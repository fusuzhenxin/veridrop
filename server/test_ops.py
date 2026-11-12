"""Behavior checks for the operations console."""

from __future__ import annotations

import http.client
import base64
import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from urllib.parse import quote
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

    def test_channel_status_and_plaza_payloads(self):
        import ops_pages

        channel = b'{"data":{"window_minutes":90,"summary":{"success_rate":96},"groups":[]}}'
        self.assertTrue(ops_pages.has_channel_status(channel))
        self.assertFalse(ops_pages.has_channel_status(b'{"success":false}'))
        pricing = b'{"data":[{"model_name":"gpt-4o"}]}'
        self.assertTrue(ops_pages.has_model_plaza(pricing))
        self.assertFalse(ops_pages.has_model_plaza(b'{"data":[]}'))

    def test_site_settings_name_their_own_pages(self):
        import ops_pages

        data = {
            "model_plaza_enabled": True,
            "model_plaza_require_auth": False,
            "channel_monitor_enabled": True,
            "public_transit_page_enabled": True,
        }
        snapshot = {
            "groups": [{"name": "default"}],
            "monitoring": [{"name": "claude"}],
            "station": {
                "monitor_url": "https://wawazz.xyz/public/transit?view=monitoring",
                "price_url": "https://wawazz.xyz/public/transit",
            },
        }
        found = ops_pages.classify_settings("https://wawazz.xyz", data, snapshot, "none")
        self.assertEqual(found["mode"], "public")
        self.assertEqual(found["service_status_url"], "https://wawazz.xyz/public/transit?view=monitoring")
        self.assertEqual(found["plaza_url"], "https://wawazz.xyz/model-plaza")
        self.assertEqual(found["channel_status_url"], "https://wawazz.xyz/monitor")
        self.assertEqual(found["status_url"], "https://wawazz.xyz/api/public/transit/v1/snapshot")
        self.assertIn("服务状态", found["note"])
        self.assertIn("模型广场", found["note"])
        self.assertIn("渠道状态要登录", found["note"])
        off = ops_pages.classify_settings(
            "https://sparkapi.top",
            {"model_plaza_enabled": False, "channel_monitor_enabled": False, "public_transit_page_enabled": False},
            None,
            "none",
        )
        self.assertEqual(off["mode"], "none")
        self.assertIn("没开", off["note"])
        login = ops_pages.classify_settings(
            "https://api.9ksj.com",
            {"model_plaza_enabled": True, "model_plaza_require_auth": True, "channel_monitor_enabled": False},
            None,
            "none",
        )
        self.assertEqual(login["mode"], "auth")
        self.assertIn("要登录", login["note"])

    def test_page_text_uses_the_sites_own_links(self):
        import ops_pages

        html = """
        <html><head><script src="/assets/index-abc.js"></script></head>
        <body>
          <a href="/models.html">模型价格</a>
          <a href="https://status.anthropic.com/">服务状态</a>
          <script>const path = '/channel-status'; entry.textContent = '渠道状态';</script>
        </body></html>
        """
        pages = ops_pages.read_html("https://dmxapi.cn", "https://dmxapi.cn/", html)
        self.assertEqual(pages["models"], "https://dmxapi.cn/models.html")
        hashed = '<a href="/portal#/plaza">模型广场</a>'
        self.assertEqual(
            ops_pages.read_html("https://ai.baipiao.co", "https://ai.baipiao.co/", hashed)["plaza"],
            "https://ai.baipiao.co/portal#/plaza",
        )
        self.assertEqual(pages["service"], "")
        self.assertEqual(pages["channel"], "https://dmxapi.cn/channel-status")
        bundled = 'model_plaza_enabled:!1,channel_monitor_enabled:!0,name:"ChannelStatus",path:"/monitor"'
        self.assertEqual(ops_pages.read_source("https://wawazz.xyz", bundled)["channel"], "")
        routes = 'path:"models",sectionPricing:"模型价格"'
        self.assertEqual(ops_pages.read_source("https://ai.irobotx.org", routes)["models"], "https://ai.irobotx.org/models")
        head = b'{"schema_version":"ai-transit.v1","station":{"monitor_url":"https://codex666ai.com/public/transit?view=monitoring","price_url":"https://codex666ai.com/public/transit"}'
        snap = ops_pages._snapshot_doc(head)
        self.assertEqual(snap["station"]["monitor_url"], "https://codex666ai.com/public/transit?view=monitoring")

    def test_page_notes_do_not_downgrade_public_status(self):
        import ops_pages

        status, row = self.client("POST", "/api/stations", {
            "name": "已有状态",
            "domain": "keep.example",
            "url": "https://keep.example/",
            "status_mode": "public",
            "status_url": "https://keep.example/api/status",
        })
        self.assertEqual(status, 200, row)
        ops_pages.apply_lookup(row["id"], "public", "https://keep.example/api/status", "", "", "", {
            "channel_status_url": "https://keep.example/monitor",
            "plaza_url": "",
            "service_status_url": "",
            "status_url": "",
            "mode": "auth",
            "note": "渠道状态要登录",
        })
        got = self.client("GET", f"/api/stations/{row['id']}")[1]
        self.assertEqual(got["status_mode"], "public")
        self.assertEqual(got["status_url"], "https://keep.example/api/status")
        self.assertEqual(got["channel_status_url"], "https://keep.example/monitor")
        self.assertEqual(got["page_note"], "渠道状态要登录")

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

    def test_ad_analytics_endpoint_filters_ai_and_attributes_directory(self):
        day = ops_db.today()
        row = ops_db.save_ad({"slot":"footer", "name":"归因测试", "target_url":"https://analytics.example/register",
                              "start_date":day,"end_date":(date.fromisoformat(day)+timedelta(days=2)).isoformat()})
        base = {"kind":"ad", "surface":"directory", "target_url":"https://analytics.example/", "placement":"directory-visit", "path":"/list?secret=hidden"}
        for agent, action in [("Mozilla/5.0 Chrome/130.0","impression"),("GPTBot/1.2","impression"),("Mozilla/5.0 Chrome/130.0","click")]:
            status, _ = self.client("POST","/api/collect",{**base,"action":action},auth=False,headers={"User-Agent":agent})
            self.assertEqual(status,204)
        route = f"/api/ads/analytics?ad_id={row['id']}&start={day}&end={day}"
        status, report = self.client("GET",route)
        self.assertEqual(status,200)
        self.assertEqual(report["all"]["impressions"],2)
        self.assertEqual(report["human"]["impressions"],1)
        self.assertEqual(report["summary"]["clicks"],1)
        self.assertEqual(report["sources"][0]["path"],"/list")
        self.assertEqual(Client(self.client.base)("GET",route)[0],401)

    def test_traffic_splits_bots(self):
        self.client("POST", "/api/collect", {"path": "/site/demo", "referrer": "https://news.example/a"}, auth=False, headers={"User-Agent": "Mozilla/5.0"})
        self.client("POST", "/api/collect", {"path": "/site/demo", "referrer": ""}, auth=False, headers={"User-Agent": "curl/8.0"})
        report = self.client("GET", "/api/traffic")[1]
        row = next(item for item in report["paths"] if item["path"] == "/site/demo")
        self.assertGreaterEqual(row["human"], 1)
        self.assertGreaterEqual(row["bot"], 1)

    def test_public_ads_follow_saved_schedule_without_snapshot(self):
        day = ops_db.today()
        end = (date.fromisoformat(day) + timedelta(days=2)).isoformat()
        payload = {"slot": "footer", "name": "动态广告验证", "blurb": "实时更新", "description": "保存后直接展示",
                   "image_url": "/media/sponsors/sidrune-920x350.png", "target_url": "https://example.com/runtime-ad",
                   "start_date": day, "end_date": end}
        status, row = self.client("POST", "/api/ads", payload)
        self.assertEqual(status, 200, row)
        status, feed = self.client("GET", "/api/public/ads", auth=False)
        self.assertEqual(status, 200, feed)
        public = next(item for item in feed["ads"]["footer"] if item["id"] == row["id"])
        self.assertEqual(public["description"], payload["description"])
        self.assertEqual(public["imageUrl"], payload["image_url"])
        self.assertEqual(public["href"], f"/go/{row['id']}")
        self.assertNotIn("target_url", public)
        self.client("POST", f"/api/ads/{row['id']}", {**payload, "paused": True})
        feed = self.client("GET", "/api/public/ads", auth=False)[1]
        self.assertFalse(any(item["id"] == row["id"] for item in feed["ads"]["footer"]))
        expired = {**payload, "start_date": (date.fromisoformat(day) - timedelta(days=2)).isoformat(), "end_date": day}
        self.client("POST", f"/api/ads/{row['id']}", expired)
        feed = self.client("GET", "/api/public/ads", auth=False)[1]
        self.assertFalse(any(item["id"] == row["id"] for item in feed["ads"]["footer"]))

    def test_ad_upload_requires_admin_and_accepts_banner_size(self):
        image = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 160000).decode()
        anonymous = Client(self.client.base)
        self.assertEqual(anonymous("POST", "/api/ads/upload", {"data": image})[0], 401)
        with patch.object(ops_http.ops_front.community, "ROOT", ROOT):
            (ROOT / "dist").mkdir(exist_ok=True)
            status, uploaded = self.client("POST", "/api/ads/upload", {"data": image})
            self.assertEqual(status, 200, uploaded)
            self.assertTrue(uploaded["url"].startswith("/media/ads/"))
            self.assertEqual((ROOT / "public" / uploaded["url"].lstrip("/")).read_bytes(), (ROOT / "dist" / uploaded["url"].lstrip("/")).read_bytes())
            self.assertEqual(self.client("POST", "/api/ads/upload", {"data": base64.b64encode(b"<script/>").decode()})[0], 400)

    def test_ad_packages_expand_and_share_placement_capacity(self):
        day = ops_db.today()
        end = (date.fromisoformat(day) + timedelta(days=2)).isoformat()
        # Other tests book the two corner slots; isolate this scenario.
        previous = self.client("GET", "/api/ads?size=200")[1]["items"]
        for item in previous:
            self.client("POST", f"/api/ads/{item['id']}", {**item, "paused": True})
        payload = {"slot": "full", "name": "三处投放", "target_url": "https://example.com/full",
                   "start_date": day, "end_date": end}
        status, row = self.client("POST", "/api/ads", payload)
        self.assertEqual(status, 200, row)
        feed = self.client("GET", "/api/public/ads", auth=False)[1]["ads"]
        for key in ("sponsor", "listTop", "footer"):
            self.assertTrue(any(item["id"] == row["id"] for item in feed[key]))
        self.client("POST", "/api/ads", {**payload, "slot": "sponsor", "name": "另一个角标"})
        status, blocked = self.client("POST", "/api/ads", {**payload, "name": "超额套餐"})
        self.assertEqual(status, 400, blocked)
        self.assertIn("左右角标", blocked["error"])
        status, pair = self.client("POST", "/api/ads", {**payload, "slot": "list_footer", "name": "列表与页脚"})
        self.assertEqual(status, 200, pair)
        feed = self.client("GET", "/api/public/ads", auth=False)[1]["ads"]
        self.assertFalse(any(item["id"] == pair["id"] for item in feed["sponsor"]))
        for key in ("listTop", "footer"):
            self.assertTrue(any(item["id"] == pair["id"] for item in feed[key]))

    def test_ad_placement_check_requires_login_and_returns_capacity(self):
        day = ops_db.today()
        end = (date.fromisoformat(day) + timedelta(days=3)).isoformat()
        query = f"/api/ads/availability?slot=full&start={day}&end={end}"
        self.assertEqual(Client(self.base)("GET", query, auth=False)[0], 401)
        status, body = self.client("GET", query)
        self.assertEqual(status, 200, body)
        self.assertEqual([item["slot"] for item in body["placements"]], ["sponsor", "list_top", "footer"])
        self.assertIsNone(body["placements"][2]["capacity"])
        self.assertEqual(self.client("GET", query.replace("slot=full", "slot=invalid"))[0], 400)
        created = self.client("POST", "/api/ads", {"slot": "footer", "name": "状态切换", "target_url": "https://example.com/state", "start_date": day, "end_date": end})[1]
        status, paused = self.client("POST", f"/api/ads/{created['id']}/state", {"paused": True})
        self.assertEqual(status, 200, paused)
        self.assertEqual(paused["status"], "paused")
        self.assertEqual(self.client("POST", f"/api/ads/{created['id']}/state", {})[0], 400)

    def test_ad_order_ledger_is_private_and_records_installments(self):
        day = ops_db.today()
        end = (date.fromisoformat(day) + timedelta(days=30)).isoformat()
        anonymous = Client(self.base)
        self.assertEqual(anonymous('GET', '/api/ad-orders', auth=False)[0], 401)
        payload = {'advertiser':'订单广告主', 'title':'接口订单', 'slot':'footer', 'start_date':day, 'end_date':end,
                   'amount':'100.10', 'request_key':'test-order-ledger-0001'}
        status, order = self.client('POST', '/api/ad-orders', payload)
        self.assertEqual(status, 200, order)
        self.assertEqual(self.client('POST', '/api/ad-orders', payload)[1]['id'], order['id'])
        self.assertEqual(anonymous('GET', f"/api/ad-orders/{order['id']}", auth=False)[0], 401)
        status, partial = self.client('POST', f"/api/ad-orders/{order['id']}/payments", {
            'kind':'receipt', 'amount':'40.05', 'paid_on':day, 'method':'微信', 'request_key':'test-order-payment-0001'})
        self.assertEqual(status, 200, partial)
        self.assertEqual(partial['outstanding_cents'], 6005)
        self.assertEqual(self.client('GET', '/api/ad-orders?q=' + quote('接口订单'))[1]['total'], 1)
        self.assertEqual(self.client('POST', f"/api/ad-orders/{order['id']}/cancel", {'version':1})[0], 409)
        cancelled = self.client('POST', f"/api/ad-orders/{order['id']}/cancel", {'version':partial['version']})[1]
        self.assertEqual(cancelled['status'], 'cancelled')

    def test_ad_campaign_report_calendar_and_delivery_are_private(self):
        day = ops_db.today()
        end = (date.fromisoformat(day) + timedelta(days=10)).isoformat()
        renewed_end = (date.fromisoformat(end) + timedelta(days=10)).isoformat()
        ad = self.client('POST','/api/ads',{'name':'排期接口广告','slot':'footer','target_url':'https://example.com/','start_date':day,'end_date':end})[1]
        status, order = self.client('POST','/api/ad-orders',{'title':'排期验证合同','advertiser':'测试广告主','contact':'private@example.com','ad_id':ad['id'],'slot':'footer','start_date':end,'end_date':renewed_end,'amount':'99.90','request_key':'campaign-http-order-0001'})
        self.assertEqual(status,200,order)
        path = f"/api/ad-orders/{order['id']}"
        for route in (path+'/report',path+'/delivery-preview','/api/ads/calendar?month='+day[:7]):
            self.assertEqual(Client(self.base)('GET',route,auth=False)[0],401)
            self.assertEqual(self.client('GET',route)[0],200)
        report = self.client('GET',path+'/report')[1]
        self.assertNotIn('contact',report['order'])
        self.assertNotIn('amount_cents',report['order'])
        self.assertEqual(self.client('GET',path+'/report?mode=invalid')[0],400)
        self.assertEqual(self.client('GET','/api/ads/calendar?month=bad')[0],400)
        plan = self.client('GET',path+'/delivery-preview')[1]
        self.assertTrue(plan['can_apply'])
        self.assertEqual(self.client('GET',f"/api/ads/{ad['id']}")[1]['end_date'],end)
        self.assertEqual(Client(self.base)('POST',path+'/delivery',{},auth=False,headers={'X-Ops':'1'})[0],401)
        self.assertEqual(self.client('POST',path+'/delivery',{'request_key':'http-preview-wrong-0001','preview_token':'stale'})[0],409)
        body={'request_key':'http-delivery-apply-0001','preview_token':plan['preview_token']}
        status, updated = self.client('POST',path+'/delivery',body)
        self.assertEqual(status,200,updated)
        self.assertEqual(len(updated['deliveries']),1)
        self.assertEqual(len(self.client('POST',path+'/delivery',body)[1]['deliveries']),1)
        self.assertEqual(self.client('GET',f"/api/ads/{ad['id']}")[1]['end_date'],renewed_end)

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
