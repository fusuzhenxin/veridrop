"""SQLite store for the operations console. Test keys stay encrypted."""

from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import ops_crypto

ROOT = Path(__file__).resolve().parent.parent
TZ = timezone(timedelta(hours=8))
LOCK = threading.RLock()
MODES = {"public", "auth", "none"}
TIERS = {"ad", "featured", "traffic", "longtail"}
SLOTS = {"sponsor": 2, "list_top": 4, "footer": None}
SLOT_NAMES = {"sponsor": "全站赞助", "list_top": "列表页顶部", "footer": "全站页脚"}
SOURCES = {"main", "external", "replica"}
DEFAULTS = {
    "probe_hour": "3",
    "down_hours": "6",
    "price_jump": "0.5",
    "cert_warn_days": "14",
    "daily_budget": "5",
    "cost_per_call": "0.0001",
    "flagships": "claude-opus,claude-sonnet,gpt-4o,gemini-2.5-pro",
    "scheduler": "1",
    "batch_limit": "20",
    "proxy": "",
    "recheck_hours": "2",
    "longtail_days": "7",
    "daily_hours": "20",
    "traffic_min": "20",
    "last_schedule_day": "",
}
_SECRET = None


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def today() -> str:
    return datetime.now(TZ).date().isoformat()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def db_path() -> Path:
    return Path(os.environ.get("OPS_DB", ROOT / "data" / "ops.sqlite"))


def secret() -> bytes:
    global _SECRET
    if os.environ.get("OPS_SECRET"):
        return ops_crypto.load_secret(Path("."))
    if _SECRET is None:
        path = Path(os.environ["OPS_SECRET_FILE"]) if os.environ.get("OPS_SECRET_FILE") else db_path().parent / "ops-secret.key"
        _SECRET = ops_crypto.load_secret(path)
    return _SECRET


def open_db() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS operators (
          id INTEGER PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          operator_id INTEGER NOT NULL,
          expires_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          domain TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL,
          status_mode TEXT NOT NULL DEFAULT 'none',
          status_url TEXT NOT NULL DEFAULT '',
          listed INTEGER NOT NULL DEFAULT 1,
          tier TEXT NOT NULL DEFAULT 'longtail',
          test_model TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          taken_down INTEGER NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          source_token TEXT NOT NULL DEFAULT '',
          last_up INTEGER,
          last_model_count INTEGER,
          last_price TEXT NOT NULL DEFAULT '',
          last_price_value REAL,
          last_flagships TEXT NOT NULL DEFAULT '',
          last_success_at TEXT,
          last_checked_at TEXT,
          last_error TEXT NOT NULL DEFAULT '',
          last_final_url TEXT NOT NULL DEFAULT '',
          cert_not_after TEXT,
          down_since TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS station_keys (
          station_id INTEGER PRIMARY KEY,
          ciphertext TEXT NOT NULL,
          hint TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS probe_runs (
          id INTEGER PRIMARY KEY,
          station_id INTEGER,
          site_id INTEGER,
          kind TEXT NOT NULL,
          ok INTEGER NOT NULL,
          latency_ms INTEGER,
          model TEXT NOT NULL DEFAULT '',
          cost REAL NOT NULL DEFAULT 0,
          error_type TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY,
          station_id INTEGER,
          site_id INTEGER,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ads (
          id INTEGER PRIMARY KEY,
          slot TEXT NOT NULL,
          name TEXT NOT NULL,
          blurb TEXT NOT NULL DEFAULT '',
          image_url TEXT NOT NULL DEFAULT '',
          target_url TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          paused INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ad_daily (
          ad_id INTEGER NOT NULL,
          day TEXT NOT NULL,
          impressions INTEGER NOT NULL DEFAULT 0,
          clicks INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (ad_id, day)
        );
        CREATE TABLE IF NOT EXISTS traffic_daily (
          day TEXT NOT NULL,
          path TEXT NOT NULL,
          referrer TEXT NOT NULL,
          human INTEGER NOT NULL,
          views INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, path, referrer, human)
        );
        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY,
          domain TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          template TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL,
          last_published_at TEXT,
          notes TEXT NOT NULL DEFAULT '',
          last_up INTEGER,
          cert_not_after TEXT,
          last_checked_at TEXT,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY,
          source TEXT NOT NULL,
          site_name TEXT NOT NULL,
          url TEXT NOT NULL,
          contact TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          station_id INTEGER,
          external_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          decided_at TEXT
        );
        CREATE TABLE IF NOT EXISTS complaints (
          id INTEGER PRIMARY KEY,
          station_id INTEGER,
          url TEXT NOT NULL DEFAULT '',
          contact TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL,
          closed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS changes (
          id INTEGER PRIMARY KEY,
          day TEXT NOT NULL,
          station_id INTEGER,
          kind TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS spend_daily (
          day TEXT NOT NULL,
          station_id INTEGER NOT NULL,
          amount REAL NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, station_id)
        );
        CREATE TABLE IF NOT EXISTS publish_runs (
          id INTEGER PRIMARY KEY,
          status TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          snapshot_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS job_batches (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          total INTEGER NOT NULL DEFAULT 0,
          done INTEGER NOT NULL DEFAULT 0,
          message TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_station ON probe_runs(station_id, id);
        CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_external ON submissions(external_id) WHERE external_id != '';
        """
    )
    for key, value in DEFAULTS.items():
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", (key, value))


def _tx(fn):
    def wrapper(*args, **kwargs):
        with LOCK:
            conn = open_db()
            try:
                init_schema(conn)
                result = fn(conn, *args, **kwargs)
                conn.commit()
                return result
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    return wrapper


def _rows(rows) -> list[dict]:
    return [dict(row) for row in rows]


def _one(row) -> dict | None:
    return dict(row) if row else None


def _clean_host(value: str) -> str:
    text = (value or "").strip().lower()
    if "://" in text:
        text = urlparse(text).hostname or ""
    text = text.split("/")[0].split(":")[0]
    if text.startswith("www."):
        text = text[4:]
    return text[:253]


def _http_url(value: str) -> str:
    text = (value or "").strip()
    if not text:
        raise ValueError("请填写网址")
    if not re.match(r"https?://", text, re.I):
        text = "https://" + text
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("网址需要以 http 或 https 开头")
    return text[:500]


def _day(value: str, label: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ValueError(label + "格式应为 YYYY-MM-DD")
    return value


def _setting(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if row:
        return row["value"]
    return DEFAULTS.get(key, "")


def _settings(conn: sqlite3.Connection) -> dict:
    found = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings")}
    merged = dict(DEFAULTS)
    merged.update(found)
    return merged


def _hint(key: str) -> str:
    text = key.strip()
    if len(text) <= 4:
        return "已保存"
    return "…" + text[-4:]


def _public_station(conn: sqlite3.Connection, row: sqlite3.Row | dict) -> dict:
    item = dict(row)
    key = conn.execute("SELECT hint FROM station_keys WHERE station_id=?", (item["id"],)).fetchone()
    item["key_hint"] = key["hint"] if key else ""
    item["has_key"] = bool(key)
    return item


def _page(conn: sqlite3.Connection, sql: str, args: list, page: int, size: int) -> dict:
    page = max(1, page)
    size = min(100, max(1, size))
    total = conn.execute(f"SELECT COUNT(*) AS n FROM ({sql})", args).fetchone()["n"]
    rows = conn.execute(sql + " LIMIT ? OFFSET ?", [*args, size, (page - 1) * size]).fetchall()
    return {"items": _rows(rows), "total": total, "page": page, "size": size}


def _open_alert(conn, kind: str, title: str, body: str, station_id=None, site_id=None) -> None:
    row = conn.execute(
        """
        SELECT id FROM alerts
        WHERE kind=? AND status!='closed' AND ifnull(station_id,0)=? AND ifnull(site_id,0)=? AND created_at>=?
        """,
        (kind, station_id or 0, site_id or 0, today()),
    ).fetchone()
    if row:
        return
    conn.execute(
        "INSERT INTO alerts(station_id, site_id, kind, title, body, status, created_at) VALUES(?,?,?,?,?,'open',?)",
        (station_id, site_id, kind, title[:80], body[:500], now_iso()),
    )


def _change(conn, station_id: int, kind: str, detail: str) -> None:
    conn.execute(
        "INSERT INTO changes(day, station_id, kind, detail, created_at) VALUES(?,?,?,?,?)",
        (today(), station_id, kind, detail[:300], now_iso()),
    )


def _flagships(names: list[str], setting: str) -> list[str]:
    needles = [part.strip().lower() for part in setting.split(",") if part.strip()]
    found = []
    for name in names:
        low = name.lower()
        for needle in needles:
            if needle in low and needle not in found:
                found.append(needle)
    return found


def _price_value(text: str) -> float | None:
    match = re.search(r"\d+(?:\.\d+)?", text or "")
    if not match:
        return None
    return float(match.group(0))


@_tx
def bootstrap(conn) -> str | None:
    row = conn.execute("SELECT id FROM operators LIMIT 1").fetchone()
    if row:
        return None
    username = os.environ.get("OPS_USER", "admin").strip() or "admin"
    password = os.environ.get("OPS_PASSWORD", "").strip()
    generated = False
    if not password:
        password = secrets.token_urlsafe(9)
        generated = True
    salt = secrets.token_bytes(16)
    conn.execute(
        "INSERT INTO operators(username, password_hash, salt, created_at) VALUES(?,?,?,?)",
        (username, ops_crypto.hash_password(password, salt), base64_salt(salt), now_iso()),
    )
    if not generated:
        return None
    path = ROOT / "data" / "admin-bootstrap.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"username={username}\npassword={password}\n", encoding="utf-8")
    return password


def base64_salt(salt: bytes) -> str:
    import base64

    return base64.b64encode(salt).decode("ascii")


def _salt_bytes(value: str) -> bytes:
    import base64

    return base64.b64decode(value.encode("ascii"))


@_tx
def login(conn, username: str, password: str) -> str | None:
    row = conn.execute("SELECT * FROM operators WHERE username=?", (username.strip(),)).fetchone()
    if not row or not ops_crypto.check_password(password, _salt_bytes(row["salt"]), row["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.now().timestamp(),))
    conn.execute(
        "INSERT INTO sessions(token, operator_id, expires_at) VALUES(?,?,?)",
        (token, row["id"], datetime.now().timestamp() + 7 * 86400),
    )
    return token


@_tx
def logout(conn, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token=?", (token,))


@_tx
def operator_from_token(conn, token: str) -> dict | None:
    if not token:
        return None
    row = conn.execute(
        """
        SELECT operators.id, operators.username FROM sessions
        JOIN operators ON operators.id = sessions.operator_id
        WHERE sessions.token=? AND sessions.expires_at >= ?
        """,
        (token, datetime.now().timestamp()),
    ).fetchone()
    return _one(row)


@_tx
def change_password(conn, operator_id: int, old: str, new: str) -> None:
    if len(new) < 6:
        raise ValueError("新密码至少 6 位")
    row = conn.execute("SELECT * FROM operators WHERE id=?", (operator_id,)).fetchone()
    if not row or not ops_crypto.check_password(old, _salt_bytes(row["salt"]), row["password_hash"]):
        raise ValueError("原密码不正确")
    salt = secrets.token_bytes(16)
    conn.execute(
        "UPDATE operators SET password_hash=?, salt=? WHERE id=?",
        (ops_crypto.hash_password(new, salt), base64_salt(salt), operator_id),
    )
    conn.execute("DELETE FROM sessions WHERE operator_id=?", (operator_id,))


def _station_filters(args: dict) -> tuple[str, list]:
    where = ["1=1"]
    params: list = []
    if args.get("q"):
        where.append("(name LIKE ? OR domain LIKE ?)")
        like = f"%{args['q'].strip()}%"
        params.extend([like, like])
    if args.get("mode") in MODES:
        where.append("status_mode=?")
        params.append(args["mode"])
    if args.get("tier") in TIERS:
        where.append("tier=?")
        params.append(args["tier"])
    if args.get("listed") in ("0", "1"):
        where.append("listed=?")
        params.append(int(args["listed"]))
    if args.get("down") == "1":
        where.append("last_up=0")
    return " AND ".join(where), params


@_tx
def list_stations(conn, args: dict) -> dict:
    where, params = _station_filters(args)
    sql = f"SELECT * FROM stations WHERE {where} ORDER BY id DESC"
    page = _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))
    page["items"] = [_public_station(conn, item) for item in page["items"]]
    return page


@_tx
def get_station(conn, station_id: int) -> dict:
    row = conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone()
    if not row:
        raise ValueError("没有这个中转站")
    item = _public_station(conn, row)
    item["runs"] = _rows(
        conn.execute(
            "SELECT id, kind, ok, latency_ms, model, cost, error_type, created_at FROM probe_runs WHERE station_id=? ORDER BY id DESC LIMIT 20",
            (station_id,),
        )
    )
    return item


def _write_station(conn, payload: dict, station_id: int | None) -> int:
    name = str(payload.get("name") or "").strip()[:80]
    domain = _clean_host(str(payload.get("domain") or payload.get("url") or ""))
    url = _http_url(str(payload.get("url") or ("https://" + domain)))
    if not name or not domain:
        raise ValueError("请填写名称和域名")
    mode = str(payload.get("status_mode") or "none")
    if mode not in MODES:
        raise ValueError("状态来源不正确")
    tier = str(payload.get("tier") or "longtail")
    if tier not in TIERS:
        raise ValueError("探测频率档不正确")
    status_url = str(payload.get("status_url") or "").strip()[:500]
    if status_url:
        status_url = _http_url(status_url)
    current = now_iso()
    fields = (
        name,
        domain,
        url,
        mode,
        status_url,
        1 if payload.get("listed", True) else 0,
        tier,
        str(payload.get("test_model") or "").strip()[:80],
        1 if payload.get("enabled", True) else 0,
        str(payload.get("notes") or "").strip()[:1000],
        str(payload.get("source_token") or "").strip()[:80],
        current,
    )
    if station_id:
        exists = conn.execute("SELECT id FROM stations WHERE id=?", (station_id,)).fetchone()
        if not exists:
            raise ValueError("没有这个中转站")
        taken = conn.execute("SELECT id FROM stations WHERE domain=? AND id!=?", (domain, station_id)).fetchone()
        if taken:
            raise ValueError("这个域名已经在站档里")
        conn.execute(
            """
            UPDATE stations SET name=?, domain=?, url=?, status_mode=?, status_url=?, listed=?, tier=?,
              test_model=?, enabled=?, notes=?, source_token=?, updated_at=? WHERE id=?
            """,
            (*fields, station_id),
        )
        return station_id
    if conn.execute("SELECT id FROM stations WHERE domain=?", (domain,)).fetchone():
        raise ValueError("这个域名已经在站档里")
    cur = conn.execute(
        """
        INSERT INTO stations(
          name, domain, url, status_mode, status_url, listed, tier, test_model, enabled, notes,
          source_token, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (*fields, current),
    )
    return int(cur.lastrowid)


@_tx
def save_station(conn, payload: dict, station_id: int | None = None) -> dict:
    saved = _write_station(conn, payload, station_id)
    key = payload.get("key")
    if isinstance(key, str) and key.strip():
        _store_key(conn, saved, key.strip())
    row = conn.execute("SELECT * FROM stations WHERE id=?", (saved,)).fetchone()
    return _public_station(conn, row)


def _store_key(conn, station_id: int, key: str) -> None:
    if len(key) < 6:
        raise ValueError("测试 Key 太短")
    conn.execute(
        """
        INSERT INTO station_keys(station_id, ciphertext, hint, updated_at) VALUES(?,?,?,?)
        ON CONFLICT(station_id) DO UPDATE SET ciphertext=excluded.ciphertext, hint=excluded.hint, updated_at=excluded.updated_at
        """,
        (station_id, ops_crypto.encrypt(secret(), key), _hint(key), now_iso()),
    )


@_tx
def set_key(conn, station_id: int, key: str) -> dict:
    if not conn.execute("SELECT id FROM stations WHERE id=?", (station_id,)).fetchone():
        raise ValueError("没有这个中转站")
    if not str(key or "").strip():
        conn.execute("DELETE FROM station_keys WHERE station_id=?", (station_id,))
    else:
        _store_key(conn, station_id, key.strip())
    return _public_station(conn, conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone())


@_tx
def read_key(conn, station_id: int) -> str:
    row = conn.execute("SELECT ciphertext FROM station_keys WHERE station_id=?", (station_id,)).fetchone()
    if not row:
        return ""
    return ops_crypto.decrypt(secret(), row["ciphertext"])


@_tx
def queue_station(conn, station_id: int) -> None:
    cur = conn.execute("UPDATE stations SET last_checked_at=NULL, updated_at=? WHERE id=?", (now_iso(), station_id))
    if not cur.rowcount:
        raise ValueError("没有这个中转站")


@_tx
def takedown(conn, station_id: int, down: bool) -> dict:
    row = conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone()
    if not row:
        raise ValueError("没有这个中转站")
    conn.execute(
        "UPDATE stations SET taken_down=?, listed=CASE WHEN ?=1 THEN 0 ELSE listed END, updated_at=? WHERE id=?",
        (1 if down else 0, 1 if down else 0, now_iso(), station_id),
    )
    fresh = conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone()
    return _public_station(conn, fresh)


def _public_status_url(sources) -> str:
    for raw in sources or []:
        text = str(raw or "").strip()
        if not text:
            continue
        parsed = urlparse(text)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            continue
        if parsed.path.rstrip("/") == "/api/status":
            return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    return ""


def _classify_status(sources, progress_status: str) -> tuple[str, str]:
    url = _public_status_url(sources)
    if url:
        return "public", url
    if progress_status == "auth":
        return "auth", ""
    return "none", ""


def _status_hints() -> dict[str, tuple[str, str]]:
    web = {}
    progress = {}
    web_path = ROOT / "data" / "station-web.json"
    progress_path = ROOT / "data" / "model-list-progress.json"
    if web_path.exists():
        try:
            web = json.loads(web_path.read_text(encoding="utf-8")).get("checked") or {}
        except (OSError, json.JSONDecodeError):
            web = {}
    if progress_path.exists():
        try:
            loaded = json.loads(progress_path.read_text(encoding="utf-8"))
            progress = loaded if isinstance(loaded, dict) else {}
        except (OSError, json.JSONDecodeError):
            progress = {}
    hints = {}
    for token in set(web) | set(progress):
        row = web.get(token) if isinstance(web.get(token), dict) else {}
        item = progress.get(token) if isinstance(progress.get(token), dict) else {}
        hints[str(token)] = _classify_status(row.get("sources"), str(item.get("status") or ""))
    return hints


@_tx
def import_catalog(conn, path: Path | None = None) -> dict:
    file = path or (ROOT / "src" / "verd-index.json")
    if not file.exists():
        raise ValueError("没有找到目录数据")
    data = json.loads(file.read_text(encoding="utf-8"))
    added = 0
    skipped = 0
    updated = 0
    modes = {"public": 0, "auth": 0, "none": 0}
    hints = _status_hints()
    current = now_iso()
    for row in data.get("stations") or []:
        domain = _clean_host(str(row.get("domain") or row.get("host") or row.get("url") or ""))
        if not domain:
            continue
        mode, status_url = hints.get(str(row.get("token") or ""), ("none", ""))
        modes[mode] += 1
        existing = conn.execute("SELECT id, status_mode FROM stations WHERE domain=?", (domain,)).fetchone()
        if existing:
            skipped += 1
            if existing["status_mode"] == "none" and mode != "none":
                conn.execute(
                    "UPDATE stations SET status_mode=?, status_url=?, updated_at=? WHERE id=?",
                    (mode, status_url, current, existing["id"]),
                )
                updated += 1
            continue
        url = str(row.get("url") or ("https://" + domain))
        try:
            url = _http_url(url)
        except ValueError:
            url = "https://" + domain
        tier = "featured" if row.get("ownerPick") else "longtail"
        conn.execute(
            """
            INSERT INTO stations(
              name, domain, url, status_mode, status_url, listed, tier, enabled, source_token,
              last_up, last_model_count, last_checked_at, created_at, updated_at
            ) VALUES(?,?,?,?,?,1,?,1,?,?,?,?,?,?)
            """,
            (
                str(row.get("name") or domain)[:80],
                domain,
                url,
                mode,
                status_url,
                tier,
                str(row.get("token") or "")[:80],
                1 if row.get("online") else 0,
                int(row.get("modelCount") or 0),
                current,
                current,
                current,
            ),
        )
        added += 1
    return {"added": added, "skipped": skipped, "updated": updated, "modes": modes}


@_tx
def list_runs(conn, args: dict) -> dict:
    where = ["1=1"]
    params: list = []
    if args.get("station_id"):
        where.append("station_id=?")
        params.append(int(args["station_id"]))
    if args.get("kind"):
        where.append("kind=?")
        params.append(str(args["kind"])[:40])
    if args.get("ok") in ("0", "1"):
        where.append("ok=?")
        params.append(int(args["ok"]))
    sql = f"SELECT * FROM probe_runs WHERE {' AND '.join(where)} ORDER BY id DESC"
    return _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))


@_tx
def get_run(conn, run_id: int) -> dict:
    row = conn.execute("SELECT * FROM probe_runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        raise ValueError("没有这条记录")
    item = dict(row)
    if item.get("station_id"):
        station = conn.execute("SELECT name, domain FROM stations WHERE id=?", (item["station_id"],)).fetchone()
        if station:
            item["station_name"] = station["name"]
            item["domain"] = station["domain"]
    return item


@_tx
def due_stations(conn, limit: int) -> list[dict]:
    settings = _settings(conn)
    now = datetime.now(timezone.utc)
    rows = conn.execute("SELECT * FROM stations WHERE enabled=1 AND taken_down=0").fetchall()
    due = []
    for row in rows:
        last = parse_time(row["last_checked_at"])
        age = 10**9 if last is None else (now - last).total_seconds() / 3600
        if row["last_up"] == 0 and row["last_checked_at"]:
            ready = age >= float(settings["recheck_hours"])
        elif row["tier"] == "longtail":
            ready = age >= float(settings["longtail_days"]) * 24
        else:
            ready = age >= float(settings["daily_hours"])
        if ready:
            due.append(dict(row))
        if len(due) >= limit:
            break
    return due


@_tx
def station_probe_context(conn, station_id: int) -> dict:
    row = conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone()
    if not row:
        raise ValueError("没有这个中转站")
    item = dict(row)
    key_row = conn.execute("SELECT ciphertext FROM station_keys WHERE station_id=?", (station_id,)).fetchone()
    item["key"] = ops_crypto.decrypt(secret(), key_row["ciphertext"]) if key_row else ""
    item["settings"] = _settings(conn)
    item["spent"] = _spent_today(conn)
    return item


def _spent_today(conn) -> float:
    row = conn.execute("SELECT COALESCE(SUM(amount),0) AS n FROM spend_daily WHERE day=?", (today(),)).fetchone()
    return float(row["n"] or 0)


@_tx
def finish_probe(conn, station_id: int, runs: list[dict]) -> dict:
    station = conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone()
    if not station:
        raise ValueError("没有这个中转站")
    settings = _settings(conn)
    created = now_iso()
    models: list[str] | None = None
    price = station["last_price"] or ""
    price_value = station["last_price_value"]
    final_url = station["last_final_url"] or ""
    cert_until = station["cert_not_after"]
    cost = 0.0
    calls = 0
    for run in runs:
        detail = run.get("detail")
        if isinstance(detail, (dict, list)):
            if isinstance(detail, dict):
                if "models" in detail:
                    models = [str(name) for name in (detail.get("models") or [])]
                if detail.get("price"):
                    price = str(detail.get("price"))[:80]
                    parsed = _price_value(price)
                    if parsed is not None:
                        price_value = parsed
                if detail.get("final_url"):
                    final_url = str(detail["final_url"])[:500]
                if detail.get("cert_not_after"):
                    cert_until = str(detail["cert_not_after"])[:40]
            stored = json.dumps(detail, ensure_ascii=False)[:4000]
        else:
            stored = str(detail or "")[:4000]
        run_cost = float(run.get("cost") or 0)
        if run_cost > 0:
            cost += run_cost
            calls += 1
        conn.execute(
            """
            INSERT INTO probe_runs(station_id, kind, ok, latency_ms, model, cost, error_type, detail, created_at)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                station_id,
                str(run.get("kind") or "ping")[:40],
                1 if run.get("ok") else 0,
                run.get("latency_ms"),
                str(run.get("model") or "")[:80],
                run_cost,
                str(run.get("error_type") or "")[:40],
                stored,
                created,
            ),
        )
    signals = [run for run in runs if run.get("kind") in ("ping", "status", "models")]
    up = any(run.get("ok") for run in signals) if signals else bool(station["last_up"])
    old_flags = [part for part in (station["last_flagships"] or "").split(",") if part]
    flags = _flagships(models, settings["flagships"]) if models is not None else old_flags
    if station["last_up"] is not None and int(bool(station["last_up"])) != int(up):
        _change(conn, station_id, "up" if up else "down", "恢复" if up else "转为测不通")
    if models is not None and old_flags:
        removed = [name for name in old_flags if name not in flags]
        added = [name for name in flags if name not in old_flags]
        if removed or added:
            _change(conn, station_id, "models", "减少 " + ",".join(removed) + " 增加 " + ",".join(added))
        if removed:
            _open_alert(conn, "flagship", station["name"] + " 主力模型消失", "不见了：" + ",".join(removed), station_id)
    if price and station["last_price"] and price != station["last_price"]:
        _change(conn, station_id, "price", f"{station['last_price']} → {price}")
        old_value = station["last_price_value"]
        if old_value and price_value and old_value > 0:
            jump = abs(price_value - old_value) / old_value
            if jump >= float(settings["price_jump"]):
                _open_alert(conn, "price", station["name"] + " 价格跳动", f"{old_value} → {price_value}", station_id)
    final_host = _clean_host(final_url)
    if final_host and final_host != station["domain"]:
        _change(conn, station_id, "redirect", final_url)
        _open_alert(conn, "redirect", station["name"] + " 域名跳走", final_url, station_id)
    down_since = station["down_since"]
    if up:
        down_since = None
    elif not down_since:
        down_since = created
    elif parse_time(down_since) and datetime.now(timezone.utc) - parse_time(down_since) >= timedelta(hours=float(settings["down_hours"])):
        _open_alert(conn, "down", station["name"] + " 连续测不通", "自 " + down_since + " 起没有恢复", station_id)
    if cert_until:
        try:
            expiry = datetime.fromisoformat(cert_until)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if expiry - datetime.now(timezone.utc) <= timedelta(days=float(settings["cert_warn_days"])):
                _open_alert(conn, "cert", station["name"] + " 证书快到期", cert_until, station_id)
        except ValueError:
            pass
    error = ""
    for run in runs:
        if not run.get("ok") and run.get("error_type"):
            error = str(run["error_type"])
            break
    conn.execute(
        """
        UPDATE stations SET last_up=?, last_model_count=?, last_price=?, last_price_value=?, last_flagships=?,
          last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END,
          last_checked_at=?, last_error=?, last_final_url=?, cert_not_after=?, down_since=?, updated_at=?
        WHERE id=?
        """,
        (
            1 if up else 0,
            len(models) if models is not None else station["last_model_count"],
            price or "",
            price_value,
            ",".join(flags),
            1 if up else 0,
            created,
            created,
            error,
            final_url or "",
            cert_until,
            down_since,
            created,
            station_id,
        ),
    )
    if cost > 0:
        conn.execute(
            """
            INSERT INTO spend_daily(day, station_id, amount, calls) VALUES(?,?,?,?)
            ON CONFLICT(day, station_id) DO UPDATE SET amount=amount+excluded.amount, calls=calls+excluded.calls
            """,
            (today(), station_id, cost, calls),
        )
    fresh = conn.execute("SELECT * FROM stations WHERE id=?", (station_id,)).fetchone()
    return _public_station(conn, fresh)


@_tx
def list_alerts(conn, args: dict) -> dict:
    where = ["1=1"]
    params: list = []
    if args.get("status") in ("open", "ack", "closed"):
        where.append("status=?")
        params.append(args["status"])
    sql = f"SELECT * FROM alerts WHERE {' AND '.join(where)} ORDER BY id DESC"
    return _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))


@_tx
def set_alert(conn, alert_id: int, status: str) -> dict:
    if status not in ("ack", "closed", "open"):
        raise ValueError("状态不正确")
    cur = conn.execute("UPDATE alerts SET status=? WHERE id=?", (status, alert_id))
    if not cur.rowcount:
        raise ValueError("没有这条告警")
    return dict(conn.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone())


def _ad_out(row: dict, stats: dict | None = None) -> dict:
    item = dict(row)
    item["slot_label"] = SLOT_NAMES.get(item["slot"], item["slot"])
    item["live"] = _ad_live(item, today())
    item["impressions"] = (stats or {}).get("impressions", 0)
    item["clicks"] = (stats or {}).get("clicks", 0)
    return item


def _ad_live(item: dict, day: str) -> bool:
    return not item["paused"] and item["start_date"] <= day < item["end_date"]


def _ad_stats_map(conn, ids: list[int]) -> dict:
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT ad_id, SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM ad_daily WHERE ad_id IN ({marks}) GROUP BY ad_id",
        ids,
    )
    return {row["ad_id"]: {"impressions": row["impressions"], "clicks": row["clicks"]} for row in rows}


@_tx
def list_ads(conn, args: dict) -> dict:
    where = ["1=1"]
    params: list = []
    if args.get("slot") in SLOTS:
        where.append("slot=?")
        params.append(args["slot"])
    sql = f"SELECT * FROM ads WHERE {' AND '.join(where)} ORDER BY id DESC"
    page = _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))
    stats = _ad_stats_map(conn, [item["id"] for item in page["items"]])
    page["items"] = [_ad_out(item, stats.get(item["id"])) for item in page["items"]]
    return page


def _save_ad(conn, payload: dict, ad_id: int | None) -> int:
    slot = str(payload.get("slot") or "")
    if slot not in SLOTS:
        raise ValueError("广告位置不正确")
    name = str(payload.get("name") or "").strip()[:40]
    blurb = str(payload.get("blurb") or "").strip()
    if not name:
        raise ValueError("请填写广告名称")
    if len(blurb) > 40:
        raise ValueError("介绍最多 40 个字")
    for word in ("推荐", "站长在用", "公益", "低延迟"):
        if word in name or word in blurb:
            raise ValueError(f"广告文案不能使用「{word}」")
    target = _http_url(str(payload.get("target_url") or ""))
    image = str(payload.get("image_url") or "").strip()[:500]
    start = _day(str(payload.get("start_date") or ""), "开始日")
    end = _day(str(payload.get("end_date") or ""), "到期日")
    if start >= end:
        raise ValueError("到期日要晚于开始日。到期当天撤下")
    paused = 1 if payload.get("paused") else 0
    if not paused:
        cap = SLOTS[slot]
        if cap is not None:
            rows = conn.execute(
                """
                SELECT id FROM ads
                WHERE slot=? AND paused=0 AND id!=? AND start_date < ? AND end_date > ?
                """,
                (slot, ad_id or 0, end, start),
            ).fetchall()
            if len(rows) >= cap:
                raise ValueError(f"{SLOT_NAMES[slot]}同时最多 {cap} 条")
    current = now_iso()
    if ad_id:
        if not conn.execute("SELECT id FROM ads WHERE id=?", (ad_id,)).fetchone():
            raise ValueError("没有这条广告")
        conn.execute(
            """
            UPDATE ads SET slot=?, name=?, blurb=?, image_url=?, target_url=?, start_date=?, end_date=?, paused=?, updated_at=?
            WHERE id=?
            """,
            (slot, name, blurb, image, target, start, end, paused, current, ad_id),
        )
        saved = ad_id
    else:
        cur = conn.execute(
            """
            INSERT INTO ads(slot, name, blurb, image_url, target_url, start_date, end_date, paused, created_at, updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (slot, name, blurb, image, target, start, end, paused, current, current),
        )
        saved = int(cur.lastrowid)
    _sync_ad_tiers(conn)
    return saved


def _sync_ad_tiers(conn) -> None:
    day = today()
    rows = conn.execute("SELECT target_url FROM ads WHERE paused=0 AND start_date<=? AND end_date>?", (day, day)).fetchall()
    hosts = {_clean_host(row["target_url"]) for row in rows}
    hosts.discard("")
    if hosts:
        marks = ",".join("?" for _ in hosts)
        conn.execute(f"UPDATE stations SET tier='ad', updated_at=? WHERE domain IN ({marks}) AND tier!='featured'", [now_iso(), *hosts])
    conn.execute(
        """
        UPDATE stations SET tier='longtail', updated_at=?
        WHERE tier='ad' AND domain NOT IN (
          SELECT lower(replace(replace(replace(target_url,'https://',''),'http://',''),'www.','')) FROM ads WHERE 1=0
        )
        """,
        (now_iso(),),
    )
    ad_domains = conn.execute("SELECT domain FROM stations WHERE tier='ad'").fetchall()
    for row in ad_domains:
        if row["domain"] not in hosts:
            conn.execute("UPDATE stations SET tier='longtail', updated_at=? WHERE domain=? AND tier='ad'", (now_iso(), row["domain"]))


@_tx
def save_ad(conn, payload: dict, ad_id: int | None = None) -> dict:
    saved = _save_ad(conn, payload, ad_id)
    row = dict(conn.execute("SELECT * FROM ads WHERE id=?", (saved,)).fetchone())
    stats = _ad_stats_map(conn, [saved]).get(saved)
    return _ad_out(row, stats)


@_tx
def get_ad(conn, ad_id: int) -> dict:
    row = conn.execute("SELECT * FROM ads WHERE id=?", (ad_id,)).fetchone()
    if not row:
        raise ValueError("没有这条广告")
    stats = _ad_stats_map(conn, [ad_id]).get(ad_id)
    item = _ad_out(dict(row), stats)
    item["daily"] = _rows(conn.execute("SELECT day, impressions, clicks FROM ad_daily WHERE ad_id=? ORDER BY day DESC LIMIT 30", (ad_id,)))
    return item


def _bump_ad(conn, ad_id: int, field: str) -> str | None:
    row = conn.execute("SELECT * FROM ads WHERE id=?", (ad_id,)).fetchone()
    if not row or not _ad_live(dict(row), today()):
        return None
    conn.execute(
        f"""
        INSERT INTO ad_daily(ad_id, day, impressions, clicks) VALUES(?,?,?,?)
        ON CONFLICT(ad_id, day) DO UPDATE SET {field}={field}+1
        """,
        (ad_id, today(), 1 if field == "impressions" else 0, 1 if field == "clicks" else 0),
    )
    return row["target_url"]


@_tx
def record_impression(conn, ad_id: int) -> bool:
    return _bump_ad(conn, ad_id, "impressions") is not None


@_tx
def record_click(conn, ad_id: int) -> str | None:
    return _bump_ad(conn, ad_id, "clicks")


@_tx
def record_view(conn, path: str, referrer: str, agent: str = "") -> None:
    clean = (path or "/").split("?")[0][:200]
    if not clean.startswith("/"):
        clean = "/" + clean
    host = _clean_host(referrer)[:120] if referrer else ""
    human = not re.search(r"bot|spider|crawl|slurp|bytespider|petalbot|wget|curl|python-requests|python-urllib|headless", agent or "", re.I)
    conn.execute(
        """
        INSERT INTO traffic_daily(day, path, referrer, human, views) VALUES(?,?,?,?,1)
        ON CONFLICT(day, path, referrer, human) DO UPDATE SET views=views+1
        """,
        (today(), clean, host, 1 if human else 0),
    )
    _promote_traffic(conn)


def _promote_traffic(conn) -> None:
    minimum = int(float(_setting(conn, "traffic_min") or 20))
    rows = conn.execute(
        """
        SELECT path, SUM(views) AS views FROM traffic_daily
        WHERE day=? AND human=1 AND path LIKE '/site/%'
        GROUP BY path HAVING SUM(views) >= ?
        """,
        (today(), minimum),
    ).fetchall()
    stations = conn.execute("SELECT id, domain, source_token, tier FROM stations WHERE tier='longtail'").fetchall()
    for station in stations:
        token = station["source_token"]
        domain = station["domain"]
        for row in rows:
            if (token and token in row["path"]) or (domain and domain in row["path"]):
                conn.execute("UPDATE stations SET tier='traffic', updated_at=? WHERE id=?", (now_iso(), station["id"]))
                break


@_tx
def traffic_report(conn, day: str) -> dict:
    day = _day(day or today(), "日期")
    rows = conn.execute(
        """
        SELECT path, SUM(CASE WHEN human=1 THEN views ELSE 0 END) AS human,
               SUM(CASE WHEN human=0 THEN views ELSE 0 END) AS bot,
               SUM(views) AS views
        FROM traffic_daily WHERE day=? GROUP BY path ORDER BY views DESC LIMIT 200
        """,
        (day,),
    ).fetchall()
    totals = conn.execute(
        """
        SELECT COALESCE(SUM(CASE WHEN human=1 THEN views ELSE 0 END),0) AS human,
               COALESCE(SUM(CASE WHEN human=0 THEN views ELSE 0 END),0) AS bot
        FROM traffic_daily WHERE day=?
        """,
        (day,),
    ).fetchone()
    return {"day": day, "human": totals["human"], "bot": totals["bot"], "paths": _rows(rows)}


@_tx
def list_sites(conn, args: dict) -> dict:
    where = ["1=1"]
    params: list = []
    if args.get("kind") in ("external", "replica"):
        where.append("kind=?")
        params.append(args["kind"])
    if args.get("q"):
        where.append("(domain LIKE ? OR template LIKE ?)")
        like = f"%{args['q'].strip()}%"
        params.extend([like, like])
    sql = f"SELECT * FROM sites WHERE {' AND '.join(where)} ORDER BY id DESC"
    return _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))


def _write_site(conn, payload: dict, site_id: int | None) -> int:
    domain = _clean_host(str(payload.get("domain") or payload.get("url") or ""))
    url = _http_url(str(payload.get("url") or ("https://" + domain)))
    kind = str(payload.get("kind") or "")
    if kind not in ("external", "replica"):
        raise ValueError("类型请选外链站或仿站")
    if not domain:
        raise ValueError("请填写域名")
    published = str(payload.get("last_published_at") or "").strip()[:40]
    current = now_iso()
    fields = (domain, kind, str(payload.get("template") or "").strip()[:120], url, published or None, str(payload.get("notes") or "")[:1000], current)
    if site_id:
        if not conn.execute("SELECT id FROM sites WHERE id=?", (site_id,)).fetchone():
            raise ValueError("没有这个站点")
        if conn.execute("SELECT id FROM sites WHERE domain=? AND id!=?", (domain, site_id)).fetchone():
            raise ValueError("这个域名已经登记")
        conn.execute(
            "UPDATE sites SET domain=?, kind=?, template=?, url=?, last_published_at=?, notes=?, updated_at=? WHERE id=?",
            (*fields, site_id),
        )
        return site_id
    if conn.execute("SELECT id FROM sites WHERE domain=?", (domain,)).fetchone():
        raise ValueError("这个域名已经登记")
    cur = conn.execute(
        "INSERT INTO sites(domain, kind, template, url, last_published_at, notes, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)",
        (*fields, current),
    )
    return int(cur.lastrowid)


@_tx
def save_site(conn, payload: dict, site_id: int | None = None) -> dict:
    saved = _write_site(conn, payload, site_id)
    return dict(conn.execute("SELECT * FROM sites WHERE id=?", (saved,)).fetchone())


@_tx
def get_site(conn, site_id: int) -> dict:
    row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
    if not row:
        raise ValueError("没有这个站点")
    item = dict(row)
    item["checks"] = _rows(
        conn.execute(
            "SELECT id, ok, latency_ms, error_type, detail, created_at FROM probe_runs WHERE site_id=? ORDER BY id DESC LIMIT 20",
            (site_id,),
        )
    )
    item["pending_forms"] = conn.execute(
        "SELECT COUNT(*) AS n FROM submissions WHERE source=? AND status='pending' AND url LIKE ?",
        (row["kind"], f"%{row['domain']}%"),
    ).fetchone()["n"]
    return item


@_tx
def due_sites(conn) -> list[dict]:
    day_ago = (datetime.now(timezone.utc) - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    rows = conn.execute(
        "SELECT * FROM sites WHERE last_checked_at IS NULL OR last_checked_at < ? ORDER BY id LIMIT 50",
        (day_ago,),
    ).fetchall()
    return _rows(rows)


@_tx
def site_context(conn, site_id: int) -> dict:
    row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
    if not row:
        raise ValueError("没有这个站点")
    return dict(row)


@_tx
def finish_site(conn, site_id: int, result: dict) -> dict:
    site = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
    if not site:
        raise ValueError("没有这个站点")
    created = now_iso()
    detail = result.get("detail")
    stored = json.dumps(detail, ensure_ascii=False)[:2000] if isinstance(detail, dict) else str(detail or "")[:2000]
    conn.execute(
        """
        INSERT INTO probe_runs(site_id, kind, ok, latency_ms, error_type, detail, created_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (site_id, "site", 1 if result.get("ok") else 0, result.get("latency_ms"), str(result.get("error_type") or "")[:40], stored, created),
    )
    cert_until = (detail or {}).get("cert_not_after") if isinstance(detail, dict) else None
    conn.execute(
        """
        UPDATE sites SET last_up=?, cert_not_after=COALESCE(?, cert_not_after), last_checked_at=?, last_error=?, updated_at=?
        WHERE id=?
        """,
        (1 if result.get("ok") else 0, cert_until, created, str(result.get("error_type") or ""), created, site_id),
    )
    if cert_until:
        try:
            expiry = datetime.fromisoformat(cert_until)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            settings = _settings(conn)
            if expiry - datetime.now(timezone.utc) <= timedelta(days=float(settings["cert_warn_days"])):
                _open_alert(conn, "cert", site["domain"] + " 证书快到期", cert_until, site_id=site_id)
        except ValueError:
            pass
    if not result.get("ok"):
        _open_alert(conn, "site", site["domain"] + " 打不开", str(result.get("error_type") or ""), site_id=site_id)
    return dict(conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone())


@_tx
def list_submissions(conn, args: dict) -> dict:
    where = ["1=1"]
    params: list = []
    if args.get("status") in ("pending", "approved", "rejected"):
        where.append("status=?")
        params.append(args["status"])
    if args.get("source") in SOURCES:
        where.append("source=?")
        params.append(args["source"])
    sql = f"SELECT * FROM submissions WHERE {' AND '.join(where)} ORDER BY id DESC"
    return _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))


@_tx
def get_submission(conn, submission_id: int) -> dict:
    row = conn.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone()
    if not row:
        raise ValueError("没有这条申请")
    return dict(row)


def _insert_submission(conn, source: str, site_name: str, url: str, contact: str, body: str, external_id: str = "") -> int:
    if source not in SOURCES:
        raise ValueError("来源不正确")
    site_name = site_name.strip()[:80]
    url = _http_url(url)
    if not site_name:
        raise ValueError("请填写站点名称")
    if external_id:
        found = conn.execute("SELECT id FROM submissions WHERE external_id=?", (external_id,)).fetchone()
        if found:
            return int(found["id"])
    cur = conn.execute(
        """
        INSERT INTO submissions(source, site_name, url, contact, body, status, external_id, created_at)
        VALUES(?,?,?,?,?,'pending',?,?)
        """,
        (source, site_name, url, contact.strip()[:120], body.strip()[:2000], external_id[:80], now_iso()),
    )
    return int(cur.lastrowid)


@_tx
def save_submission(conn, payload: dict, submission_id: int | None = None) -> dict:
    if submission_id:
        current = conn.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone()
        if not current:
            raise ValueError("没有这条申请")
        if current["status"] != "pending":
            raise ValueError("已经处理过的申请不能再改")
        name = str(payload.get("site_name") or current["site_name"]).strip()[:80]
        url = _http_url(str(payload.get("url") or current["url"]))
        conn.execute(
            "UPDATE submissions SET site_name=?, url=?, contact=?, body=? WHERE id=?",
            (name, url, str(payload.get("contact") or "")[:120], str(payload.get("body") or "")[:2000], submission_id),
        )
        saved = submission_id
    else:
        saved = _insert_submission(
            conn,
            str(payload.get("source") or "main"),
            str(payload.get("site_name") or ""),
            str(payload.get("url") or ""),
            str(payload.get("contact") or ""),
            str(payload.get("body") or ""),
        )
    return dict(conn.execute("SELECT * FROM submissions WHERE id=?", (saved,)).fetchone())


@_tx
def ingest_submission(conn, source: str, site_name: str, url: str, contact: str, body: str, external_id: str = "") -> int:
    return _insert_submission(conn, source, site_name, url, contact, body, external_id)


@_tx
def decide_submission(conn, submission_id: int, approve: bool) -> dict:
    row = conn.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone()
    if not row:
        raise ValueError("没有这条申请")
    if row["status"] != "pending":
        raise ValueError("已经处理过")
    station_id = row["station_id"]
    if approve:
        domain = _clean_host(row["url"])
        found = conn.execute("SELECT id FROM stations WHERE domain=?", (domain,)).fetchone()
        if found:
            station_id = found["id"]
            conn.execute(
                "UPDATE stations SET listed=1, taken_down=0, name=?, url=?, updated_at=? WHERE id=?",
                (row["site_name"], row["url"], now_iso(), station_id),
            )
        else:
            station_id = _write_station(
                conn,
                {"name": row["site_name"], "domain": domain, "url": row["url"], "status_mode": "none", "listed": True, "tier": "longtail", "notes": "来自收录申请"},
                None,
            )
    conn.execute(
        "UPDATE submissions SET status=?, station_id=?, decided_at=? WHERE id=?",
        ("approved" if approve else "rejected", station_id, now_iso(), submission_id),
    )
    return dict(conn.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone())


@_tx
def sync_community(conn, path: Path | None = None) -> dict:
    file = path or (ROOT / "data" / "community.json")
    if not file.exists():
        return {"added": 0}
    data = json.loads(file.read_text(encoding="utf-8"))
    added = 0
    before = conn.execute("SELECT COUNT(*) AS n FROM submissions").fetchone()["n"]
    for email, profile in (data.get("profiles") or {}).items():
        for row in profile.get("submissions") or []:
            name = str(row.get("name") or "").strip()
            url = str(row.get("url") or "").strip()
            if not name or not url:
                continue
            _insert_submission(conn, "main", name, url, str(email), str(row.get("note") or ""), str(row.get("id") or ""))
    after = conn.execute("SELECT COUNT(*) AS n FROM submissions").fetchone()["n"]
    added = after - before
    return {"added": added}


@_tx
def list_complaints(conn, args: dict) -> dict:
    where = ["1=1"]
    params: list = []
    if args.get("status") in ("open", "closed"):
        where.append("status=?")
        params.append(args["status"])
    sql = f"SELECT * FROM complaints WHERE {' AND '.join(where)} ORDER BY id DESC"
    return _page(conn, sql, params, int(args.get("page") or 1), int(args.get("size") or 20))


@_tx
def save_complaint(conn, payload: dict, complaint_id: int | None = None) -> dict:
    body = str(payload.get("body") or "").strip()
    if len(body) < 2:
        raise ValueError("请填写投诉内容")
    url = str(payload.get("url") or "").strip()[:500]
    contact = str(payload.get("contact") or "").strip()[:120]
    station_id = payload.get("station_id") or None
    if station_id:
        station_id = int(station_id)
        if not conn.execute("SELECT id FROM stations WHERE id=?", (station_id,)).fetchone():
            raise ValueError("没有这个中转站")
    if complaint_id:
        if not conn.execute("SELECT id FROM complaints WHERE id=?", (complaint_id,)).fetchone():
            raise ValueError("没有这条投诉")
        conn.execute(
            "UPDATE complaints SET station_id=?, url=?, contact=?, body=? WHERE id=?",
            (station_id, url, contact, body[:2000], complaint_id),
        )
        saved = complaint_id
    else:
        cur = conn.execute(
            "INSERT INTO complaints(station_id, url, contact, body, status, created_at) VALUES(?,?,?,?, 'open', ?)",
            (station_id, url, contact, body[:2000], now_iso()),
        )
        saved = int(cur.lastrowid)
    return dict(conn.execute("SELECT * FROM complaints WHERE id=?", (saved,)).fetchone())


@_tx
def get_complaint(conn, complaint_id: int) -> dict:
    row = conn.execute("SELECT * FROM complaints WHERE id=?", (complaint_id,)).fetchone()
    if not row:
        raise ValueError("没有这条投诉")
    return dict(row)


@_tx
def close_complaint(conn, complaint_id: int) -> dict:
    cur = conn.execute("UPDATE complaints SET status='closed', closed_at=? WHERE id=?", (now_iso(), complaint_id))
    if not cur.rowcount:
        raise ValueError("没有这条投诉")
    return dict(conn.execute("SELECT * FROM complaints WHERE id=?", (complaint_id,)).fetchone())


@_tx
def list_changes(conn, day: str) -> dict:
    day = _day(day or today(), "日期")
    rows = conn.execute(
        """
        SELECT changes.*, stations.domain, stations.name FROM changes
        LEFT JOIN stations ON stations.id = changes.station_id
        WHERE changes.day=? ORDER BY changes.id DESC
        """,
        (day,),
    ).fetchall()
    return {"day": day, "items": _rows(rows)}


@_tx
def list_spend(conn, start: str, end: str) -> dict:
    start = _day(start or today(), "开始日")
    end = _day(end or today(), "结束日")
    rows = conn.execute(
        """
        SELECT spend_daily.day, spend_daily.station_id, spend_daily.amount, spend_daily.calls, stations.name, stations.domain
        FROM spend_daily LEFT JOIN stations ON stations.id = spend_daily.station_id
        WHERE spend_daily.day>=? AND spend_daily.day<=? ORDER BY spend_daily.day DESC, spend_daily.amount DESC
        """,
        (start, end),
    ).fetchall()
    total = sum(row["amount"] for row in rows)
    return {"start": start, "end": end, "total": round(total, 6), "items": _rows(rows)}


@_tx
def get_settings(conn) -> dict:
    return _settings(conn)


@_tx
def save_settings(conn, payload: dict) -> dict:
    allowed = set(DEFAULTS) - {"last_schedule_day"}
    for key, value in payload.items():
        if key not in allowed:
            continue
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)[:200]),
        )
    return _settings(conn)


@_tx
def dashboard(conn) -> dict:
    day = today()
    stations = conn.execute("SELECT COUNT(*) AS n FROM stations").fetchone()["n"]
    down = conn.execute("SELECT COUNT(*) AS n FROM stations WHERE last_up=0 AND taken_down=0").fetchone()["n"]
    alerts = conn.execute("SELECT COUNT(*) AS n FROM alerts WHERE status='open'").fetchone()["n"]
    pending = conn.execute("SELECT COUNT(*) AS n FROM submissions WHERE status='pending'").fetchone()["n"]
    complaints = conn.execute("SELECT COUNT(*) AS n FROM complaints WHERE status='open'").fetchone()["n"]
    live = conn.execute("SELECT COUNT(*) AS n FROM ads WHERE paused=0 AND start_date<=? AND end_date>?", (day, day)).fetchone()["n"]
    spend = _spent_today(conn)
    traffic = conn.execute(
        """
        SELECT COALESCE(SUM(CASE WHEN human=1 THEN views ELSE 0 END),0) AS human,
               COALESCE(SUM(CASE WHEN human=0 THEN views ELSE 0 END),0) AS bot
        FROM traffic_daily WHERE day=?
        """,
        (day,),
    ).fetchone()
    alert_rows = conn.execute("SELECT * FROM alerts WHERE status='open' ORDER BY id DESC LIMIT 6").fetchall()
    change_rows = conn.execute(
        """
        SELECT changes.*, stations.name, stations.domain FROM changes
        LEFT JOIN stations ON stations.id=changes.station_id
        WHERE changes.day=? ORDER BY changes.id DESC LIMIT 8
        """,
        (day,),
    ).fetchall()
    batch = conn.execute("SELECT * FROM job_batches ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "stations": stations,
        "down": down,
        "alerts": alerts,
        "pending": pending,
        "complaints": complaints,
        "liveAds": live,
        "spendToday": round(spend, 6),
        "humanToday": traffic["human"],
        "botToday": traffic["bot"],
        "alertsPreview": _rows(alert_rows),
        "changesPreview": _rows(change_rows),
        "batch": _one(batch),
    }


@_tx
def start_batch(conn, kind: str, total: int) -> int:
    cur = conn.execute(
        "INSERT INTO job_batches(kind, status, total, done, message, created_at) VALUES(?,?,?,0,'',?)",
        (kind, "running", total, now_iso()),
    )
    return int(cur.lastrowid)


@_tx
def advance_batch(conn, batch_id: int, done: int, message: str = "") -> None:
    conn.execute("UPDATE job_batches SET done=?, message=? WHERE id=?", (done, message[:300], batch_id))


@_tx
def finish_batch(conn, batch_id: int, status: str, message: str) -> None:
    conn.execute(
        "UPDATE job_batches SET status=?, message=?, finished_at=? WHERE id=?",
        (status, message[:300], now_iso(), batch_id),
    )


@_tx
def latest_batch(conn) -> dict | None:
    return _one(conn.execute("SELECT * FROM job_batches ORDER BY id DESC LIMIT 1").fetchone())


@_tx
def mark_scheduled(conn, day: str) -> bool:
    current = _setting(conn, "last_schedule_day")
    if current == day:
        return False
    conn.execute(
        "INSERT INTO settings(key, value) VALUES('last_schedule_day', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (day,),
    )
    return True


@_tx
def scheduler_due(conn, hour: int) -> bool:
    settings = _settings(conn)
    if settings.get("scheduler") != "1":
        return False
    if int(float(settings.get("probe_hour") or 3)) != hour:
        return False
    return _setting(conn, "last_schedule_day") != today()


def _live_ads(conn) -> dict:
    day = today()
    grouped = {"sponsor": [], "listTop": [], "footer": []}
    mapping = {"sponsor": "sponsor", "list_top": "listTop", "footer": "footer"}
    rows = conn.execute(
        "SELECT * FROM ads WHERE paused=0 AND start_date<=? AND end_date>? ORDER BY id",
        (day, day),
    ).fetchall()
    for row in rows:
        key = mapping[row["slot"]]
        cap = {"sponsor": 2, "listTop": 4, "footer": None}[key]
        bucket = grouped[key]
        if cap is not None and len(bucket) >= cap:
            continue
        bucket.append(
            {
                "id": row["id"],
                "name": row["name"],
                "blurb": row["blurb"],
                "imageUrl": row["image_url"],
                "href": f"/go/{row['id']}",
            }
        )
    return grouped


@_tx
def publish_snapshot(conn, dest: Path | None = None) -> dict:
    target = dest or snapshot_file()
    payload = {
        "generatedAt": now_iso(),
        "ads": _live_ads(conn),
        "stations": [
            {
                "domain": row["domain"],
                "name": row["name"],
                "up": row["last_up"],
                "modelCount": row["last_model_count"],
                "price": row["last_price"],
                "checkedAt": row["last_checked_at"],
                "listed": row["listed"],
                "takenDown": row["taken_down"],
            }
            for row in conn.execute("SELECT * FROM stations ORDER BY id")
        ],
        "changes": _rows(
            conn.execute(
                """
                SELECT changes.day, changes.kind, changes.detail, stations.domain
                FROM changes LEFT JOIN stations ON stations.id=changes.station_id
                WHERE changes.day=? ORDER BY changes.id
                """,
                (today(),),
            )
        ),
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    cur = conn.execute(
        "INSERT INTO publish_runs(status, message, snapshot_path, created_at, finished_at) VALUES('snapshot','已写入快照',?,?,?)",
        (str(target), now_iso(), now_iso()),
    )
    return {"id": int(cur.lastrowid), "path": str(target), "ads": {key: len(value) for key, value in payload["ads"].items()}, "stations": len(payload["stations"])}


@_tx
def add_publish(conn, status: str, message: str) -> int:
    cur = conn.execute(
        "INSERT INTO publish_runs(status, message, created_at) VALUES(?,?,?)",
        (status, message[:500], now_iso()),
    )
    return int(cur.lastrowid)


@_tx
def finish_publish(conn, run_id: int, status: str, message: str) -> None:
    conn.execute(
        "UPDATE publish_runs SET status=?, message=?, finished_at=? WHERE id=?",
        (status, message[:500], now_iso(), run_id),
    )


@_tx
def list_publish(conn) -> dict:
    rows = conn.execute("SELECT * FROM publish_runs ORDER BY id DESC LIMIT 20").fetchall()
    return {"items": _rows(rows)}


def snapshot_file() -> Path:
    override = os.environ.get("OPS_SNAPSHOT", "").strip()
    if override:
        return Path(override)
    return ROOT / "data" / "ops-snapshot.json"
