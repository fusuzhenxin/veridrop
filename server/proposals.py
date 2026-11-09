"""Public collection/test proposals. Votes and moderation share one SQLite store."""
from contextlib import contextmanager
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import re
import secrets
import sqlite3
from urllib.parse import urlsplit, urlunsplit

DB = Path(__file__).resolve().parent.parent / "data" / "proposals.sqlite"
TESTS = {"basic": "基础测试", "candy": "糖果测试", "pelican": "鹈鹕骑车"}
STATUSES = {"open": "征集中", "planned": "已排期", "testing": "测试中", "done": "已完成", "closed": "暂不处理"}


@contextmanager
def connection():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY, host TEXT NOT NULL UNIQUE, name TEXT NOT NULL, url TEXT NOT NULL,
        reason TEXT NOT NULL, tests TEXT NOT NULL, owner TEXT NOT NULL, author TEXT NOT NULL,
        created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '',
        result_url TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS proposal_votes (
        proposal TEXT NOT NULL REFERENCES proposals(id), voter TEXT NOT NULL,
        PRIMARY KEY(proposal,voter));
      CREATE TABLE IF NOT EXISTS proposal_comments (
        id TEXT PRIMARY KEY, proposal TEXT NOT NULL REFERENCES proposals(id), owner TEXT NOT NULL,
        author TEXT NOT NULL, content TEXT NOT NULL, created TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS proposal_comments_thread ON proposal_comments(proposal,hidden,created);
      CREATE INDEX IF NOT EXISTS proposal_comments_author ON proposal_comments(owner,created);
      CREATE INDEX IF NOT EXISTS proposal_submissions_author ON proposals(owner,created);
    """)
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def text(value, limit, required=False):
    value = str(value or "").strip()
    if len(value) > limit:
        raise ValueError(f"内容不能超过 {limit} 字")
    if required and not value:
        raise ValueError("请填写完整内容")
    if re.search(r"sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S{8,}", value, re.I):
        raise ValueError("请移除 API Key 或令牌，只提交公开信息")
    return value


def site_url(value):
    value = text(value, 500, True)
    if "://" not in value:
        value = "https://" + value
    try:
        u = urlsplit(value)
        host = (u.hostname or "").encode("idna").decode().lower().removeprefix("www.")
        if u.scheme not in ("http", "https") or not host or u.username or u.password or u.query or u.fragment:
            raise ValueError()
        if "." not in host or host.endswith((".local", ".internal", ".localhost")) or u.port not in (None, 80, 443):
            raise ValueError()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError()
        if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host):
            raise ValueError()
        return host, urlunsplit((u.scheme, u.hostname.encode("idna").decode().lower(), u.path or "", "", ""))
    except (ValueError, UnicodeError):
        raise ValueError("请填写站点公开域名，不要附带密钥、参数或登录信息") from None


def public_row(db, row, who="", admin=False):
    item = {k: row[k] for k in ("id", "host", "name", "url", "reason", "author", "created", "status", "note", "result_url")}
    item["tests"] = json.loads(row["tests"])
    item["votes"] = db.execute("SELECT count(*) FROM proposal_votes WHERE proposal=?", (row["id"],)).fetchone()[0]
    item["mine"] = bool(who and db.execute("SELECT 1 FROM proposal_votes WHERE proposal=? AND voter=?", (row["id"], who)).fetchone())
    item["commentCount"] = db.execute("SELECT count(*) FROM proposal_comments WHERE proposal=? AND hidden=0", (row["id"],)).fetchone()[0]
    if admin:
        item["hidden"] = bool(row["hidden"])
    return item


def require_row(db, pid, admin=False):
    row = db.execute("SELECT * FROM proposals WHERE id=?" + ("" if admin else " AND hidden=0"), (pid,)).fetchone()
    if not row:
        raise ValueError("这条提案不存在或已下架")
    return row


def listing(query, who="", admin=False):
    q = text(query.get("q"), 100).lower()
    status = str(query.get("status") or "")
    try:
        page = max(1, int(query.get("page") or 1))
    except (ValueError, TypeError):
        page = 1
    with connection() as db:
        rows = db.execute("SELECT * FROM proposals" + ("" if admin else " WHERE hidden=0")).fetchall()
        items = [public_row(db, row, who, admin) for row in rows if (not status or row["status"] == status) and (not q or q in (row["name"] + row["host"] + row["reason"]).lower())]
        items.sort(key=(lambda x: x["created"]) if query.get("sort") == "new" else (lambda x: (x["votes"], x["created"])), reverse=True)
        total = len(items)
        page = min(page, max(1, (total + 9) // 10))
        return {"items": items[(page - 1) * 10:page * 10], "total": total, "page": page, "pages": max(1, (total + 9) // 10),
                "stats": {"total": len(rows), "supporters": db.execute("SELECT count(DISTINCT v.voter) FROM proposal_votes v JOIN proposals p ON v.proposal=p.id WHERE p.hidden=0").fetchone()[0],
                          "done": sum(row["status"] == "done" and not row["hidden"] for row in rows)}}


def detail(pid, who="", admin=False):
    with connection() as db:
        result = public_row(db, require_row(db, pid, admin), who, admin)
        result["comments"] = [{k: row[k] for k in ("id", "author", "content", "created", "hidden")}
                              for row in db.execute("SELECT * FROM proposal_comments WHERE proposal=?" + ("" if admin else " AND hidden=0") + " ORDER BY created DESC LIMIT 100", (pid,))]
        return result


def create(body, user):
    host, url = site_url(body.get("url"))
    name, reason = text(body.get("name"), 60, True), text(body.get("reason"), 1000, True)
    tests = body.get("tests")
    if not isinstance(tests, list) or not tests or any(not isinstance(t, str) or t not in TESTS for t in tests):
        raise ValueError("至少选择一项希望进行的测试")
    tests = list(dict.fromkeys(tests))
    with connection() as db:
        existing = db.execute("SELECT * FROM proposals WHERE host=?", (host,)).fetchone()
        if existing:
            if existing["hidden"]:
                raise ValueError("该站点已有提案，请联系运营核实处理情况")
            return {"item": public_row(db, existing, user["email"]), "duplicate": True}
        recent = db.execute("SELECT count(*) FROM proposals WHERE owner=? AND substr(created,1,10)=?", (user["email"], now()[:10])).fetchone()[0]
        if recent >= 5:
            raise ValueError("今天已提交 5 条提案，明天再来吧")
        pid = secrets.token_hex(8)
        author = text(user.get("nick") or user.get("name") or "社区用户", 40, True)
        db.execute("INSERT INTO proposals(id,host,name,url,reason,tests,owner,author,created) VALUES(?,?,?,?,?,?,?,?,?)", (pid, host, name, url, reason, json.dumps(tests), user["email"], author, now()))
        return {"item": public_row(db, require_row(db, pid), user["email"]), "duplicate": False}


def support(pid, user, on):
    if not isinstance(on, bool):
        raise ValueError("投票参数不正确")
    with connection() as db:
        row = require_row(db, pid)
        if on and row["status"] in ("done", "closed"):
            raise ValueError("这条提案已结束支持，可以查看进展或参与评论")
        if on:
            db.execute("INSERT OR IGNORE INTO proposal_votes(proposal,voter) VALUES(?,?)", (pid, user["email"]))
        else:
            db.execute("DELETE FROM proposal_votes WHERE proposal=? AND voter=?", (pid, user["email"]))
        return public_row(db, require_row(db, pid), user["email"])


def comment(pid, user, content):
    content = text(content, 1000, True)
    with connection() as db:
        require_row(db, pid)
        latest = db.execute("SELECT created FROM proposal_comments WHERE owner=? ORDER BY created DESC LIMIT 1", (user["email"],)).fetchone()
        if latest and (datetime.now(timezone.utc) - datetime.fromisoformat(latest[0])).total_seconds() < 15:
            raise ValueError("评论太快了，请稍等 15 秒")
        author = text(user.get("nick") or user.get("name") or "社区用户", 40, True)
        db.execute("INSERT INTO proposal_comments(id,proposal,owner,author,content,created) VALUES(?,?,?,?,?,?)", (secrets.token_hex(8), pid, user["email"], author, content, now()))
    return detail(pid, user["email"])


def moderate(pid, body):
    with connection() as db:
        row = require_row(db, pid, True)
        if body.get("commentId"):
            db.execute("UPDATE proposal_comments SET hidden=? WHERE id=? AND proposal=?", (int(body.get("hidden") is True), str(body["commentId"]), pid))
        else:
            status = str(body.get("status") or row["status"])
            if status not in STATUSES:
                raise ValueError("处理状态不正确")
            note = text(body.get("note"), 1000)
            url = text(body.get("result_url"), 300)
            if url and (not re.fullmatch(r"/(?:site/[^\s<>\\]+|b/[^\s<>\\]+|check(?:/[^\s<>\\]*)?(?:\?[^\s<>\\]*)?)", url) or "//" in url or any(ord(c) < 32 for c in url)):
                raise ValueError("结果链接请填写本站的 /site/、/b/ 或 /check/ 地址")
            db.execute("UPDATE proposals SET status=?,note=?,result_url=?,hidden=? WHERE id=?", (status, note, url, int(body.get("hidden") is True), pid))
    return detail(pid, admin=True)
