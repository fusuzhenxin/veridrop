import copy
import unittest
from unittest.mock import patch

import station_status as status


def board():
    return {"groups": [{
        "provider_slug": "aicodemirror", "channel": "官方直连", "service": "cx",
        "layers": [{"model": "gpt-test", "current_status": {"status": 1, "latency": 1250, "timestamp": 1794282300},
                    "timeline": [{"timestamp": 1794275100, "availability": 100},
                                 {"timestamp": 1794278700, "availability": -1},
                                 {"timestamp": 1794282300, "availability": 50}]}],
    }]}


class PublicStatusTests(unittest.TestCase):
    def setUp(self):
        status._cache.clear()

    def test_mean_excludes_missing_but_includes_zero_and_keeps_real_series(self):
        sample = board()
        row = status.normalize(sample, "24h")["models"][0]
        self.assertEqual(row["uptime"], "75%")
        self.assertEqual(row["latency"], "1.25s")
        self.assertEqual([p[1] for p in row["points"]], [100, -1, 50])
        self.assertIsNone(row["score"])
        self.assertIsNone(row["input"])
        sample["groups"][0]["layers"][0]["timeline"][2]["availability"] = 0
        self.assertEqual(status.normalize(sample, "24h")["models"][0]["uptime"], "50%")

    def test_missing_probe_and_invalid_numbers_are_not_successes(self):
        sample = board()
        layer = sample["groups"][0]["layers"][0]
        layer["current_status"] = {"status": -1, "latency": 0}
        for p in layer["timeline"]:
            p["availability"] = float("nan")
        row = status.normalize(sample, "24h")["models"][0]
        self.assertEqual(row["uptime"], "—")
        self.assertEqual(row["latency"], "—")
        self.assertTrue(all(p[1] == -1 for p in row["points"]))

    def test_group_keeps_worst_model_and_distinguishes_service(self):
        sample = board()
        second = copy.deepcopy(sample["groups"][0]["layers"][0])
        second["model"] = "gpt-other"
        second["timeline"][0]["availability"] = 0
        second["current_status"]["latency"] = 3000
        sample["groups"][0]["layers"].append(second)
        other = copy.deepcopy(sample["groups"][0])
        other["service"] = "gm"
        sample["groups"].append(other)
        result = status.normalize(sample, "7d")
        self.assertEqual(len(result["models"]), 4)
        self.assertNotEqual(result["groups"][0]["name"], result["groups"][1]["name"])
        self.assertEqual(result["groups"][0]["avail"], 25)
        self.assertEqual(result["groups"][0]["latencyMs"], 3000)
        self.assertEqual(result["groups"][0]["points"][0][1], 0)

    @patch.object(status, "_fetch")
    def test_only_fixed_station_and_periods_can_fetch(self, fetch):
        for station, period in [("https://127.0.0.1/", "24h"), ("3", "arbitrary"), ("4", "24h")]:
            self.assertEqual(status.read(station, period)[0], 400)
        fetch.assert_not_called()

    @patch.object(status.time, "time", return_value=10000)
    @patch.object(status, "_fetch")
    def test_shared_cache_period_isolation_and_bounded_stale_fallback(self, fetch, clock):
        fetch.side_effect = lambda period: status.normalize(board(), period)
        first = status.read("3", "24h")[1]
        self.assertFalse(first["stale"])
        status.read("479", "24h")
        self.assertEqual(fetch.call_count, 1)
        status.read("3", "7d")
        self.assertEqual(fetch.call_count, 2)
        clock.return_value = 10400
        fetch.side_effect = OSError("unavailable")
        stale = status.read("3", "24h")[1]
        self.assertTrue(stale["stale"])
        self.assertEqual(stale["fetchedAt"], first["fetchedAt"])
        clock.return_value = 14000
        self.assertEqual(status.read("3", "24h")[0], 502)

    def test_foxcode_keeps_routes_separate_and_uses_upstream_uptime(self):
        board = {"publicGroupList": [{"name": "Claude Code 分组", "monitorList": [
            {"id": 2, "name": "Claude Code 官方专用线路"}]}]}
        heartbeat = {"uptimeList": {"2_24": .9959}, "heartbeatList": {"2": [
            {"status": 1, "time": "2026-11-10 01:05:00", "ping": 1500},
            {"status": 0, "time": "2026-11-10 01:00:00", "ping": 0},
            {"status": 2, "time": "2026-11-10 01:01:00", "ping": 0},
            {"status": 3, "time": "2026-11-10 01:02:00", "ping": 0},
            {"status": 1, "time": "bad-date", "ping": 0},
        ]}}
        result = status.normalize_foxcode(board, heartbeat)
        row = result["models"][0]
        self.assertTrue(result["routeOnly"])
        self.assertEqual(result["period"], "24h")
        self.assertEqual(row["id"], "foxcode-monitor-2")
        self.assertEqual(row["uptime"], "99.59%")
        self.assertEqual(row["latency"], "1.50s")
        self.assertEqual([point[1] for point in row["points"]], [0, -1, -1, 100])
        self.assertEqual(row["points"][0][0], 1794272400)  # UTC, independent of server timezone.
        self.assertEqual(result["groups"][0]["name"], "Claude Code 官方专用线路")
        self.assertIsNone(row["input"])
        self.assertIsNone(row["score"])
        for state in (0, 2, 3, -1):
            heartbeat["heartbeatList"]["2"][0]["status"] = state
            self.assertEqual(status.normalize_foxcode(board, heartbeat)["models"][0]["latency"], "—")
        heartbeat["uptimeList"]["2_24"] = float("nan")
        self.assertEqual(status.normalize_foxcode(board, heartbeat)["models"][0]["uptime"], "—")
        heartbeat["uptimeList"]["2_24"] = 0
        self.assertEqual(status.normalize_foxcode(board, heartbeat)["models"][0]["uptime"], "0%")

    @patch.object(status, "_fetch_foxcode")
    @patch.object(status, "_fetch")
    def test_foxcode_cache_cannot_leak_into_other_stations_or_fabricate_history(self, relay, fox):
        relay.side_effect = lambda period: status.normalize(board(), period)
        fox.return_value = {"period": "24h", "source": status.FOXCODE_SOURCE, "models": [{"id": "route"}]}
        self.assertEqual(status.read("5", "24h")[1]["source"], status.FOXCODE_SOURCE)
        self.assertEqual(status.read("3", "24h")[1]["source"], status.SOURCE)
        status.read("5", "24h")
        fox.assert_called_once()
        relay.assert_called_once()
        for period in ("7d", "30d"):
            self.assertEqual(status.read("5", period)[0], 400)
        fox.side_effect = OSError("down")
        status._cache.clear()
        self.assertEqual(status.read("5", "24h")[1]["source"], status.FOXCODE_SOURCE)


if __name__ == "__main__":
    unittest.main()
