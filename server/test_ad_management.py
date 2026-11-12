"""Ad lifecycle, placement availability, and the save-time capacity guard."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ops_db


class AdManagementTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix="ad-management-")
        self.addCleanup(self.root.cleanup)
        self.env = patch.dict(os.environ, {"OPS_DB": str(Path(self.root.name) / "ops.sqlite")})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.clock = patch.object(ops_db, "today", return_value="2026-11-11")
        self.clock.start()
        self.addCleanup(self.clock.stop)
        conn = ops_db.open_db()
        ops_db.init_schema(conn)
        conn.execute("DELETE FROM ads")
        conn.commit()
        conn.close()

    def make(self, name, slot="footer", start="2026-11-10", end="2026-11-20", paused=False):
        return ops_db.save_ad({"name": name, "slot": slot, "start_date": start, "end_date": end,
                               "paused": paused, "target_url": "https://example.com/register?aff=keep"})

    def capacity(self, **kwargs):
        return ops_db.ad_availability({"slot": "sponsor", "start": "2026-11-11", "end": "2026-11-14", **kwargs})

    def test_status_boundaries_and_unfiltered_overview(self):
        self.make("今天开始", start="2026-11-11")
        soon = self.make("七天后撤下", end="2026-11-18")
        self.make("明天开始", start="2026-11-12")
        self.make("今天已撤下", end="2026-11-11")
        self.make("暂停且过期", end="2026-11-11", paused=True)
        data = ops_db.list_ads({"status": "expiring", "size": 1})
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], soon["id"])
        self.assertEqual(data["items"][0]["days_remaining"], 7)
        self.assertEqual(data["overview"]["summary"], {"total": 5, "live": 2, "scheduled": 1, "paused": 1, "expired": 1, "expiring": 1})
        for state in ("live", "scheduled", "paused", "expired"):
            rows = ops_db.list_ads({"status": state})["items"]
            self.assertTrue(rows)
            self.assertTrue(all(row["status"] == state for row in rows))

    def test_physical_placement_filters_include_packages_and_literal_search(self):
        package = self.make("品牌_100%套餐", slot="full")
        self.make("列表页套餐", slot="list_footer")
        self.make("普通页脚")
        self.assertEqual(ops_db.list_ads({"slot": "list_top"})["total"], 2)
        self.assertEqual(ops_db.list_ads({"slot": "footer"})["total"], 3)
        self.assertEqual(ops_db.list_ads({"slot": "full"})["total"], 1)
        self.assertEqual(ops_db.list_ads({"q": "_100%"})["items"][0]["id"], package["id"])
        self.assertEqual(ops_db.list_ads({"q": "example.com"})["total"], 3)
        placements = {row["slot"]: row for row in ops_db.list_ads({})["overview"]["placements"]}
        self.assertEqual(placements["sponsor"]["remaining"], 1)
        self.assertEqual(placements["list_top"]["used"], 2)
        self.assertIsNone(placements["footer"]["capacity"])

    def test_packages_conflicts_edit_exclusion_and_back_to_back_bookings(self):
        full = self.make("全包广告", slot="full", end="2026-11-14")
        first = self.make("前半档期", slot="sponsor", end="2026-11-12")
        self.make("后半档期", slot="sponsor", start="2026-11-12", end="2026-11-14")
        data = self.capacity()
        self.assertFalse(data["available"])
        self.assertEqual(data["placements"][0]["peak"], 2)
        self.assertEqual({row["id"] for row in data["placements"][0]["conflict"]["ads"]}, {full["id"], first["id"]})
        self.assertTrue(self.capacity(exclude_id=full["id"])["available"])
        self.assertTrue(self.capacity(start="2026-11-14", end="2026-11-16")["available"])
        with self.assertRaisesRegex(ValueError, "最多 2 条"):
            self.make("超额广告", slot="sponsor", end="2026-11-14")

    def test_paused_ads_do_not_reserve_and_save_rechecks_after_preview(self):
        self.make("暂停草稿", slot="full", paused=True)
        self.assertTrue(self.capacity()["available"])
        self.make("新占位一", slot="sponsor")
        self.make("新占位二", slot="sponsor")
        with self.assertRaisesRegex(ValueError, "最多"):
            self.make("检查后被抢占", slot="full")
        self.assertTrue(self.capacity(slot="footer")["available"])

    def test_non_simultaneous_bookings_and_invalid_ranges(self):
        self.make("第一段", slot="sponsor", end="2026-11-12")
        self.make("第二段", slot="sponsor", start="2026-11-12", end="2026-11-14")
        self.assertTrue(self.capacity()["available"])
        self.assertEqual(self.capacity()["placements"][0]["peak"], 1)
        self.make("跨两段", slot="sponsor", end="2026-11-14")
        for args in ({"start": "2026-11-14"}, {"end": "bad"}, {"slot": "unknown"}, {"exclude_id": -1}):
            with self.assertRaises(ValueError):
                self.capacity(**args)

    def test_pause_only_updates_state_and_resume_checks_capacity(self):
        row = self.make("可暂停广告", slot="sponsor")
        updated = ops_db.save_ad({**row, "target_url": "https://changed.example/?aff=NEW", "description": "最新文案"}, row["id"])
        paused = ops_db.set_ad_paused(row["id"], True)
        self.assertEqual(paused["target_url"], updated["target_url"])
        self.assertEqual(paused["description"], "最新文案")
        self.assertEqual(paused["status"], "paused")
        self.make("占位一", slot="sponsor")
        self.make("占位二", slot="sponsor")
        with self.assertRaisesRegex(ValueError, "最多"):
            ops_db.set_ad_paused(row["id"], False)
        self.assertEqual(ops_db.get_ad(row["id"])["status"], "paused")
        with self.assertRaises(ValueError):
            ops_db.set_ad_paused(row["id"], "false")


if __name__ == "__main__":
    unittest.main()
