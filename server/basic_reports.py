"""Read basic-test reports stored on disk. The daily runner writes these files."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "basic-reports"
INDEX = DIR / "index.json"
SECRET = re.compile(r"sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*", re.I)


def _scrub(value):
    if isinstance(value, str):
        return SECRET.sub("[redacted]", value)
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    if isinstance(value, dict):
        copy = {}
        for key, item in value.items():
            if key in ("key", "apiKey", "authorization"):
                continue
            copy[key] = _scrub(item)
        return copy
    return value


def _safe_id(value: str) -> str:
    text = str(value or "")
    return text if re.fullmatch(r"basic-[a-z0-9]{6,16}", text) else ""


def read_index() -> list:
    try:
        parsed = json.loads(INDEX.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    reports = parsed.get("reports") if isinstance(parsed, dict) else None
    return reports if isinstance(reports, list) else []


def read_report(report_id: str):
    safe = _safe_id(report_id)
    if not safe:
        return None
    try:
        parsed = json.loads((DIR / f"{safe}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    report = _scrub(parsed)
    if not isinstance(report, dict) or report.get("id") != safe or report.get("suite") != "basic":
        return None
    if not isinstance(report.get("rows"), list):
        return None
    report["keyMask"] = "—"
    return report


def summaries_for(station_id: str, host: str) -> list:
    verd = str(station_id or "")
    name = str(host or "").lower()
    if name.startswith("www."):
        name = name[4:]
    rows = []
    for row in read_index():
        if not isinstance(row, dict):
            continue
        row_host = str(row.get("host") or "").lower()
        if row_host.startswith("www."):
            row_host = row_host[4:]
        if (verd and str(row.get("stationId") or "") == verd) or (name and row_host in (name, f"api.{name}")) or (name == f"api.{row_host}" and row_host):
            rows.append(row)
    return rows


def report_html(report: dict) -> str:
    rows = []
    for row in report.get("rows") or []:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or row.get("id") or "")
        summary = str(row.get("summary") or "")
        rows.append(f"<li>{_html(label)} {_html(summary)}</li>")
    title = f"{report.get('host') or '基础测试'} {report.get('model') or ''} 基础测试报告"
    body = "".join(rows)
    payload = json.dumps(report, ensure_ascii=False).replace("<", "\\u003c")
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_html(title)}</title>
  <meta name="robots" content="noindex,follow">
  <meta name="description" content="{_html(title)}。每一项都是这次接口返回，页面里没有密钥。">
</head>
<body>
  <header><a href="/">维渡 AI</a></header>
  <main>
    <h1>{_html(report.get('host') or '')} 基础测试</h1>
    <p>{_html(report.get('model') or '')} {_html(report.get('result') or '')}</p>
    <ol>{body}</ol>
    <p><a href="/">回到首页</a></p>
  </main>
  <footer>2026 维渡 AI · www.veridrop.cn</footer>
  <script>window.__VD_BASIC_REPORT__={payload};window.__VD_BASIC_INDEX__=null;</script>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
"""


def _html(value) -> str:
    return (str(value or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))
