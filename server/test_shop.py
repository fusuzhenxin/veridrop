"""Prize code inventory regressions; all stores and HTTP requests are isolated."""
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
import ops_front


class ShopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for name, value in [("DATA", Path(self.tmp.name) / "community.json"),
                            ("SHOP_FILE", Path(self.tmp.name) / "shop.json"),
                            ("SEED", Path(self.tmp.name) / "no-seed.json")]:
            self.enterContext(patch.object(community, name, value))
        self.item = {"id": "gift", "title": "独立码奖品", "cost": 20,
                     "codeMode": "unique", "codes": ["gift-A", "gift-B"], "key": "unused-shared"}
        self.store = community.empty_store()
        for i in range(12):
            community.points_book(self.store, f"user-{i}")["balance"] = 100
        community.save_store(self.store)
        self.save()

    def save(self, **changes):
        self.item.update(changes)
        return ops_front.save_prizes({"items": [self.item]})

    def redeem(self, user="user-0"):
        return community.redeem_shop_item(self.store, user, "gift")

    def test_distinct_codes_private_and_persisted(self):
        first, second = self.redeem(), self.redeem("user-1")
        self.assertEqual(first["item"]["key"], "gift-A")
        self.assertEqual(second["item"]["key"], "gift-B")
        self.assertEqual(second["item"]["stock"], 2)
        self.assertEqual(second["item"]["sold"], 2)
        self.assertEqual(second["item"]["remaining"], 0)
        community.save_store(self.store)
        reloaded = community.load_store()
        self.assertEqual(community.public_shop(reloaded, "user-0")["items"][0]["key"], "gift-A")
        for user in ("", "user-2"):
            public = community.public_shop(reloaded, user)["items"][0]
            self.assertNotIn("key", public)
            self.assertNotIn("codes", public)
            self.assertNotIn("url", public)
        self.assertNotIn("gift-B", json.dumps(community.public_shop(reloaded, "user-0")))

    def test_exhaustion_and_idempotent_retry_even_after_closing(self):
        first = self.redeem()
        self.redeem("user-1")
        with self.assertRaisesRegex(ValueError, "兑完"):
            self.redeem("user-2")
        self.assertEqual(community.points_book(self.store, "user-2")["balance"], 100)
        self.save(status="closed", key="replacement")
        again = self.redeem()
        self.assertEqual(again["item"]["key"], first["item"]["key"])
        self.assertEqual(again["points"]["balance"], 80)
        self.assertEqual(len(community.points_book(self.store, "user-0")["ledger"]), 1)

    def test_insufficient_points_does_not_consume_code(self):
        community.points_book(self.store, "user-0")["balance"] = 0
        with self.assertRaisesRegex(ValueError, "积分不够"):
            self.redeem()
        self.assertEqual(community.shop_inventory(self.store, self.item)["remaining"], 2)
        self.assertEqual(self.redeem("user-1")["item"]["key"], "gift-A")

    def test_restock_does_not_reissue_removed_codes_or_change_existing_order(self):
        self.redeem()
        community.save_store(self.store)
        self.save(codes=["gift-B", "gift-C"], url="https://example.test/new")
        self.assertEqual(self.redeem("user-1")["item"]["key"], "gift-B")
        self.save(codes=["gift-A", "gift-B", "gift-C"])
        self.assertEqual(self.redeem("user-2")["item"]["key"], "gift-C")
        self.assertEqual(self.redeem()["item"]["url"], "")
        self.assertEqual(self.redeem()["item"]["key"], "gift-A")

    def test_claim_ledger_survives_order_removal(self):
        self.redeem()
        self.store["shop"]["orders"].pop("user-0")
        self.assertEqual(self.redeem("user-1")["item"]["key"], "gift-B")

    def test_total_cap_and_empty_pool(self):
        self.save(stock=1)
        self.redeem()
        with self.assertRaisesRegex(ValueError, "兑完"):
            self.redeem("user-1")
        self.save(stock=None, codes=[])
        with self.assertRaisesRegex(ValueError, "兑完"):
            self.redeem("user-1")
        self.assertEqual(community.public_shop(self.store)["items"][0]["remaining"], 0)

    def test_legacy_shared_code_compatibility_and_order_snapshot(self):
        self.item.pop("codeMode")
        self.item.pop("codes")
        self.save(key="shared-original", url="https://example.test/old", stock=3)
        self.assertEqual(self.redeem()["item"]["key"], "shared-original")
        self.assertEqual(self.redeem("user-1")["item"]["key"], "shared-original")
        self.save(key="shared-new", url="https://example.test/new")
        own = self.redeem()["item"]
        self.assertEqual(own["key"], "shared-original")
        self.assertEqual(own["url"], "https://example.test/old")
        self.assertEqual(self.redeem("user-2")["item"]["key"], "shared-new")

    def test_switch_from_shared_reserves_previous_code(self):
        self.save(codeMode="shared", key="gift-A")
        self.redeem()
        self.save(codeMode="unique")
        self.assertEqual(self.redeem("user-1")["item"]["key"], "gift-B")

    def test_admin_validation_and_inventory(self):
        saved = self.save(codes=" gift-A \n\ngift-B \r\n")["rows"][0]
        self.assertEqual(saved["codes"], ["gift-A", "gift-B"])
        self.assertEqual(saved["codeRemaining"], 2)
        for bad in (["gift-A", " gift-A "], [123], {"invalid": "code"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.save(codes=bad)
        self.save(codes=["gift-A", "gift-B"])
        with self.assertRaisesRegex(ValueError, "不同奖品"):
            ops_front.save_prizes({"items": [self.item, {**self.item, "id": "other"}]})
        self.redeem()
        community.save_store(self.store)
        row = ops_front.prizes()["rows"][0]
        self.assertEqual((row["sold"], row["codeUsed"], row["codeRemaining"]), (1, 1, 1))
        self.assertEqual(ops_front.redemptions()["rows"][0]["key"], "gift-A")

    def start_http(self):
        def fixture_user(handler, store):
            user = handler.headers.get("Authorization", "")
            return {"email": user} if user.startswith("user-") else None
        self.enterContext(patch.object(community.Handler, "_user", fixture_user))
        self.enterContext(patch.object(community.Handler, "log_message", lambda *args: None))
        server = ThreadingHTTPServer(("127.0.0.1", 0), community.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def request(self, port, user, method="POST"):
        conn = HTTPConnection("127.0.0.1", port, timeout=25)
        try:
            conn.request(method, "/api/shop/redeem" if method == "POST" else "/api/shop",
                         json.dumps({"id": "gift"}) if method == "POST" else None,
                         {"Content-Type": "application/json", "Authorization": user})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_http_concurrent_buyers_never_oversell(self):
        port = self.start_http()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda i: self.request(port, f"user-{i}"), range(12)))
        successes = [body for status, body in results if status == 200]
        self.assertEqual(len(successes), 2, results)
        self.assertEqual({body["item"]["key"] for body in successes}, {"gift-A", "gift-B"})
        store = community.load_store()
        self.assertEqual(sum(100 - community.points_book(store, f"user-{i}")["balance"] for i in range(12)), 40)
        status, body = self.request(port, "", "GET")
        self.assertEqual(status, 200)
        self.assertNotIn("gift-A", json.dumps(body))
        self.assertEqual(self.request(port, "")[0], 401)

    def test_http_concurrent_retries_charge_once(self):
        port = self.start_http()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: self.request(port, "user-0"), range(8)))
        self.assertTrue(all(status == 200 for status, _ in results), results)
        self.assertEqual({body["item"]["key"] for _, body in results}, {"gift-A"})
        store = community.load_store()
        self.assertEqual(community.points_book(store, "user-0")["balance"], 80)
        self.assertEqual(community.shop_inventory(store, self.item)["codeRemaining"], 1)


if __name__ == "__main__":
    unittest.main()
