"""Production report deep links retain the built application shell."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import community


class ReportRouteTests(unittest.TestCase):
    def test_unbuilt_report_routes_keep_assets_and_loading_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shell = root / "check/detect/index.html"
            shell.parent.mkdir(parents=True)
            shell.write_text('<html><head><meta name="robots" content="index,follow">'
                             '<link rel="stylesheet" href="/assets/site.css"></head>'
                             '<body><div id="root"><header class="topbar">Navigation</header>'
                             '<main><h1>Stale result</h1></main><footer>Footer</footer></div>'
                             '<script type="module" src="/assets/site.js"></script></body></html>', encoding="utf-8")
            with patch.object(community, "DIST", root), patch.object(community, "DATA", root / "community.json"), patch.object(community, "SEED", root / "none.json"):
                server = ThreadingHTTPServer(("127.0.0.1", 0), community.Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    for suite in ("basic", "all", "candy", "pelican"):
                        conn = HTTPConnection(*server.server_address, timeout=5)
                        conn.request("GET", f"/b/{suite}-fixture123")
                        response = conn.getresponse()
                        body = response.read().decode()
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.getheader("X-Robots-Tag"), "noindex")
                        self.assertIn("正在加载检测结果", body)
                        self.assertIn("/assets/site.css", body)
                        self.assertIn("/assets/site.js", body)
                        self.assertIn('class="topbar"', body)
                        self.assertNotIn("Stale result", body)
                        conn.close()
                    self.assertIsNone(community.report_loading_html("/b/not-a-report"))
                    self.assertIsNone(community.report_loading_html("/b/basic-../secrets"))
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
