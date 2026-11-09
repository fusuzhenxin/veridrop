import { useEffect, useId, useMemo, useRef, useState } from "react";

export function ModelViewIcon({ name }) {
  const paths = {
    chart: "M4 4v16h16M8 15V9m5 6V5m5 10v-4",
    list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
    tool: "m14 6 4 4M9 15l-5 5-2-2 5-5M9 13l4-4a5 5 0 0 1 6-6l-3 3 2 2 3-3a5 5 0 0 1-6 6l-4 4z",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    down: "m6 9 6 6 6-6",
    check: "m5 12 4 4L19 6",
    search: "M21 21l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  };
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.list} /></svg>;
}

const validPrice = (value) => value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

function GroupPicker({ options, chosen, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const optionRefs = useRef([]);
  const id = useId();
  const text = query.trim().toLowerCase();
  const filtered = options.filter((item) => !text || `${item.station} ${item.group} ${item.usd ? "USD" : "CNY"}`.toLowerCase().includes(text));
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  useEffect(() => {
    if (!open) return undefined;
    search.current?.focus({ preventScroll: true });
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);
  function show() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((item) => item.key === chosen.key)));
    setOpen(true);
  }
  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  function choose(item) { onChange(item.key); close(); }
  return <div className="mb-group-picker" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span className="mb-group-label" id={`${id}-label`}>站点 / 分组</span>
    <button ref={trigger} type="button" className="mb-group-trigger" aria-label={`站点 / 分组：${chosen.station} · ${chosen.group} · ${chosen.usd ? "USD" : "CNY"}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} onClick={() => open ? setOpen(false) : show()} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
    }}><span><strong>{chosen.station}</strong><small>{chosen.group}</small></span><em>{chosen.usd ? "USD" : "CNY"}</em><ModelViewIcon name="down" /></button>
    {open ? <div className="mb-group-menu" id={`${id}-menu`} role="dialog" aria-label="选择站点与分组" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="mb-group-search"><ModelViewIcon name="search" /><input ref={search} role="combobox" aria-label="搜索站点或分组" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={filtered.length ? `${id}-option-${activeIndex}` : undefined} placeholder="搜索站点、分组或币种" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(filtered.length ? (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length : 0); }
        else if ((event.key === "Home" || event.key === "End") && event.ctrlKey) { event.preventDefault(); setActive(event.key === "Home" ? 0 : Math.max(0, filtered.length - 1)); }
        else if (event.key === "Enter") { event.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex]); }
      }} /></div>
      <div className="mb-group-options" role="listbox" id={`${id}-list`} aria-labelledby={`${id}-label`}>{filtered.map((item, index) => <button type="button" role="option" tabIndex={-1} ref={(node) => { optionRefs.current[index] = node; }} id={`${id}-option-${index}`} key={item.key} aria-selected={chosen.key === item.key} className={index === activeIndex ? "is-active" : ""} onClick={() => choose(item)}><span><strong>{item.station}</strong><small>{item.group}</small></span><em>{item.usd ? "USD" : "CNY"}</em><span className="mb-group-check">{chosen.key === item.key ? <ModelViewIcon name="check" /> : null}</span></button>)}</div>
      {filtered.length ? <div className="mb-group-menu-foot">{filtered.length} 个分组 <span>↑ ↓ 选择 · Enter 确认</span></div> : <p className="mb-group-empty" role="status">没有匹配的站点或分组</p>}
    </div> : null}
  </div>;
}

export function ModelAccessGuide({ slug, name, rows }) {
  const options = useMemo(() => rows.flatMap((row) => [row.main, ...(row.others || [])].flatMap((group, index) => group && validPrice(group.in) && validPrice(group.out) ? [{ key: `${row.slug}-${index}`, station: row.name, group: group.name, input: Number(group.in), output: Number(group.out), usd: row.usd }] : [])), [rows]);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("1000000");
  const [output, setOutput] = useState("100000");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const chosen = options.find((item) => item.key === selected) || options[0];
  const tokensValid = input !== "" && output !== "" && Number.isFinite(Number(input)) && Number.isFinite(Number(output)) && Number(input) >= 0 && Number(output) >= 0 && Number(input) <= 1000000000 && Number(output) <= 1000000000;
  const format = (value) => `${chosen?.usd ? "$" : "¥"}${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const inputCost = chosen && tokensValid ? Number(input) * chosen.input / 1000000 : null;
  const outputCost = chosen && tokensValid ? Number(output) * chosen.output / 1000000 : null;
  const config = `model: ${slug}\nbase_url: YOUR_PROVIDER_BASE_URL\napi_key: YOUR_API_KEY`;
  async function copyConfig() {
    setCopyError("");
    try { await navigator.clipboard.writeText(config); setCopied(true); }
    catch { setCopyError("复制失败，请手动选择并复制上方配置。"); }
  }
  return <div className="mb-guide-layout">
    <div className="mb-guide-steps">
      <h2>接入 {name}</h2>
      <ol>
        <li><b>选择站点与分组</b><p>对照分组报价，确认该分组支持的模型、计费币种和接口格式。</p></li>
        <li><b>填写接口与密钥</b><p>从服务商控制台获取 Base URL 和 API Key。下方配置适用于支持这些字段的客户端，接口路径以服务商文档为准。</p></li>
        <li><b>确认模型名称并小额测试</b><p>目录模型 ID 为 <code>{slug}</code>。部分分组使用别名，请以该站模型列表为准；先发送少量请求，确认响应和账单。</p></li>
      </ol>
      <div className="mb-guide-config"><span>客户端配置参考</span><button type="button" onClick={copyConfig}><ModelViewIcon name="copy" />{copied ? "已复制" : "复制配置"}</button><pre>{config}</pre></div>
      {copyError ? <p role="status">{copyError}</p> : null}
    </div>
    <div className="mb-guide-cost">
      <h2>费用估算 <small>按公开分组单价计算</small></h2>
      {chosen ? <>
        <GroupPicker options={options} chosen={chosen} onChange={setSelected} />
        <div className="mb-guide-token-inputs"><label>输入 tokens<input type="number" min="0" max="1000000000" step="1" value={input} onChange={(event) => setInput(event.target.value)} /></label><label>输出 tokens<input type="number" min="0" max="1000000000" step="1" value={output} onChange={(event) => setOutput(event.target.value)} /></label></div>
        <p className="mb-guide-unit-price">每百万 tokens：输入 {format(chosen.input)} / 输出 {format(chosen.output)}</p>
        <div className="mb-guide-total" aria-live="polite"><span>预计费用</span><strong>{tokensValid ? format(inputCost + outputCost) : "—"}</strong><small>{tokensValid ? `输入 ${format(inputCost)} + 输出 ${format(outputCost)}` : "请输入 0–1,000,000,000 之间的 token 数量"}</small></div>
        <p className="mb-guide-footnote">按未缓存输入与输出估算；缓存命中、折扣、额外计费和充值汇率未计入，实际费用以服务商账单为准。</p>
      </> : <p className="mb-guide-footnote">当前站点列表暂无完整的输入与输出价格，暂不能估算费用。可回到分组报价查看，或前往服务商了解计费方式。</p>}
    </div>
  </div>;
}
