"""HTTP API and the built admin UI."""

from __future__ import annotations

import json
import subprocess
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import ops_db
import ops_jobs

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "admin" / "dist"
BUILD_LOCK = threading.Lock()
HITS: dict[str, list[float]] = {}
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


def _limited(ip: str) -> bool:
    import time

    now = time.time()
    bucket = [stamp for stamp in HITS.get(ip, []) if now - stamp < 60]
    if len(bucket) >= 120:
        HITS[ip] = bucket
        return True
    bucket.append(now)
    HITS[ip] = bucket
    return False


class OpsHandler(BaseHTTPRequestHandler):
    server_version = "VeridropOps/1.0"

    def log_message(self, fmt: str, *args) -> None:
        return

    def do_OPTIONS(self) -> None:
        if self._public_path():
            self.send_response(204)
            self._cors()
            self.end_headers()
            return
        self._json(404, {"error": "没有这个接口"})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/go/"):
            self._go(parsed.path)
            return
        try:
            self._dispatch("GET", parsed)
        except ValueError as err:
            self._json(400, {"error": str(err)})
        except RuntimeError as err:
            self._json(409, {"error": str(err)})
        except Exception:
            traceback.print_exc()
            self._json(500, {"error": "服务器出错"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            self._dispatch("POST", parsed)
        except ValueError as err:
            self._json(400, {"error": str(err)})
        except RuntimeError as err:
            self._json(409, {"error": str(err)})
        except Exception:
            traceback.print_exc()
            self._json(500, {"error": "服务器出错"})

    def _public_path(self) -> bool:
        path = urlparse(self.path).path.rstrip("/")
        return path in ("/api/collect", "/api/public/submission", "/api/login") or path.startswith("/go/")

    def _dispatch(self, method: str, parsed) -> None:
        path = parsed.path.rstrip("/") or "/"
        parts = [item for item in path.split("/") if item]
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
        if path == "/api/collect" and method == "POST":
            self._collect()
            return
        if path == "/api/public/submission" and method == "POST":
            self._public_submission()
            return
        if path == "/api/login" and method == "POST":
            self._login()
            return
        if path == "/api/health" and method == "GET":
            self._json(200, {"ok": True})
            return
        if not parts or parts[0] != "api":
            self._file(parsed.path)
            return
        if method == "POST" and path != "/api/logout":
            if self.headers.get("X-Ops") != "1":
                self._json(400, {"error": "缺少操作标记"})
                return
        operator = ops_db.operator_from_token(self._token())
        if not operator:
            self._json(401, {"error": "请先登录"})
            return
        self._api(method, parts[1:], query, operator)

    def _api(self, method: str, parts: list[str], query: dict, operator: dict) -> None:
        if parts == ["logout"] and method == "POST":
            ops_db.logout(self._token())
            self._json(200, {"ok": True}, clear=True)
            return
        if parts == ["me"] and method == "GET":
            self._json(200, operator)
            return
        if parts == ["password"] and method == "POST":
            body = self._body()
            ops_db.change_password(operator["id"], str(body.get("old") or ""), str(body.get("new") or ""))
            self._json(200, {"ok": True, "relogin": True}, clear=True)
            return
        if parts == ["dashboard"] and method == "GET":
            self._json(200, ops_db.dashboard())
            return
        if parts == ["stations"] and method == "GET":
            self._json(200, ops_db.list_stations(query))
            return
        if parts == ["stations"] and method == "POST":
            self._json(200, ops_db.save_station(self._body()))
            return
        if parts == ["stations", "import"] and method == "POST":
            self._json(200, ops_db.import_catalog())
            return
        if len(parts) >= 2 and parts[0] == "stations" and parts[1].isdigit():
            station_id = int(parts[1])
            tail = parts[2:]
            if not tail and method == "GET":
                self._json(200, ops_db.get_station(station_id))
                return
            if not tail and method == "POST":
                self._json(200, ops_db.save_station(self._body(), station_id))
                return
            if tail == ["key"] and method == "POST":
                self._json(200, ops_db.set_key(station_id, str(self._body().get("key") or "")))
                return
            if tail == ["probe"] and method == "POST":
                self._json(200, ops_jobs.run_station(station_id))
                return
            if tail == ["queue"] and method == "POST":
                ops_db.queue_station(station_id)
                self._json(200, {"ok": True})
                return
            if tail == ["takedown"] and method == "POST":
                self._json(200, ops_db.takedown(station_id, bool(self._body().get("down", True))))
                return
        if parts == ["runs"] and method == "GET":
            self._json(200, ops_db.list_runs(query))
            return
        if len(parts) == 2 and parts[0] == "runs" and parts[1].isdigit() and method == "GET":
            self._json(200, ops_db.get_run(int(parts[1])))
            return
        if parts == ["jobs", "run"] and method == "POST":
            self._json(200, ops_jobs.start_due())
            return
        if parts == ["jobs", "status"] and method == "GET":
            self._json(200, {"batch": ops_db.latest_batch()})
            return
        if parts == ["alerts"] and method == "GET":
            self._json(200, ops_db.list_alerts(query))
            return
        if len(parts) == 2 and parts[0] == "alerts" and parts[1].isdigit() and method == "POST":
            self._json(200, ops_db.set_alert(int(parts[1]), str(self._body().get("status") or "")))
            return
        if parts == ["ads"] and method == "GET":
            self._json(200, ops_db.list_ads(query))
            return
        if parts == ["ads"] and method == "POST":
            self._json(200, ops_db.save_ad(self._body()))
            return
        if len(parts) == 2 and parts[0] == "ads" and parts[1].isdigit():
            ad_id = int(parts[1])
            if method == "GET":
                self._json(200, ops_db.get_ad(ad_id))
                return
            if method == "POST":
                self._json(200, ops_db.save_ad(self._body(), ad_id))
                return
        if parts == ["traffic"] and method == "GET":
            self._json(200, ops_db.traffic_report(query.get("day") or ""))
            return
        if parts == ["sites"] and method == "GET":
            self._json(200, ops_db.list_sites(query))
            return
        if parts == ["sites"] and method == "POST":
            self._json(200, ops_db.save_site(self._body()))
            return
        if parts == ["sites", "check"] and method == "POST":
            self._json(200, ops_jobs.start_sites())
            return
        if len(parts) >= 2 and parts[0] == "sites" and parts[1].isdigit():
            site_id = int(parts[1])
            tail = parts[2:]
            if not tail and method == "GET":
                self._json(200, ops_db.get_site(site_id))
                return
            if not tail and method == "POST":
                self._json(200, ops_db.save_site(self._body(), site_id))
                return
            if tail == ["check"] and method == "POST":
                self._json(200, ops_jobs.run_site(site_id))
                return
        if parts == ["submissions"] and method == "GET":
            self._json(200, ops_db.list_submissions(query))
            return
        if parts == ["submissions"] and method == "POST":
            self._json(200, ops_db.save_submission(self._body()))
            return
        if parts == ["submissions", "sync"] and method == "POST":
            self._json(200, ops_db.sync_community())
            return
        if len(parts) >= 2 and parts[0] == "submissions" and parts[1].isdigit():
            submission_id = int(parts[1])
            tail = parts[2:]
            if not tail and method == "GET":
                self._json(200, ops_db.get_submission(submission_id))
                return
            if not tail and method == "POST":
                self._json(200, ops_db.save_submission(self._body(), submission_id))
                return
            if tail == ["approve"] and method == "POST":
                self._json(200, ops_db.decide_submission(submission_id, True))
                return
            if tail == ["reject"] and method == "POST":
                self._json(200, ops_db.decide_submission(submission_id, False))
                return
        if parts == ["complaints"] and method == "GET":
            self._json(200, ops_db.list_complaints(query))
            return
        if parts == ["complaints"] and method == "POST":
            self._json(200, ops_db.save_complaint(self._body()))
            return
        if len(parts) >= 2 and parts[0] == "complaints" and parts[1].isdigit():
            complaint_id = int(parts[1])
            tail = parts[2:]
            if not tail and method == "GET":
                self._json(200, ops_db.get_complaint(complaint_id))
                return
            if not tail and method == "POST":
                self._json(200, ops_db.save_complaint(self._body(), complaint_id))
                return
            if tail == ["close"] and method == "POST":
                self._json(200, ops_db.close_complaint(complaint_id))
                return
        if parts == ["changes"] and method == "GET":
            self._json(200, ops_db.list_changes(query.get("day") or ""))
            return
        if parts == ["spend"] and method == "GET":
            self._json(200, ops_db.list_spend(query.get("start") or "", query.get("end") or ""))
            return
        if parts == ["settings"] and method == "GET":
            self._json(200, ops_db.get_settings())
            return
        if parts == ["settings"] and method == "POST":
            self._json(200, ops_db.save_settings(self._body()))
            return
        if parts == ["publish"] and method == "GET":
            self._json(200, ops_db.list_publish())
            return
        if parts == ["publish"] and method == "POST":
            self._json(200, ops_db.publish_snapshot())
            return
        if parts == ["publish", "build"] and method == "POST":
            self._json(200, self._start_build())
            return
        if parts == ["publish", "snapshot"] and method == "GET":
            file = ops_db.snapshot_file()
            if not file.exists():
                raise ValueError("还没有快照")
            self._json(200, json.loads(file.read_text(encoding="utf-8")))
            return
        self._json(404, {"error": "没有这个接口"})

    def _login(self) -> None:
        body = self._body()
        token = ops_db.login(str(body.get("username") or ""), str(body.get("password") or ""))
        if not token:
            self._json(401, {"error": "账号或密码不正确"})
            return
        operator = ops_db.operator_from_token(token)
        self._json(200, operator or {"ok": True}, token=token)

    def _collect(self) -> None:
        if _limited(self.client_address[0]):
            self._json(204, {})
            return
        body = self._body()
        if body.get("ad_id"):
            ops_db.record_impression(int(body["ad_id"]))
        else:
            ops_db.record_view(str(body.get("path") or "/"), str(body.get("referrer") or ""), self.headers.get("User-Agent") or "")
        self._json(204, {})

    def _public_submission(self) -> None:
        if _limited(self.client_address[0]):
            self._json(429, {"error": "提交太频繁"})
            return
        body = self._body()
        source = str(body.get("source") or "external")
        if source not in ("external", "replica", "main"):
            source = "external"
        saved = ops_db.ingest_submission(source, str(body.get("site_name") or ""), str(body.get("url") or ""), str(body.get("contact") or ""), str(body.get("body") or ""))
        self._json(200, {"id": saved})

    def _go(self, path: str) -> None:
        part = path[len("/go/") :].split("?")[0].strip("/")
        if not part.isdigit():
            self._json(404, {"error": "没有这条广告"})
            return
        target = ops_db.record_click(int(part))
        if not target:
            self._json(404, {"error": "广告不在投放期"})
            return
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _start_build(self) -> dict:
        if not BUILD_LOCK.acquire(blocking=False):
            raise RuntimeError("构建还在进行")
        run_id = ops_db.add_publish("building", "开始构建静态站")

        def work() -> None:
            log = ROOT / "data" / "ops-build.log"
            try:
                proc = subprocess.run(
                    "npm run build",
                    cwd=ROOT,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=1800,
                )
                log.parent.mkdir(parents=True, exist_ok=True)
                log.write_text((proc.stdout or "")[-6000] + "\n" + (proc.stderr or "")[-3000], encoding="utf-8")
                if proc.returncode == 0:
                    ops_db.finish_publish(run_id, "built", "静态站已构建")
                else:
                    ops_db.finish_publish(run_id, "failed", "构建失败，日志在 data/ops-build.log")
            except Exception as err:
                ops_db.finish_publish(run_id, "failed", str(err)[:300])
            finally:
                BUILD_LOCK.release()

        threading.Thread(target=work, daemon=True).start()
        return {"id": run_id, "started": True}

    def _token(self) -> str:
        for part in (self.headers.get("Cookie") or "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == "ops_session":
                return value
        return ""

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(max(0, min(length, 200000))) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            raise ValueError("请求格式不对")
        if not isinstance(data, dict):
            raise ValueError("请求格式不对")
        return data

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def _json(self, code: int, payload, token: str | None = None, clear: bool = False) -> None:
        if code == 204:
            body = b""
        else:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if token:
            self.send_header("Set-Cookie", f"ops_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800")
        if clear:
            self.send_header("Set-Cookie", "ops_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
        if self._public_path():
            self._cors()
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _file(self, path: str) -> None:
        if not DIST.exists():
            self._json(404, {"error": "后台页面还没有构建。开发时请另开 admin 的 Vite。"})
            return
        rel = path.split("?", 1)[0].lstrip("/")
        root = DIST.resolve()
        candidate = (DIST / rel).resolve() if rel else root / "index.html"
        if not str(candidate).startswith(str(root)) or not candidate.is_file():
            candidate = root / "index.html"
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(candidate.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def make_server(host: str = "127.0.0.1", port: int = 4180) -> ThreadingHTTPServer:
    ops_db.bootstrap()
    return ThreadingHTTPServer((host, port), OpsHandler)
