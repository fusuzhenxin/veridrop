"""First-party aggregate ad attribution; no visitor IDs, raw IPs or raw UAs."""
import re
from datetime import date, timedelta
from urllib.parse import urlparse
from traffic_identity import classify


def ensure_schema(conn):
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS ad_metrics (
        ad_id INTEGER NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL,
        placement TEXT NOT NULL, surface TEXT NOT NULL, audience TEXT NOT NULL,
        reason TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(ad_id,day,path,placement,surface,audience,reason));
      CREATE INDEX IF NOT EXISTS idx_ad_metrics_day ON ad_metrics(day,ad_id);
      CREATE TABLE IF NOT EXISTS ad_event_ids (id TEXT PRIMARY KEY, day TEXT NOT NULL);
    """)
    if not conn.execute("SELECT 1 FROM settings WHERE key='ad_metrics_v1'").fetchone():
        conn.execute("""INSERT OR IGNORE INTO ad_metrics
          SELECT ad_id,day,'/','legacy','banner','legacy','historical-unclassified',impressions,clicks FROM ad_daily""")
        conn.execute("INSERT INTO settings(key,value) VALUES('ad_metrics_v1','1')")


def host(value):
    try:
        return (urlparse(str(value)).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def clean_path(value):
    text = str(value or "/").split("?")[0].split("#")[0][:200]
    return text if text.startswith("/") and not text.startswith("//") else "/"


PAGE_NAMES = {"home": "首页", "stations": "站点列表", "detail": "站点详情", "vote": "投票", "models": "模型", "search": "搜索", "other": "其他页面", "unknown": "历史 / 来源未知"}


def source_labels(path, placement):
    if placement in ("legacy", "unspecified"):
        return "unknown", "来源未记录", "未区分"
    if placement == "search":
        page = "search"
    elif path == "/":
        page = "home"
    elif path.startswith(("/list", "/cat/", "/favorites")):
        page = "stations"
    elif path.startswith(("/site/", "/station/")):
        page = "detail"
    elif path.startswith(("/reputation", "/vote")):
        page = "vote"
    elif path.startswith("/model"):
        page = "models"
    else:
        page = "other"
    region = {
        "sides": "赞助角标", "list": "顶部广告", "footer": "页脚广告",
        "directory-row": "站点榜单", "directory-site": "站点榜单", "directory-visit": "站点榜单",
        "directory-listed": "站点榜单", "home-rank": "站点榜单", "home-jump": "站点榜单",
        "list-rank": "站点榜单", "list-jump": "站点榜单", "list-card": "站点卡片",
        "home-rec": "推荐站点", "home-rec-visit": "推荐站点", "home-rec-row": "推荐站点",
        "home-review": "最新点评", "vote": "口碑榜", "vote-row": "口碑榜", "vote-review": "最新点评", "vote-review-row": "最新点评",
        "model-name": "模型供应站", "model-jump": "模型供应站", "site-go": "官网按钮",
        "site-link": "站点链接", "site-api": "API 接口", "search": "搜索结果",
    }.get(placement, "其他位置")
    action = "查看详情" if placement in ("directory-site", "directory-listed", "directory-row", "list-rank", "home-rank", "vote", "vote-review", "home-rec", "home-review", "model-name", "search") else "跳转官网" if placement in ("directory-visit", "list-jump", "home-jump", "home-rec-visit", "model-jump", "site-go", "site-link", "site-api", "sides", "list", "footer") else "未区分"
    return page, region, action


def record(conn, ad_id, action, day, agent="", context=None):
    context = context or {}
    if action not in ("impressions", "clicks"):
        raise ValueError("统计事件不正确")
    row = conn.execute("SELECT * FROM ads WHERE id=? AND paused=0 AND start_date<=? AND end_date>?", (ad_id, day, day)).fetchone()
    if not row:
        return None
    event_id = str(context.get("event_id") or "")
    if event_id and not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", event_id):
        raise ValueError("事件编号不正确")
    if event_id:
        # Namespace by ad/action: one directory exposure can match multiple campaigns.
        key = f"{ad_id}:{action}:{event_id}"
        if not conn.execute("INSERT OR IGNORE INTO ad_event_ids VALUES(?,?)", (key, day)).rowcount:
            return row["target_url"]
    audience, reason = classify(agent, context.get("automated"))
    surface = "directory" if context.get("surface") == "directory" else "banner"
    placement = re.sub(r"[^a-z0-9_-]", "", str(context.get("placement") or "unspecified").lower())[:60] or "unspecified"
    conn.execute(f"""INSERT INTO ad_metrics VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ad_id,day,path,placement,surface,audience,reason)
      DO UPDATE SET {action}={action}+1""",
      (ad_id, day, clean_path(context.get("path")), placement, surface, audience, reason,
       int(action == "impressions"), int(action == "clicks")))
    if surface == "banner":
        conn.execute(f"""INSERT INTO ad_daily VALUES(?,?,?,?) ON CONFLICT(ad_id,day)
          DO UPDATE SET {action}={action}+1""", (ad_id, day, int(action == "impressions"), int(action == "clicks")))
    conn.execute("DELETE FROM ad_event_ids WHERE day<?", ((date.fromisoformat(day)-timedelta(days=90)).isoformat(),))
    return row["target_url"]


def collect(conn, body, day, agent):
    action = {"impression": "impressions", "click": "clicks"}.get(body.get("action") or "impression")
    if not action:
        raise ValueError("统计事件不正确")
    if body.get("surface") == "directory":
        target = host(body.get("target_url"))
        if not target:
            return
        # Match public outbound targets exactly; never guess unrelated subdomains.
        rows = conn.execute("SELECT id,target_url FROM ads WHERE paused=0 AND start_date<=? AND end_date>?", (day, day))
        ids = [r["id"] for r in rows if host(r["target_url"]) == target]
    else:
        try:
            ids = [int(body.get("ad_id"))]
        except (ValueError, TypeError):
            raise ValueError("广告编号不正确")
    for ad_id in ids:
        record(conn, ad_id, action, day, agent, body)


def report(conn, args, today):
    end = str(args.get("end") or today)
    try:
        start = str(args.get("start") or (date.fromisoformat(end)-timedelta(days=29)).isoformat())
        length = (date.fromisoformat(end)-date.fromisoformat(start)).days
        if not 0 <= length <= 365:
            raise ValueError()
    except ValueError:
        raise ValueError("请选择 366 天以内的有效日期范围")
    where, params = ["m.day BETWEEN ? AND ?"], [start, end]
    if args.get("ad_id"):
        where.append("m.ad_id=?")
        params.append(int(args["ad_id"]))
    if args.get("slot"):
        where.append("a.slot=?")
        params.append(str(args["slot"]))
    if args.get("surface") in ("banner", "directory"):
        where.append("m.surface=?")
        params.append(args["surface"])
    data = [dict(r) for r in conn.execute(f"SELECT m.*,a.name FROM ad_metrics m JOIN ads a ON a.id=m.ad_id WHERE {' AND '.join(where)}", params)]
    for row in data:
        row["page"], row["region"], row["action_label"] = source_labels(row["path"], row["placement"])
        row["page_label"] = PAGE_NAMES[row["page"]]
    all_pages = data
    if args.get("page") in PAGE_NAMES:
        data = [r for r in data if r["page"] == args["page"]]
    mode = args.get("mode") or "human"
    if mode not in ("human", "all", "ai"):
        raise ValueError("统计口径不正确")
    def allowed(r):
        return mode == "all" or (r["audience"] == "human" if mode == "human" else r["audience"] == "ai")
    def totals(rows):
        imp, clicks = sum(r["impressions"] for r in rows), sum(r["clicks"] for r in rows)
        return {"impressions": imp, "clicks": clicks, "ctr": round(clicks/imp*100, 2) if imp else None}
    def groups(rows, keys):
        buckets = {}
        for r in rows:
            key = tuple(r[k] for k in keys)
            buckets.setdefault(key, []).append(r)
        return [{**dict(zip(keys,k)), **totals(v)} for k,v in buckets.items()]
    filtered = [r for r in data if allowed(r)]
    days = [(date.fromisoformat(start)+timedelta(days=i)).isoformat() for i in range(length+1)]
    daily = {r["day"]: r for r in groups(filtered,["day"])}
    sources = groups(filtered, ["page", "page_label", "region", "surface"])
    for row in sources:
        matches = [r for r in filtered if all(r[key] == row[key] for key in ("page", "region", "surface"))]
        row["detail_clicks"] = sum(r["clicks"] for r in matches if r["action_label"] == "查看详情")
        row["outbound_clicks"] = sum(r["clicks"] for r in matches if r["action_label"] == "跳转官网")
        row["unclassified_clicks"] = row["clicks"] - row["detail_clicks"] - row["outbound_clicks"]
        row["paths"] = sorted({r["path"] for r in matches})
    # Keep comparison cards stable when drilling into one source page.
    page_groups = {r["page"]: r for r in groups([r for r in all_pages if allowed(r)], ["page"])}
    return {"start": start, "end": end, "mode": mode, "summary": totals(filtered),
      "all": totals(data), "human": totals([r for r in data if r["audience"] == "human"]),
      "ai": totals([r for r in data if r["audience"] == "ai"]),
      "excluded": totals([r for r in data if r["audience"] in ("ai","bot")]),
      "unknown": totals([r for r in data if r["audience"] in ("unknown","legacy")]),
      "daily": [daily.get(day,{"day":day,**totals([])}) for day in days],
      "ads": sorted(groups(filtered,["ad_id","name"]), key=lambda r:r["impressions"], reverse=True),
      "pages": [{"page": key, "page_label": label, **page_groups.get(key, totals([]))} for key, label in PAGE_NAMES.items()],
      "locations": sorted(sources, key=lambda r: (list(PAGE_NAMES).index(r["page"]), -r["clicks"], -r["impressions"])),
      "sources": sorted(groups(filtered,["path","placement","surface"]),key=lambda r:r["clicks"],reverse=True),
      "audiences": groups(data,["audience","reason"])}
