"""Isolated proposal storage and public/operations HTTP regression tests."""
import concurrent.futures
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import community
import ops_http
import proposals


class ProposalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(proposals, "DB", Path(self.tmp.name) / "proposals.sqlite")
        self.db_patch.start()
        self.user = {"email": "one@example.test", "nick": "提名人"}
        self.other = {"email": "two@example.test", "nick": "支持者"}
        self.body = {"name": "测试站", "url": "https://www.example.com/", "reason": "想看推理表现", "tests": ["basic", "candy"]}

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def create(self):
        return proposals.create(self.body, self.user)["item"]["id"]

    def test_normalized_duplicate_and_no_private_identity(self):
        pid = self.create()
        second = proposals.create({**self.body, "url": "example.com/v1"}, self.other)
        self.assertTrue(second["duplicate"])
        self.assertEqual(second["item"]["id"], pid)
        item = proposals.detail(pid)
        self.assertEqual(item["host"], "example.com")
        self.assertNotIn("owner", item)
        self.assertNotIn(self.user["email"], json.dumps(item))
        self.assertEqual(item["votes"], 0)

    def test_concurrent_votes_idempotent_retract_and_persist(self):
        pid = self.create()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda _: proposals.support(pid, self.user, True), range(12)))
        self.assertEqual(proposals.detail(pid)["votes"], 1)
        proposals.support(pid, self.other, True)
        self.assertEqual(proposals.listing({})["stats"]["supporters"], 2)
        self.assertFalse(proposals.detail(pid)["mine"])
        self.assertTrue(proposals.detail(pid, self.user["email"])["mine"])
        proposals.support(pid, self.user, False)
        self.assertEqual(proposals.detail(pid)["votes"], 1)

    def test_comments_rate_limit_moderation_and_progress(self):
        pid = self.create()
        row = proposals.comment(pid, self.user, "重点看 Claude 的推理表现")
        self.assertNotIn(self.user["email"], json.dumps(row))
        with self.assertRaises(ValueError):
            proposals.comment(pid, self.user, "重复刷屏")
        cid = row["comments"][0]["id"]
        proposals.moderate(pid, {"commentId": cid, "hidden": True})
        self.assertEqual(proposals.detail(pid)["commentCount"], 0)
        self.assertEqual(len(proposals.detail(pid, admin=True)["comments"]), 1)
        proposals.moderate(pid, {"commentId": cid, "hidden": False})
        row = proposals.moderate(pid, {"status": "done", "note": "已收录并完成测试", "result_url": "/b/basic-example"})
        self.assertEqual(row["status"], "done")
        self.assertEqual(proposals.detail(pid)["result_url"], "/b/basic-example")
        self.assertEqual(proposals.listing({})["stats"]["done"], 1)
        with self.assertRaises(ValueError):
            proposals.support(pid, self.user, True)
        proposals.moderate(pid, {"hidden": True})
        self.assertEqual(proposals.listing({})["total"], 0)
        self.assertEqual(proposals.listing({}, admin=True)["total"], 1)
        with self.assertRaises(ValueError):
            proposals.detail(pid)

    def test_input_validation(self):
        for url in ["javascript:alert(1)", "http://127.0.0.1", "http://localhost", "https://example.com?key=secret", "https://user:pass@example.com", "https://example.com/#key", "https://example.com:1234"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                proposals.create({**self.body, "url": url}, self.user)
        for tests in [[], ["unknown"], [{}], "basic", None]:
            with self.subTest(tests=tests), self.assertRaises(ValueError):
                proposals.create({**self.body, "tests": tests}, self.user)
        with self.assertRaises(ValueError):
            proposals.create({**self.body, "reason": "sk-TEST_FAKE_SECRET_123456789"}, self.user)
        pid = self.create()
        for url in ["https://other.example", "//other.example", "/site/x\\evil", "/b/x\ny", "/account"]:
            with self.subTest(result=url), self.assertRaises(ValueError):
                proposals.moderate(pid, {"result_url": url})

    def test_filters_pagination_and_submission_limit(self):
        for n in range(12):
            proposals.create({**self.body, "url": f"https://station-{n}.example.com", "name": f"测试 {n:02}"}, {"email": f"person{n}@example.test"})
        self.assertEqual(len(proposals.listing({})["items"]), 10)
        self.assertEqual(len(proposals.listing({"page": 2})["items"]), 2)
        self.assertEqual(proposals.listing({"page": 999})["page"], 2)
        self.assertEqual(proposals.listing({"q": "测试 11"})["total"], 1)
        self.assertEqual(proposals.listing({"status": "done"})["total"], 0)
        self.assertEqual(proposals.listing({"q": "' OR 1=1 --"})["total"], 0)
        for n in range(5):
            proposals.create({**self.body, "url": f"https://own-{n}.example.com"}, self.user)
        with self.assertRaises(ValueError):
            proposals.create({**self.body, "url": "https://over.example.com"}, self.user)

    def test_public_and_operations_http(self):
        # Fake users/sessions exist only in a temporary store; no real accounts change.
        datafile = Path(self.tmp.name) / "community.json"
        datafile.write_text(json.dumps({"accounts": {self.user["email"]: self.user}, "sessions": {"test-session": self.user["email"]}}), encoding="utf-8")
        with patch.object(community, "DATA", datafile), patch.object(ops_http.ops_db, "operator_from_token", side_effect=lambda token: {"id": 1} if token == "test-operator" else None):
            public = ThreadingHTTPServer(("127.0.0.1", 0), community.Handler)
            admin = ThreadingHTTPServer(("127.0.0.1", 0), ops_http.OpsHandler)
            workers = [threading.Thread(target=s.serve_forever, daemon=True) for s in (public, admin)]
            for worker in workers:
                worker.start()
            def request(server, method, path, body=None, headers=None):
                conn = HTTPConnection("127.0.0.1", server.server_port, timeout=10)
                conn.request(method, path, json.dumps(body) if body is not None else None, headers or {})
                response = conn.getresponse()
                result = response.status, json.loads(response.read())
                conn.close()
                return result
            try:
                self.assertEqual(request(public, "GET", "/api/proposals")[0], 200)
                self.assertEqual(request(public, "POST", "/api/proposals", self.body)[0], 401)
                status, data = request(public, "POST", "/api/proposals", self.body, {"Authorization": "Bearer test-session"})
                self.assertEqual(status, 200)
                pid = data["item"]["id"]
                self.assertEqual(request(public, "POST", f"/api/proposals/{pid}/support", {"on": True})[0], 401)
                auth = {"Authorization": "Bearer test-session"}
                self.assertTrue(request(public, "POST", f"/api/proposals/{pid}/support", {"on": True}, auth)[1]["mine"])
                self.assertEqual(request(public, "POST", f"/api/proposals/{pid}/comments", {"content": "希望看看稳定性"}, auth)[1]["commentCount"], 1)
                self.assertEqual(request(admin, "GET", "/api/proposals")[0], 401)
                self.assertEqual(request(admin, "POST", f"/api/proposals/{pid}", {"hidden": True}, {"Cookie": "ops_session=test-operator"})[0], 400)
                ops_auth = {"Cookie": "ops_session=test-operator", "X-Ops": "1"}
                self.assertEqual(request(admin, "POST", f"/api/proposals/{pid}", {"status": "planned", "note": "等待安排"}, ops_auth)[0], 200)
                self.assertEqual(request(public, "GET", f"/api/proposals/{pid}")[1]["note"], "等待安排")
                self.assertEqual(request(public, "GET", "/api/proposals/bad/route")[0], 404)
            finally:
                for server in (public, admin):
                    server.shutdown(); server.server_close()
                for worker in workers:
                    worker.join()


if __name__ == "__main__":
    unittest.main()
