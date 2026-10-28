#!/usr/bin/env python3
"""Accounts, station comments, and up/down votes for 维渡 AI."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import smtplib
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env()
DATA = ROOT / "data" / "community.json"
SEED = ROOT / "src" / "vote-counts.json"
DIST = ROOT / "dist"
REDIRECTS = ROOT / "data" / "station-redirects.json"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4175"))
FILE_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".xml": "application/xml; charset=utf-8",
    ".webmanifest": "application/manifest+json",
}


def issue_code(store: dict, email: str, purpose: str) -> str:
    key = f"{purpose}:{email}"
    current = store.setdefault("codes", {}).get(key) or {}
    if float(current.get("sent") or 0) > time.time() - 60:
        raise ValueError("请稍后再获取验证码")
    code = f"{secrets.randbelow(1000000):06d}"
    store["codes"][key] = {
        "digest": hashlib.sha256(code.encode("utf-8")).hexdigest(),
        "exp": time.time() + 600,
        "sent": time.time(),
    }
    return code


def check_code(store: dict, email: str, purpose: str, code: str) -> None:
    key = f"{purpose}:{email}"
    row = store.get("codes", {}).get(key)
    if not row or float(row.get("exp") or 0) < time.time():
        raise ValueError("验证码无效或已过期")
    if hashlib.sha256(str(code or "").strip().encode("utf-8")).hexdigest() != row.get("digest"):
        raise ValueError("验证码不正确")
    store["codes"].pop(key, None)


def send_mail(to: str, subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST", "")
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    port = int(os.environ.get("SMTP_PORT", "465"))
    if not host or not user or not password:
        raise ValueError("邮件服务还没有配置")
    message = EmailMessage()
    message["From"] = user
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP_SSL(host, port, timeout=20) as smtp:
        smtp.login(user, password)
        smtp.send_message(message)


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def shanghai_day() -> str:
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")


def points_book(store: dict, email: str) -> dict:
    book = store.setdefault("points", {}).setdefault(email, {"balance": 0, "ledger": [], "done": {}})
    book.setdefault("balance", 0)
    book.setdefault("ledger", [])
    book.setdefault("done", {})
    return book


def award_points(store: dict, email: str, kind: str, amount: int, reason: str, scope: str = "day") -> dict:
    day = shanghai_day()
    book = points_book(store, email)
    if scope == "once":
        if book["done"].get(kind):
            return {"added": False, "amount": 0, "day": day, "balance": book["balance"]}
        book["done"][kind] = "once"
    else:
        if book["done"].get(kind) == day:
            return {"added": False, "amount": 0, "day": day, "balance": book["balance"]}
        book["done"][kind] = day
    book["balance"] = int(book["balance"]) + amount
    book["ledger"].insert(0, {"id": kind, "reason": reason, "amount": amount, "day": day, "at": utcnow()})
    book["ledger"] = book["ledger"][:80]
    return {"added": True, "amount": amount, "day": day, "balance": book["balance"]}


def profile_book(store: dict, email: str) -> dict:
    book = store.setdefault("profiles", {}).setdefault(email, {"avatar": "", "favorites": [], "submissions": []})
    book.setdefault("avatar", "")
    book.setdefault("favorites", [])
    book.setdefault("submissions", [])
    book.setdefault("invites", [])
    if not book.get("inviteCode"):
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        used = {str(item.get("inviteCode") or "") for item in store.get("profiles", {}).values()}
        code = ""
        while not code or code in used:
            code = "".join(secrets.choice(alphabet) for _ in range(6))
        book["inviteCode"] = code
    return book


def credit_points(store: dict, email: str, kind: str, amount: int, reason: str) -> None:
    day = shanghai_day()
    book = points_book(store, email)
    book["balance"] = int(book.get("balance") or 0) + amount
    book["ledger"].insert(0, {"id": kind, "reason": reason, "amount": amount, "day": day, "at": utcnow()})
    book["ledger"] = book["ledger"][:80]


def apply_invite(store: dict, email: str, code: str, nick: str) -> None:
    wanted = str(code or "").strip().upper()
    if not wanted:
        return
    inviter = ""
    for owner, profile in store.get("profiles", {}).items():
        if str(profile.get("inviteCode") or "").upper() == wanted:
            inviter = owner
            break
    if not inviter or inviter == email:
        return
    account = store["accounts"][email]
    if account.get("invitedBy"):
        return
    account["invitedBy"] = inviter
    profile = profile_book(store, inviter)
    profile["invites"].insert(0, {"name": nick or email.split("@")[0], "at": utcnow()})
    profile["invites"] = profile["invites"][:100]
    credit_points(store, inviter, "invite", 20, "邀请好友")


def public_points(store: dict, email: str) -> dict:
    day = shanghai_day()
    book = store.get("points", {}).get(email) or {}
    done_days = book.get("done") or {}
    checked = any(row.get("day") == day for row in store.get("checkins", {}).get(email, []))
    done = {
        "checkin": checked or done_days.get("checkin") == day,
        "like": done_days.get("like") == day,
        "review": done_days.get("review") == day,
        "detect": done_days.get("detect") == day,
        "first-detect": bool(done_days.get("first-detect")),
        "favorite": bool(done_days.get("favorite")),
        "profile": bool(done_days.get("profile")),
    }
    today = {}
    for row in book.get("ledger") or []:
        if row.get("day") == day and row.get("id") in ("checkin", "like", "review", "detect"):
            today[row["id"]] = int(row.get("amount") or 0)
    for row in store.get("checkins", {}).get(email, []):
        if row.get("day") == day:
            today["checkin"] = int(row.get("amount") or 0)
    ledger = []
    for row in book.get("ledger") or []:
        ledger.append({
            "id": row.get("id") or "",
            "reason": row.get("reason") or "",
            "amount": int(row.get("amount") or 0),
            "day": row.get("day") or "",
            "at": row.get("at") or "",
        })
    return {"day": day, "balance": int(book.get("balance") or 0), "done": done, "today": today, "ledger": ledger}


def public_account(store: dict, email: str) -> dict:
    profile = profile_book(store, email)
    user = store["accounts"][email]
    people = [{"name": row.get("name") or "好友", "at": row.get("at") or ""} for row in profile.get("invites") or []]
    return {
        **public_user(user),
        "avatar": profile.get("avatar") or "",
        "favorites": list(profile.get("favorites") or []),
        "submissions": list(profile.get("submissions") or []),
        "points": public_points(store, email),
        "invite": {"code": profile.get("inviteCode") or "", "count": len(people), "points": len(people) * 20, "people": people[:20]},
    }


TASK_POINTS = {
    "like": (2, "投票", "day"),
    "review": (8, "发表点评", "day"),
    "detect": (3, "每日检测", "day"),
    "first-detect": (5, "完成首次检测", "once"),
    "favorite": (3, "首次收藏", "once"),
    "profile": (5, "完善资料", "once"),
}


def empty_store() -> dict:
    return {"updatedAt": "", "accounts": {}, "sessions": {}, "votes": {"stations": {}, "ballots": {}}, "comments": []}


def seed_votes(data: dict) -> None:
    stations = data["votes"]["stations"]
    if stations or not SEED.exists():
        return
    raw = json.loads(SEED.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return
    for sid, pair in raw.items():
        if not isinstance(pair, list) or len(pair) < 2:
            continue
        try:
            up, down = int(pair[0] or 0), int(pair[1] or 0)
            key = str(int(sid))
        except (TypeError, ValueError):
            continue
        if up or down:
            stations[key] = {"up": up, "down": down}


class FileLock:
    def __init__(self, path: Path) -> None:
        self.path = str(path) + ".lock"
        self.fp = None

    def __enter__(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.fp = open(self.path, "a+b")
        if self.fp.tell() == 0:
            self.fp.write(b"0")
            self.fp.flush()
        self.fp.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(self.fp.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(self.fp.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc) -> None:
        try:
            self.fp.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.fp.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fp.fileno(), fcntl.LOCK_UN)
        finally:
            self.fp.close()


def load_store() -> dict:
    DATA.parent.mkdir(parents=True, exist_ok=True)
    if not DATA.exists():
        data = empty_store()
        seed_votes(data)
        save_store(data)
        return data
    try:
        data = json.loads(DATA.read_text(encoding="utf-8"))
    except Exception:
        data = empty_store()
    data.setdefault("accounts", {})
    data.setdefault("sessions", {})
    votes = data.setdefault("votes", {})
    votes.setdefault("stations", {})
    votes.setdefault("ballots", {})
    data.setdefault("comments", [])
    data.setdefault("checkins", {})
    data.setdefault("points", {})
    data.setdefault("profiles", {})
    data.setdefault("resets", {})
    data.setdefault("codes", {})
    return data


def save_store(data: dict) -> None:
    DATA.parent.mkdir(parents=True, exist_ok=True)
    data["updatedAt"] = utcnow()
    tmp = DATA.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, DATA)


def hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return digest.hex()


def public_user(account: dict) -> dict:
    return {"email": account["email"], "name": account.get("nick") or account["email"].split("@")[0], "nick": account.get("nick") or ""}


def user_from_header(data: dict, header: str) -> dict | None:
    token = ""
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    email = (data.get("sessions") or {}).get(token)
    if not email:
        return None
    return (data.get("accounts") or {}).get(email)


def vote_key(raw) -> str:
    text = str(raw or "").strip()
    if text.isdigit():
        return str(int(text))
    cleaned = "".join(ch for ch in text if ch.isalnum() or ch in "-_")[:80]
    if not cleaned:
        raise ValueError("缺少站点")
    return cleaned


def public_votes(data: dict, email: str = "") -> dict:
    stations = {}
    for sid, row in (data["votes"].get("stations") or {}).items():
        stations[str(sid)] = {"up": int(row.get("up") or 0), "down": int(row.get("down") or 0)}
    mine = {}
    if email:
        raw = (data["votes"].get("ballots") or {}).get(email) or {}
        for sid, direction in raw.items():
            if direction in ("up", "down"):
                mine[str(sid)] = direction
    return {"updatedAt": data.get("updatedAt") or "", "stations": stations, "mine": mine}


def apply_vote(data: dict, station_id, direction: str, email: str) -> dict:
    if direction not in ("up", "down"):
        raise ValueError("dir 必须是 up 或 down")
    sid = vote_key(station_id)
    votes = data["votes"]
    stations = votes["stations"]
    ballots = votes["ballots"]
    mine = ballots.setdefault(email, {})
    prev = mine.get(sid)
    counts = stations.setdefault(sid, {"up": 0, "down": 0})
    counts["up"] = int(counts.get("up") or 0)
    counts["down"] = int(counts.get("down") or 0)
    now = ""
    if prev == direction:
        counts[prev] = max(0, counts[prev] - 1)
        mine.pop(sid, None)
    else:
        if prev in ("up", "down"):
            counts[prev] = max(0, counts[prev] - 1)
        counts[direction] += 1
        mine[sid] = direction
        now = direction
    if not mine:
        ballots.pop(email, None)
    return {"id": sid, "up": counts["up"], "down": counts["down"], "mine": now}


def station_redirect(url_path: str) -> str:
    if not url_path.startswith("/station/"):
        return ""
    slug = unquote(url_path.split("?", 1)[0][len("/station/"):]).strip("/")
    if not slug or "/" in slug:
        return ""
    mapping = {}
    if REDIRECTS.exists():
        try:
            mapping = json.loads(REDIRECTS.read_text(encoding="utf-8"))
        except Exception:
            mapping = {}
    return mapping.get(slug) or f"/site/{slug}"


def site_file(url_path: str) -> Path | None:
    if url_path.startswith("/api"):
        return None
    rel = unquote(url_path.split("?", 1)[0]).lstrip("/") or "index.html"
    if ".." in Path(rel).parts:
        return None
    root = DIST.resolve()
    candidates = [(DIST / rel).resolve(), (DIST / rel / "index.html").resolve()]
    for candidate in candidates:
        if candidate.is_file() and (candidate == root or str(candidate).startswith(str(root) + os.sep)):
            return candidate
    return None


def public_comment(row: dict) -> dict:
    return {
        "id": row["id"],
        "slug": row["slug"],
        "user": row["user"],
        "rating": row["rating"],
        "body": row["body"],
        "pros": row.get("pros") or [],
        "cons": row.get("cons") or [],
        "date": row["date"],
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args) -> None:
        return

    def _send(self, code: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, file: Path) -> None:
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", FILE_TYPES.get(file.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location: str) -> None:
        self.send_response(301)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(max(0, min(length, 200000))) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("请求格式不对")
        return data

    def _user(self, store: dict) -> dict | None:
        return user_from_header(store, self.headers.get("Authorization") or "")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)
        try:
            with FileLock(DATA):
                store = load_store()
            if path == "/api/votes":
                user = self._user(store)
                self._send(200, public_votes(store, user["email"] if user else ""))
                return
            if path == "/api/comments":
                slug = (query.get("slug") or [""])[0]
                rows = [public_comment(row) for row in store["comments"] if not slug or row.get("slug") == slug]
                self._send(200, {"comments": rows})
                return
            if path == "/api/account":
                with FileLock(DATA):
                    store = load_store()
                    user = self._user(store)
                    if not user:
                        self._send(401, {"error": "请先登录"})
                        return
                    profile_book(store, user["email"])
                    save_store(store)
                    payload = public_account(store, user["email"])
                self._send(200, payload)
                return
            if path == "/api/points":
                user = self._user(store)
                if not user:
                    self._send(401, {"error": "请先登录"})
                    return
                self._send(200, public_points(store, user["email"]))
                return
            if path == "/api/auth/me":
                user = self._user(store)
                if not user:
                    self._send(401, {"error": "请先登录"})
                    return
                self._send(200, {**public_user(user), "token": ""})
                return
            target = station_redirect(parsed.path)
            if target:
                self._redirect(target)
                return
            page = site_file(parsed.path)
            if page is not None:
                self._send_file(page)
                return
            self._send(404, {"error": "没有这个接口"})
        except Exception as err:
            self._send(400, {"error": str(err)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        try:
            body = self._read_json()
            with FileLock(DATA):
                store = load_store()
                if path == "/api/auth/register":
                    email = str(body.get("email") or "").strip().lower()
                    password = str(body.get("password") or "")
                    nick = str(body.get("nick") or "").strip()[:40]
                    if "@" not in email:
                        raise ValueError("请输入有效邮箱")
                    if len(password) < 6:
                        raise ValueError("密码至少 6 位")
                    if email in store["accounts"]:
                        raise ValueError("该邮箱已注册")
                    check_code(store, email, "register", body.get("code"))
                    salt = secrets.token_hex(16)
                    store["accounts"][email] = {"email": email, "nick": nick, "salt": salt, "password": hash_password(password, salt)}
                    token = secrets.token_urlsafe(24)
                    store["sessions"][token] = email
                    profile_book(store, email)
                    apply_invite(store, email, body.get("invite"), nick)
                    save_store(store)
                    self._send(200, {**public_user(store["accounts"][email]), "token": token})
                    return
                if path == "/api/auth/login":
                    email = str(body.get("email") or "").strip().lower()
                    password = str(body.get("password") or "")
                    account = store["accounts"].get(email)
                    if not account or hash_password(password, account["salt"]) != account["password"]:
                        raise ValueError("邮箱或密码不正确")
                    token = secrets.token_urlsafe(24)
                    store["sessions"][token] = email
                    save_store(store)
                    self._send(200, {**public_user(account), "token": token})
                    return
                if path == "/api/auth/code":
                    email = str(body.get("email") or "").strip().lower()
                    purpose = str(body.get("purpose") or "")
                    if "@" not in email:
                        raise ValueError("请输入有效邮箱")
                    if purpose not in ("register", "reset"):
                        raise ValueError("没有这种验证码")
                    if purpose == "register" and email in store["accounts"]:
                        raise ValueError("该邮箱已注册")
                    if purpose == "reset" and email not in store["accounts"]:
                        raise ValueError("没有找到这个邮箱")
                    code = issue_code(store, email, purpose)
                    save_store(store)
                    title = "维渡 AI 注册验证码" if purpose == "register" else "维渡 AI 重置密码验证码"
                    send_mail(email, title, f"验证码是 {code}。10 分钟内有效。如果不是你本人操作，忽略这封邮件。")
                    self._send(200, {"ok": True})
                    return
                if path == "/api/auth/reset":
                    email = str(body.get("email") or "").strip().lower()
                    password = str(body.get("password") or "")
                    if len(password) < 6:
                        raise ValueError("密码至少 6 位")
                    account = store["accounts"].get(email)
                    if not account:
                        raise ValueError("没有找到这个邮箱")
                    check_code(store, email, "reset", body.get("code"))
                    account["salt"] = secrets.token_hex(16)
                    account["password"] = hash_password(password, account["salt"])
                    save_store(store)
                    self._send(200, {"ok": True})
                    return
                user = self._user(store)
                if not user:
                    self._send(401, {"error": "请先登录"})
                    return
                if path == "/api/auth/profile":
                    nick = str(body.get("nick") or "").strip()[:40]
                    if not nick:
                        raise ValueError("昵称不能为空")
                    user["nick"] = nick
                    save_store(store)
                    self._send(200, public_user(user))
                    return
                if path == "/api/auth/password":
                    current = str(body.get("current") or "")
                    password = str(body.get("password") or "")
                    if hash_password(current, user["salt"]) != user["password"]:
                        raise ValueError("当前密码不正确")
                    if len(password) < 6:
                        raise ValueError("新密码至少 6 位")
                    user["salt"] = secrets.token_hex(16)
                    user["password"] = hash_password(password, user["salt"])
                    save_store(store)
                    self._send(200, {"ok": True})
                    return
                if path == "/api/account/avatar":
                    avatar = str(body.get("avatar") or "")
                    if avatar and (not avatar.startswith("data:image/") or len(avatar) > 180000):
                        raise ValueError("头像图片太大")
                    profile_book(store, user["email"])["avatar"] = avatar
                    if avatar:
                        award_points(store, user["email"], "profile", 5, "完善资料", "once")
                    save_store(store)
                    self._send(200, public_account(store, user["email"]))
                    return
                if path == "/api/account/favorite":
                    slug = str(body.get("slug") or "").strip()[:120]
                    if not slug:
                        raise ValueError("没有这个站点")
                    profile = profile_book(store, user["email"])
                    favs = [item for item in profile["favorites"] if item != slug]
                    if body.get("on"):
                        favs.append(slug)
                        award_points(store, user["email"], "favorite", 3, "首次收藏", "once")
                    profile["favorites"] = favs[-500:]
                    save_store(store)
                    self._send(200, public_account(store, user["email"]))
                    return
                if path == "/api/account/submission":
                    name = str(body.get("name") or "").strip()[:80]
                    url = str(body.get("url") or "").strip()[:300]
                    if not name or not url:
                        raise ValueError("请填写站点名称和网址")
                    profile = profile_book(store, user["email"])
                    profile["submissions"].insert(0, {
                        "id": "s-" + secrets.token_hex(6),
                        "name": name,
                        "url": url,
                        "note": str(body.get("note") or "").strip()[:300],
                        "at": utcnow(),
                    })
                    profile["submissions"] = profile["submissions"][:50]
                    save_store(store)
                    letter = str(body.get("letter") or "").strip()
                    if letter:
                        send_mail(
                            os.environ.get("SMTP_USER", ""),
                            "维渡 AI 申请收录：" + name,
                            "申请人：" + user["email"] + "\n\n" + letter[:4000],
                        )
                    self._send(200, public_account(store, user["email"]))
                    return
                if path == "/api/account/migrate":
                    book = points_book(store, user["email"])
                    profile = profile_book(store, user["email"])
                    empty = not book["ledger"] and not book["balance"] and not profile["avatar"] and not profile["favorites"] and not profile["submissions"]
                    if empty:
                        limits = {"checkin": 5, "like": 2, "review": 8, "detect": 3, "first-detect": 5, "favorite": 3, "profile": 5}
                        ledger = []
                        for row in (body.get("ledger") or [])[:80]:
                            kind = str(row.get("id") or "")
                            if kind not in limits:
                                continue
                            amount = min(limits[kind], max(0, int(row.get("amount") or 0)))
                            if not amount:
                                continue
                            ledger.append({
                                "id": kind,
                                "reason": str(row.get("reason") or kind)[:40],
                                "amount": amount,
                                "day": str(row.get("day") or "")[:10],
                                "at": str(row.get("at") or utcnow())[:40],
                            })
                            if kind in ("first-detect", "favorite", "profile"):
                                book["done"][kind] = "once"
                            elif row.get("day"):
                                book["done"][kind] = str(row.get("day"))[:10]
                        book["ledger"] = ledger
                        book["balance"] = sum(item["amount"] for item in ledger)
                        avatar = str(body.get("avatar") or "")
                        if avatar.startswith("data:image/") and len(avatar) <= 180000:
                            profile["avatar"] = avatar
                        profile["favorites"] = [str(item).strip()[:120] for item in (body.get("favorites") or []) if str(item).strip()][:500]
                        submissions = []
                        for row in (body.get("submissions") or [])[:50]:
                            name = str(row.get("name") or "").strip()[:80]
                            url = str(row.get("url") or "").strip()[:300]
                            if not name or not url:
                                continue
                            submissions.append({
                                "id": str(row.get("id") or ("s-" + secrets.token_hex(6)))[:40],
                                "name": name,
                                "url": url,
                                "note": str(row.get("note") or "")[:300],
                                "at": str(row.get("at") or utcnow())[:40],
                            })
                        profile["submissions"] = submissions
                        save_store(store)
                    self._send(200, public_account(store, user["email"]))
                    return
                if path == "/api/points":
                    kind = str(body.get("id") or "")
                    spec = TASK_POINTS.get(kind)
                    if not spec:
                        raise ValueError("没有这项积分")
                    amount, reason, scope = spec
                    award_points(store, user["email"], kind, amount, reason, scope)
                    save_store(store)
                    self._send(200, public_points(store, user["email"]))
                    return
                if path == "/api/checkin":
                    day = shanghai_day()
                    book = store.setdefault("checkins", {}).setdefault(user["email"], [])
                    found = next((row for row in book if row.get("day") == day), None)
                    if found:
                        self._send(200, {"added": False, "day": day, "amount": int(found.get("amount") or 0)})
                        return
                    amount = secrets.randbelow(3) + 3
                    book.append({"day": day, "amount": amount, "at": utcnow()})
                    points = award_points(store, user["email"], "checkin", amount, "每日签到")
                    save_store(store)
                    self._send(200, {"added": True, "day": day, "amount": amount, "balance": points["balance"]})
                    return
                if path == "/api/votes":
                    result = apply_vote(store, body.get("id"), str(body.get("dir") or ""), user["email"])
                    awarded = {"added": False, "amount": 0}
                    if result.get("mine") in ("up", "down"):
                        awarded = award_points(store, user["email"], "like", 2, "投票")
                    result["points"] = {**public_points(store, user["email"]), "added": awarded["added"], "amount": awarded["amount"]}
                    save_store(store)
                    self._send(200, result)
                    return
                if path == "/api/comments":
                    slug = str(body.get("slug") or "").strip()
                    if not slug:
                        raise ValueError("先选择一个站点")
                    rating = int(body.get("rating") or 0)
                    if rating < 1 or rating > 5:
                        raise ValueError("请先打分")
                    pros = [str(item).strip()[:40] for item in (body.get("pros") or []) if str(item).strip()][:12]
                    cons = [str(item).strip()[:40] for item in (body.get("cons") or []) if str(item).strip()][:12]
                    row = {
                        "id": "c-" + secrets.token_hex(8),
                        "slug": slug[:120],
                        "user": public_user(user)["name"],
                        "email": user["email"],
                        "rating": rating,
                        "body": str(body.get("body") or "").strip()[:2000],
                        "pros": pros,
                        "cons": cons,
                        "date": utcnow()[:10],
                    }
                    store["comments"].append(row)
                    awarded = award_points(store, user["email"], "review", 8, "发表点评")
                    save_store(store)
                    self._send(200, {**public_comment(row), "points": {**public_points(store, user["email"]), "added": awarded["added"], "amount": awarded["amount"]}})
                    return
            self._send(404, {"error": "没有这个接口"})
        except Exception as err:
            self._send(400, {"error": str(err)})


def main() -> None:
    with FileLock(DATA):
        load_store()
    print(f"listening http://{HOST}:{PORT}", flush=True)
    if DIST.exists():
        print(f"pages {DIST}", flush=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
