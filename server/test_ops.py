"""Behavior checks for the operations console."""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(tempfile.mkdtemp(prefix="ops-test-"))
os.environ["OPS_DB"] = str(ROOT / "ops.sqlite")
os.environ["OPS_SECRET"] = "ops-test-secret"
os.environ["OPS_PASSWORD"] = "test-pass-123"
os.environ["OPS_USER"] = "admin"
os.environ["OPS_SCHEDULER"] = "0"
os.environ["OPS_SNAPSHOT"] = str(ROOT / "ops-snapshot.json")

import ops_crypto
import ops_db
import ops_http
import ops_jobs

STATE = {"price": "1", "models": ["claude-opus-x", "gpt-4o"]}


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, code: int, body: bytes, location: str = "") -> None:
        self.send_response(code)
        if location:
            self.send_header("Location", location)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self) -> None:
        port = self.server.server_address[1]
        if self.path.startswith("/jump"):
            self._send(302, b"", f"http://127.0.0.1:{port}/land")
            return
        if self.path.startswith("/api/status"):
            payload = {"models": STATE["models"], "price": STATE["price"]}
            self._send(200, json.dumps(payload).encode())
            return
        if self.path.startswith("/v1/models"):
            if self.headers.get("Authorization") != "Bearer sk-test-key-1234":
                self._send(401, b"{}")
                return
            self._send(200, json.dumps({"data": [{"id": name} for name in STATE["models"]]}).encode())
            return
        self._send(200, b"ok")

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self._send(200, json.dumps({"usage": {"total_tokens": 8}}).encode())


class Client:
    def __init__(self, base: str):
        self.base = base
        self.cookie = ""

    def __call__(self, method: str, path: str, body=None, headers=None, auth: bool = True):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if auth:
            request.add_header("X-Ops", "1")
        if self.cookie:
            request.add_header("Cookie", self.cookie)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request) as response:
                raw = response.read()
                self._take_cookie(response.headers.get("Set-Cookie"))
                return response.status, json.loads(raw.decode()) if raw else {}
        except urllib.error.HTTPError as err:
            raw = err.read()
            self._take_cookie(err.headers.get("Set-Cookie"))
            return err.code, json.loads(raw.decode()) if raw else {}

    def _take_cookie(self, header: str | None) -> None:
        if header and "ops_session=" in header:
            self.cookie = header.split(";", 1)[0]


class OpsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        threading.Thread(target=cls.fixture.serve_forever, daemon=True).start()
        cls.ops = ops_http.make_server("127.0.0.1", 0)
        threading.Thread(target=cls.ops.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.ops.server_address[1]}"
        cls.fix = f"http://127.0.0.1:{cls.fixture.server_address[1]}"
        cls.client = Client(cls.base)
        status, me = cls.client("POST", "/api/login", {"username": "admin", "password": "test-pass-123"}, auth=False)
        assert status == 200, me
        assert me["username"] == "admin"

    @classmethod
    def tearDownClass(cls):
        cls.ops.shutdown()
        cls.fixture.shutdown()

    def test_password_and_key_roundtrip(self):
        salt = b"1234567890abcdef"
        encoded = ops_crypto.hash_password("test-pass-123", salt)
        self.assertTrue(ops_crypto.check_password("test-pass-123", salt, encoded))
        self.assertFalse(ops_crypto.check_password("nope", salt, encoded))
        token = ops_crypto.encrypt(ops_crypto.load_secret(Path(".")), "sk-test-key-1234")
        self.assertEqual(ops_crypto.decrypt(ops_crypto.load_secret(Path(".")), token), "sk-test-key-1234")

    def test_login_rejects_bad_password(self):
        status, body = self.client("POST", "/api/login", {"username": "admin", "password": "wrong-pass"}, auth=False)
        self.assertEqual(status, 401)
        self.assertIn("error", body)

    def test_station_key_is_write_only(self):
        status, row = self.client("POST", "/api/stations", {
            "name": "本地状态",
            "domain": "127.0.0.1",
            "url": self.fix + "/",
            "status_mode": "public",
            "tier": "featured",
            "listed": True,
        })
        self.assertEqual(status, 200, row)
        self.station_id = row["id"]
        status, saved = self.client("POST", f"/api/stations/{row['id']}/key", {"key": "sk-test-key-1234"})
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["key_hint"], "…1234")
        self.assertNotIn("sk-test-key-1234", json.dumps(saved))
        status, again = self.client("GET", f"/api/stations/{row['id']}")
        self.assertNotIn("sk-test-key-1234", json.dumps(again))
        self.assertEqual(ops_db.read_key(row["id"]), "sk-test-key-1234")

    def test_probe_changes_price_and_models(self):
        status, station = self.client("POST", "/api/stations", {
            "name": "状态页",
            "domain": "status.local",
            "url": self.fix + "/",
            "status_mode": "public",
            "tier": "featured",
        })
        self.assertEqual(status, 200, station)
        STATE["price"] = "1"
        STATE["models"] = ["claude-opus-x", "gpt-4o"]
        status, probed = self.client("POST", f"/api/stations/{station['id']}/probe", {})
        self.assertEqual(status, 200, probed)
        self.assertEqual(probed["last_up"], 1)
        self.assertGreaterEqual(probed["last_model_count"], 2)
        STATE["price"] = "3"
        STATE["models"] = ["gpt-4o"]
        status, again = self.client("POST", f"/api/stations/{station['id']}/probe", {})
        self.assertEqual(status, 200, again)
        changes = self.client("GET", "/api/changes")[1]["items"]
        kinds = {item["kind"] for item in changes}
        self.assertIn("price", kinds)
        self.assertIn("models", kinds)
        alerts = self.client("GET", "/api/alerts?status=open")[1]["items"]
        alert_kinds = {item["kind"] for item in alerts}
        self.assertIn("flagship", alert_kinds)
        self.assertIn("price", alert_kinds)

    def test_auth_probe_stops_at_budget(self):
        self.client("POST", "/api/settings", {"daily_budget": "0", "cost_per_call": "0.01"})
        status, row = self.client("POST", "/api/stations", {
            "name": "要 Key",
            "domain": "auth.local",
            "url": self.fix + "/",
            "status_mode": "auth",
            "test_model": "gpt-4o",
            "key": "sk-test-key-1234",
        })
        self.assertEqual(status, 200, row)
        status, probed = self.client("POST", f"/api/stations/{row['id']}/probe", {})
        self.assertEqual(status, 200, probed)
        runs = self.client("GET", f"/api/runs?station_id={row['id']}&kind=basic")[1]["items"]
        self.assertTrue(any(item["error_type"] == "budget" for item in runs))
        self.client("POST", "/api/settings", {"daily_budget": "5"})

    def test_status_source_uses_known_pages(self):
        public, url = ops_db._classify_status(["https://ezapi.site/api/status"], "auth")
        self.assertEqual(public, "public")
        self.assertEqual(url, "https://ezapi.site/api/status")
        auth_mode, empty = ops_db._classify_status(["https://ezapi.site/"], "auth")
        self.assertEqual((auth_mode, empty), ("auth", ""))
        none_mode, empty = ops_db._classify_status([], "empty")
        self.assertEqual((none_mode, empty), ("none", ""))

    def test_redirect_alert_and_down_age(self):
        status, row = self.client("POST", "/api/stations", {
            "name": "跳转",
            "domain": "other.test",
            "url": self.fix + "/jump",
            "status_mode": "none",
        })
        self.assertEqual(status, 200, row)
        status, probed = self.client("POST", f"/api/stations/{row['id']}/probe", {})
        self.assertEqual(status, 200, probed)
        self.assertEqual(probed["last_up"], 1)
        alerts = self.client("GET", "/api/alerts?status=open")[1]["items"]
        self.assertTrue(any(item["kind"] == "redirect" and item["station_id"] == row["id"] for item in alerts))

    def test_ad_caps_clicks_and_expiry(self):
        start = date.today().isoformat()
        end = (date.today() + timedelta(days=10)).isoformat()
        made = []
        for index in range(2):
            status, row = self.client("POST", "/api/ads", {
                "slot": "sponsor",
                "name": f"赞助{index}",
                "blurb": "一句介绍",
                "target_url": "https://example.com/a",
                "start_date": start,
                "end_date": end,
            })
            self.assertEqual(status, 200, row)
            made.append(row)
        status, blocked = self.client("POST", "/api/ads", {
            "slot": "sponsor",
            "name": "超额",
            "blurb": "一句介绍",
            "target_url": "https://example.com/b",
            "start_date": start,
            "end_date": end,
        })
        self.assertEqual(status, 400)
        self.assertIn("最多", blocked["error"])
        long_blurb = "字" * 41
        status, _ = self.client("POST", "/api/ads", {
            "slot": "footer",
            "name": "太长",
            "blurb": long_blurb,
            "target_url": "https://example.com/c",
            "start_date": start,
            "end_date": end,
        })
        self.assertEqual(status, 400)
        status, banned = self.client("POST", "/api/ads", {
            "slot": "footer",
            "name": "推荐站",
            "blurb": "一句介绍",
            "target_url": "https://example.com/d",
            "start_date": start,
            "end_date": end,
        })
        self.assertEqual(status, 400)
        self.assertIn("推荐", banned["error"])
        status, seen = self.client("POST", "/api/collect", {"ad_id": made[0]["id"]}, auth=False)
        self.assertEqual(status, 204)
        connection = http.client.HTTPConnection("127.0.0.1", self.ops.server_address[1])
        connection.request("GET", f"/go/{made[0]['id']}")
        response = connection.getresponse()
        self.assertEqual(response.status, 302)
        self.assertEqual(response.getheader("Location"), "https://example.com/a")
        detail = self.client("GET", f"/api/ads/{made[0]['id']}")[1]
        self.assertEqual(detail["impressions"], 1)
        self.assertEqual(detail["clicks"], 1)
        expired = self.client("POST", "/api/ads", {
            "slot": "footer",
            "name": "到期",
            "blurb": "今天撤下",
            "target_url": "https://example.com/old",
            "start_date": (date.today() - timedelta(days=3)).isoformat(),
            "end_date": start,
        })[1]
        connection.request("GET", f"/go/{expired['id']}")
        gone = connection.getresponse()
        self.assertEqual(gone.status, 404)

    def test_traffic_splits_bots(self):
        self.client("POST", "/api/collect", {"path": "/site/demo", "referrer": "https://news.example/a"}, auth=False, headers={"User-Agent": "Mozilla/5.0"})
        self.client("POST", "/api/collect", {"path": "/site/demo", "referrer": ""}, auth=False, headers={"User-Agent": "curl/8.0"})
        report = self.client("GET", "/api/traffic")[1]
        row = next(item for item in report["paths"] if item["path"] == "/site/demo")
        self.assertGreaterEqual(row["human"], 1)
        self.assertGreaterEqual(row["bot"], 1)

    def test_submission_approve_and_complaint(self):
        status, row = self.client("POST", "/api/submissions", {
            "source": "replica",
            "site_name": "仿站甲",
            "url": "https://replica.example/",
            "contact": "a@example.com",
            "body": "申请收录",
        })
        self.assertEqual(status, 200, row)
        status, decided = self.client("POST", f"/api/submissions/{row['id']}/approve", {})
        self.assertEqual(decided["status"], "approved")
        stations = self.client("GET", "/api/stations?q=replica.example")[1]
        self.assertEqual(stations["total"], 1)
        self.assertEqual(stations["items"][0]["listed"], 1)
        status, complaint = self.client("POST", "/api/complaints", {"body": "页面打不开", "url": "https://replica.example/", "station_id": stations["items"][0]["id"]})
        self.assertEqual(status, 200, complaint)
        closed = self.client("POST", f"/api/complaints/{complaint['id']}/close", {})[1]
        self.assertEqual(closed["status"], "closed")
        runs = self.client("GET", f"/api/runs?station_id={stations['items'][0]['id']}")[1]
        self.assertEqual(runs["total"], 0)

    def test_publish_snapshot_has_no_rank(self):
        status, published = self.client("POST", "/api/publish", {})
        self.assertEqual(status, 200, published)
        text = Path(published["path"]).read_text(encoding="utf-8")
        self.assertNotIn("rank", text)
        self.assertIn("/go/", text)
        snapshot = json.loads(text)
        self.assertIn("ads", snapshot)
        self.assertNotIn("uptime", text)
        self.assertNotIn("latency", text)

    def test_reject_and_takedown(self):
        row = self.client("POST", "/api/submissions", {
            "source": "external",
            "site_name": "外链乙",
            "url": "https://out.example/",
            "contact": "",
            "body": "",
        })[1]
        decided = self.client("POST", f"/api/submissions/{row['id']}/reject", {})[1]
        self.assertEqual(decided["status"], "rejected")
        self.assertEqual(self.client("GET", "/api/stations?q=out.example")[1]["total"], 0)
        station = self.client("POST", "/api/stations", {
            "name": "待下架",
            "domain": "down.example",
            "url": "https://down.example",
            "status_mode": "none",
        })[1]
        down = self.client("POST", f"/api/stations/{station['id']}/takedown", {"down": True})[1]
        self.assertEqual(down["taken_down"], 1)
        self.assertEqual(down["listed"], 0)

    def test_site_registry(self):
        status, site = self.client("POST", "/api/sites", {
            "domain": "link.example",
            "kind": "external",
            "template": "目录模板",
            "url": self.fix + "/",
            "last_published_at": "2026-10-31",
        })
        self.assertEqual(status, 200, site)
        checked = self.client("POST", f"/api/sites/{site['id']}/check", {})[1]
        self.assertEqual(checked["last_up"], 1)
        detail = self.client("GET", f"/api/sites/{site['id']}")[1]
        self.assertGreaterEqual(len(detail["checks"]), 1)


if __name__ == "__main__":
    unittest.main()
