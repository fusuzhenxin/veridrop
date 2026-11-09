import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

const BRANDS = {
  anthropic: { label: "Claude", company: "Anthropic", icon: "claude", color: "#bd643a", aliases: "克劳德", domestic: false },
  openai: { label: "GPT", company: "OpenAI", icon: "openai", color: "#292b30", aliases: "ChatGPT", domestic: false },
  google: { label: "Gemini", company: "Google", icon: "gemini", color: "#199575", aliases: "谷歌 双子座", domestic: false },
  deepseek: { label: "DeepSeek", company: "深度求索", icon: "deepseek", color: "#416de1", aliases: "深度求索", domestic: true },
  glm: { label: "GLM", company: "智谱 AI", icon: "zhipu", color: "#289bad", aliases: "智谱 清言", domestic: true },
  kimi: { label: "Kimi", company: "月之暗面", icon: "moonshot", color: "#7a61dc", aliases: "月之暗面 moonshot", domestic: true },
};

const DOMAINS = [
  { id: "overall", label: "综合能力", icon: "chart", description: "对照同一套基准下的整体表现，再结合近期变化和长期趋势判断。", score: (row) => row.cur },
  { id: "coding", label: "编程开发", icon: "code", description: "比较写代码、修复问题与完成开发任务的表现，每小时测试一轮。", score: (row) => row.modes?.coding },
  { id: "reasoning", label: "逻辑推理", icon: "layers", description: "比较数学、逻辑和复杂问题中的推理表现，每天测试一轮。", score: (row) => row.modes?.reasoning },
  { id: "tooling", label: "工具调用", icon: "tools", description: "比较调用工具、执行操作和完成多步任务的表现，每天测试一轮。", score: (row) => row.modes?.tooling },
  { id: "stability", label: "稳定性", icon: "pulse", description: "比较近 7 天重复测试时的发挥，观察同一模型的表现是否稳定。", score: (row) => row.stability },
];

function Icon({ name, ...props }) {
  const paths = {
    chart: <><path d="M4 3v17h17M8 15V9m5 6V5m5 10v-5" /></>,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
    tools: <><path d="M14 4a6 6 0 0 0-7 8L3 16a3 3 0 0 0 5 5l5-5a6 6 0 0 0 7-8l-4 4-4-4 4-4Z" /></>,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    share: <><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7" /></>,
  };
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

function brand(row) {
  return BRANDS[row.ven] || { label: row.ven, company: row.ven, color: "#5c7c4d" };
}

function ModelMark({ row }) {
  const info = brand(row);
  return <img className={`iqx-mark${["openai", "kimi"].includes(row.ven) ? " iqx-mark-mono" : ""}`} src={info.icon ? `/icons/vendor/${info.icon}.svg` : row.logo} alt="" width="22" height="22" />;
}

function FilterDropdown({ label, name, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];
  const initialFocus = useRef(null);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[initialFocus.current ?? selectedIndex]?.focus({ preventScroll: true });
    initialFocus.current = null;
    function outside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, selectedIndex]);

  function choose(option) {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function optionIcon(option) {
    return option.vendor ? <ModelMark row={{ ven: option.vendor }} /> : <Icon name={option.icon || "layers"} />;
  }

  return <div className={`iqx-dropdown${open ? " is-open" : ""}`} ref={rootRef} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={triggerRef} className="iqx-select-trigger" type="button" aria-label={`${name}：${selected.label}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(!open)} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        initialFocus.current = event.key === "ArrowUp" ? options.length - 1 : selectedIndex;
        setOpen(true);
      }
    }}><span className="iqx-select-label">{label}</span><span className="iqx-select-value">{optionIcon(selected)}{selected.label}</span><Icon name="down" /></button>
    {open && <div className="iqx-dropdown-menu" id={listId} role="listbox" aria-label={name} onKeyDown={(event) => {
      const index = optionRefs.current.indexOf(document.activeElement);
      let next;
      if (event.key === "ArrowDown") next = (index + 1) % options.length;
      else if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
      else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) next = options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (next != null && next >= 0) { event.preventDefault(); optionRefs.current[next]?.focus(); }
    }}>{options.map((option, index) => <button ref={(node) => { optionRefs.current[index] = node; }} type="button" role="option" tabIndex={-1} aria-selected={value === option.value} key={option.value} onClick={() => choose(option)}>{optionIcon(option)}<span>{option.label}</span>{value === option.value && <Icon name="check" />}</button>)}</div>}
  </div>;
}

function signed(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value}` : "—";
}

function History({ row }) {
  return <span className="iqx-history" role="img" aria-label={`${row.display} 30 天趋势，绿色正常，黄色有波动，红色明显低于平时，灰色缺少数据`}>
    {(row.vals || []).map((value, index) => <i key={index} title={`第 ${index + 1} 天：${value ?? "暂无数据"}`} className={value == null ? "missing" : value < row.hmed - 8 ? "low" : value < row.hmed - 2 ? "vary" : "normal"} />)}
  </span>;
}

function Breakdown({ row }) {
  return <div className="iqx-breakdown" id={`iqx-detail-${row.slug}`}>
    <div className="iqx-breakdown-hd"><strong>分项表现</strong><Link to={`/model/${row.slug}`}>模型与分组报价 <Icon name="arrow" /></Link></div>
    <div className="iqx-breakdown-bars">{DOMAINS.slice(1).map((domain) => {
      const value = domain.score(row);
      return <div key={domain.id}><span>{domain.label}</span><b>{value ?? "—"}</b><i><span style={{ width: `${value ?? 0}%` }} /></i></div>;
    })}</div>
    <dl className="iqx-facts">
      <div><dt>综合得分</dt><dd>{row.cur}</dd></div>
      <div><dt>近期常态</dt><dd>{row.base ?? "—"}</dd></div>
      <div><dt>较近期</dt><dd className={row.bdiff < 0 ? "iqx-negative" : "iqx-positive"}>{signed(row.bdiff)}</dd></div>
      <div><dt>发布时得分</dt><dd>{row.gold ?? "—"}</dd></div>
      <div><dt>较发布时</dt><dd className={row.diff < 0 ? "iqx-negative" : "iqx-positive"}>{signed(row.diff)}</dd></div>
      <div><dt>置信区间</dt><dd>{row.ci?.length === 2 ? `${row.ci[0]}–${row.ci[1]}` : "—"}</dd></div>
    </dl>
    <div className="iqx-history-key"><span>30 天趋势 <History row={row} /></span><small><i className="normal" />正常 <i className="vary" />波动 <i className="low" />低于平时 <i className="missing" />无数据</small></div>
  </div>;
}

export function IqLeaderboard({ rows, latest }) {
  const [domainId, setDomainId] = useState("overall");
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState("all");
  const [scope, setScope] = useState("all");
  const [onlyReasoning, setOnlyReasoning] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [shareMessage, setShareMessage] = useState("");
  const tabRefs = useRef({});
  const rowRefs = useRef({});
  const domain = DOMAINS.find((item) => item.id === domainId);
  const ranked = rows.filter((row) => Number.isFinite(domain.score(row))).sort((a, b) => domain.score(b) - domain.score(a) || b.cur - a.cur || a.display.localeCompare(b.display));
  const ranks = new Map(ranked.map((row, index) => [row.slug, index > 0 && domain.score(row) === domain.score(ranked[index - 1]) ? ranked.findIndex((item) => domain.score(item) === domain.score(row)) + 1 : index + 1]));
  const search = query.trim().toLowerCase();
  const visible = ranked.filter((row) => {
    const info = brand(row);
    return (vendor === "all" || row.ven === vendor)
      && (scope === "all" || (scope === "domestic" ? info.domestic : !info.domestic))
      && (!onlyReasoning || row.re)
      && (!search || `${row.display} ${info.label} ${info.company} ${info.aliases}`.toLowerCase().includes(search));
  });
  const vendors = [...new Set(rows.map((row) => row.ven))];
  const lowered = rows.filter((row) => row.bdiff < 0).length;
  const leaders = DOMAINS.slice(1).map((item) => ({ domain: item, row: [...rows].filter((row) => Number.isFinite(item.score(row))).sort((a, b) => item.score(b) - item.score(a) || b.cur - a.cur)[0] }));

  function selectDomain(id, focus = false) {
    setDomainId(id);
    if (focus) tabRefs.current[id]?.focus();
  }

  function focusModel(slug) {
    setExpanded(slug);
    rowRefs.current[slug]?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    rowRefs.current[slug]?.querySelector(".iqx-expand")?.focus({ preventScroll: true });
  }

  function reset() {
    setQuery(""); setVendor("all"); setScope("all"); setOnlyReasoning(false);
  }

  return <>
    <div className="tool-hd iqx-heading">
      <div><h1>模型智商榜</h1><p>第三方基准持续对照主流模型的代码、推理与工具调用表现。先看整体差距，再看不同任务中的发挥和近期变化。</p></div>
      <div className="iqx-heading-actions"><a href="#faq">常见问题</a><button type="button" className="ghost-btn" onClick={async () => {
        try { await navigator.clipboard.writeText(location.href); setShareMessage("链接已复制"); } catch { setShareMessage("暂时无法复制，请复制地址栏链接"); }
      }}><Icon name="share" />分享</button><span className="iqx-share-message" role="status">{shareMessage}</span></div>
    </div>
    <div className="iqx-meta"><span><i />{rows.length} 款模型监测中</span><span>较近期下滑 <b className="iqx-negative">{lowered}</b> 款</span><span>来源 aistupidlevel · 每 5 小时同步</span></div>

    <div className="iqx-domains" role="tablist" aria-label="能力领域">{DOMAINS.map((item) => <button key={item.id} ref={(node) => { tabRefs.current[item.id] = node; }} id={`iqx-tab-${item.id}`} type="button" role="tab" aria-selected={domainId === item.id} aria-controls="iqx-rank-panel" tabIndex={domainId === item.id ? 0 : -1} onClick={() => selectDomain(item.id)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = DOMAINS.findIndex((value) => value.id === item.id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? DOMAINS.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + DOMAINS.length) % DOMAINS.length;
      selectDomain(DOMAINS[next].id, true);
    }}><Icon name={item.icon} />{item.label}</button>)}</div>

    <section id="iqx-rank-panel" role="tabpanel" aria-labelledby={`iqx-tab-${domain.id}`} tabIndex={0}>
      <div className="iqx-domain-heading"><div><h2>{domain.label}<span>排行榜</span></h2><p>{domain.description}</p></div>{visible[0] && <span className="iqx-leader"><small>当前领先</small><ModelMark row={visible[0]} /><b>{visible[0].display}</b><strong>{domain.score(visible[0])}</strong></span>}</div>
      <div className="iqx-filters">
        <label className="iqx-search"><Icon name="search" /><input type="search" aria-label="搜索模型或厂商" placeholder="搜索模型或厂商" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <FilterDropdown label="品牌" name="筛选模型品牌" value={vendor} onChange={setVendor} options={[{ value: "all", label: "全部品牌", icon: "layers" }, ...vendors.map((value) => ({ value, label: BRANDS[value]?.label || value, vendor: value }))]} />
        <FilterDropdown label="范围" name="筛选模型范围" value={scope} onChange={setScope} options={[{ value: "all", label: "全部模型", icon: "globe" }, { value: "domestic", label: "国产模型", icon: "layers" }, { value: "overseas", label: "海外模型", icon: "globe" }]} />
        <label className="iqx-checkbox"><input type="checkbox" checked={onlyReasoning} onChange={(event) => setOnlyReasoning(event.target.checked)} />仅推理模型</label>
        <span className="iqx-count" role="status">{visible.length} / {rows.length} 款模型</span>
        {(query || vendor !== "all" || scope !== "all" || onlyReasoning) && <button className="iqx-clear" type="button" onClick={reset}>重置筛选</button>}
      </div>
      <Link to="/tools/codex-resets" className="iqx-reset"><span><Icon name="clock" />Codex 额度上次重置 <b>{latest.label}前</b></span><span>查看记录<Icon name="arrow" /></span></Link>
      {visible.length ? <>
        <section className="iqx-overview" aria-label={`${domain.label}柱状总览`}>
          <div className="iqx-overview-heading"><div><h3>维渡 AI 模型能力指数 <span>{domain.label}</span></h3><p>同一刻度，一眼看清差距。点击柱子，查看分项表现。</p></div><span>{visible.length} 款模型</span></div>
          <div className="iqx-plot"><div className="iqx-yaxis" aria-hidden="true">{[100, 75, 50, 25, 0].map((value) => <span key={value}>{value}</span>)}</div><div className="iqx-plot-scroll"><div className="iqx-columns" style={{ "--iqx-columns": visible.length }}>{visible.map((row) => <button type="button" key={row.slug} className="iqx-column" onClick={() => focusModel(row.slug)} aria-label={`查看 ${row.display} 分项表现，${domain.label} ${domain.score(row)} 分`} style={{ "--iqx-brand": brand(row).color, "--iqx-value": `${domain.score(row)}%` }}><span className="iqx-column-track"><span className="iqx-column-fill"><b>{domain.score(row)}</b></span></span><ModelMark row={row} /><span className="iqx-column-name">{row.display}</span></button>)}</div></div></div>
          <div className="iqx-chart-footer"><div>{[...new Set(visible.map((row) => row.ven))].map((value) => <span key={value}><i style={{ background: BRANDS[value]?.color }} />{BRANDS[value]?.label || value}</span>)}</div><small>0–100 完整刻度 · 分数越高，表现越好</small></div>
        </section>
        <section className="iqx-ranking" aria-label={`${domain.label}完整排行`}>
          <div className="iqx-ranking-heading"><h3>完整排行</h3><span>同分并列 · 排名按当前领域全部模型计算</span></div>
          <div className="iqx-rank-axis" aria-hidden="true"><span>排名 / 模型</span><div>{[0, 25, 50, 75, 100].map((value) => <span key={value}>{value}</span>)}</div><span>得分</span><span>较近期</span><span>30 天趋势</span></div>
          <div className="iqx-rank-list">{visible.map((row) => <article className={`iqx-rank-row${expanded === row.slug ? " is-expanded" : ""}`} key={row.slug} ref={(node) => { rowRefs.current[row.slug] = node; }}>
            <div className="iqx-rank-main">
              <span className={`iqx-position${ranks.get(row.slug) <= 3 ? " is-top" : ""}`}>{String(ranks.get(row.slug)).padStart(2, "0")}</span>
              <Link className="iqx-model" to={`/model/${row.slug}`}><ModelMark row={row} /><span><strong>{row.display}</strong><small>{brand(row).company}</small></span></Link>
              <div className="iqx-meter" role="meter" aria-label={`${row.display} ${domain.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={domain.score(row)}><i style={{ width: `${domain.score(row)}%`, "--iqx-strength": ranks.get(row.slug) === 1 ? 1 : ranks.get(row.slug) <= 3 ? 0.85 : 0.65 }} /></div>
              <strong className="iqx-score">{domain.score(row)}<small>分</small></strong>
              <span className={`iqx-change ${row.bdiff < 0 ? "iqx-negative" : "iqx-positive"}`} title="综合得分较近期常态的变化">{signed(row.bdiff)}<small>综合较近期</small></span>
              <History row={row} />
              <button className="iqx-expand" type="button" aria-expanded={expanded === row.slug} aria-controls={`iqx-detail-${row.slug}`} aria-label={`${expanded === row.slug ? "收起" : "查看"} ${row.display} 分项表现`} onClick={() => setExpanded(expanded === row.slug ? null : row.slug)}><Icon name="down" /></button>
            </div>
            {expanded === row.slug && <Breakdown row={row} />}
          </article>)}</div>
          <p className="iqx-rank-note">分项按各自基准独立排序；较近期和 30 天趋势均对应综合得分。分数用于横向对照与观察变化，请结合实际任务体验。</p>
        </section>
      </> : <div className="iqx-empty"><Icon name="search" /><h3>没有找到匹配的模型</h3><p>试试其他关键词，或重置筛选查看全部模型。</p><button className="ghost-btn" type="button" onClick={reset}>重置筛选</button></div>}
    </section>
    <section className="iqx-highlights"><h2>分项基准榜 <span>信号速览</span></h2><div>{leaders.map(({ domain: item, row }) => row && <button key={item.id} type="button" onClick={() => { selectDomain(item.id); tabRefs.current[item.id]?.focus(); tabRefs.current[item.id]?.scrollIntoView({ block: "center", behavior: "instant" }); }}><span><Icon name={item.icon} />{item.label}领先</span><b><ModelMark row={row} />{row.display}</b><strong>{item.score(row)}<small>分</small></strong></button>)}</div></section>
  </>;
}
