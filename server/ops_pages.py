"""Find public channel-status pages and model plazas. Does not change the public site."""

from __future__ import annotations

import json
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import ops_db
import ops_probe


def origin_of(url: str) -> str:
    parsed = urlparse(str(url or ""))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def has_channel_status(body: bytes) -> bool:
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        return False
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        data = payload if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return False
    return any(key in data for key in ("groups", "summary", "window_minutes"))


def has_model_plaza(body: bytes) -> bool:
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        return False
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return False
    for item in rows[:40]:
        if isinstance(item, dict) and (item.get("model_name") or item.get("model")):
            return True
    return False


def _html_channel(result: dict) -> bool:
    if not result.get("ok"):
        return False
    path = urlparse(result.get("final_url") or "").path
    if "channel-status" not in path:
        return False
    return b"channel-status" in (result.get("body") or b"")


def look_up(url: str, mode: str) -> dict:
    origin = origin_of(url)
    found = {"channel_status_url": "", "status_url": "", "plaza_url": "", "mode": mode}
    if not origin:
        return found
    api = ops_probe.fetch(
        origin + "/api/channel-status?minutes=90",
        timeout=3,
        headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"},
        read_limit=800000,
    )
    if api.get("ok") and has_channel_status(api.get("body") or b""):
        found["channel_status_url"] = origin + "/channel-status"
        found["status_url"] = origin + "/api/channel-status?minutes=90"
        if mode == "none":
            found["mode"] = "public"
        return found
    if api.get("error_type") in ("dns", "timeout", "connect", "tls"):
        return found
    if api.get("status") == 404:
        page = ops_probe.fetch(origin + "/channel-status", timeout=4, headers={"User-Agent": "Mozilla/5.0"})
    else:
        page = {"ok": False}
    if _html_channel(page):
        found["channel_status_url"] = origin + "/channel-status"
        if mode == "none":
            found["mode"] = "public"
        return found
    if mode != "none":
        return found
    pricing = ops_probe.fetch(origin + "/api/pricing", timeout=4, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
    if pricing.get("ok") and has_model_plaza(pricing.get("body") or b""):
        found["plaza_url"] = origin + "/pricing"
        found["mode"] = "plaza"
        return found
    plaza = ops_probe.fetch(origin + "/api/v1/model-plaza", timeout=4, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
    if plaza.get("ok") and has_model_plaza(plaza.get("body") or b""):
        found["plaza_url"] = origin + "/api/v1/model-plaza"
        found["mode"] = "plaza"
    return found


def apply_lookup(station_id: int, current_mode: str, current_status_url: str, found: dict) -> None:
    mode = current_mode
    status_url = current_status_url or ""
    if found["channel_status_url"] and mode == "none":
        mode = "public"
        if not status_url:
            status_url = found["status_url"]
    elif found["plaza_url"] and mode == "none":
        mode = "plaza"
    ops_db.save_page_notes(
        station_id,
        found["channel_status_url"],
        found["plaza_url"],
        mode,
        status_url,
    )


def scan_unchecked(workers: int = 80) -> dict:
    socket.setdefaulttimeout(3)
    rows = ops_db.stations_for_page_scan()
    counts = {"checked": 0, "channel": 0, "plaza": 0, "still_none": 0, "left": len(rows)}
    print({"start": len(rows)}, flush=True)

    def one(row):
        found = look_up(row["url"], row["status_mode"])
        return row, found

    for start in range(0, len(rows), 100):
        chunk = rows[start:start + 100]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(one, row) for row in chunk]
            for future in as_completed(futures):
                row, found = future.result()
                apply_lookup(row["id"], row["status_mode"], row["status_url"], found)
                counts["checked"] += 1
                if found["channel_status_url"]:
                    counts["channel"] += 1
                elif found["plaza_url"]:
                    counts["plaza"] += 1
                elif row["status_mode"] == "none":
                    counts["still_none"] += 1
        counts["left"] = len(rows) - (start + len(chunk))
        print(counts, flush=True)
    return counts
