"""Immutable, explicitly shared test results. Never stores request credentials."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit

DIR = Path(__file__).resolve().parent.parent / "data" / "shared-reports"
LIMIT = 2_000_000
LOCK = threading.Lock()
RATE = {}
SUITES = {"candy": "candy", "pelican": "pelican", "all": "detect"}


def text(value, limit=500):
    value = str(value or "")[:limit]
    return re.sub(r"sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*", "[redacted]", value, flags=re.I)


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 10**15 else None


def clean_report(source):
    if not isinstance(source, dict) or source.get("suite") not in SUITES or source.get("running"):
        raise ValueError("请等待检测结束后再分享")
    suite = source["suite"]
    if not re.fullmatch(suite + r"-[a-z0-9]{4,24}", str(source.get("id") or "")):
        raise ValueError("这份检测记录不完整")
    rows = source.get("rows")
    if not isinstance(rows, list) or not rows or len(rows) > 16:
        raise ValueError("这份检测记录不完整")
    result = {"id": source["id"], "suite": suite, "running": False, "keyMask": "—"}
    for key in ("model", "modelId", "result"):
        result[key] = text(source.get(key), 120)
    try:
        address = urlsplit(str(source.get("base") or ""))
        result["host"] = text(address.hostname or source.get("host"), 200)
        result["base"] = (address.scheme + "://" + address.netloc.rsplit("@", 1)[-1]) if address.scheme in ("http", "https") else ""
    except ValueError:
        result["host"], result["base"] = text(source.get("host"), 200), ""
    for key in ("started", "finishedAt", "partScore", "partRight", "partTotal", "candySeq"):
        result[key] = number(source.get(key))
    result["interrupted"] = source.get("interrupted") is True
    result["rows"] = [{"id": text(row.get("id"), 30), "label": text(row.get("label"), 80),
                       "status": text(row.get("status"), 20), "state": "done",
                       "summary": text(row.get("summary"), 2000), "raw": ""}
                      for row in rows if isinstance(row, dict)]
    result["candyRows"] = []
    for row in (source.get("candyRows") or [])[:20]:
        if not isinstance(row, dict):
            continue
        item = {key: text(row.get(key), 2000 if key == "prompt" else 500)
                for key in ("title", "prompt", "dimension", "level", "answer", "picked", "expect")}
        item.update(ok=row.get("ok") is True, missed=row.get("missed") is True)
        item["options"] = [{"key": text(opt.get("key"), 8), "text": text(opt.get("text"), 300)}
                           for opt in (row.get("options") or [])[:8] if isinstance(opt, dict)]
        result["candyRows"].append(item)
    result["pelicanHtml"] = text(source.get("pelicanHtml"), 1_200_000) if suite != "candy" else ""
    meter = source.get("meter") or {}
    result["meter"] = {key: number(meter.get(key)) for key in ("ttftMs", "totalMs", "input", "output", "requests")} if isinstance(meter, dict) else None
    return result


def create(source, client):
    report = clean_report(source)
    body = json.dumps(report, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if len(body.encode("utf-8")) > LIMIT:
        raise ValueError("这份结果过大，无法生成分享")
    digest = hashlib.sha256(body.encode()).hexdigest()
    with LOCK:
        now = time.time()
        for key in list(RATE):
            if RATE[key][0] < now - 600:
                del RATE[key]
        started, count = RATE.get(client, (now, 0))
        if count >= 20:
            raise ValueError("分享太频繁，请稍后再试")
        RATE[client] = (started, count + 1)
        DIR.mkdir(parents=True, exist_ok=True)
        index = DIR / (digest + ".ref")
        token = index.read_text() if index.exists() else secrets.token_urlsafe(18)
        target = DIR / (token + ".json")
        if not target.exists():
            temp = DIR / (token + ".tmp")
            temp.write_text(body, encoding="utf-8")
            os.replace(temp, target)
            index.write_text(token)
    return {"token": token, "path": "/check/" + SUITES[report["suite"]] + "?share=" + token}


def read(token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{24}", token):
        return None
    try:
        report = json.loads((DIR / (token + ".json")).read_text(encoding="utf-8"))
        return clean_report(report)
    except (OSError, ValueError, TypeError):
        return None
