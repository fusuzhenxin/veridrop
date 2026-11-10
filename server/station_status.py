"""Read-only, cached access to fixed public station monitoring boards."""

import gzip
import io
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from visits import _ssl_context

SOURCE = "https://status.claudecode.net.cn/"
FOXCODE_SOURCE = "https://status.rjj.cc/status/foxcode"
STATIONS = {"3", "479", "5"}
PERIODS = {"24h", "7d", "30d"}
TTL = 300
MAX_STALE = 3600
LIMIT = 4_000_000
_cache = {}
_locks = {(source, period): threading.Lock() for source in (SOURCE, FOXCODE_SOURCE) for period in PERIODS}
_services = {"cc": "Claude", "cx": "Codex", "gm": "Gemini", "grok": "Grok"}


def number(value, minimum=0, maximum=None):
    if value is None or isinstance(value, bool) or value == "":
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(result) or result < minimum or (maximum is not None and result > maximum):
        return None
    return result


def normalize(board, period):
    models, groups = [], []
    for group in board.get("groups", []):
        if group.get("provider_slug") != "aicodemirror":
            continue
        channel = str(group.get("channel") or "默认线路")[:100]
        service = str(group.get("service") or "")[:30]
        name = f"{channel} · {_services.get(service, service)}"
        rows = []
        for layer in group.get("layers", []):
            model = str(layer.get("model") or layer.get("request_model") or "")[:180]
            if not model:
                continue
            points = []
            for point in layer.get("timeline", []):
                stamp = number(point.get("timestamp"), minimum=1_000_000_000)
                if stamp is None:
                    continue
                avail = number(point.get("availability"), maximum=100)
                points.append([int(stamp), avail if avail is not None else -1])
            points.sort(key=lambda item: item[0])
            valid = [point[1] for point in points if point[1] >= 0]
            availability = round(sum(valid) / len(valid), 2) if valid else None
            current = layer.get("current_status") or {}
            latency = number(current.get("latency"))
            stamp = number(current.get("timestamp"), minimum=1_000_000_000)
            # A missing probe is not a zero-millisecond success.
            if current.get("status") not in (0, 1, 2):
                latency = None
            row = {
                "id": model, "name": model, "group": name,
                "input": None, "output": None, "cache": None, "ratio": None,
                "score": None, "service": "status", "points": points,
                "uptime": f"{availability:g}%" if availability is not None else "—",
                "latency": f"{latency / 1000:.2f}s" if latency is not None else "—",
                "latencyMs": latency, "checkedAt": int(stamp) if stamp else None,
                "monitored": True,
            }
            rows.append(row)
            models.append(row)
        if not rows:
            continue
        values = [number(row["uptime"].rstrip("%"), maximum=100) for row in rows]
        latencies = [row["latencyMs"] for row in rows if row["latencyMs"] is not None]
        buckets = {}
        for row in rows:
            for stamp, avail in row["points"]:
                buckets.setdefault(stamp, []).append(avail)
        groups.append({
            "name": name, "ratio": None, "startPrice": None, "score": None, "service": "status",
            "latencyMs": max(latencies) if latencies else None,
            "avail": min(values) if all(value is not None for value in values) else None,
            "points": [[stamp, min(values)] for stamp, values in sorted(buckets.items())],
            "models": [{"id": row["id"], "name": row["name"], "in": None, "out": None, "cache": None} for row in rows],
        })
    if not models:
        raise ValueError("No public monitor data")
    return {"period": period, "source": SOURCE, "models": models, "groups": groups}


def _json(url, source):
    request = Request(url, headers={"Accept-Encoding": "gzip", "Accept": "application/json",
                                    "User-Agent": "Mozilla/5.0", "Referer": source})
    with urlopen(request, timeout=15, context=_ssl_context()) as response:
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Response too large")
        if response.headers.get("Content-Encoding") == "gzip":
            with gzip.GzipFile(fileobj=io.BytesIO(body)) as archive:
                body = archive.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Response too large")
    return json.loads(body)


def _fetch(period):
    return normalize(_json(SOURCE + "api/status?period=" + period + "&board=all", SOURCE), period)


def _heartbeat_stamp(value):
    try:
        # Uptime Kuma's public heartbeat timestamps without an offset are UTC.
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return int((stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)).timestamp())
    except (ValueError, TypeError, OverflowError):
        return 0


def normalize_foxcode(board, heartbeat):
    rows, groups = [], []
    states = {0: "异常", 1: "正常", 2: "重试中", 3: "维护中"}
    for section in board.get("publicGroupList", []):
        for monitor in section.get("monitorList", []):
            ident = str(monitor.get("id") or "")
            name = str(monitor.get("name") or "")[:180]
            if not ident or not name:
                continue
            beats = []
            for beat in heartbeat.get("heartbeatList", {}).get(ident, []):
                stamp = _heartbeat_stamp(beat.get("time"))
                if stamp >= 1_000_000_000:
                    beats.append((stamp, beat))
            beats.sort(key=lambda item: item[0])
            points = [[stamp, 100 if beat.get("status") == 1 else 0 if beat.get("status") == 0 else -1,
                       states.get(beat.get("status"), "暂无数据")] for stamp, beat in beats]
            current = beats[-1][1] if beats else {}
            latency = number(current.get("ping")) if current.get("status") == 1 else None
            # Use the upstream 24h aggregate, never the mean of the last 100 probes.
            availability = number(heartbeat.get("uptimeList", {}).get(ident + "_24"), maximum=1)
            availability = round(availability * 100, 2) if availability is not None else None
            row = {
                "id": "foxcode-monitor-" + ident,
                "name": str(section.get("name") or name).replace(" 分组", "") + " · 线路监测",
                "group": name, "input": None, "output": None, "cache": None, "ratio": None,
                "score": None, "service": "status", "points": points, "scope": "route",
                "trendLabel": f"最近 {len(points)} 次探测",
                "uptime": f"{availability:g}%" if availability is not None else "—",
                "latency": f"{latency / 1000:.2f}s" if latency is not None else "—",
                "latencyMs": latency, "checkedAt": beats[-1][0] if beats else None, "monitored": True,
            }
            rows.append(row)
            groups.append({
                "name": name, "ratio": None, "startPrice": None, "score": None, "service": "status",
                "latencyMs": latency, "avail": availability, "points": points, "scope": "route",
                "trendLabel": row["trendLabel"],
                "models": [{"id": row["id"], "name": row["name"], "in": None, "out": None, "cache": None}],
            })
    if not rows:
        raise ValueError("No public Foxcode monitor data")
    return {"period": "24h", "source": FOXCODE_SOURCE, "models": rows, "groups": groups,
            "routeOnly": True,
            "note": "线路监测，非单个模型实测；延迟为最近一次探测，在线率为站方 24 小时统计，趋势为最近 100 次探测。"}


def _fetch_foxcode():
    paths = ("https://status.rjj.cc/api/status-page/foxcode",
             "https://status.rjj.cc/api/status-page/heartbeat/foxcode")
    with ThreadPoolExecutor(max_workers=2) as pool:
        board, heartbeat = list(pool.map(lambda url: _json(url, FOXCODE_SOURCE), paths))
    return normalize_foxcode(board, heartbeat)


def read(station, period):
    if station not in STATIONS or period not in PERIODS or (station == "5" and period != "24h"):
        return 400, {"error": "没有这个站点或时间范围"}
    source = FOXCODE_SOURCE if station == "5" else SOURCE
    key = (source, period)
    with _locks[key]:
        now = time.time()
        cached = _cache.get(key)
        if cached and now - cached["fetchedAt"] < TTL:
            return 200, dict(cached, stale=False)
        try:
            result = dict(_fetch_foxcode() if station == "5" else _fetch(period), fetchedAt=int(time.time()))
            _cache[key] = result
            return 200, dict(result, stale=False)
        except Exception:
            if cached and now - cached["fetchedAt"] < MAX_STALE:
                return 200, dict(cached, stale=True)
            return 502, {"error": "站方状态暂时无法读取，请稍后重试", "source": source}
