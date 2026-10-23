import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOfficialStatus } from "./official-store.js";
import { Tester } from "./pages.jsx";
import { useTitle } from "./ui.jsx";
import { CHECK_PAGES, OFFICIAL_SEO } from "./verd-meta.js";

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
    title: "官方状态",
    desc: "上游官方状态对照。本站不跳转官方后台。",
  };
  const board = snap.boards.find((item) => item.provider === provider) || null;
  const boards = OFFICIAL_ORDER.map((id) => snap.boards.find((item) => item.provider === id)).filter(Boolean);
  useTitle(meta.h1);
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
  const navigate = useNavigate();
  const safe = CHECK_KINDS.has(kind) ? kind : "";
  const page = CHECK_PAGES[safe] || CHECK_PAGES[""];
  const frame = useRef(null);
  const frameSrc = useRef(null);
  if (safe === "basic") frameSrc.current = null;
  else if (!frameSrc.current) frameSrc.current = `/original-check/check.html?view=${safe || "home"}`;
  useTitle(page.title, { exact: true });
  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || !data.type) return;
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
    if (!node?.contentWindow) return undefined;
    node.contentWindow.postMessage({ type: "veridrop-check-show", view: safe || "home" }, window.location.origin);
    return undefined;
  }, [safe]);
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
    node.addEventListener("load", watch);
    const timer = window.setInterval(fit, 1000);
    return () => {
      node.removeEventListener("load", watch);
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, [safe]);
  if (safe === "basic") {
    return (
      <div className="wrap check-basic">
        <CheckNav current="basic" />
        <h1>基础测试</h1>
        <p className="sub">检测 OpenAI 兼容和 Claude Messages 是否按协议返回。不支持的项会跳过，不直接当成 GPT 降智。</p>
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

export function ApplyPage() {
  useTitle("申请收录");
  const [sent, setSent] = useState(false);
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = [
      "申请收录",
      `站点名称：${form.get("name") || ""}`,
      `称呼：${form.get("applicant") || ""}`,
      `网站地址：${form.get("url") || ""}`,
      `接口地址：${form.get("api") || ""}`,
      `类型：${form.get("kind") || ""}`,
      `模型：${form.getAll("models").join("、")}`,
      `简介：${form.get("about") || ""}`,
    ];
    const mail = `mailto:2201219073@qq.com?subject=${encodeURIComponent("申请收录")}&body=${encodeURIComponent(lines.join("\n"))}`;
    window.location.href = mail;
    setSent(true);
  }
  return (
    <form className="wrap form-page" onSubmit={submit}>
      <h1>申请收录</h1>
      <p className="sub">填写站点的公开信息。收录前会打开你填的网址核对。本站只做导航，不代收充值，也不保证一定收录。不要填写 API Key 或密码。</p>
      <div className="field"><label>站点名称</label><input required name="name" maxLength={40} /></div>
      <div className="field"><label>你的称呼</label><input name="applicant" maxLength={40} /></div>
      <div className="field"><label>网站地址</label><input required type="url" name="url" placeholder="https://" /></div>
      <div className="field"><label>接口地址，没有就留空</label><input type="url" name="api" placeholder="https://" /></div>
      <div className="field">
        <label>站点类型</label>
        <label><input type="radio" name="kind" value="付费中转" defaultChecked /> 付费中转</label>
        {" "}
        <label><input type="radio" name="kind" value="公益站" /> 公益站</label>
      </div>
      <div className="field">
        <label>支持的模型</label>
        {["GPT", "Claude", "Gemini", "Grok", "DeepSeek", "Kimi", "Qwen", "GLM", "生图", "视频"].map((label) => (
          <label key={label} style={{ marginRight: 12 }}>
            <input type="checkbox" name="models" value={label} /> {label}
          </label>
        ))}
      </div>
      <div className="field"><label>简介</label><textarea name="about" rows={4} placeholder="门槛、价格、支付方式。不要写 Key。" /></div>
      <button className="go" type="submit">发到站长邮箱</button>
      {sent ? <div className="toast">已打开邮件。如果没有弹出，请直接发到 2201219073@qq.com，QQ 2201219073。</div> : null}
    </form>
  );
}
