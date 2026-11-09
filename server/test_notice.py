"""Notice editing and image regressions using isolated files and HTTP storage."""

import base64
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import community
import ops_front
import ops_http


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


class NoticeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.enterContext(patch.object(community, "ROOT", self.root))
        self.enterContext(patch.object(ops_front, "NOTICE_FILE", self.root / "data" / "notice.json"))
        self.enterContext(patch.object(ops_http, "ROOT", self.root))
        self.enterContext(patch.object(ops_http, "DIST", self.root / "admin" / "dist"))
        self.form = ops_front.read_notice()

    def upload(self):
        return ops_front.save_notice_image({"data": "data:image/png;base64," + base64.b64encode(PNG).decode()})["url"]

    def test_existing_notice_keeps_default_icon(self):
        ops_front.NOTICE_FILE.parent.mkdir()
        ops_front.NOTICE_FILE.write_text(json.dumps({"title": "原公告", "body": "原正文"}), encoding="utf-8")
        self.assertEqual(ops_front.read_notice()["icon"], "/icons/vendor/deepseek.svg")
        self.assertEqual(ops_front.public_notice()["icon"], "/icons/vendor/deepseek.svg")

    def test_upload_does_not_publish_until_saved(self):
        (self.root / "dist").mkdir()
        icon = self.upload()
        self.assertEqual((self.root / "public" / icon.lstrip("/")).read_bytes(), PNG)
        self.assertEqual((self.root / "dist" / icon.lstrip("/")).read_bytes(), PNG)
        self.assertEqual(ops_front.read_notice(), self.form)
        saved = ops_front.save_notice({**self.form, "icon": icon, "body": "第一行\n第二行"})
        self.assertEqual(ops_front.read_notice()["icon"], icon)
        self.assertEqual(ops_front.public_notice()["icon"], icon)
        self.assertEqual(ops_front.public_notice()["body"], "第一行\n第二行")
        self.assertNotEqual(saved["id"], self.form["id"])
        self.assertEqual(ops_front.save_notice(saved)["id"], saved["id"])

    def test_visible_changes_create_distinct_versions(self):
        current = ops_front.save_notice(self.form)
        for key, value in [("icon", self.upload()), ("title", "新标题"), ("date", "2026-11-09"), ("body", "新正文"), ("actionLabel", "去看看"), ("actionTo", "/sites")]:
            saved = ops_front.save_notice({**current, key: value})
            self.assertNotEqual(current["id"], saved["id"], key)
            current = saved

    def test_older_client_preserves_uploaded_icon_and_reset_works(self):
        saved = ops_front.save_notice({**self.form, "icon": self.upload()})
        del saved["icon"]
        icon = ops_front.read_notice()["icon"]
        self.assertEqual(ops_front.save_notice(saved)["icon"], icon)
        reset = ops_front.save_notice({**saved, "icon": ""})
        self.assertEqual(reset["icon"], self.form["icon"])

    def test_disabled_notice_and_optional_action(self):
        ops_front.save_notice({**self.form, "enabled": False})
        self.assertEqual(ops_front.public_notice(), {"enabled": False})
        ops_front.save_notice({**self.form, "actionLabel": ""})
        self.assertIsNone(ops_front.public_notice()["action"])

    def test_invalid_images_and_icon_paths_rejected(self):
        for data in ["bad-base64", base64.b64encode(b"<svg>unsafe</svg>").decode(), base64.b64encode(PNG + b"x" * 2_000_000).decode()]:
            with self.assertRaises(ValueError):
                ops_front.save_notice_image({"data": data})
        for icon in ["https://example.test/icon.png", "data:image/svg+xml,<svg/>", "/media/notices/../../secret.png"]:
            with self.assertRaises(ValueError):
                ops_front.save_notice({**self.form, "icon": icon})
        self.assertFalse(ops_front.NOTICE_FILE.exists())

    def test_prize_upload_still_uses_prize_directory(self):
        saved = ops_front.save_prize_image({"data": base64.b64encode(PNG).decode()})
        self.assertTrue(saved["url"].startswith("/media/prizes/"))
        self.assertEqual((self.root / "public" / saved["url"].lstrip("/")).read_bytes(), PNG)

    def test_http_upload_save_publication_and_image_serving(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), ops_http.OpsHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        operator = self.enterContext(patch.object(ops_http.ops_db, "operator_from_token", return_value={"id": 1}))

        def request(method, path, body=None):
            conn = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            self.addCleanup(conn.close)
            conn.request(method, path, json.dumps(body) if body is not None else None, {"Content-Type": "application/json", "X-Ops": "1"})
            response = conn.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()

        status, _, body = request("POST", "/api/notice/upload", {"data": base64.b64encode(PNG).decode()})
        self.assertEqual(status, 200)
        icon = json.loads(body)["url"]
        self.assertEqual(request("GET", icon), (200, "image/png", PNG))
        status, _, body = request("POST", "/api/notice", {**self.form, "icon": icon})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["icon"], ops_front.public_notice()["icon"])
        operator.return_value = None
        self.assertEqual(request("POST", "/api/notice/upload", {"data": "invalid"})[0], 401)
        self.assertEqual(request("GET", icon), (200, "image/png", PNG))


if __name__ == "__main__":
    unittest.main()
