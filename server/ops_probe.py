"""Fetch station status, models, and homepage. No password login."""

from __future__ import annotations

import json
import socket
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse


class _Track(urllib.request.HTTPRedirectHandler):
    max_redirections = 5

    def __init__(self):
        super().__init__()
        self.hops = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops += 1
        if self.hops > 5:
            raise urllib.error.HTTPError(req.full_url, code, "跳转过多", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _error_type(err: Exception) -> str:
    text = str(getattr(err, "reason", err)).lower()
    if isinstance(err, (TimeoutError, socket.timeout)) or "timed out" in text:
        return "timeout"
    if isinstance(err, ssl.SSLError) or "ssl" in text or "certificate" in text:
        return "tls"
    if isinstance(err, socket.gaierror) or "getaddrinfo" in text or "name or service" in text:
        return "dns"
    return "connect"


def fetch(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: float = 8, proxy: str = "") -> dict:
    started = time.perf_counter()
    handlers = [_Track()]
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with opener.open(request, timeout=timeout) as response:
            payload = response.read(200000)
            return {
                "ok": 200 <= response.status < 400,
                "status": response.status,
                "body": payload,
                "final_url": response.geturl(),
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "error_type": "",
            }
    except urllib.error.HTTPError as err:
        payload = err.read(20000)
        kind = "auth" if err.code in (401, 403) else "http"
        return {
            "ok": False,
            "status": err.code,
            "body": payload,
            "final_url": err.geturl() or url,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error_type": kind,
        }
    except Exception as err:
        return {
            "ok": False,
            "status": 0,
            "body": b"",
            "final_url": url,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error_type": _error_type(err),
        }


def _json_body(raw: bytes):
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None


def _model_names(payload) -> list[str]:
    names = []
    if isinstance(payload, dict):
        rows = payload.get("data") or payload.get("models") or []
        if isinstance(rows, dict):
            rows = rows.get("data") or []
        for row in rows:
            if isinstance(row, str):
                names.append(row)
            elif isinstance(row, dict):
                name = row.get("id") or row.get("name") or ""
                if name:
                    names.append(str(name))
    return names[:400]


def _price_text(payload) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("price", "min_topup", "minTopup", "quota", "announcement"):
        value = payload.get(key)
        if value:
            return str(value)[:80]
    return ""


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def cert_expiry(url: str, timeout: float = 8) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return ""
    context = ssl.create_default_context()
    with socket.create_connection((parsed.hostname, parsed.port or 443), timeout=timeout) as sock:
        with context.wrap_socket(sock, server_hostname=parsed.hostname) as secure:
            cert = secure.getpeercert()
    text = cert.get("notAfter") or ""
    if not text:
        return ""
    parsed_time = datetime.strptime(text, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    return parsed_time.strftime("%Y-%m-%dT%H:%M:%SZ")


def _run(kind: str, result: dict, model: str = "", cost: float = 0, detail=None) -> dict:
    return {
        "kind": kind,
        "ok": bool(result.get("ok")),
        "latency_ms": result.get("latency_ms"),
        "model": model,
        "cost": cost,
        "error_type": result.get("error_type") or "",
        "detail": detail if detail is not None else {"status": result.get("status"), "final_url": result.get("final_url")},
    }


def probe_station(station: dict) -> list[dict]:
    settings = station.get("settings") or {}
    proxy = settings.get("proxy") or ""
    runs = []
    home = fetch(station["url"], timeout=8, proxy=proxy)
    runs.append(_run("ping", home, detail={"status": home["status"], "final_url": home["final_url"]}))
    mode = station.get("status_mode") or "none"
    if mode == "public":
        status_url = station.get("status_url") or (_origin(station["url"]) + "/api/status")
        status = fetch(status_url, timeout=8, proxy=proxy)
        payload = _json_body(status["body"]) if status["body"] else None
        detail = {"status": status["status"], "final_url": status["final_url"]}
        if isinstance(payload, dict):
            names = _model_names(payload)
            if names:
                detail["models"] = names
            price = _price_text(payload)
            if price:
                detail["price"] = price
        runs.append(_run("status", status, detail=detail))
    elif mode == "auth":
        key = station.get("key") or ""
        if not key:
            runs.append({"kind": "models", "ok": False, "latency_ms": 0, "model": "", "cost": 0, "error_type": "auth", "detail": "没有测试 Key，不登录对方后台"})
        else:
            headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
            models = fetch(_origin(station["url"]) + "/v1/models", headers=headers, timeout=8, proxy=proxy)
            payload = _json_body(models["body"]) if models["body"] else None
            names = _model_names(payload)
            detail = {"status": models["status"], "final_url": models["final_url"], "models": names}
            if models["ok"] and not names:
                models = dict(models)
                models["ok"] = False
                models["error_type"] = "empty"
            runs.append(_run("models", models, detail=detail))
            model_name = station.get("test_model") or (names[0] if names else "")
            cost = float(settings.get("cost_per_call") or 0)
            spent = float(station.get("spent") or 0)
            budget = float(settings.get("daily_budget") or 0)
            if not model_name:
                runs.append({"kind": "basic", "ok": False, "latency_ms": 0, "model": "", "cost": 0, "error_type": "empty", "detail": "没有可测的模型"})
            elif spent + cost > budget:
                runs.append({"kind": "basic", "ok": False, "latency_ms": 0, "model": model_name, "cost": 0, "error_type": "budget", "detail": "今日探测预算已用完"})
            else:
                body = json.dumps({"model": model_name, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}).encode("utf-8")
                chat_headers = {**headers, "Content-Type": "application/json"}
                chat = fetch(_origin(station["url"]) + "/v1/chat/completions", method="POST", headers=chat_headers, body=body, timeout=12, proxy=proxy)
                usage = {}
                parsed = _json_body(chat["body"]) if chat["body"] else None
                if isinstance(parsed, dict):
                    usage = parsed.get("usage") or {}
                charged = cost if chat["ok"] else 0
                runs.append(_run("basic", chat, model=model_name, cost=charged, detail={"status": chat["status"], "usage": usage}))
    if str(station.get("url") or "").startswith("https://"):
        try:
            expiry = cert_expiry(station["url"])
            runs.append({"kind": "cert", "ok": True, "latency_ms": 0, "model": "", "cost": 0, "error_type": "", "detail": {"cert_not_after": expiry}})
        except Exception as err:
            runs.append({"kind": "cert", "ok": False, "latency_ms": 0, "model": "", "cost": 0, "error_type": _error_type(err), "detail": str(err)[:200]})
    return runs


def check_site(site: dict) -> dict:
    result = fetch(site["url"], timeout=8)
    detail = {"status": result["status"], "final_url": result["final_url"]}
    if str(site.get("url") or "").startswith("https://"):
        try:
            detail["cert_not_after"] = cert_expiry(site["url"])
        except Exception as err:
            detail["cert_error"] = _error_type(err)
    return {
        "ok": result["ok"],
        "latency_ms": result["latency_ms"],
        "error_type": result["error_type"],
        "detail": detail,
    }
