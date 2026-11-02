"""Find each relay's own model, plaza, service-status, and channel-status pages.

Addresses are taken from that site's public settings, its links, or its own scripts.
A fixed path that 404s is not treated as proof the page is absent.
This module only writes the ops database. It does not change the public site.
"""

from __future__ import annotations

import json
import re
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import ops_db
import ops_probe

JSON_HEADERS = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
BROWSER_HEADERS = {"User-Agent": "Mozilla/5.0"}
DEAD = ("dns", "timeout", "connect", "tls")
RANK = {"none": 0, "auth": 1, "plaza": 2, "public": 3}
PATH_RE = re.compile(r"""(?:path|href)\s*[:=]\s*["'](/[^"'?#\s]{1,80})["']""")
QUOTED_PAGE = re.compile(
    r"""["'](/(?:channel-status|model-plaza|model-square|public/transit|pricing|models)[^"'?#\s]{0,60})["']"""
)
NAMED_ROUTE = re.compile(r"""name\s*:\s*["'](ChannelStatus|ModelPlaza|ModelSquare|PublicTransit)["']""")


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
        if not isinstance(item, dict):
            continue
        name = item.get("model_name") or item.get("model") or ""
        if not name and isinstance(item.get("id"), str):
            name = item["id"]
        if name:
            return True
    return False


def _empty(mode: str) -> dict:
    return {
        "channel_status_url": "",
        "status_url": "",
        "plaza_url": "",
        "service_status_url": "",
        "mode": mode if mode in ops_db.MODES else "none",
        "note": "",
    }


def _raise_mode(found: dict, current: str, new: str) -> None:
    if current != "none":
        found["mode"] = current
        return
    if RANK.get(new, 0) > RANK.get(found["mode"], 0):
        found["mode"] = new


def _same(origin: str, url: str) -> str:
    if not url:
        return ""
    full = urljoin(origin + "/", str(url).strip())
    parsed = urlparse(full)
    if parsed.scheme not in ("http", "https") or origin_of(full) != origin:
        return ""
    if parsed.path.startswith(("/admin", "/assets/", "/static/js/", "/static/css/")):
        return ""
    fragment = parsed.fragment.lower()
    if fragment.startswith("/") or any(key in fragment for key in ("plaza", "status", "model", "pric", "channel")):
        return full[:500]
    return full.split("#")[0][:500]


def _settings_data(body: bytes) -> dict | None:
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict):
        return None
    if not any(key in data for key in ("model_plaza_enabled", "channel_monitor_enabled", "public_transit_page_enabled")):
        return None
    return data


def _snapshot_doc(body: bytes) -> dict | None:
    if not body:
        return None
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        payload = None
    if isinstance(payload, dict):
        station = payload.get("station") if isinstance(payload.get("station"), dict) else {}
        if payload.get("monitoring") or payload.get("groups") or station.get("monitor_url"):
            return payload
    head = body[:6000].decode("utf-8", "replace")
    if "ai-transit" not in head and "monitor_url" not in head:
        return None

    def grab(key: str) -> str:
        match = re.search(rf'"{key}"\s*:\s*"([^"]*)"', head)
        return match.group(1) if match else ""

    return {"station": {"monitor_url": grab("monitor_url"), "price_url": grab("price_url")}, "groups": [{}]}


def _public_status(body: bytes) -> bool:
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        return False
    if not isinstance(payload, dict):
        return False
    if payload.get("success") is True and isinstance(payload.get("data"), dict):
        return True
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    return isinstance(data, dict) and any(key in data for key in ("start_time", "system_name", "version"))


def _waf(result: dict) -> bool:
    if result.get("status") not in (403, 503, 429):
        return False
    body = (result.get("body") or b"")[:6000].lower()
    return b"just a moment" in body or b"cf-browser" in body or b"enable javascript and cookies" in body


def classify_settings(origin: str, data: dict, snapshot: dict | None, mode: str) -> dict:
    """Read the switches the site itself publishes. Disabled means the operator turned the page off."""
    found = _empty(mode)
    notes: list[str] = []
    station = {}
    if isinstance(snapshot, dict) and isinstance(snapshot.get("station"), dict):
        station = snapshot["station"]
    if data.get("public_transit_page_enabled") is True:
        monitor = _same(origin, str(station.get("monitor_url") or ""))
        price = _same(origin, str(station.get("price_url") or ""))
        found["service_status_url"] = monitor or (origin + "/public/transit")
        notes.append("服务状态")
        if snapshot is not None:
            found["status_url"] = origin + "/api/public/transit/v1/snapshot"
            _raise_mode(found, mode, "public")
        if price and price != found["service_status_url"]:
            notes.append("模型价格")
            if not found["plaza_url"]:
                found["plaza_url"] = price
    if data.get("model_plaza_enabled") is True:
        found["plaza_url"] = origin + "/model-plaza"
        if data.get("model_plaza_require_auth") is True:
            notes.append("模型广场要登录")
            _raise_mode(found, mode, "auth")
        else:
            notes.append("模型广场")
            _raise_mode(found, mode, "plaza")
    if data.get("channel_monitor_enabled") is True:
        found["channel_status_url"] = origin + "/monitor"
        notes.append("渠道状态要登录")
        _raise_mode(found, mode, "auth")
    if not notes:
        notes.append("站点开着，没开模型广场、服务状态、渠道状态")
    found["note"] = "、".join(dict.fromkeys(notes))[:200]
    return found


def _nearest_page(text: str, index: int) -> str:
    start = max(0, index - 240)
    end = min(len(text), index + 240)
    window = text[start:end]
    center = index - start
    matches = list(PATH_RE.finditer(window)) + list(QUOTED_PAGE.finditer(window))
    if not matches:
        return ""
    matches.sort(key=lambda item: abs(item.start() - center))
    path = matches[0].group(1)
    if path.startswith(("/admin", "/assets", "/static", "/api")):
        return ""
    return path


def read_source(origin: str, text: str) -> dict:
    """Pull page URLs that sit next to the labels in this site's own script or HTML."""
    found = {"channel": "", "plaza": "", "service": "", "models": ""}
    if "model_plaza_enabled" in text and "channel_monitor_enabled" in text:
        return found
    names = {"ChannelStatus": "channel", "ModelPlaza": "plaza", "ModelSquare": "plaza", "PublicTransit": "service"}
    for match in NAMED_ROUTE.finditer(text):
        kind = names[match.group(1)]
        if found[kind]:
            continue
        path = _nearest_page(text, match.start())
        url = _same(origin, path)
        if url:
            found[kind] = url
    words = {
        "channel": ("渠道状态", "channel-status"),
        "service": ("服务状态", "service-status"),
        "plaza": ("模型广场", "model-plaza", "model-square"),
        "models": ("模型价格", "模型列表"),
    }
    lowered = text.lower()
    for kind, keys in words.items():
        if found[kind] or (kind == "models" and found["plaza"]):
            continue
        for key in keys:
            index = lowered.find(key.lower())
            if index < 0:
                continue
            url = _same(origin, _nearest_page(text, index))
            if url:
                found[kind] = url
                break
    routes = {item.strip("/") for item in re.findall(r"""path\s*:\s*["']/?([^"']+)["']""", text)}
    if not found["plaza"] and not found["models"] and any(label in text for label in ("模型广场", "模型价格", "模型列表")):
        for name in ("model-plaza", "model-square", "models", "pricing", "price"):
            if name in routes:
                slot = "plaza" if "plaza" in name or "square" in name else "models"
                found[slot] = _same(origin, "/" + name)
                break
    if not found["service"] and "服务状态" in text:
        for name in ("service-status", "uptime", "status"):
            if name in routes:
                found["service"] = _same(origin, "/" + name)
                break
    if not found["channel"] and "渠道状态" in text:
        for name in ("channel-status", "monitor"):
            if name in routes:
                found["channel"] = _same(origin, "/" + name)
                break
    return found


class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.scripts: list[str] = []
        self.inline: list[str] = []
        self._skip = 0
        self._anchor = None
        self._anchor_text: list[str] = []
        self._script = False
        self._script_src = ""
        self._script_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        raw = {key: value or "" for key, value in attrs}
        if tag in ("script", "style"):
            self._skip += 1
        if tag == "script":
            self._script = True
            self._script_src = raw.get("src") or ""
            self._script_text = []
            if self._script_src:
                self.scripts.append(self._script_src)
        if tag == "a":
            self._anchor = raw.get("href") or ""
            self._anchor_text = []

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
        if tag == "script" and self._script:
            if not self._script_src:
                blob = "".join(self._script_text).strip()
                if blob:
                    self.inline.append(blob[:100000])
            self._script = False
            self._script_src = ""
        if tag == "a" and self._anchor is not None:
            self.links.append((self._anchor, " ".join(self._anchor_text)))
            self._anchor = None

    def handle_data(self, data):
        if self._script and not self._script_src:
            self._script_text.append(data)
        if self._skip:
            return
        text = " ".join(data.split())
        if text and self._anchor is not None:
            self._anchor_text.append(text)


def _link_kind(href: str, text: str) -> str:
    blob = f"{href} {text}".lower()
    path = urlparse(href).path.lower()
    if "渠道状态" in text or "channel-status" in blob:
        return "channel"
    if "模型广场" in text or "model-plaza" in blob or "model-square" in blob:
        return "plaza"
    if "服务状态" in text or "service-status" in blob:
        return "service"
    if "模型价格" in text or "模型列表" in text or path.rstrip("/").endswith(("/models", "/models.html", "/pricing")):
        return "models"
    return ""


def read_html(origin: str, page_url: str, text: str) -> dict:
    parser = _Page()
    try:
        parser.feed(text)
    except Exception:
        pass
    found = {"channel": "", "plaza": "", "service": "", "models": "", "scripts": [], "inline": ""}
    for href, label in parser.links:
        kind = _link_kind(urljoin(page_url, href), label)
        if not kind or found[kind]:
            continue
        url = _same(origin, urljoin(page_url, href))
        if url:
            found[kind] = url
    inline = "\n".join(parser.inline)[:150000]
    if inline:
        for key, url in read_source(origin, inline).items():
            if url and not found[key]:
                found[key] = url
    found["inline"] = inline[:20000]
    scripts = []
    for src in parser.scripts:
        full = urljoin(page_url, src)
        if origin_of(full) != origin:
            continue
        low = full.lower()
        if any(skip in low for skip in ("cloudflare", "beacon", "analytics", "gtag")):
            continue
        scripts.append(full.split("#")[0])
    def rank(url: str) -> tuple:
        low = url.lower()
        if any(key in low for key in ("channel", "status", "plaza", "nav")):
            return (0, len(url))
        if "index" in low:
            return (1, len(url))
        if any(key in low for key in ("vendor", "react", "vue", "polyfill", "jquery")):
            return (3, len(url))
        return (2, len(url))
    scripts.sort(key=rank)
    found["scripts"] = scripts[:2]
    return found


def _apply_pages(found: dict, pages: dict, mode: str) -> None:
    if pages.get("channel") and not found["channel_status_url"]:
        found["channel_status_url"] = pages["channel"]
    if pages.get("service") and not found["service_status_url"]:
        found["service_status_url"] = pages["service"]
    plaza = pages.get("plaza") or ""
    models = pages.get("models") or ""
    if plaza and not found["plaza_url"]:
        found["plaza_url"] = plaza
        _raise_mode(found, mode, "plaza")
    elif models and not found["plaza_url"]:
        found["plaza_url"] = models
        _raise_mode(found, mode, "plaza")


def _note_for(found: dict) -> str:
    if found["note"]:
        return found["note"]
    parts = []
    if found["service_status_url"]:
        parts.append("服务状态")
    if found["channel_status_url"]:
        parts.append("渠道状态")
    if found["plaza_url"]:
        if "model-plaza" in found["plaza_url"] or "model-square" in found["plaza_url"]:
            parts.append("模型广场")
        else:
            parts.append("模型")
    if found["status_url"] and "服务状态" not in parts:
        parts.append("公开状态")
    return "、".join(parts)


def look_up(url: str, mode: str) -> dict:
    origin = origin_of(url)
    found = _empty(mode)
    if not origin:
        found["note"] = "打不开"
        return found
    settings = ops_probe.fetch(
        origin + "/api/v1/settings/public",
        timeout=4,
        headers=JSON_HEADERS,
        read_limit=250000,
    )
    if settings.get("error_type") in ("dns", "connect", "tls"):
        found["note"] = "打不开"
        return found
    data = _settings_data(settings.get("body") or b"") if settings.get("status") == 200 else None
    if data is not None:
        snapshot = None
        if data.get("public_transit_page_enabled") is True:
            snap = ops_probe.fetch(
                origin + "/api/public/transit/v1/snapshot",
                timeout=4,
                headers=JSON_HEADERS,
                read_limit=8000,
            )
            if snap.get("status") == 200:
                snapshot = _snapshot_doc(snap.get("body") or b"")
        return classify_settings(origin, data, snapshot, mode)
    if _waf(settings):
        found["note"] = "打不开（人机验证）"
        return found
    home = ops_probe.fetch(url, timeout=5, headers=BROWSER_HEADERS, read_limit=350000)
    if home.get("error_type") in DEAD or not home.get("body"):
        found["note"] = "打不开"
        return found
    if _waf(home):
        found["note"] = "打不开（人机验证）"
        return found
    text = (home.get("body") or b"").decode("utf-8", "replace")
    pages = read_html(origin, home.get("final_url") or url, text)
    _apply_pages(found, pages, mode)
    source = pages.get("inline") or ""
    for script in pages.get("scripts") or []:
        loaded = ops_probe.fetch(script, timeout=6, headers=BROWSER_HEADERS, read_limit=700000)
        chunk = (loaded.get("body") or b"").decode("utf-8", "replace")
        if not chunk:
            continue
        source += "\n" + chunk[:20000]
        _apply_pages(found, read_source(origin, chunk), mode)
        if found["channel_status_url"] and found["plaza_url"] and found["service_status_url"]:
            break
    spa = any("/assets/index" in item or "/static/js/" in item for item in (pages.get("scripts") or []))
    mentioned = text + "\n" + source
    if spa or "/api/status" in mentioned:
        if not found["status_url"]:
            status = ops_probe.fetch(origin + "/api/status", timeout=4, headers=JSON_HEADERS, read_limit=150000)
            if status.get("ok") and _public_status(status.get("body") or b""):
                found["status_url"] = origin + "/api/status"
                _raise_mode(found, mode, "public")
                extra_auth = ""
            elif status.get("error_type") == "auth" and spa and b"success" in (status.get("body") or b""):
                _raise_mode(found, mode, "auth")
                extra_auth = "状态要登录"
            else:
                extra_auth = ""
        else:
            extra_auth = ""
    else:
        extra_auth = ""
    if not found["plaza_url"] and ("/api/pricing" in mentioned or "模型" in text):
        pricing = ops_probe.fetch(origin + "/api/pricing", timeout=4, headers=JSON_HEADERS, read_limit=200000)
        if pricing.get("ok") and has_model_plaza(pricing.get("body") or b""):
            found["plaza_url"] = origin + "/pricing"
            _raise_mode(found, mode, "plaza")
    label = _note_for(found)
    if extra_auth and extra_auth not in label:
        label = f"{label}、{extra_auth}" if label else extra_auth
    found["note"] = (label or "打开后没看到模型、模型广场、服务状态、渠道状态")[:200]
    return found


def apply_lookup(
    station_id: int,
    current_mode: str,
    current_status_url: str,
    current_channel: str,
    current_plaza: str,
    current_service: str,
    found: dict,
) -> None:
    mode = current_mode if current_mode != "none" else (found.get("mode") or "none")
    if mode not in ops_db.MODES:
        mode = current_mode if current_mode in ops_db.MODES else "none"
    ops_db.save_page_notes(
        station_id,
        found.get("channel_status_url") or current_channel or "",
        found.get("plaza_url") or current_plaza or "",
        mode,
        current_status_url or found.get("status_url") or "",
        found.get("service_status_url") or current_service or "",
        found.get("note") or "",
    )


def scan_unchecked(workers: int = 40) -> dict:
    socket.setdefaulttimeout(4)
    rows = ops_db.stations_for_page_scan()
    counts = {
        "checked": 0,
        "channel": 0,
        "plaza": 0,
        "service": 0,
        "public": 0,
        "auth": 0,
        "down": 0,
        "plain": 0,
        "left": len(rows),
    }
    print({"start": len(rows)}, flush=True)

    def one(row):
        try:
            return row, look_up(row["url"], row["status_mode"])
        except Exception as err:
            found = _empty(row["status_mode"])
            found["note"] = "打不开"
            print({"station_error": row.get("id"), "error": type(err).__name__}, flush=True)
            return row, found

    for start in range(0, len(rows), 40):
        chunk = rows[start:start + 40]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(one, row) for row in chunk]
            for future in as_completed(futures):
                row, found = future.result()
                apply_lookup(
                    row["id"],
                    row["status_mode"],
                    row["status_url"],
                    row.get("channel_status_url") or "",
                    row.get("plaza_url") or "",
                    row.get("service_status_url") or "",
                    found,
                )
                counts["checked"] += 1
                if found.get("note") in ("打不开", "打不开（人机验证）"):
                    counts["down"] += 1
                if found.get("channel_status_url"):
                    counts["channel"] += 1
                if found.get("plaza_url"):
                    counts["plaza"] += 1
                if found.get("service_status_url"):
                    counts["service"] += 1
                mode = row["status_mode"] if row["status_mode"] != "none" else found.get("mode")
                if mode == "public":
                    counts["public"] += 1
                elif mode == "auth":
                    counts["auth"] += 1
                elif mode == "none" and found.get("note") not in ("打不开", "打不开（人机验证）"):
                    counts["plain"] += 1
        counts["left"] = len(rows) - (start + len(chunk))
        print(counts, flush=True)
    return counts
