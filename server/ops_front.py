"""Admin views for accounts, redemptions, visitors, notices, and prizes."""

from __future__ import annotations

import base64
import json
import re
import secrets
from datetime import datetime, timezone

import community
import visits

NOTICE_FILE = community.ROOT / "data" / "notice.json"


def _default_notice() -> dict:
    return {
        "id": "shop-deepseek-3000",
        "enabled": True,
        "icon": "/icons/vendor/deepseek.svg",
        "title": "积分兑换上新",
        "date": "2026-11-02",
        "body": "DeepSeek 3000 积分共享额度已上架。登录后用 20 积分兑换，用完截止，每人一份。",
        "actionTo": "/points#redeem",
        "actionLabel": "去兑换",
    }


def read_notice() -> dict:
    notice = _default_notice()
    if NOTICE_FILE.exists():
        try:
            raw = json.loads(NOTICE_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = None
        if isinstance(raw, dict):
            notice.update({key: raw.get(key) if raw.get(key) is not None else notice.get(key) for key in notice})
            notice["enabled"] = bool(raw.get("enabled", True))
    return notice


def public_notice() -> dict:
    notice = read_notice()
    if not notice.get("enabled"):
        return {"enabled": False}
    action = None
    if notice.get("actionTo") and notice.get("actionLabel"):
        action = {"to": str(notice["actionTo"]), "label": str(notice["actionLabel"])}
    return {
        "enabled": True,
        "id": str(notice.get("id") or "notice"),
        "title": str(notice.get("title") or ""),
        "date": str(notice.get("date") or ""),
        "body": str(notice.get("body") or ""),
        "icon": str(notice.get("icon") or _default_notice()["icon"]),
        "action": action,
    }


def save_notice(body: dict) -> dict:
    title = str(body.get("title") or "").strip()
    text = str(body.get("body") or "").strip()
    if not title or not text:
        raise ValueError("标题和正文都要填")
    current = read_notice()
    icon = str(body.get("icon", current.get("icon")) or _default_notice()["icon"]).strip()
    if icon != _default_notice()["icon"] and not re.fullmatch(r"/media/notices/[a-f0-9]{16}\.(?:png|jpg|webp|gif)", icon):
        raise ValueError("请使用上传的公告图标")
    notice = {
        "id": str(current.get("id") or "notice"),
        "enabled": bool(body.get("enabled", True)),
        "icon": icon,
        "title": title[:80],
        "date": str(body.get("date") or community.shanghai_day())[:10],
        "body": text[:500],
        "actionTo": str(body.get("actionTo") or "").strip()[:120],
        "actionLabel": str(body.get("actionLabel") or "").strip()[:20],
    }
    if any(notice[key] != current.get(key) for key in ("title", "body", "date", "icon", "actionTo", "actionLabel")):
        notice["id"] = f"notice-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    NOTICE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = NOTICE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(notice, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(NOTICE_FILE)
    return notice


def members() -> dict:
    store = community.load_store()
    rows = []
    for email, account in (store.get("accounts") or {}).items():
        if not isinstance(account, dict):
            continue
        points = (store.get("points") or {}).get(email) or {}
        rows.append({
            "email": email,
            "nick": account.get("nick") or "",
            "created": account.get("created") or "",
            "points": int(points.get("balance") or 0),
        })
    rows.sort(key=lambda row: row["created"], reverse=True)
    return {"count": len(rows), "rows": rows}


def _sold(store: dict, item_id: str) -> int:
    orders = ((store.get("shop") or {}).get("orders") or {})
    count = 0
    for book in orders.values():
        if isinstance(book, dict) and item_id in book:
            count += 1
    return count


def redemptions() -> dict:
    store = community.load_store()
    catalog = {str(item.get("id")): item for item in community.shop_items()}
    rows = []
    people = set()
    for email, book in (((store.get("shop") or {}).get("orders") or {}).items()):
        if not isinstance(book, dict) or not book:
            continue
        people.add(email)
        for item_id, owned in book.items():
            if not isinstance(owned, dict):
                continue
            item = catalog.get(str(item_id)) or {}
            rows.append({
                "email": email,
                "itemId": str(item_id),
                "title": item.get("title") or str(item_id),
                "at": owned.get("at") or "",
                "url": owned.get("url") or item.get("url") or "",
                "key": owned.get("key") or "",
            })
    rows.sort(key=lambda row: row["at"], reverse=True)
    return {"people": len(people), "count": len(rows), "rows": rows}


def prizes() -> dict:
    store = community.load_store()
    rows = []
    for item in community.shop_items():
        item_id = str(item.get("id") or "")
        rows.append({**item, "id": item_id, **community.shop_inventory(store, item)})
    return {"rows": rows}


def save_prizes(body: dict) -> dict:
    # Use the redemption lock so a catalog update cannot race code allocation.
    with community.FileLock(community.DATA):
        return _save_prizes(body)


def _save_prizes(body: dict) -> dict:
    raw = body.get("items")
    if not isinstance(raw, list):
        raise ValueError("奖品列表不对")
    items = []
    seen = set()
    seen_codes = set()
    for row in raw:
        if not isinstance(row, dict):
            continue
        item_id = re.sub(r"[^a-z0-9-]", "", str(row.get("id") or "").strip().lower())
        title = str(row.get("title") or "").strip()
        if not item_id or not title:
            raise ValueError("每件奖品都要有编号和名称")
        if item_id in seen:
            raise ValueError("奖品编号重复")
        seen.add(item_id)
        stock = row.get("stock")
        stock_value = None
        if stock not in (None, ""):
            stock_value = int(stock)
            if stock_value < 0:
                raise ValueError("份数不能是负数")
        mode = str(row.get("codeMode") or "shared")
        if mode not in ("shared", "unique"):
            raise ValueError("请选择兑换码发放方式")
        raw_codes = row.get("codes") or []
        if isinstance(raw_codes, str):
            raw_codes = raw_codes.splitlines()
        if not isinstance(raw_codes, list) or any(not isinstance(code, str) for code in raw_codes):
            raise ValueError("兑换码请每行填写一个")
        codes = [code.strip() for code in raw_codes if code.strip()]
        if len(codes) > 10000 or any(len(code) > 2000 for code in codes):
            raise ValueError("每件奖品最多填写 10000 个兑换码，每个不超过 2000 字")
        if len(codes) != len(set(codes)):
            raise ValueError("同一奖品的兑换码不能重复")
        if mode == "unique":
            if seen_codes.intersection(codes):
                raise ValueError("不同奖品不能使用相同的独立兑换码")
            seen_codes.update(codes)
        items.append({
            "id": item_id,
            "title": title[:80],
            "desc": str(row.get("desc") or "")[:200],
            "brand": str(row.get("brand") or "")[:40],
            "badge": str(row.get("badge") or "")[:20],
            "cost": max(0, int(row.get("cost") or 0)),
            "perPerson": 1 if mode == "unique" else max(1, int(row.get("perPerson") or 1)),
            "stock": stock_value,
            "status": "closed" if str(row.get("status") or "open") == "closed" else "open",
            "ends": str(row.get("ends") or "")[:40],
            "icon": str(row.get("icon") or "")[:300],
            "cover": str(row.get("cover") or "")[:300],
            "url": str(row.get("url") or "")[:300],
            "key": str(row.get("key") or "")[:200],
            "codeMode": mode,
            "codes": codes,
        })
    community.SHOP_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = community.SHOP_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(community.SHOP_FILE)
    return prizes()


def _image_ext(blob: bytes) -> str:
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if blob.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if len(blob) >= 12 and blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
        return ".webp"
    if blob.startswith(b"GIF87a") or blob.startswith(b"GIF89a"):
        return ".gif"
    raise ValueError("只支持 png、jpg、webp、gif")


def save_prize_image(body: dict) -> dict:
    return _save_image(body, "prizes")


def save_notice_image(body: dict) -> dict:
    return _save_image(body, "notices")


def _save_image(body: dict, category: str) -> dict:
    raw = str(body.get("data") or "")
    if "," in raw[:80]:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except Exception as err:
        raise ValueError("图片没有读出来") from err
    if not blob or len(blob) > 2_000_000:
        raise ValueError("图片请小于 2MB")
    ext = _image_ext(blob)
    name = f"{secrets.token_hex(8)}{ext}"
    folders = [community.ROOT / "public" / "media" / category]
    dist_media = community.ROOT / "dist" / "media" / category
    if (community.ROOT / "dist").exists():
        folders.append(dist_media)
    for folder in folders:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(blob)
    return {"url": f"/media/{category}/{name}"}


def visitors() -> dict:
    return visits.admin_report("veridrop")
