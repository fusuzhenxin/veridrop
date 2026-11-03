import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useOfficialStatus } from "./official-store.js";
import { allReportFor, latestAllReport, recoverAllDetail, subscribeCheckJob } from "./basic-run.jsx";
import { Tester } from "./pages.jsx";
import { applyRemoteAccount } from "./account.js";
import { authToken, saveSubmission } from "./community.js";
import { useTitle } from "./ui.jsx";
import { CATS, CHECK_PAGES, OFFICIAL_SEO } from "./verd-meta.js";

const OFFICIAL_ORDER = ["openai", "anthropic", "gemini", "deepseek", "moonshot", "xai"];
const MODEL_HINT = {
  openai: "GPT / ChatGPT",
  anthropic: "Claude",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  moonshot: "Kimi",
  xai: "Grok",
};

function officialRate(board) {
  const values = (board.components || []).map((part) => Number(part.uptime)).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function officialTone(board) {
  if (board.level === "unknown") return "unknown";
  if (board.level === "minor") return "warn";
  if (board.level === "major" || board.online === false) return "bad";
  if (board.online) return "on";
  return "bad";
}

function officialShort(board) {
  if (board.level === "unknown") return "未知";
  if (board.level === "minor") return "降级";
  if (board.level === "major") return "故障";
  if (board.online) return "正常";
  return "异常";
}

function partTone(status) {
  if (status === "operational") return "on";
  if (status === "degraded_performance" || status === "under_maintenance") return "warn";
  if (status === "unknown") return "unknown";
  return "bad";
}

function monthSpan(components) {
  const dates = (components || []).flatMap((part) => (part.days || []).map((day) => day.date)).filter(Boolean).sort();
  if (!dates.length) return "";
  const start = new Date(`${dates[0]}T00:00:00Z`);
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  return `${start.getUTCFullYear()}年${start.getUTCMonth() + 1}月 – ${end.getUTCFullYear()}年${end.getUTCMonth() + 1}月`;
}

function incidentWhen(value) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value || "";
  return time.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const CHECK_KINDS = new Set(["", "detect", "basic", "candy", "pelican"]);
const CHECK_NAV = [
  ["", "检测首页"],
  ["detect", "检测结果"],
  ["basic", "基础测试"],
  ["candy", "糖果测试"],
  ["pelican", "鹈鹕骑车"],
];

const CHECK_PARK = "check-park";

function scopeSelector(selector, scope) {
  const raw = String(selector || "").trim();
  if (!raw || raw.startsWith("@")) return raw;
  return raw.split(",").map((part) => {
    let sel = part.trim();
    if (!sel) return sel;
    sel = sel.replace(/html\.check-embed\s+body(?:\.mc-page)?/g, `${scope}.mc-page`).replace(/html\.check-embed/g, scope).replace(/:root/g, scope);
    if (sel === "html" || sel === "body") return scope;
    if (sel.startsWith("html[") || sel.startsWith("html.") || sel.startsWith("html ") || sel.startsWith("html:") || sel.startsWith("html#")) {
      return scope + sel.slice(4);
    }
    if (sel.startsWith("body")) return scope + sel.slice(4);
    if (sel.includes(scope)) return sel;
    return `${scope} ${sel}`;
  }).join(",");
}

function scopeCss(css, scope) {
  const source = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "";
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open < 0) break;
    const selector = source.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < source.length && depth) {
      if (source[cursor] === "{") depth += 1;
      else if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const body = source.slice(open + 1, cursor - 1);
    if (selector.startsWith("@media") || selector.startsWith("@supports")) out += `${selector}{${scopeCss(body, scope)}}`;
    else if (selector.startsWith("@")) out += `${selector}{${body}}`;
    else if (selector) out += `${scopeSelector(selector, scope)}{${body}}`;
    index = cursor;
  }
  return out;
}

function checkPark() {
  let node = document.getElementById(CHECK_PARK);
  if (!node) {
    node = document.createElement("div");
    node.id = CHECK_PARK;
    node.hidden = true;
    document.body.appendChild(node);
  }
  return node;
}

function moveChildren(from, to) {
  while (from.firstChild) to.appendChild(from.firstChild);
}

let checkAssets = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(src));
    document.body.appendChild(script);
  });
}

function ensureCheckAssets() {
  if (checkAssets) return checkAssets;
  checkAssets = (async () => {
    const [html, style, embed] = await Promise.all([
      fetch("/original-check/check.html").then((response) => response.text()),
      fetch("/original-check/style.css").then((response) => response.text()),
      fetch("/original-check/embed.css").then((response) => response.text()),
    ]);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const holder = document.createElement("div");
    holder.className = "check-host mc-page";
    [...parsed.body.childNodes].forEach((node) => {
      if (node.nodeType === 1 && (node.classList.contains("topbar") || node.tagName === "SCRIPT")) return;
      holder.appendChild(node);
    });
    const styleNode = document.createElement("style");
    styleNode.setAttribute("data-check-style", "1");
    styleNode.textContent = `${scopeCss(`${style}\n${embed}`, ".check-host")}
.check-host.mc-page,.check-host{
  background:var(--bg);
  color:var(--fg);
  min-height:calc(100vh - var(--nav-h, 78px));
}
.check-host .cd-opt{
  background:var(--chip);
  border-color:var(--line);
  color:var(--fg);
}
.check-host .cd-opt b,.check-host .cd-opt span{ color:var(--fg); }`;
    holder.prepend(styleNode);
    checkPark().appendChild(holder);
    await loadScript("/original-check/check-grade.js");
    await loadScript("/original-check/check.js?v=20261102c");
    const extra = [...parsed.querySelectorAll("body script:not([src])")].map((node) => node.textContent || "").join("\n");
    if (extra.trim()) {
      const inline = document.createElement("script");
      inline.textContent = extra;
      document.body.appendChild(inline);
    }
    return holder;
  })();
  return checkAssets;
}

function emitCheck(data) {
  window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin }));
}

function CheckNav({ current }) {
  return (
    <nav className="check-nav" aria-label="模型检测">
      {CHECK_NAV.map(([id, label]) => (
        <Link key={id || "home"} to={id ? `/check/${id}` : "/check"} className={current === id ? "on" : ""} aria-current={current === id ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function OfficialPage() {
  const { provider } = useParams();
  const snap = useOfficialStatus();
  const meta = OFFICIAL_SEO[provider] || {
    h1: "官方状态",
    title: "上游官方状态对照｜模型是否降级或中断",
    desc: "上游官方状态对照。本站不跳转官方后台，也不代表第三方中转站本身可用。",
  };
  const board = snap.boards.find((item) => item.provider === provider) || null;
  const boards = OFFICIAL_ORDER.map((id) => snap.boards.find((item) => item.provider === id)).filter(Boolean);
  useTitle(meta.title);
  if (!board) {
    return (
      <div className="wrap off-page">
        <p className="crumb"><Link to="/">首页</Link> / 官方状态</p>
        <h1>{meta.h1}</h1>
        <p>这份快照里没有该上游的状态记录。地址仍然保留，避免原来的收录页失效。</p>
        <p><Link to="/list">返回中转站排行</Link></p>
      </div>
    );
  }
  const rate = officialRate(board);
  const tone = officialTone(board);
  const hint = MODEL_HINT[board.provider] || board.label;
  const span = monthSpan(board.components);
  return (
    <div className="wrap off-page">
      <p className="crumb"><Link to="/">首页</Link> / {board.label} 官方状态</p>
      <section className="off-hero">
        <h1>{board.label} 官方状态 · 模型实况</h1>
        <p>{board.status || "状态未知"}{rate != null ? ` · 近 90 天可用率 ${rate.toFixed(2)}%` : ""}</p>
      </section>
      <p className="off-lead">{meta.desc} 上游异常时，多数{hint}中转也会一起抖。</p>
      <div className="off-tabs">
        {boards.map((item) => {
          const itemTone = officialTone(item);
          const itemRate = officialRate(item);
          const active = item.provider === board.provider;
          return (
            <Link key={item.provider} className={`off-chip ${itemTone}${active ? " active" : ""}`} to={`/official/${item.provider}`}>
              <i className={`dot ${itemTone}`} />
              <span>{item.label}</span>
              <strong>{itemRate == null ? "—" : `${itemRate.toFixed(2)}%`}</strong>
              <small>{officialShort(item)}</small>
            </Link>
          );
        })}
      </div>
      <article className="off-board">
        <div className={`off-banner ${tone}`}>
          <span className={`svc-check ${tone}`}>{tone === "on" ? "✓" : "!"}</span>
          <div>
            <strong>{board.status || "状态未知"}</strong>
            {board.sub ? <p>{board.sub}</p> : null}
          </div>
        </div>
        <div className="svc-head">
          <h2>系统状态</h2>
          {span ? <span>{span}</span> : null}
        </div>
        <ul className="svc-list">
          {(board.components || []).map((part) => {
            const partState = partTone(part.status);
            return (
              <li className="svc-row" key={part.name}>
                <span className={`svc-check ${partState}`}>{part.status === "operational" ? "✓" : "!"}</span>
                <span className="svc-name">{part.name || "组件"}</span>
                <span className="uptime-bar">
                  {(part.days || []).map((day, index) => (
                    <i key={`${day.date}-${index}`} className={day.level === "ok" ? "u" : `u ${day.level}`} title={day.date} />
                  ))}
                </span>
                <em className={partState}>
                  {part.uptime == null ? "未知" : `${Number(part.uptime).toFixed(2)}% 可用性`}
                </em>
              </li>
            );
          })}
        </ul>
        <h2>近期事件</h2>
        <ul className="event-list">
          {board.incidents?.length ? board.incidents.map((item) => (
            <li key={item.title + item.date}>
              <span className={item.status === "进行中" ? "off-badge bad" : "off-badge ok"}>{item.status || "事件"}</span>
              <div>
                <b>{item.title}</b>
                <p>{[incidentWhen(item.date), item.desc].filter(Boolean).join(" · ")}</p>
              </div>
            </li>
          )) : <li>近期没有公开事件</li>}
        </ul>
      </article>
      <section className="off-faq">
        <h2>常见问题</h2>
        <p><b>{board.label} 官方异常，中转站还能用吗？</b>上游降级或故障时，很多第三方 {hint} 中转会一起受影响。建议先看本页，再决定要不要充值。</p>
        <p><b>本站会链到官方状态站吗？</b>不会。本页只在站内对照公开状态，方便和目录里的 API 中转站一起看。</p>
      </section>
    </div>
  );
}

export function CheckPage() {
  const { kind = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const safe = CHECK_KINDS.has(kind) ? kind : "";
  const replay = search.get("replay") || "";
  const replayId = (safe === "candy" || safe === "pelican") && new RegExp(`^${safe}-[a-z0-9]{4,24}$`, "i").test(replay) ? replay : "";
  const runQuery = search.get("run") || "";
  const runId = safe === "detect" && /^all-[a-z0-9]{4,24}$/i.test(runQuery) ? runQuery : "";
  const page = CHECK_PAGES[safe] || CHECK_PAGES[""];
  const host = useRef(null);
  useTitle(page.title, { exact: true });
  useEffect(() => {
    function onView(event) {
      const view = event.detail === "home" ? "" : String(event.detail || "");
      if (!CHECK_KINDS.has(view)) return;
      const next = view ? `/check/${view}` : "/check";
      if (window.location.pathname !== next) navigate(next, { preventScrollReset: true });
    }
    window.addEventListener("veridrop-inline-view", onView);
    return () => window.removeEventListener("veridrop-inline-view", onView);
  }, [navigate]);
  useEffect(() => {
    if (safe === "basic") return undefined;
    const node = host.current;
    if (!node) return undefined;
    let dead = false;
    ensureCheckAssets().then((holder) => {
      if (dead || !holder || !node) return;
      holder.dataset.theme = document.documentElement.dataset.theme || "light";
      if (holder.parentElement !== node) node.appendChild(holder);
      emitCheck({ type: "veridrop-check-show", view: safe || "home" });
      if (replayId) emitCheck({ type: "veridrop-replay", id: replayId });
    }).catch(() => {});
    const theme = new MutationObserver(() => {
      const holder = node.querySelector(".check-host");
      if (holder) holder.dataset.theme = document.documentElement.dataset.theme || "light";
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      dead = true;
      const holder = node.querySelector(".check-host");
      if (holder) checkPark().appendChild(holder);
      theme.disconnect();
    };
  }, [safe, replayId]);
  useEffect(() => {
    if (safe !== "detect") return undefined;
    function push() {
      if (!document.querySelector("main .check-host")) return;
      recoverAllDetail();
      const report = runId ? allReportFor(runId) : latestAllReport();
      const missing = Boolean(runId && !report);
      emitCheck({
        type: "veridrop-all-report",
        report: report ? { ...report, pelicanHtml: "" } : null,
        missing,
      });
      if (report?.pelicanHtml) emitCheck({ type: "veridrop-all-html", id: report.id, html: report.pelicanHtml });
    }
    const stop = subscribeCheckJob(push);
    const first = window.setTimeout(push, 0);
    const later = window.setTimeout(push, 700);
    return () => {
      stop();
      window.clearTimeout(first);
      window.clearTimeout(later);
    };
  }, [safe, runId]);
  if (safe === "basic") {
    return (
      <div className="wrap check-basic">
        <CheckNav current="basic" />
        <h1>基础测试</h1>
        <p className="sub">做 API中转检测，看 OpenAI兼容、Claude中转、GPT中转和 DeepSeek API 是否按协议返回。不支持就跳过，不直接当成 GPT 降智或中转站降智。</p>
        <Tester extended />
      </div>
    );
  }
  return <div ref={host} className="check-page" />;
}

const APPLY_CATS = CATS.filter(([id]) => !["owner", "online", "fast", "highup"].includes(id)).map(([, label]) => label);
const APPLY_PAYS = ["支付宝", "微信", "USDT", "银行卡", "对公转账", "PayPal"];
const SOCIALS = ["Twitter", "Telegram", "GitHub", "Discord", "QQ", "微博", "其他"];

function makeProbePass() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => alphabet[n % alphabet.length]).join("");
}

export function ApplyPage() {
  useTitle("申请收录｜提交中转站公开信息，不要填写 API Key");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState([{ kind: "Twitter", url: "" }]);
  const [socialOpen, setSocialOpen] = useState(-1);
  const [probePass, setProbePass] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const url = String(form.get("url") || "").trim();
    const cats = form.getAll("cat").map(String);
    const pays = form.getAll("pay").map(String);
    if (!cats.length || !pays.length) {
      setError("请至少选一个分类和一种支付方式");
      setSent(false);
      return;
    }
    const socials = links
      .map((item) => ({ kind: item.kind, url: item.url.trim() }))
      .filter((item) => item.url);
    const probeUser = String(form.get("probeUser") || "").trim();
    const lines = [
      "申请收录",
      `站点名称：${name}`,
      `站点 URL：${url}`,
      `分类：${cats.join("、")}`,
      `网站介绍：${form.get("about") || ""}`,
      `社交链接：${socials.map((item) => `${item.kind} ${item.url}`).join("；")}`,
      `支付方式：${pays.join("、")}`,
      `发票：${form.get("invoice") || ""}`,
      `退款政策：${form.get("refund") || ""}`,
      `优惠码：${form.get("coupon") || ""}`,
      `探测账户：${probeUser}`,
      `探测账户密码：${probePass}`,
      `备注：${form.get("remark") || ""}`,
      `联系方式：${form.get("contact") || ""}`,
    ];
    if (!authToken()) {
      setError("请先登录，提交才会记到账户里");
      window.dispatchEvent(new Event("okk-open-auth"));
      return;
    }
    try {
      applyRemoteAccount(await saveSubmission({
        name,
        url,
        note: [cats.join("、"), pays.join("、"), `发票${form.get("invoice") || ""}`, `退款${form.get("refund") || ""}`, String(form.get("contact") || "").trim()].filter(Boolean).join(" · "),
        letter: lines.join("\n"),
      }));
    } catch (err) {
      setError(err.message || "没有记下");
      return;
    }
    setError("");
    setSent(true);
  }
  return (
    <div className="wrap apply-page">
      <aside className="apply-side">
        <h1>申请<em>收录</em></h1>
        <p>填写站点的公开信息。收录前会打开你填的网址核对。本站只做导航，不代收充值，也不保证一定收录。</p>
        <p>不要填写 API Key。探测账户可以留空；如果填了，密码只写进这封邮件，不会记到账户里的提交列表。</p>
      </aside>
      <form className="apply-form" onSubmit={submit}>
        <h2>站点信息</h2>
        <div className="apply-grid">
          <div className="field">
            <label>站点名称 <i className="req">*</i></label>
            <input required name="name" maxLength={40} placeholder="例:OpenRouter" />
          </div>
          <div className="field">
            <label>站点 URL <i className="req">*</i></label>
            <input required type="url" name="url" placeholder="https://example.com" />
          </div>
          <div className="field apply-span">
            <label>分类 <i className="req">*</i></label>
            <div className="choice-row">
              {APPLY_CATS.map((label) => (
                <label key={label}><input type="checkbox" name="cat" value={label} /> {label}</label>
              ))}
            </div>
          </div>
          <div className="field apply-span">
            <label>网站介绍 <span className="opt">选填</span></label>
            <textarea name="about" rows={4} placeholder="请介绍站点定位、主要优势、服务特点、价格/稳定性/售后等信息。" />
          </div>
          <div className="field apply-span">
            <label>社交链接 <span className="opt">选填</span></label>
            {links.map((item, index) => (
              <div className="social-row" key={index}>
                <div className={`soc-pick${socialOpen === index ? " open" : ""}`}>
                  <button type="button" className="soc-btn" aria-expanded={socialOpen === index} onClick={() => setSocialOpen(socialOpen === index ? -1 : index)}>
                    <span>{item.kind}</span>
                    <svg className={socialOpen === index ? "open" : ""} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {socialOpen === index ? (
                    <>
                      <div className="fback" onClick={() => setSocialOpen(-1)} />
                      <div className="fpop soc-pop" role="listbox">
                        {SOCIALS.map((kind) => (
                          <button
                            type="button"
                            key={kind}
                            role="option"
                            aria-selected={kind === item.kind}
                            className={kind === item.kind ? "on" : ""}
                            onClick={() => {
                              setLinks((rows) => rows.map((row, i) => (i === index ? { ...row, kind } : row)));
                              setSocialOpen(-1);
                            }}
                          >
                            {kind}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
                <input value={item.url} placeholder="https://" onChange={(event) => setLinks((rows) => rows.map((row, i) => (i === index ? { ...row, url: event.target.value } : row)))} />
              </div>
            ))}
            <button className="apply-add" type="button" onClick={() => setLinks((rows) => [...rows, { kind: "Twitter", url: "" }])}>+ 添加一条</button>
          </div>
        </div>

        <h2>支付与政策</h2>
        <div className="field">
          <label>支付方式 <i className="req">*</i></label>
          <div className="choice-row">
            {APPLY_PAYS.map((label) => (
              <label key={label}><input type="checkbox" name="pay" value={label} /> {label}</label>
            ))}
          </div>
        </div>
        <div className="apply-split">
          <div className="field">
            <label>发票 <i className="req">*</i></label>
            <div className="choice-row">
              {["支持", "不支持", "其他"].map((label) => (
                <label key={label}><input type="radio" name="invoice" value={label} required /> {label}</label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>退款政策 <i className="req">*</i></label>
            <div className="choice-row">
              {["支持", "不支持", "其他"].map((label) => (
                <label key={label}><input type="radio" name="refund" value={label} required /> {label}</label>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <label>专属优惠码 <span className="opt">选填</span></label>
          <input name="coupon" placeholder="例:VERIDROP，新用户注册 9 折" />
        </div>

        <h2>探测账户 <span className="opt">选填</span></h2>
        <p className="apply-note">这个账户用来代为调用你填写的模型，核对接口是否在线、能否正常返回。建议余额留 100 元以上，并保证这个账户可以登录。</p>
        <div className="apply-grid">
          <div className="field">
            <label>探测账户</label>
            <input name="probeUser" autoComplete="off" placeholder="账户名" />
          </div>
          <div className="field">
            <div className="pass-line"><label>探测账户密码</label><button type="button" onClick={() => setProbePass(makeProbePass())}>生成密码</button></div>
            <input name="probePass" type="text" autoComplete="off" value={probePass} onChange={(event) => setProbePass(event.target.value)} placeholder="探测账户密码" />
          </div>
        </div>
        <div className="field">
          <label>备注 <span className="opt">选填</span></label>
          <textarea name="remark" rows={3} placeholder="补充审核需要知道的信息，可留空。" />
        </div>
        <div className="field">
          <label>联系方式 <i className="req">*</i></label>
          <input required name="contact" placeholder="微信 / QQ号 / 手机号 / Telegram 等" />
        </div>
        {error ? <div className="toast" style={{ color: "var(--red)" }}>{error}</div> : null}
        {sent ? <div className="toast">申请已发到邮箱，并记在这个账户里。</div> : null}
        <div className="apply-submit"><button className="go" type="submit">提交申请</button></div>
      </form>
    </div>
  );
}
