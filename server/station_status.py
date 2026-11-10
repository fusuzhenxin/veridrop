"""Read-only, cached access to the station's public RelayPulse board."""

import gzip
import io
import json
import math
import threading
import time
from urllib.request import Request, urlopen

from visits import _ssl_context

SOURCE = "https://status.claudecode.net.cn/"
STATIONS = {"3", "479"}
PERIODS = {"24h", "7d", "30d"}
TTL = 300
MAX_STALE = 3600
LIMIT = 4_000_000
_cache = {}
_locks = {period: threading.Lock() for period in PERIODS}
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


def _fetch(period):
    request = Request(SOURCE + "api/status?period=" + period + "&board=all",
                      headers={"Accept-Encoding": "gzip", "Accept": "application/json"})
    with urlopen(request, timeout=15, context=_ssl_context()) as response:
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Response too large")
        if response.headers.get("Content-Encoding") == "gzip":
            with gzip.GzipFile(fileobj=io.BytesIO(body)) as archive:
                body = archive.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Response too large")
    return normalize(json.loads(body), period)


def read(station, period):
    if station not in STATIONS or period not in PERIODS:
        return 400, {"error": "没有这个站点或时间范围"}
    with _locks[period]:
        now = time.time()
        cached = _cache.get(period)
        if cached and now - cached["fetchedAt"] < TTL:
            return 200, dict(cached, stale=False)
        try:
            result = dict(_fetch(period), fetchedAt=int(time.time()))
            _cache[period] = result
            return 200, dict(result, stale=False)
        except Exception:
            if cached and now - cached["fetchedAt"] < MAX_STALE:
                return 200, dict(cached, stale=True)
            return 502, {"error": "站方状态暂时无法读取，请稍后重试", "source": SOURCE}
