import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useOfficialStatus } from "./official-store.js";
import { allReportFor, keepRecoveredDetail, latestAllReport, recoverAllDetail, stopCheckJob, subscribeCheckJob } from "./basic-run.jsx";
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
  const frame = useRef(null);
  const frameSrc = useRef(null);
  const frameRev = "20261027y";
  if (safe === "basic") frameSrc.current = null;
  else if (!frameSrc.current || !String(frameSrc.current).includes(`rev=${frameRev}`)) {
    frameSrc.current = `/original-check/check.html?view=${safe || "home"}&rev=${frameRev}`;
  }
  useTitle(page.title, { exact: true });
  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || !data.type) return;
      if (data.type === "veridrop-all-stop") {
        if (!frame.current || event.source !== frame.current.contentWindow) return;
        stopCheckJob("all");
        return;
      }
      if (data.type === "veridrop-all-recovered") {
        if (!frame.current || event.source !== frame.current.contentWindow) return;
        keepRecoveredDetail(data);
        return;
      }
      if (data.type === "veridrop-check-view") {
        if (!frame.current || event.source !== frame.current.contentWindow) return;
        const view = data.view === "home" ? "" : String(data.view || "");
        if (!CHECK_KINDS.has(view)) return;
        const next = view ? `/check/${view}` : "/check";
        if (window.location.pathname !== next) navigate(next, { preventScrollReset: true });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);
  useEffect(() => {
    if (safe === "basic") return undefined;
    const node = frame.current;
    if (!node) return undefined;
    function send() {
      const win = node.contentWindow;
      if (!win) return;
      win.postMessage({ type: "veridrop-check-show", view: safe || "home" }, window.location.origin);
      if (replayId) win.postMessage({ type: "veridrop-replay", id: replayId }, window.location.origin);
    }
    node.addEventListener("load", send);
    if (node.contentDocument?.readyState === "complete") send();
    return () => node.removeEventListener("load", send);
  }, [safe, replayId]);
  useEffect(() => {
    if (safe !== "detect") return undefined;
    const node = frame.current;
    if (!node) return undefined;
    function postReport(win, report, missing) {
      try {
        win.postMessage({
          type: "veridrop-all-report",
          report: report || null,
          missing,
        }, window.location.origin);
        return;
      } catch {
        /* the pelican page can be too large for one message */
      }
      if (!report) return;
      try {
        win.postMessage({
          type: "veridrop-all-report",
          report: { ...report, pelicanHtml: "" },
          missing,
        }, window.location.origin);
      } catch {
        return;
      }
      if (!report.pelicanHtml) return;
      try {
        win.postMessage({
          type: "veridrop-all-html",
          id: report.id,
          html: report.pelicanHtml,
        }, window.location.origin);
      } catch {
        /* the questions still paint */
      }
    }
    function push() {
      const win = node.contentWindow;
      if (!win) return;
      let href = "";
      try {
        href = String(win.location.href || "");
      } catch {
        return;
      }
      if (!href.includes("original-check")) return;
      recoverAllDetail();
      const report = runId ? allReportFor(runId) : latestAllReport();
      postReport(win, report, Boolean(runId && !report));
    }
    function onReady(event) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "veridrop-all-ready") return;
      if (event.source !== node.contentWindow) return;
      push();
    }
    const stop = subscribeCheckJob(push);
    window.addEventListener("message", onReady);
    node.addEventListener("load", push);
    push();
    return () => {
      stop();
      window.removeEventListener("message", onReady);
      node.removeEventListener("load", push);
    };
  }, [safe, runId]);
  useEffect(() => {
    if (safe === "basic") return undefined;
    const node = frame.current;
    if (!node) return undefined;
    let observer;
    function fit() {
      const doc = node.contentDocument;
      if (!doc) return;
      const height = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0, 720);
      if (Math.abs(height - node.offsetHeight) > 2) node.style.height = `${height}px`;
    }
    function watch() {
      fit();
      observer?.disconnect();
      const root = node.contentDocument?.documentElement;
      if (!root) return;
      observer = new ResizeObserver(fit);
      observer.observe(root);
    }
    function onFit(event) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "veridrop-frame-fit") return;
      if (event.source !== node.contentWindow) return;
      fit();
    }
    node.addEventListener("load", watch);
    window.addEventListener("message", onFit);
    const timer = window.setInterval(fit, 1000);
    return () => {
      node.removeEventListener("load", watch);
      window.removeEventListener("message", onFit);
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, [safe]);
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
  return (
    <iframe
      ref={frame}
      className="check-frame"
      title={page.title}
      src={frameSrc.current || `/original-check/check.html?view=${safe || "home"}`}
    />
  );
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
      }));
    } catch (err) {
      setError(err.message || "没有记下");
      return;
    }
    const mail = `mailto:2201219073@qq.com?subject=${encodeURIComponent("申请收录")}&body=${encodeURIComponent(lines.join("\n"))}`;
    window.location.href = mail;
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
        {sent ? <div className="toast">已记到这个账户，并尝试打开邮件。如果没有弹出，请直接发到 2201219073@qq.com，QQ 2201219073。</div> : null}
        <div className="apply-submit"><button className="go" type="submit">提交申请</button></div>
      </form>
    </div>
  );
}
