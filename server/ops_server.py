#!/usr/bin/env python3
"""Operations console. Bind local. UI is the Arco admin, API is this process."""

from __future__ import annotations

import os
import threading
import time

import ops_db
import ops_http
import ops_jobs


def _clock() -> None:
    while True:
        time.sleep(60)
        try:
            ops_jobs.maybe_schedule()
        except Exception as err:
            print("schedule failed:", err)


def main() -> None:
    password = ops_db.bootstrap()
    host = os.environ.get("OPS_HOST", "127.0.0.1")
    port = int(os.environ.get("OPS_PORT", "4180"))
    if os.environ.get("OPS_SCHEDULER", "1") != "0":
        threading.Thread(target=_clock, daemon=True).start()
    server = ops_http.make_server(host, port)
    print(f"运营后台 http://{host}:{port}")
    if password:
        print("首次启动，初始密码写在 data/admin-bootstrap.txt")
    server.serve_forever()


if __name__ == "__main__":
    main()
