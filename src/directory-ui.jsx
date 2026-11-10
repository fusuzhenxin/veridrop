import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import codexRows from "./codex.json";
import { hubMark, iq, latestTests, stations, stationHeading, stationPath } from "./data.js";
import { mergeRecentTests } from "./recent-tests.js";
import { readFavs } from "./account.js";
import { fetchComments, fetchShop } from "./community.js";
import { useStationModels } from "./prices.js";
import { Logo, Pays, Vendor, VENDOR_ICON, vendorOfModel } from "./ui.jsx";

export function DirectoryIcon({ name, ...props }) {
  const paths = {
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    external: "M14 4h6v6m0-6L10 14M10 4H4v16h16v-6",
    plus: "M12 5v14M5 12h14",
    chart: "M4 4v16h16M8 15V9m5 6V5m5 10v-4",
    clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    gift: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
    pulse: "M2 12h5l3-8 4 16 3-8h5",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    prev: "m14 6-6 6 6 6",
    next: "m10 6 6 6-6 6",
    pause: "M9 5v14M15 5v14",
    play: "m9 5 10 7-10 7z",
    chevron: "m7 9 5 5 5-5",
    bookmark: "M6 4h12v17l-6-4-6 4z",
    wallet: "M4 6h15v15H4zM4 6V3h12v3m-1 7h5v4h-5z",
    card: "M3 5h18v14H3zM3 10h18M7 15h3",
    receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
    refund: "M7 7H3V3m0 4a9 9 0 1 1-1 9M9 12h6m-3-3v6",
    layers: "m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5",
    message: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
    news: "M5 4h15v16H5zM5 8H2v12h3M9 8h7M9 12h7M9 16h4",
    megaphone: "m3 10 17-6v16L3 14zM7 15l2 6h4l-2-5M3 10v4",
    image: "M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M8 8h.01",
    video: "M3 5h13v14H3zm13 5 5-3v10l-5-3",
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.arrow} /></svg>;
}

export function DirectoryStats({ count, uptime, compact = false }) {
  return <div className={`vd-stats${compact ? " compact" : ""}`}>
    <span><DirectoryIcon name="grid" />收录站点 <b>{count.toLocaleString("zh-CN")}</b><small>个</small></span>
    <span><DirectoryIcon name="pulse" />平均在线率 <b className="vd-green">{uptime}</b></span>
    <small className="vd-stats-note">已记录站点 · 目录数据</small>
  </div>;
}

export function DirectoryAtmosphere() {
  return <div className="vd-atmosphere" aria-hidden="true">{Array.from({ length: 33 }, (_, index) => {
    const size = index % 8 === 0 ? 10 : index % 3 === 0 ? 6 : 3;
    return <svg key={index} viewBox="-8 -8 16 16" style={{ left: `${(index * 37 + 11) % 98}%`, top: `${(index * 29 + 7) % 89}%`, width: size, height: size, animationDelay: `${index % 7}s` }}><path d="M0-6 1.5-1.5 6 0 1.5 1.5 0 6-1.5 1.5-6 0-1.5-1.5Z" /></svg>;
  })}</div>;
}

// The repeated set is inert: only the original links enter keyboard navigation.
export function DirectoryCarousel({ title, eyebrow, more, stats, items, renderItem, kind }) {
  const id = useId();
  const viewport = useRef(null);
  const firstSet = useRef(null);
  const paused = useRef(false);
  const [playing, setPlaying] = useState(true);
  const cooldown = useRef(0);
  const reduced = useRef(false);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => { reduced.current = media.matches; };
    updateMotion();
    media.addEventListener("change", updateMotion);
    let frame;
    let last = 0;
    let fraction = 0;
    let hover = false;
    let touching = false;
    const enter = (event) => { if (event.pointerType !== "touch") hover = true; };
    const leave = () => { hover = false; };
    const down = () => { touching = true; };
    const up = () => { touching = false; cooldown.current = performance.now() + 2400; };
    const wheel = () => { cooldown.current = performance.now() + 3000; };
    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const elapsed = last ? Math.min(now - last, 48) : 0;
      last = now;
      if (paused.current || reduced.current || hover || touching || document.hidden || el.contains(document.activeElement) || now < cooldown.current) return;
      const period = firstSet.current?.getBoundingClientRect().width || 0;
      if (!period || period <= el.clientWidth) return;
      fraction += elapsed * (kind === "welfare" ? 0.026 : 0.035);
      if (fraction < 1) return;
      const step = Math.floor(fraction);
      fraction -= step;
      el.scrollLeft = (el.scrollLeft + step) % period;
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", updateMotion);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [kind]);
  function move(direction) {
    const el = viewport.current;
    const period = firstSet.current?.getBoundingClientRect().width || 0;
    if (!el || !period) return;
    cooldown.current = performance.now() + 2000;
    const step = firstSet.current.firstElementChild?.getBoundingClientRect().width || el.clientWidth;
    const gap = parseFloat(getComputedStyle(firstSet.current).gap) || 0;
    if (direction < 0 && el.scrollLeft < step + gap) el.scrollLeft += period;
    if (direction > 0 && el.scrollLeft >= period) el.scrollLeft -= period;
    el.scrollBy({ left: direction * (step + gap), behavior: reduced.current ? "instant" : "smooth" });
  }
  return <section className={`vd-carousel vd-carousel-${kind}`} aria-label={title}>
    <div className="vd-carousel-heading">
      <div>{eyebrow ? <p className="vd-eyebrow">{eyebrow}</p> : null}<h2>{title}</h2></div>
      {stats}
      {more ? <Link className="vd-more" to={more}>查看全部福利 <DirectoryIcon name="arrow" /></Link> : null}
      <div className="vd-carousel-controls" aria-label={`${title}轮播控制`}>
        <button type="button" aria-label={`上一个${title}`} aria-controls={id} onClick={() => move(-1)}><DirectoryIcon name="prev" /></button>
        <button type="button" aria-label={playing ? `暂停${title}滚动` : `播放${title}滚动`} aria-pressed={!playing} aria-controls={id} onClick={() => { paused.current = playing; setPlaying(!playing); }}><DirectoryIcon name={playing ? "pause" : "play"} /></button>
        <button type="button" aria-label={`下一个${title}`} aria-controls={id} onClick={() => move(1)}><DirectoryIcon name="next" /></button>
      </div>
    </div>
    <div id={id} ref={viewport} className="vd-carousel-viewport">
      <div ref={firstSet} className="vd-carousel-set">{items.map(renderItem)}</div>
      <div className="vd-carousel-set" aria-hidden="true" inert>{items.map(renderItem)}</div>
      <div className="vd-carousel-set" aria-hidden="true" inert>{items.map(renderItem)}</div>
    </div>
  </section>;
}

const resets = [...codexRows].map((row) => ({ ...row, at: new Date(row.announcedAt.replace(/^\$D/, "")) })).filter((row) => Number.isFinite(row.at.getTime())).sort((a, b) => b.at - a.at);
const resetDate = (at, options) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ...options }).format(at);
const digestTabs = [
  ["tests", "最近实测", "pulse", "/list", "查看更多"],
  ["rewards", "积分兑奖", "gift", "/points#redeem", "全部奖品"],
  ["models", "模型智商榜", "chart", "/tools/iq", "完整榜单"],
  ["codex", "Codex 额度重置", "clock", "/tools/codex-resets", "全部记录"],
];

export function DirectoryDigest() {
  const [tab, setTab] = useState(digestTabs[0][0]);
  const [tests, setTests] = useState(() => mergeRecentTests(latestTests, globalThis.__VD_BASIC_INDEX__, stations, stationHeading));
  const [rewards, setRewards] = useState([]);
  const [rewardState, setRewardState] = useState("loading");
  const id = useId();
  const entries = [...iq].filter((item) => Number.isFinite(item.score)).sort((a, b) => b.score - a.score).slice(0, 3);
  const active = digestTabs.find(([key]) => key === tab) || digestTabs[0];
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/basic-reports?recent=1", { cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("reports"); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setTests(mergeRecentTests(latestTests, data.reports, stations, stationHeading)); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (tab !== "rewards") return undefined;
    let cancelled = false;
    setRewardState("loading");
    fetchShop().then((data) => {
      if (cancelled) return;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const items = (Array.isArray(data.items) ? data.items : []).filter((item) =>
        (item.status || "open") === "open" &&
        (item.stock == null || item.stock === "" || Number(item.sold || 0) < Number(item.stock)) &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(item.ends || "") || item.ends >= today)
      ).slice(0, 3).map(({ id, title, desc, brand, badge, icon, cost, stock, sold, perPerson }) => ({ id, title, desc, brand, badge, icon, cost, stock, sold, perPerson }));
      setRewards(items);
      setRewardState("ready");
    }).catch(() => { if (!cancelled) setRewardState("error"); });
    return () => { cancelled = true; };
  }, [tab]);
  function keyTabs(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = digestTabs.findIndex(([key]) => key === tab);
    const next = digestTabs[event.key === "Home" ? 0 : event.key === "End" ? digestTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + digestTabs.length) % digestTabs.length][0];
    setTab(next);
    event.currentTarget.querySelector(`[data-digest-tab="${next}"]`)?.focus();
  }
  return <section className="vd-digest" aria-label="模型、额度、实测与兑奖速览">
    <div className="vd-digest-heading">
      <div role="tablist" aria-label="速览类型" onKeyDown={keyTabs}>
        {digestTabs.map(([key, label, icon]) => <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} data-digest-tab={key} onClick={() => setTab(key)}><DirectoryIcon name={icon} />{label}</button>)}
      </div>
      <Link className="vd-more" to={active[3]}>{active[4]}<DirectoryIcon name="arrow" /></Link>
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} aria-busy={tab === "rewards" && rewardState === "loading"} className={`vd-digest-entries ${tab}`} style={tab === "rewards" ? { "--vd-digest-count": Math.max(1, rewards.length) } : undefined}>
      {tab === "models" ? entries.map((item, index) => <Link key={item.name} to="/tools/iq" className="vd-digest-entry">
        <em>{String(index + 1).padStart(2, "0")}</em><Vendor name={item.vendor} /><span>{item.name}<small>{index ? "综合能力评分" : "综合能力领先"}</small></span><b>{item.score}<small>分</small></b>
      </Link>) : tab === "codex" ? resets.slice(0, 3).map((item, index) => <Link key={item.id} to="/tools/codex-resets" className="vd-digest-entry">
        <DirectoryIcon name="clock" /><span><small>{index ? "历史重置" : "最近一次重置"}</small><strong>{resetDate(item.at, { month: "2-digit", day: "2-digit" })}</strong></span><span className="vd-reset-time">{resetDate(item.at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}<small>{resets[index + 1] ? `间隔 ${((item.at - resets[index + 1].at) / 86400000).toFixed(1)} 天` : "公开记录"}</small></span>
      </Link>) : tab === "tests" ? tests.slice(0, 3).map((item) => <Link key={item.href} to={item.href} className="vd-digest-entry vd-digest-test" title={`${item.station} · ${item.model} · ${item.date}`}>
        <Logo station={{ img: item.img }} className="vd-digest-logo" /><span className="vd-digest-copy"><span>{item.station}</span><small>{item.model}</small></span><span className="vd-digest-result"><b>{item.score == null ? "已记录" : <>{item.score}<small>分</small></>}</b><time dateTime={new Date(item.at).toISOString()}>{item.date}</time></span>
      </Link>) : rewardState !== "ready" ? <p className="vd-digest-message" role="status">{rewardState === "loading" ? "正在读取可兑奖品…" : <>奖品暂未加载，<Link to="/points#redeem">前往积分中心查看 <DirectoryIcon name="arrow" /></Link></>}</p> : rewards.length ? rewards.map((item) => <Link key={item.id} to="/points#redeem" className="vd-digest-entry vd-digest-reward" title={`${item.title}\n${item.desc || ""}`}>
        {item.icon ? <Logo station={{ img: item.icon }} className="vd-digest-logo" /> : <DirectoryIcon name="gift" className="vd-digest-logo" />}<span className="vd-digest-copy"><span>{item.title}</span><small>{item.desc || item.badge || item.brand}</small><small>{item.stock == null || item.stock === "" ? `每人限 ${item.perPerson || 1} 份` : `剩 ${Math.max(0, Number(item.stock) - Number(item.sold || 0))} 份 · 每人限 ${item.perPerson || 1} 份`}</small></span><span className="vd-digest-result"><b>{item.cost}<small>积分</small></b><small>去兑换 →</small></span>
      </Link>) : <p className="vd-digest-message" role="status">暂无可兑奖品，<Link to="/points">先做任务攒积分 <DirectoryIcon name="arrow" /></Link></p>}
    </div>
  </section>;
}

const tagColor = (tag) => /公益|在用|推荐|高可用/.test(tag) ? "olive" : /企业|发票|稳定/.test(tag) ? "blue" : /国内|支付|退款/.test(tag) ? "teal" : /个人|便宜/.test(tag) ? "rose" : /赠额|倍率|延迟|签到/.test(tag) ? "amber" : "violet";
const paymentNames = { alipay: "支付宝", wechat: "微信", usdt: "USDT", bank: "银行卡", corp: "对公转账", paypal: "PayPal", taobao: "淘宝" };
const familyName = (name) => VENDOR_ICON[name]?.[1] || ({ image: "图像模型", video: "视频模型" }[name]) || name;

export function DirectoryTags({ item, limit }) {
  const tags = [...new Set(item.tags || [])];
  const visible = limit && tags.length > limit ? tags.slice(0, limit - 1) : tags;
  return tags.length ? <div className="vd-directory-tags">{visible.map((tag) => <span key={tag} className={tagColor(tag)}>{tag}</span>)}{visible.length < tags.length ? <Link className="vd-tags-more" to={stationPath(item)} title={tags.join("、")} aria-label={`查看全部 ${tags.length} 个分类：${tags.join("、")}`}>+{tags.length - visible.length} 项</Link> : null}</div> : <span className="vd-muted">—</span>;
}

function ExpandedModels({ item, panelId, close }) {
  const models = useStationModels(item);
  const names = [...new Set(models.map((row) => row.name || row.display || row.model || row.id).filter((name) => typeof name === "string" && name))];
  return <div className="vd-expanded-models" id={panelId} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true); } }}>
    <div className="vd-expanded-heading"><b>支持的模型</b><span>{names.length ? `已收录 ${names.length} 个模型名称` : "暂无已公布的具体模型清单"}</span><Link to={stationPath(item)}>查看模型与报价 <DirectoryIcon name="arrow" /></Link></div>
    {names.length ? <div className="vd-model-chips">{names.slice(0, 36).map((name) => <Link key={name} to={stationPath(item)}>{vendorOfModel(name) ? <Vendor name={vendorOfModel(name)} /> : null}{name}</Link>)}</div> : null}
    {names.length > 36 ? <Link className="vd-expanded-more" to={stationPath(item)}>查看全部 {names.length} 个模型 →</Link> : null}
  </div>;
}

export function DirectoryTable({ rows, offset = 0, onFavorite }) {
  const id = useId();
  const navigate = useNavigate();
  const [open, setOpen] = useState("");
  const [favs, setFavs] = useState(readFavs);
  const [comments, setComments] = useState([]);
  const triggers = useRef(new Map());
  useEffect(() => {
    const sync = () => setFavs(readFavs());
    window.addEventListener("okk-account", sync);
    return () => window.removeEventListener("okk-account", sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchComments("").then((data) => { if (!cancelled) setComments(data.comments || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return <div className="vd-directory-table-scroll" onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      triggers.current.get(open)?.focus();
      setOpen("");
    }
  }}><table className="vd-directory-table">
    <colgroup><col className="vd-col-name" /><col className="vd-col-quality" /><col className="vd-col-models" /><col className="vd-col-pay" /><col className="vd-col-tags" /><col className="vd-col-rating" /><col className="vd-col-favorite" /></colgroup>
    <thead><tr><th scope="col">站点名称</th><th scope="col">可用率 / 延迟</th><th scope="col">模型覆盖</th><th scope="col">支付方式</th><th scope="col">分类</th><th scope="col">社区评分</th><th scope="col">收藏</th></tr></thead>
    <tbody>{rows.map((item, index) => {
      const panelId = `${id}-${index}`;
      const expanded = open === item.slug;
      const uptime = item.uptime != null && Number.isFinite(Number(item.uptime)) ? Number(item.uptime) : null;
      const latency = item.latency != null && Number.isFinite(Number(item.latency)) ? Number(item.latency) : null;
      const keys = new Set([item.slug, item.siteToken, ...(item.aliases || [])].filter(Boolean));
      const reviews = [...(item.reviews || []), ...comments.filter((row) => keys.has(row.slug))].filter((row) => Number(row.rating) > 0);
      const rating = reviews.length ? reviews.reduce((sum, row) => sum + Number(row.rating), 0) / reviews.length : null;
      const close = (restoreFocus) => { setOpen(""); if (restoreFocus) triggers.current.get(item.slug)?.focus(); };
      const name = <>{stationHeading(item)}{item.ownerPick ? <small className="vd-owner-pick">· 精选</small> : null}</>;
      const official = /^https?:\/\//i.test(item.site || "") ? item.site : "";
      return <Fragment key={item.slug}><tr className="vd-directory-row" onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.target.closest('a, button, input, select, textarea, [role="button"], [tabindex]') || window.getSelection()?.toString()) return;
        navigate(stationPath(item));
      }}>
        <td><div className="vd-directory-identity"><span className={`vd-place${offset + index < 3 ? " leading" : ""}`}>{String(offset + index + 1).padStart(2, "0")}</span><div className="vd-site-identity"><Link to={stationPath(item)} aria-label={`查看${stationHeading(item)}详情`} {...hubMark(item, "directory-site")}><Logo station={item} /></Link><span><b>{official ? <a className="vd-site-external" href={official} target="_blank" rel="noopener noreferrer" aria-label={`前往${stationHeading(item)}官网（新标签页）`} {...hubMark(item, "directory-visit")}>{name}<DirectoryIcon name="external" /></a> : <Link to={stationPath(item)}>{name}</Link>}</b><Link className="vd-site-listed" to={stationPath(item)}>{item.listed ? <>收录于 <time dateTime={item.listed}>{item.listed}</time></> : "收录时间暂缺"}</Link>{item.issue ? <small className="vd-issue">访问异常</small> : null}</span></div></div></td>
        <td><div className={`vd-uptime${uptime != null && uptime < 95 ? " low" : ""}`}><i />{uptime == null ? "—" : <><b>{uptime.toFixed(2)}</b><small>%</small></>}</div>{uptime != null ? <div className="vd-uptime-meter" role="meter" aria-label={`${item.name}已记录可用率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uptime}><i style={{ width: `${Math.max(0, Math.min(100, uptime))}%` }} /></div> : null}<div className="vd-latency">平均延迟 <span>{latency == null ? "—" : latency < 1 ? `${Math.round(latency * 1000)} ms` : `${latency.toFixed(1)} s`}</span></div></td>
        <td><div className="vd-model-coverage"><button type="button" ref={(el) => { if (el) triggers.current.set(item.slug, el); else triggers.current.delete(item.slug); }} className="vd-model-count" aria-label={`${item.name}支持的模型，${item.modelsList ?? item.modelsHome ?? "未知"} 个`} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onClick={() => setOpen(expanded ? "" : item.slug)}>{item.modelsList ?? item.modelsHome ?? "—"}<DirectoryIcon name="chevron" /></button><span className="vd-vendor-marks">{[...new Set(item.vendors || [])].map((name) => <span key={name} tabIndex={0} aria-label={familyName(name)} className="vd-icon-hint" data-hint={familyName(name)}>{name === "image" || name === "video" ? <DirectoryIcon name={name} /> : <Vendor name={name} />}</span>)}</span></div></td>
        <td><div className="vd-payment-marks">{item.pay?.length ? item.pay.map((pay) => <span key={pay} tabIndex={0} className="vd-icon-hint" data-hint={paymentNames[pay] || pay} aria-label={paymentNames[pay] || pay}>{pay === "taobao" || !paymentNames[pay] ? <DirectoryIcon name="wallet" className="vd-payment-fallback" /> : <Pays list={[pay]} />}</span>) : <span className="vd-muted">—</span>}</div></td>
        <td><DirectoryTags item={item} /></td>
        <td>{rating == null ? <span className="vd-muted">暂无评分</span> : <div className="vd-site-rating"><span><i>★</i> {rating.toFixed(1)}</span><Link to={`${stationPath(item)}#reviews`}>{reviews.length} 人参与</Link></div>}</td>
        <td><button type="button" className={`vd-bookmark${favs[item.slug] ? " on" : ""}`} aria-label={`${favs[item.slug] ? "取消收藏" : "收藏"}${item.name}`} aria-pressed={!!favs[item.slug]} onClick={() => { const next = onFavorite(item.slug); if (next) setFavs(next); }}><DirectoryIcon name="bookmark" /></button></td>
      </tr>{expanded ? <tr className="vd-models-row"><td colSpan={7}><ExpandedModels item={item} panelId={panelId} close={close} /></td></tr> : null}</Fragment>;
    })}</tbody>
  </table></div>;
}
