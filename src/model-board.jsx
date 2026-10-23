import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import modelRows from "./model-rows.json";
import { models, stationPath, stations } from "./data.js";
import { useTitle } from "./ui.jsx";

const SORTS = [
  { id: "avail", label: "在线率" },
  { id: "latency", label: "延迟" },
  { id: "in", label: "输入价格" },
];

const MODS = {
  text: { label: "文本", className: "t", path: "M4 7V5h16v2M12 5v14M9 19h6" },
  image: { label: "图片", className: "g", path: "M3 5h18v14H3zM8.5 10.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8M21 16l-5-5-8 8" },
  file: { label: "文件", className: "f", path: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" },
  audio: { label: "音频", className: "a", path: "M9 18V6l10-2v12M9 18a3 3 0 1 1-2-2.8M19 16a3 3 0 1 1-2-2.8" },
  video: { label: "视频", className: "v", path: "M4 6h11v12H4zM15 10l5-3v10l-5-3z" },
};

function normName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function publicHref(url) {
  try {
    const next = new URL(url);
    if (/(^|\.)okkmax\.com$/i.test(next.hostname)) return "";
    for (const key of [...next.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) next.searchParams.delete(key);
    }
    return next.toString();
  } catch {
    return "";
  }
}

const stationBySlug = new Map();
const stationByName = new Map();
for (const station of stations) {
  if (station.slug && !stationBySlug.has(station.slug)) stationBySlug.set(station.slug, station);
  const key = normName(station.name);
  if (key && !stationByName.has(key)) stationByName.set(key, station);
}

function localStation(row) {
  return stationBySlug.get(row.slug) || stationByName.get(normName(row.name)) || null;
}

function heatColor(value) {
  if (value < 0) return "rgb(148, 163, 184)";
  const mix = (from, to, t) => Math.round(from + (to - from) * t);
  const red = [239, 68, 68];
  const amber = [234, 179, 8];
  const green = [34, 165, 89];
  const [from, to, t] = value <= 60 ? [red, amber, value / 60] : [amber, green, (value - 60) / 40];
  return `rgb(${mix(from[0], to[0], t)}, ${mix(from[1], to[1], t)}, ${mix(from[2], to[2], t)})`;
}

function trendTip(point) {
  const avail = `${Number(point[1]).toFixed(1)}%`;
  if (!point[0]) return `可用率 ${avail}`;
  const stamp = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(point[0] * 1000));
  return `${stamp} 可用率 ${avail}`;
}

function Trend({ points }) {
  if (!points?.length) return <span className="dash">—</span>;
  return (
    <span className="mb-hm">
      {points.map((point, index) => (
        <i key={`${point[0]}-${index}`} title={trendTip(point)} style={{ background: heatColor(point[1]) }} />
      ))}
    </span>
  );
}

function moneyText(value, usd) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = number !== 0 && Math.abs(number) < 0.01 ? 4 : 2;
  return `${usd ? "$" : "¥"}${number.toFixed(digits)}`;
}

function availText(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
}

function latencyText(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${(number / 1000).toFixed(1)}s`;
}

function contextLabel(value) {
  if (!value) return "—";
  if (value >= 10000) {
    const wan = value / 10000;
    const text = Number.isInteger(wan) ? String(wan) : String(Math.round(wan * 10) / 10);
    return `${text} 万 tokens`;
  }
  return `${value.toLocaleString("zh-CN")} tokens`;
}

function releasedLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!match) return value || "—";
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function officialPrice(row) {
  if (row?.priceIn == null && row?.priceOut == null) return "—";
  const part = (value) => (value == null ? "—" : `$${Number(value).toFixed(2)}`);
  return `${part(row.priceIn)} / ${part(row.priceOut)} / 1M`;
}

export function ModIcon({ kind }) {
  const mod = MODS[kind];
  if (!mod) return null;
  return (
    <span className="ract-w">
      <em className={mod.className} aria-label={mod.label}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={mod.path} />
        </svg>
      </em>
      <span className="ract-tip">{mod.label}</span>
    </span>
  );
}

function OutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

function StationName({ row }) {
  const local = localStation(row);
  const outbound = publicHref(local?.site || "") || row.href || "";
  const label = (
    <>
      <span className="slb-nm">{row.name}</span>
      {outbound ? <OutIcon /> : null}
    </>
  );
  if (local) {
    return (
      <span className="hrb-nmrow">
        <Link className="st-out" to={stationPath(local)}><span className="slb-nm">{row.name}</span></Link>
        {outbound ? <a className="st-jump" href={outbound} target="_blank" rel="noreferrer" aria-label="打开站点"><OutIcon /></a> : null}
        {row.cnDown ? <DownTag /> : null}
      </span>
    );
  }
  if (outbound) {
    return (
      <span className="hrb-nmrow">
        <a className="st-out" href={outbound} target="_blank" rel="noreferrer">{label}</a>
        {row.cnDown ? <DownTag /> : null}
      </span>
    );
  }
  return (
    <span className="hrb-nmrow">
      <span className="slb-nm">{row.name}</span>
      {row.cnDown ? <DownTag /> : null}
    </span>
  );
}

function DownTag() {
  return (
    <span className="cn-tag">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6.8" />
        <path d="M1.2 8h13.6M8 1.2c-2 2-2 11.6 0 13.6M8 1.2c2 2 2 11.6 0 13.6" />
        <path d="M2.5 2.5l11 11" strokeWidth="1.8" />
      </svg>
      访问异常
    </span>
  );
}

function LogoMark({ row }) {
  const local = localStation(row);
  const src = local?.img || row.logo || "";
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="slb-logo fallback">{(row.name || "?").slice(0, 1)}</span>;
  return <img className="slb-logo" src={src} alt="" onError={() => setFailed(true)} />;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareRows(sort, a, b) {
  const left = a.main || {};
  const right = b.main || {};
  if (sort === "latency") {
    const av = numberOrNull(left.latencyMs);
    const bv = numberOrNull(right.latencyMs);
    if (av == null && bv == null) return a.order - b.order;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv || a.order - b.order;
  }
  if (sort === "in") {
    const av = numberOrNull(left.in);
    const bv = numberOrNull(right.in);
    if (av == null && bv == null) return a.order - b.order;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv || a.order - b.order;
  }
  const av = numberOrNull(left.avail);
  const bv = numberOrNull(right.avail);
  if (av == null && bv == null) return a.order - b.order;
  if (av == null) return 1;
  if (bv == null) return -1;
  return bv - av || a.order - b.order;
}

function GroupCells({ group, usd }) {
  return (
    <>
      <td><span className="mb-gn"><span className="gm-gname">{group?.name || "—"}</span></span></td>
      <td className="v">{moneyText(group?.in, usd)}</td>
      <td className="v">{moneyText(group?.out, usd)}</td>
      <td className="v">{moneyText(group?.cache, usd)}</td>
      <td className="r">{availText(group?.avail)}</td>
      <td className="r">{latencyText(group?.latencyMs)}</td>
      <td className="r"><Trend points={group?.points} /></td>
    </>
  );
}

export function ModelBoard({ slug }) {
  const row = modelRows.find((item) => item.slug === slug);
  const known = models.find((item) => item.slug === slug);
  const name = row?.title || known?.name || slug;
  useTitle(name);
  const [board, setBoard] = useState(undefined);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("avail");
  const [sortOpen, setSortOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState("");
  const [shown, setShown] = useState(20);
  const [open, setOpen] = useState({});
  const [descOpen, setDescOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sortRef = useRef(null);
  const moreRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    setBoard(undefined);
    setQuery("");
    setSort("avail");
    setShown(20);
    setOpen({});
    setDescOpen(false);
    setMoreOpen(false);
    setMoreQuery("");
    fetch(`/model-board/${encodeURIComponent(slug)}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancel) setBoard(data);
      })
      .catch(() => {
        if (!cancel) setBoard(null);
      });
    return () => {
      cancel = true;
    };
  }, [slug]);

  useEffect(() => {
    const close = (event) => {
      if (sortRef.current && !sortRef.current.contains(event.target)) setSortOpen(false);
      if (moreRef.current && !moreRef.current.contains(event.target)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const chips = models.map((item) => modelRows.find((entry) => entry.slug === item.slug) || { slug: item.slug, title: item.name, icon: "" });
  const desc = board?.desc || "";
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const rows = (board?.rows || []).map((item, index) => ({ ...item, order: index })).filter((item) => {
      if (!text) return true;
      const groups = [item.main?.name, ...(item.others || []).map((group) => group.name)].join(" ");
      return `${item.name} ${groups}`.toLowerCase().includes(text);
    });
    return [...rows].sort((a, b) => compareRows(sort, a, b));
  }, [board, query, sort]);
  const visible = filtered.slice(0, shown);
  const moreRows = modelRows.filter((item) => {
    const text = moreQuery.trim().toLowerCase();
    if (!text) return true;
    return `${item.title} ${item.slug}`.toLowerCase().includes(text);
  });
  const sortLabel = SORTS.find((item) => item.id === sort)?.label || "在线率";

  return (
    <div className="wrap model-page mb">
      <div className="mb-top">
        <h1 className="mb-ttl">
          {row?.icon ? <img className="mb-vlogo" src={row.icon} alt="" /> : null}
          {name}
          <span className="ract-w">
            <button
              type="button"
              className="mb-cp"
              aria-label={copied ? "已复制" : "复制"}
              onClick={() => {
                navigator.clipboard?.writeText(slug).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }).catch(() => {});
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            <span className="ract-tip">{copied ? "已复制" : "复制"}</span>
          </span>
        </h1>
        {desc ? (
          <div className={descOpen ? "mb-desc-wrap open" : "mb-desc-wrap"}>
            <div className={descOpen ? "mb-desc open" : "mb-desc"}>{desc}</div>
            {desc.length > 72 ? (
              <button type="button" className="mb-fold" onClick={() => setDescOpen((value) => !value)}>{descOpen ? "收起" : "展开"}</button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mb-cards">
        <div className="mb-card">
          <i>模态</i>
          <b className="mb-mod">{(row?.mods || []).map((kind) => <ModIcon key={kind} kind={kind} />)}</b>
        </div>
        <div className="mb-card"><i>输入 / 输出</i><b>{officialPrice(row)}</b></div>
        <div className="mb-card"><i>上下文</i><b>{contextLabel(row?.context)}</b></div>
        <div className="mb-card"><i>发布时间</i><b>{releasedLabel(row?.released)}</b></div>
      </div>
      <div className="mb-pills">
        <div className="mb-pills-l">
          {chips.map((item) => (
            <Link key={item.slug} className={item.slug === slug ? "mb-chip on" : "mb-chip"} to={`/model/${item.slug}`}>
              {item.icon ? <img className="mb-chip-ic" src={item.icon} alt="" /> : null}
              {item.title}
            </Link>
          ))}
        </div>
        <div className="mb-more" ref={moreRef}>
          <button type="button" className="mb-chip" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
            更多
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {moreOpen ? (
            <div className="mb-more-menu">
              <input value={moreQuery} placeholder="搜索模型" onChange={(event) => setMoreQuery(event.target.value)} />
              <div className="mb-more-list">
                {moreRows.map((item) => (
                  <Link key={item.slug} className={item.slug === slug ? "on" : ""} to={`/model/${item.slug}`} onClick={() => setMoreOpen(false)}>
                    {item.icon ? <img src={item.icon} alt="" /> : null}
                    {item.title}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="slb-mfilter">
        <label className="slb-msearch">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={query}
            placeholder="搜索站点 / 分组"
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(20);
            }}
          />
        </label>
        <div className="mb-sort" ref={sortRef}>
          <button type="button" aria-expanded={sortOpen} onClick={() => setSortOpen((value) => !value)}>
            <span>排序</span>
            <b>{sortLabel}</b>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {sortOpen ? (
            <div className="mb-sort-menu">
              {SORTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === sort ? "on" : ""}
                  onClick={() => {
                    setSort(item.id);
                    setSortOpen(false);
                    setShown(20);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="table-wrap">
        <table className="rank mb-table">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr>
              <td>站名</td>
              <td>分组</td>
              <td>输入</td>
              <td>输出</td>
              <td>缓存</td>
              <td className="r">在线率</td>
              <td className="r">延迟</td>
              <td className="r">响应趋势</td>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const text = query.trim().toLowerCase();
              const others = item.others || [];
              const forced = text && others.some((group) => String(group.name || "").toLowerCase().includes(text)) && !`${item.name} ${item.main?.name || ""}`.toLowerCase().includes(text);
              const expanded = Boolean(open[item.slug]) || forced;
              return (
                <GroupBlock key={item.slug || item.name} item={item} expanded={expanded} onToggle={() => setOpen((value) => ({ ...value, [item.slug]: !expanded }))} />
              );
            })}
          </tbody>
        </table>
      </div>
      {board === undefined ? <p className="mini mb-empty">正在读取站点列表。</p> : null}
      {board && !filtered.length ? <p className="mini mb-empty">没有符合条件的站点。</p> : null}
      {board === null ? <p className="mini mb-empty">这份快照里没有这款模型的站点列表。</p> : null}
      {visible.length < filtered.length ? (
        <div className="pager"><button type="button" className="step" onClick={() => setShown((value) => value + 20)}>加载更多</button></div>
      ) : null}
    </div>
  );
}

function GroupBlock({ item, expanded, onToggle }) {
  const others = item.others || [];
  return (
    <>
      <tr>
        <td>
          <div className="slb-st">
            <LogoMark row={item} />
            <div className="slb-stn">
              <StationName row={item} />
            </div>
            {others.length ? (
              <button type="button" className={expanded ? "mb-chev on" : "mb-chev"} aria-expanded={expanded} aria-label={expanded ? "收起其他分组" : "展开其他分组"} onClick={onToggle}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            ) : null}
          </div>
        </td>
        <GroupCells group={item.main} usd={item.usd} />
      </tr>
      {expanded ? others.map((group, index) => (
        <tr key={`${item.slug}-${group.name}-${index}`} className="mb-other">
          <td />
          <GroupCells group={group} usd={item.usd} />
        </tr>
      )) : null}
    </>
  );
}
