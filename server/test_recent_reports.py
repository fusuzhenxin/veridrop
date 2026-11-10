from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import threading
import unittest
from unittest.mock import patch
import json

import basic_reports
import community


class RecentReportTests(unittest.TestCase):
    def test_sorted_whitelist_and_invalid_reports(self):
        report = {"id": "basic-fixture123", "stationId": 1852, "host": "relay.example",
                  "score": 89, "at": "2026-11-10T01:00:00Z", "raw": "private-response",
                  "key": "private-credential", "model": "model", "channel": "OpenAI"}
        older = {**report, "id": "basic-older123", "at": "2026-11-09T01:00:00Z", "score": 0}
        invalid = [{**report, "score": None}, {**report, "score": True}, {**report, "score": float("nan")},
                   {**report, "id": "../secret"}, {**report, "at": "bad"}, {**report, "at": "2026-11-10"}]
        with patch.object(basic_reports, "read_index", return_value=[older, *invalid, report]):
            rows = basic_reports.recent_summaries()
            self.assertEqual([row["score"] for row in rows], [89, 0])
            self.assertNotIn("raw", rows[0])
            self.assertNotIn("key", rows[0])
            self.assertEqual(len(basic_reports.recent_summaries(1)), 1)

    def test_public_recent_endpoint_is_uncached(self):
        expected = [{"id": "basic-fixture123", "stationId": 1852, "score": 93}]
        with patch.object(basic_reports, "recent_summaries", return_value=expected):
            server = ThreadingHTTPServer(("127.0.0.1", 0), community.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                conn = HTTPConnection(*server.server_address, timeout=5)
                conn.request("GET", "/api/basic-reports?recent=1")
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Cache-Control"), "no-store")
                self.assertEqual(json.loads(response.read()), {"reports": expected})
                conn.close()
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
