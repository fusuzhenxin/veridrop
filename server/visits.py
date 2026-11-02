"""Daily visitor counts. Same rules as the previous site: one open and one action per browser per Shanghai day."""

from __future__ import annotations

import hmac
import json
import os
import re
import ssl
import threading
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

KINDS = ["home", "check", "cat", "site", "model", "official", "apply", "other"]
KIND_LABEL = {
    "home": "首页",
    "check": "模型检测",
    "cat": "分类",
    "site": "站点页",
    "model": "模型",
    "official": "官方状态",
    "apply": "申请收录",
    "other": "其他",
}
SITES = {
    "veridrop": {
        "label": "维渡 AI",
        "origins": [
            "https://www.veridrop.cn",
            "https://veridrop.cn",
            "http://127.0.0.1:4175",
            "http://localhost:4175",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
        ],
        "kinds": KINDS,
    },
    "modeltool": {
        "label": "降智检测",
        "origins": ["https://www.modeltool.cn", "https://modeltool.cn"],
        "kinds": None,
    },
}
BOT_RE = re.compile(
    r"ahrefs|mj12bot|bingbot|yandex|shapbot|applebot|googlebot|google-inspectiontool|google-extended|petalbot|bytespider|baiduspider|semrush|dotbot|sogou|360spider|yisouspider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-searchbot|claude-user|anthropic-ai|perplexity|ccbot|amazonbot|meta-externalagent|meta-externalfetcher|cohere-ai|diffbot|youbot|curl/|wget/|python-requests|go-http-client|headlesschrome|local-mirror|scrapy|httpclient|spider|crawler|slurp|\bbot\b",
    re.I,
)
BLOB_PATH = "visits.json"
DAYS = 30
_LOCK = threading.Lock()
_MEMORY = {"sites": {}}


def shanghai_day(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    shifted = current.astimezone(timezone(timedelta(hours=8)))
    return shifted.strftime("%Y-%m-%d")


def recent_days(count: int = DAYS, now: datetime | None = None) -> list[str]:
    current = now or datetime.now(timezone.utc)
    return [shanghai_day(current - timedelta(days=offset)) for offset in range(count)]


def is_bot(ua: str) -> bool:
    text = str(ua or "").strip()
    if len(text) < 12:
        return True
    return bool(BOT_RE.search(text))


def clean_id(raw) -> str:
    text = str(raw or "").strip()
    return text if re.fullmatch(r"[a-z0-9]{16,48}", text) else ""


def clean_kind(raw, kinds) -> str:
    text = str(raw or "").strip()
    if not kinds:
        return ""
    return text if text in kinds else ""


def key_matches(given: str) -> bool:
    expected = str(os.environ.get("VISIT_STATS_KEY") or "")
    actual = str(given or "")
    if len(expected) < 16 or len(actual) != len(expected):
        return False
    return hmac.compare_digest(actual.encode("utf-8"), expected.encode("utf-8"))


def origin_allowed(origin: str) -> bool:
    value = str(origin or "").strip()
    return any(value in site["origins"] for site in SITES.values())


def site_for(raw_site, origin: str) -> str:
    value = str(origin or "").strip()
    requested = str(raw_site or "").strip()
    if requested:
        site = SITES.get(requested)
        if not site or value not in site["origins"]:
            return ""
        return requested
    if value in SITES["veridrop"]["origins"]:
        return "veridrop"
    return ""


def _ssl_context():
    for path in (
        os.environ.get("SSL_CERT_FILE") or "",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/certs/ca-certificates.crt",
    ):
        if path and os.path.isfile(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


def _open(request: Request):
    return urlopen(request, timeout=20, context=_ssl_context())


def _store_id(token: str) -> str:
    parts = token.split("_")
    return parts[3] if len(parts) > 3 else ""


def _blob_token() -> str:
    return str(os.environ.get("BLOB_READ_WRITE_TOKEN") or "").strip()


def _read_blob() -> dict:
    token = _blob_token()
    store = _store_id(token)
    if not token or not store:
        return {"sites": {}}
    url = f"https://{store}.private.blob.vercel-storage.com/{BLOB_PATH}?cache=0"
    request = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with _open(request) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        if err.code == 404:
            return {"sites": {}}
        raise
    return data if isinstance(data, dict) else {"sites": {}}


def _write_blob(data: dict) -> None:
    token = _blob_token()
    if not token:
        return
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = Request(
        f"https://vercel.com/api/blob/?pathname={BLOB_PATH}",
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "x-api-version": "12",
            "x-vercel-blob-access": "private",
            "x-content-type": "application/json",
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
        },
    )
    with _open(request):
        return


def _as_sites(data: dict) -> dict:
    sites = {}
    incoming = data.get("sites") if isinstance(data.get("sites"), dict) else None
    if incoming:
        for site_id, bucket in incoming.items():
            if site_id not in SITES or not isinstance(bucket, dict):
                continue
            days = bucket.get("days")
            if isinstance(days, dict):
                sites[site_id] = {"days": days}
    if (not incoming or "veridrop" not in sites) and isinstance(data.get("days"), dict):
        sites["veridrop"] = {"days": data["days"]}
    return {"sites": sites}


def _entry(value):
    clicked = 1 if isinstance(value, dict) and value.get("c") else 0
    if isinstance(value, str) and value in KINDS:
        return {"k": value, "o": 0, "a": 1, "c": 0}
    if not isinstance(value, dict):
        return None
    if value.get("k"):
        kind = value["k"] if value["k"] in KINDS else ""
        if not kind and not clicked:
            return None
        return {"k": kind, "o": 1 if value.get("o") else 0, "a": 1 if value.get("a") else 0, "c": clicked}
    if not value.get("o") and not value.get("a") and not clicked:
        return None
    return {"k": "", "o": 1 if value.get("o") else 0, "a": 1 if value.get("a") else 0, "c": clicked}


def _merge(prev, kind: str, acted: bool, clicked: bool = False):
    opened = 0 if acted else 1
    acted_bit = 1 if acted else 0
    click_bit = 1 if clicked else 0
    current = _entry(prev)
    if not current:
        entry = {"o": opened, "a": acted_bit}
        if click_bit:
            entry["c"] = 1
        if kind:
            entry["k"] = kind
        return entry
    entry = {"o": current["o"] or opened, "a": current["a"] or acted_bit}
    if current["c"] or click_bit:
        entry["c"] = 1
    next_kind = current["k"] or kind or ""
    if next_kind:
        entry["k"] = next_kind
    return entry


def _prune(data: dict, now: datetime) -> None:
    keep = set(recent_days(40, now))
    for site, bucket in list((data.get("sites") or {}).items()):
        days = bucket.get("days") if isinstance(bucket, dict) else None
        if not isinstance(days, dict):
            data["sites"].pop(site, None)
            continue
        for day in list(days):
            if day not in keep:
                days.pop(day, None)


def record_visit(ua: str, origin: str, body: bytes, now: datetime | None = None) -> int:
    if is_bot(ua):
        return 204
    try:
        data = json.loads(body.decode("utf-8") or "")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 204
    if not isinstance(data, dict):
        return 204
    site = site_for(data.get("site"), origin)
    visitor = clean_id(data.get("id"))
    if not site or not visitor:
        return 204
    kinds = SITES[site]["kinds"]
    kind = clean_kind(data.get("kind"), kinds)
    clicked = data.get("ad") is True and site == "veridrop"
    if kinds and not kind and not clicked:
        return 204
    acted = data.get("acted") is True
    moment = now or datetime.now(timezone.utc)
    day = shanghai_day(moment)
    with _LOCK:
        if _blob_token():
            raw = _as_sites(_read_blob())
        else:
            raw = _MEMORY
        days = raw.setdefault("sites", {}).setdefault(site, {}).setdefault("days", {})
        bucket = days.setdefault(day, {})
        bucket[visitor] = _merge(bucket.get(visitor), kind, acted, clicked)
        _prune(raw, moment)
        if _blob_token():
            _write_blob({"sites": raw["sites"]})
    return 204


def _rows(site: str, now: datetime) -> list[dict]:
    kinds = SITES[site]["kinds"] or []
    dates = recent_days(DAYS, now)
    with _LOCK:
        data = _as_sites(_read_blob()) if _blob_token() else _MEMORY
    days = ((data.get("sites") or {}).get(site) or {}).get("days") or {}
    rows = []
    for date in dates:
        raw = days.get(date) if isinstance(days.get(date), dict) else {}
        counts = {kind: 0 for kind in kinds}
        opened = 0
        acted = 0
        ads = 0
        for value in raw.values():
            entry = _entry(value)
            if not entry:
                continue
            if entry["o"]:
                opened += 1
            if entry["a"]:
                acted += 1
            if entry["c"]:
                ads += 1
            if entry["k"] in counts:
                counts[entry["k"]] += 1
        rows.append({"date": date, "open": opened, "acted": acted, "ad": ads, "kinds": counts})
    return rows


def _esc(value) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _cell(value: int, class_name: str = "") -> str:
    names = [class_name] if class_name else []
    if not value:
        names.append("zero")
    cls = f' class="{" ".join(names)}"' if names else ""
    return f"<td{cls}>{value}</td>"


def render_html(site: str, rows: list[dict], key: str) -> str:
    kinds = SITES[site]["kinds"] or []
    label = SITES[site]["label"]
    today = rows[0]["date"] if rows else ""
    open_sum = sum(row["open"] for row in rows)
    act_sum = sum(row["acted"] for row in rows)
    ad_sum = sum(row.get("ad") or 0 for row in rows)
    show_ads = site == "veridrop"
    head = "".join(f"<th>{_esc(KIND_LABEL[kind])}</th>" for kind in kinds)
    ad_head = "<th>广告点击</th>" if show_ads else ""
    body = []
    for row in rows:
        classes = []
        if row["date"] == today:
            classes.append("is-today")
        if not row["open"] and not row["acted"]:
            classes.append("is-empty")
        cls = f' class="{" ".join(classes)}"' if classes else ""
        kind_cells = "".join(_cell(row["kinds"].get(kind, 0)) for kind in kinds)
        ad_cell = _cell(row.get("ad") or 0, "col-ad") if show_ads else ""
        body.append(
            f"<tr{cls}><td>{_esc(row['date'])}</td>{_cell(row['open'], 'col-open')}{_cell(row['acted'], 'col-act')}{ad_cell}{kind_cells}</tr>"
        )
    note = "每个浏览器按上海时间一天记一次。页面打开记「打开」，当天第一次点击、按键或滚动再记「有操作」。点开带赞助标记的广告再记「广告点击」。爬虫不算。同一个人连续来几天会各记一次。"
    links = []
    for site_id, meta in SITES.items():
        query = "key=" + quote(key)
        if site_id != "veridrop":
            query += "&site=" + site_id
        current = ' aria-current="page"' if site_id == site else ""
        links.append(f'<a href="/api/visit?{query}"{current}>{_esc(meta["label"])}</a>')
    nav = '<nav class="sites">' + "".join(links) + "</nav>"
    return f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>访客 · {_esc(label)}</title>
<style>
:root{{color-scheme:dark;--bg:#070b14;--panel:#121b2e;--line:rgba(168,196,255,.12);--text:#e9f0ff;--muted:#8b9bb8;--teal:#3ee0c2;--blue:#7aa7ff;--placeholder:#6d7d99}}
*{{box-sizing:border-box}}body{{margin:0;font:16px/1.5 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:var(--text);background:var(--bg)}}
.wrap{{max-width:1120px;margin:0 auto;padding:28px 20px 64px}}
h1{{margin:0;font-size:28px}} .sub,.note{{color:var(--muted)}}
.sites{{display:flex;gap:18px;margin:12px 0 0}} .sites a{{color:var(--muted);text-decoration:none}}
.sites a[aria-current=page]{{color:var(--text);font-weight:600}}
.stats{{display:flex;gap:16px;margin:22px 0 14px}}
.stat{{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px 20px}}
.stat .label{{color:var(--muted);font-size:14px}} .stat .num{{display:block;margin-top:4px;font-size:40px;font-weight:600}}
.stat.open .num{{color:var(--teal)}} .stat.act .num{{color:var(--blue)}} .stat.ad .num{{color:#d9f99d}}
.table-wrap{{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:auto}}
table{{width:100%;border-collapse:collapse;min-width:920px}}
th,td{{padding:10px 12px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}}
th:first-child,td:first-child{{text-align:left}} th{{color:var(--muted);font-size:13px}}
td.col-open{{color:var(--teal)}} td.col-act{{color:var(--blue)}} td.col-ad{{color:#d9f99d}} td.zero{{color:var(--placeholder)}}
tr.is-empty td{{color:var(--placeholder)}}
@media(max-width:640px){{.stats{{flex-direction:column}}}}
</style></head><body><div class="wrap">
<p class="sub">{_esc(label)}</p><h1>访客</h1><p class="sub">近 30 天 · 上海时间</p>{nav}
<div class="stats"><section class="stat open"><span class="label">打开</span><strong class="num">{open_sum}</strong></section>
<section class="stat act"><span class="label">有操作</span><strong class="num">{act_sum}</strong></section>
{f'<section class="stat ad"><span class="label">广告点击</span><strong class="num">{ad_sum}</strong></section>' if show_ads else ''}</div>
<p class="note">{_esc(note)}</p>
<div class="table-wrap"><table><thead><tr><th>日期</th><th>打开</th><th>有操作</th>{ad_head}{head}</tr></thead>
<tbody>{''.join(body)}</tbody></table></div></div></body></html>"""


def read_visits(key: str, fmt: str, site: str, now: datetime | None = None) -> tuple[int, dict, bytes]:
    if not key_matches(key):
        return 404, {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}, b"not found"
    site_id = str(site or "").strip() or "veridrop"
    if site_id not in SITES:
        return 404, {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}, b"not found"
    moment = now or datetime.now(timezone.utc)
    rows = _rows(site_id, moment)
    headers = {"cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer"}
    if fmt == "json":
        headers["content-type"] = "application/json; charset=utf-8"
        body = json.dumps({"ok": True, "site": site_id, "timezone": "Asia/Shanghai", "days": rows}, ensure_ascii=False).encode("utf-8")
        return 200, headers, body
    headers["content-type"] = "text/html; charset=utf-8"
    return 200, headers, render_html(site_id, rows, key).encode("utf-8")


def cors_headers(origin: str) -> dict:
    if not origin_allowed(origin):
        return {}
    return {
        "access-control-allow-origin": str(origin or "").strip(),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        "vary": "Origin",
    }
