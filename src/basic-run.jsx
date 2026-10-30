import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { grant } from "./points.js";
import { renderBasicPoster } from "./poster-canvas.js";
import { useTitle } from "./ui.jsx";
import publishedBasic from "./published-basic.json";

const ACTIVE_KEY = "veridrop-basic-active";
const REPORT_PREFIX = "veridrop-basic-report:";
const HISTORY_KEY = "veridrop-basic-history";
const ACTIVE_MS = 3 * 60 * 60 * 1000;
const SUITE_LIMIT_MS = {
  basic: 20 * 60 * 1000,
  candy: 8 * 60 * 1000 + 25 * 1000,
  pelican: 3 * 60 * 1000 + 25 * 1000,
  all: 32 * 60 * 1000,
};
const SUITES = new Set(["basic", "candy", "pelican", "all"]);
export const JOB_EVENT = "veridrop-job";
const BASIC_ITEMS = [
  ["proto", "协议识别"],
  ["structure", "响应结构"],
  ["modelecho", "模型回显"],
  ["consistent", "模型一致性"],
  ["stream", "流式响应"],
  ["control", "输出控制"],
  ["memory", "上下文记忆"],
  ["system", "系统指令"],
  ["tools", "工具调用"],
  ["vision", "多模态"],
  ["reasoning", "推理参数"],
  ["usage", "用量审计"],
  ["replay", "缓存与重放"],
  ["context", "长上下文真实性"],
];
const BASIC_IDS = new Set(BASIC_ITEMS.map(([id]) => id));

function reportKey(id) {
  return `${REPORT_PREFIX}${id}`;
}

function suiteOf(id, explicit) {
  if (SUITES.has(explicit)) return explicit;
  const prefix = String(id || "").split("-")[0];
  return SUITES.has(prefix) ? prefix : "basic";
}

function acceptedId(id) {
  return typeof id === "string" && SUITES.has(id.split("-")[0]);
}

function readSessionRaw() {
  try {
    const job = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
    if (!job || !acceptedId(job.id) || !job.base || !job.key || !job.modelId) return null;
    if (typeof job.at !== "number") return null;
    return job;
  } catch {
    return null;
  }
}

function readActiveJob() {
  const job = readSessionRaw();
  if (!job || Date.now() - job.at > ACTIVE_MS) return null;
  return job;
}

function readActive(id) {
  const job = readActiveJob();
  if (!job || job.id !== id) return null;
  return job;
}

function publishedReport(id) {
  const report = publishedBasic?.[id];
  if (!report || report.id !== id || report.suite !== "basic" || !Array.isArray(report.rows)) return null;
  return report;
}

function readSaved(id) {
  try {
    const report = JSON.parse(localStorage.getItem(reportKey(id)) || "null");
    if (report?.id === id) return report;
  } catch {
    /* a broken local copy falls through to the copy kept on the site */
  }
  return publishedReport(id);
}

function blankRows() {
  return BASIC_ITEMS.map(([id, label]) => ({ id, label, status: "", summary: "", raw: "", state: "wait" }));
}

function blankPart(id, label, active) {
  return { id, label, status: "", summary: "", raw: "", state: active ? "run" : "wait" };
}

function rowsFor(suite) {
  if (suite === "candy") return [blankPart("candy", "糖果测试", true)];
  if (suite === "pelican") return [blankPart("pelican", "鹈鹕骑车", true)];
  if (suite === "all") return [...blankRows(), blankPart("candy", "糖果测试", false), blankPart("pelican", "鹈鹕骑车", false)];
  return blankRows();
}

function liveFromJob(job) {
  const suite = suiteOf(job.id, job.suite);
  return {
    id: job.id,
    suite,
    host: hostOf(job.base),
    base: job.base,
    model: job.model || job.modelId,
    modelId: job.modelId,
    keyMask: maskKey(job.key),
    started: job.at,
    running: true,
    interrupted: false,
    result: "进行中",
    rows: rowsFor(suite),
    meter: null,
    partScore: null,
    partRight: null,
    partTotal: null,
  };
}

function maskKey(key) {
  const text = String(key || "");
  if (text.length < 8) return "••••";
  return `${text.slice(0, 6)}••••••${text.slice(-2)}`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function seconds(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function shanghaiClock(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function basicScore(rows) {
  let points = 0;
  let counted = 0;
  rows.forEach((row) => {
    if (row.status === "pass") {
      counted += 1;
      points += 1;
    } else if (row.status === "warn") {
      counted += 1;
      points += 0.5;
    } else if (row.status === "fail") counted += 1;
  });
  return { score: counted ? Math.round((points / counted) * 100) : null, counted };
}

function basicWord(row) {
  if (row.state === "run") return "检测中";
  if (row.status === "pass") return "通过";
  if (row.status === "warn") return "留意";
  if (row.status === "fail") return "未通过";
  if (row.status === "error") return "没测成";
  if (row.status === "skip") return "不支持";
  if (row.status === "stop") return "已停止";
  return "";
}

function canvasBlob(dataUrl) {
  const body = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i += 1) bytes[i] = body.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

function posterPayload(run, scored, now) {
  const meter = run.meter || {};
  const waiting = run.running && !meter.requests;
  const total = run.running
    ? Math.max(0, now - run.started)
    : (meter.totalMs ?? Math.max(0, (run.finishedAt || now) - run.started));
  return {
    host: run.host || "",
    base: run.base || "",
    model: run.model || "",
    score: run.running || scored.score == null ? null : scored.score,
    running: !!run.running,
    verdict: verdictWord(run, scored),
    kpis: [
      ["首次响应", waiting ? "—" : seconds(meter.ttftMs)],
      ["总耗时", seconds(total)],
      ["输入 tokens", waiting ? "—" : (meter.input || 0).toLocaleString("en-US")],
      ["输出 tokens", waiting ? "—" : (meter.output || 0).toLocaleString("en-US")],
    ],
    rows: run.rows.map((row) => ({
      label: row.label,
      word: row.state === "done" ? (basicWord(row) || "—") : "…",
    })),
    time: run.running ? "检测中" : shanghaiClock(run.finishedAt || run.started),
    url: typeof window !== "undefined" && window.location && typeof window.location.href === "string" ? window.location.href : "",
  };
}

function stepBadge(row) {
  if (row.state === "run") return ["进行中", "run"];
  if (row.state !== "done") return ["未测", "mute"];
  const pill = basicPill(row);
  if (!pill) return ["未测", "mute"];
  if (pill[0] === "通过") return ["通过", "ok"];
  if (pill[0] === "留意") return ["留意", "warn"];
  return pill;
}

function basicPill(row) {
  if (row.state !== "done") return null;
  if (row.status === "pass") return ["通过", ""];
  if (row.status === "warn") return ["留意", ""];
  if (row.status === "fail") return ["未通过", "bad"];
  if (row.status === "error") return ["没测成", "bad"];
  if (row.status === "skip") return ["不支持", "mute"];
  if (row.status === "stop") return ["已停止", "mute"];
  return ["—", "mute"];
}

function storedReport(run) {
  return {
    id: run.id,
    suite: run.suite || suiteOf(run.id),
    host: run.host,
    base: run.base,
    model: run.model,
    modelId: run.modelId,
    keyMask: run.keyMask,
    started: run.started,
    finishedAt: run.finishedAt || null,
    running: !!run.running,
    interrupted: !!run.interrupted,
    result: run.result || "",
    partScore: typeof run.partScore === "number" ? run.partScore : null,
    partRight: typeof run.partRight === "number" ? run.partRight : null,
    partTotal: typeof run.partTotal === "number" ? run.partTotal : null,
    rows: run.rows,
    meter: run.meter,
    replay: run.replay === "candy" || run.replay === "pelican" ? run.replay : "",
    candySeq: typeof run.candySeq === "number" ? run.candySeq : null,
    candyRows: Array.isArray(run.candyRows) ? run.candyRows : [],
    pelicanHtml: typeof run.pelicanHtml === "string" ? run.pelicanHtml : "",
  };
}

function safeHost(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    if (text.includes("://")) return new URL(text).host;
  } catch {
    /* keep the typed host */
  }
  return text.slice(0, 120);
}

function clampScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function historyEntry(report) {
  if (!report || !acceptedId(report.id)) return null;
  const suite = suiteOf(report.id, report.suite);
  const rows = Array.isArray(report.rows) ? report.rows.filter((row) => BASIC_IDS.has(row.id)) : [];
  let score = rows.length ? basicScore(rows).score : null;
  if (score == null && suite === "candy") score = clampScore(report.partScore);
  if (score == null) score = clampScore(report.score);
  const at = Number(report.finishedAt || report.started || report.at);
  const running = report.running === true && report.interrupted !== true;
  const interrupted = report.interrupted === true || report.result === "已中断";
  return {
    id: report.id,
    host: safeHost(report.host),
    model: String(report.model || "").slice(0, 80),
    at: Number.isFinite(at) ? at : Date.now(),
    score,
    suite,
    running,
    interrupted,
    result: running ? "进行中" : interrupted ? "已中断" : String(report.result || "").slice(0, 40),
    replay: report.replay === "candy" || report.replay === "pelican" ? report.replay : "",
  };
}

function readBasicIndex() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(historyEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function readBasicHistory() {
  const listed = readBasicIndex();
  const seen = new Set(listed.map((item) => item.id));
  const extra = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(REPORT_PREFIX)) continue;
      const id = key.slice(REPORT_PREFIX.length);
      if (seen.has(id)) continue;
      const report = JSON.parse(localStorage.getItem(key) || "null");
      const entry = historyEntry(report);
      if (entry) extra.push(entry);
    }
  } catch {
    /* a bad report key stays out of the list */
  }
  return [...extra, ...listed].sort((a, b) => b.at - a.at).slice(0, 50);
}

export function rememberBasicHistory(report) {
  const entry = historyEntry(report);
  if (!entry) return;
  const items = readBasicIndex().filter((item) => item.id !== entry.id);
  items.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
}

export function clearBasicHistory() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key === HISTORY_KEY || key?.startsWith(REPORT_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

function DimMark({ id }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (id === "proto") {
    return <svg {...common}><path d="M8 8 4 12l4 4" /><path d="m16 8 4 4-4 4" /><path d="M14 5 10 19" /></svg>;
  }
  if (id === "structure") {
    return <svg {...common}><path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5V9a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2.5A2.5 2.5 0 0 0 6.5 20H8" /><path d="M16 4h1.5A2.5 2.5 0 0 1 20 6.5V9a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2.5a2.5 2.5 0 0 1-2.5 2.5H16" /></svg>;
  }
  if (id === "modelecho") {
    return <svg {...common}><path d="M5 5h14v9H9l-4 3.2V5z" /><path d="M9 9.5h6" /></svg>;
  }
  if (id === "consistent") {
    return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M6 16V6a2 2 0 0 1 2-2h8" /></svg>;
  }
  if (id === "stream") {
    return <svg {...common}><path d="M2 8c2.2 0 2.2 3 4.4 3S8.6 8 10.8 8s2.2 3 4.4 3 2.2-3 4.4-3" /><path d="M2 15c2.2 0 2.2 3 4.4 3s2.2-3 4.4-3 2.2 3 4.4 3 2.2-3 4.4-3" /></svg>;
  }
  if (id === "control") {
    return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 12h6" /></svg>;
  }
  if (id === "memory") {
    return <svg {...common}><path d="m12 3 8 4.5L12 12 4 7.5 12 3z" /><path d="m4 12 8 4.5L20 12" /><path d="m4 16.5 8 4.5 8-4.5" /></svg>;
  }
  if (id === "system") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M13 15h4" /></svg>;
  }
  if (id === "tools") {
    return <svg {...common}><path d="M8 3v5" /><path d="M16 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></svg>;
  }
  if (id === "vision") {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.3" /><path d="m21 16-5-4.5L8 19" /></svg>;
  }
  if (id === "reasoning") {
    return <svg {...common}><path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.5 10.6 18 9.3 18 8a6 6 0 0 0-12 0c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 21h4" /></svg>;
  }
  if (id === "usage") {
    return <svg {...common}><path d="M4 19V11" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M3 19h18" /></svg>;
  }
  if (id === "replay") {
    return <svg {...common}><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.5 2.7L3 8" /><path d="M3 3v5h5" /></svg>;
  }
  if (id === "context") {
    return <svg {...common}><path d="M13 3H6.5A1.5 1.5 0 0 0 5 4.5V19h8" /><path d="M13 3v4.2h4.2L13 3z" /><path d="M8 9h3.5M8 12.2h2.8" /><circle cx="16.2" cy="16.2" r="3" /><path d="m18.4 18.4 2.1 2.1" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="7" /></svg>;
}

function RawFold({ text }) {
  const [open, setOpen] = useState(false);
  const lines = String(text || "").split("\n");
  const long = lines.length > 3 || text.length > 180;
  return (
    <div className={open ? "raw-fold open" : "raw-fold"}>
      <div className="raw-fold-text">{text}</div>
      {long ? (
        <button type="button" className="raw-more" onClick={() => setOpen((value) => !value)}>
          {open ? "收起" : "查看更多"}
        </button>
      ) : null}
    </div>
  );
}

function suiteScore(run) {
  if (!run || run.running) return { score: null };
  if (run.suite === "pelican") return { score: null };
  if (run.suite === "candy") return { score: clampScore(run.partScore) };
  return basicScore((run.rows || []).filter((row) => BASIC_IDS.has(row.id)));
}

function verdictWord(run, scored) {
  if (!run) return "没测成";
  if (run.running) return "检测中";
  if (run.interrupted || run.result === "已中断") return "已中断";
  if (run.result === "已停止") return "已停止";
  if (run.suite === "pelican") {
    if (run.result === "通过" || run.result === "留意" || run.result === "未通过") return "检测完成";
    return "没测成";
  }
  if (scored.score == null) return "没测成";
  return "检测完成";
}

function dialMark(run, scored) {
  if (!run || run.running) return "";
  if (run.suite === "pelican") {
    if (run.result === "通过" || run.result === "留意" || run.result === "未通过" || run.result === "已停止" || run.result === "已中断") return run.result;
  }
  if (scored.score == null) return run.result === "已停止" || run.result === "已中断" ? run.result : "";
  return "";
}

function readRun(id) {
  if (liveRun && liveRun.id === id) return liveRun;
  if (readActive(id)) return liveFromJob(readActive(id));
  return readSaved(id);
}

function BasicDial({ running, score, mark }) {
  const radius = 52;
  const length = 2 * Math.PI * radius;
  const ratio = running ? 0.16 : Math.max(0, Math.min(100, Number(score) || 0)) / 100;
  return (
    <div className="score-ring ddial">
      <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#f1f1f3" strokeWidth="7" />
        <g className={running ? "run-arc" : ""}>
          <circle cx="64" cy="64" r={radius} fill="none" stroke="#65A30D" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${Math.max(length * ratio, running ? 28 : 0)} ${length}`} transform="rotate(-90 64 64)" />
        </g>
      </svg>
      <div className="score-ring-num">
        {running || score == null ? <b className="ddial-run">{running ? "检测中" : (mark || "—")}</b> : (<><b>{score}</b><span>/ 100</span></>)}
      </div>
    </div>
  );
}

const SUITE_NAME = {
  basic: "基础测试",
  candy: "糖果测试",
  pelican: "鹈鹕骑车",
  all: "三项测试",
};

export function BasicRunPage() {
  const { id } = useParams();
  const posterRef = useRef(null);
  const routeId = useRef(id);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState("report");
  const [poster, setPoster] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [run, setRun] = useState(() => readRun(id));
  const [missing, setMissing] = useState(() => !readRun(id));
  const suiteName = SUITE_NAME[run?.suite] || "基础测试";
  useTitle(run ? `${run.host || suiteName} ${suiteName} 报告｜密钥不在链接里` : "检测报告未找到｜记录只在这台浏览器");

  useEffect(() => {
    if (!run?.running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [run?.running]);

  useEffect(() => {
    const pull = () => {
      const next = readRun(routeId.current);
      setRun(next);
      setMissing(!next);
    };
    const stop = subscribeCheckJob(pull);
    pull();
    return stop;
  }, []);

  useEffect(() => {
    if (routeId.current === id) return;
    routeId.current = id;
    setPoster(false);
    setCopied(false);
    setJsonCopied(false);
    setTab("report");
    const next = readRun(id);
    setRun(next);
    setMissing(!next);
  }, [id]);

  function stopRun() {
    stopCheckJob();
  }

  async function writeText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    }
  }

  async function copyLink() {
    setCopied(await writeText(window.location.href));
  }

  async function copyJson() {
    const body = JSON.stringify((run?.rows || []).map((row) => ({
      name: row.label,
      status: basicWord(row) || "未测",
      summary: row.summary || "",
      response: row.raw || "",
    })), null, 2);
    setJsonCopied(await writeText(body));
  }

  const scored = suiteScore(run);
  const posterInfo = useMemo(
    () => (run ? posterPayload(run, scored, now) : null),
    [run, scored.score, now],
  );
  useEffect(() => {
    if (!poster || !posterRef.current || !posterInfo) return;
    const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2));
    renderBasicPoster(posterRef.current, posterInfo, scale);
  }, [poster, posterInfo]);

  function downloadPoster() {
    if (!posterInfo || !run) return;
    const canvas = document.createElement("canvas");
    renderBasicPoster(canvas, posterInfo, 3);
    const url = URL.createObjectURL(canvasBlob(canvas.toDataURL("image/png")));
    const host = (run.host || "report").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "report";
    const link = document.createElement("a");
    link.href = url;
    link.download = `veridrop-${host}.png`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 30000);
  }

  if (missing || !run) {
    return (
      <div className="wrap form-page">
        <h1>报告未找到</h1>
        <p>这份检测不在本机。请从首页重新填写接口和密钥。密钥不会留在地址里。</p>
        <Link to="/" className="more">返回首页</Link>
      </div>
    );
  }

  const meter = run.meter || {};
  const waiting = run.running && !meter.requests;
  const total = run.running
    ? Math.max(0, now - run.started)
    : (meter.totalMs ?? Math.max(0, (run.finishedAt || now) - run.started));
  const kpis = [
    ["首次响应", waiting ? "" : seconds(meter.ttftMs)],
    ["总耗时", seconds(total)],
    ["输入 tokens", waiting ? "" : (meter.input || 0).toLocaleString("en-US")],
    ["输出 tokens", waiting ? "" : (meter.output || 0).toLocaleString("en-US")],
    ["检测请求数", waiting ? "" : String(meter.requests || 0)],
  ];

  return (
    <div className="wrap report-page dpage basic-report">
      <div className="report-top">
        <div className="dcrumb">
          <Link to="/">首页</Link>
          <span>&gt;</span>
          <b>{run.running ? "检测中" : "检测报告"}</b>
        </div>
        <div className="report-actions">
          {run.running ? <button type="button" className="ghost-btn" onClick={stopRun}>停止</button> : null}
          <button type="button" className="ghost-btn" onClick={() => setPoster(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="M20 15l-4.5-4.5L8 18" /></svg>
            分享海报
          </button>
          <button type="button" className="ghost-btn" onClick={copyLink}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>
            {copied ? "已复制" : "分享链接"}
          </button>
        </div>
      </div>
      <div className="report-hero-card">
        <BasicDial running={run.running} score={scored.score} mark={dialMark(run, scored)} />
        <div className="dmain">
          {run.running ? (
            <div className="dtier-run">正在检测中,已用时 {Math.max(0, Math.floor((now - run.started) / 1000))} 秒</div>
          ) : (
            <div className="dtier-done">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#65A30D" strokeWidth="1.8" aria-hidden="true"><path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 8.6 4.2-1.4 7-4.4 7-8.6V6l-7-3z" /></svg>
              {verdictWord(run, scored)}
            </div>
          )}
          <div className="dhost">
            <b>{run.host}</b>
            {run.base ? <a href={run.base} target="_blank" rel="noreferrer">{run.base}</a> : null}
          </div>
        </div>
        <div className="report-meta-side">
          <div><span>检测时间</span>{run.running ? <i className="dskel meta" /> : <b>{shanghaiClock(run.finishedAt || run.started)}</b>}</div>
          <div><span>检测模型</span><b className="dmodel">{run.model}</b></div>
          <div><span>API Key</span><b>{run.keyMask}</b></div>
        </div>
      </div>
      <div className="report-kpis">
        {kpis.map(([label, value]) => (
          <div key={label}><span>{label}</span>{value === "" ? <i className="dskel kpi" /> : <b>{value}</b>}</div>
        ))}
      </div>
      <div className="raw-tabbar">
        <div className="tabs report-tabs detect-tabs">
          <button type="button" className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>检测报告</button>
          <button type="button" className={tab === "raw" ? "on" : ""} onClick={() => setTab("raw")}>原始服务器响应</button>
        </div>
        {tab === "raw" ? (
          <button type="button" className="ghost-btn" onClick={copyJson}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></svg>
            {jsonCopied ? "已复制" : "复制 JSON"}
          </button>
        ) : null}
      </div>
      {tab === "raw" ? (
        <div className="dpanel">
          <table className="raw-table">
            <thead>
              <tr><th>检测维度</th><th>原始响应值</th></tr>
            </thead>
            <tbody>
              {run.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="dim">
                      <DimMark id={row.id} />
                      <span className="dim-link">{row.label}</span>
                    </span>
                  </td>
                  <td className="raw-body">
                    {row.state === "wait" || row.state === "run"
                      ? <i className="dskel bar" />
                      : <RawFold text={row.raw || row.summary || "没有响应正文"} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dpanel">
          <ol className="dsteps">
            {run.rows.map((row, index) => {
              const badge = stepBadge(row);
              return (
                <li key={row.id}>
                  <span className="dstep-no">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{row.label}</b>
                    {row.state === "done" && row.summary ? <p>{row.summary}</p> : null}
                  </div>
                  <span className={`dpill ${badge[1]}`.trim()}>{badge[0]}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="report-note">密钥只发给你填写的接口，链接和海报里没有密钥。通过、留意、未通过按这一轮的实际返回计算，不打真伪分。离开这一页后，这一轮仍会继续，检测历史里显示进行中。对方一直不返回时，基础题大约 90 秒停下，鹈鹕骑车大约 3 分钟，糖果每题大约 60 秒、整组大约 8 分钟。</p>
      {poster ? (
        <div className="th-overlay" onClick={() => setPoster(false)}>
          <div className="bposter-dialog" onClick={(event) => event.stopPropagation()}>
            <canvas ref={posterRef} className="bposter-canvas" role="img" aria-label="基础测试海报" />
            <div className="bposter-actions">
              <button type="button" className="bposter-save" onClick={downloadPoster}>下载海报</button>
              <button type="button" className="ghost-btn" onClick={() => setPoster(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

let liveRun = null;
let runnerFrame = null;
let installed = false;
let bootId = "";
let handedId = "";
let cancelId = "";
let navigateJob = null;
let watchTimer = 0;
const jobListeners = new Set();

function emitJob() {
  jobListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one listener cannot stop the others */
    }
  });
  window.dispatchEvent(new Event(JOB_EVENT));
}

export function subscribeCheckJob(fn) {
  jobListeners.add(fn);
  return () => jobListeners.delete(fn);
}

function bindJobNavigate(fn) {
  navigateJob = fn;
  return () => {
    if (navigateJob === fn) navigateJob = null;
  };
}

function candyCountOf(value) {
  const count = Number(value);
  return count === 5 || count === 10 || count === 15 || count === 20 ? count : 10;
}

function writeReport(run) {
  const stored = storedReport(run);
  const attempts = [
    stored,
    { ...stored, pelicanHtml: "" },
    { ...stored, candyRows: [], pelicanHtml: "" },
  ];
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      localStorage.setItem(reportKey(run.id), JSON.stringify(attempts[i]));
      return attempts[i];
    } catch {
      /* a large pelican page must not erase the candy questions */
    }
  }
  return stored;
}

function publish(run) {
  liveRun = run;
  const stored = writeReport(run);
  rememberBasicHistory(stored);
  emitJob();
  return stored;
}

function settleOrphans() {
  const fresh = readActiveJob();
  let items = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }
  let changed = false;
  const next = items.map((item) => {
    if (!item || item.running !== true) return item;
    if (fresh && fresh.id === item.id) return item;
    changed = true;
    const report = readSaved(item.id);
    if (report?.running) {
      report.running = false;
      report.interrupted = true;
      report.result = "已中断";
      report.finishedAt = report.finishedAt || Date.now();
      try {
        localStorage.setItem(reportKey(item.id), JSON.stringify(report));
      } catch {
        /* the index still records the interruption */
      }
    }
    return { ...item, running: false, interrupted: true, result: "已中断" };
  });
  if (changed) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  if (!fresh && readSessionRaw()) sessionStorage.removeItem(ACTIVE_KEY);
}

function limitFor(job) {
  const suite = suiteOf(job.id, job.suite);
  return SUITE_LIMIT_MS[suite] || SUITE_LIMIT_MS.basic;
}

function clearWatch() {
  if (!watchTimer) return;
  clearTimeout(watchTimer);
  watchTimer = 0;
}

function armWatch(job) {
  clearWatch();
  if (!job) return;
  const wait = Math.max(0, job.at + limitFor(job) - Date.now());
  watchTimer = setTimeout(() => expireJob(job.id), wait);
}

function expireJob(id) {
  if (!liveRun || liveRun.id !== id || !liveRun.running || cancelId === id) return;
  try {
    runnerFrame?.contentWindow?.postMessage({ type: "veridrop-basic-stop" }, window.location.origin);
  } catch {
    /* the runner is not ready */
  }
  const rows = liveRun.rows.map((row) => {
    if (row.state === "done") return row;
    if (row.state === "run") return { ...row, state: "done", status: "error", summary: "等太久，没有返回。" };
    return { ...row, state: "done", status: "skip", summary: "前面超时，这项没有再测。" };
  });
  const next = {
    ...liveRun,
    rows,
    running: false,
    interrupted: false,
    finishedAt: Date.now(),
  };
  next.result = resultOf(next);
  next.score = suiteScore(next).score;
  sessionStorage.removeItem(ACTIVE_KEY);
  bootId = "";
  handedId = "";
  cancelId = id;
  publish(next);
}

function resumeActive() {
  const job = readActiveJob();
  if (!job) return;
  const saved = readSaved(job.id);
  if (saved && saved.running === false) {
    sessionStorage.removeItem(ACTIVE_KEY);
    return;
  }
  if (Date.now() - job.at > limitFor(job)) {
    sessionStorage.removeItem(ACTIVE_KEY);
    liveRun = liveFromJob(job);
    expireJob(job.id);
    return;
  }
  publish(liveFromJob(job));
  armWatch(job);
  scheduleHandoff();
}

function scheduleHandoff() {
  const job = readActiveJob();
  if (!job || !liveRun || liveRun.id !== job.id || !liveRun.running) return;
  if (Date.now() - job.at > limitFor(job)) return;
  if (cancelId === job.id || bootId === job.id || handedId === job.id) return;
  bootId = job.id;
  const frame = ensureFrame();
  frame.src = `/original-check/check.html?view=basic&rev=20261027y&run=${encodeURIComponent(job.id)}`;
}

function ensureFrame() {
  if (runnerFrame && runnerFrame.isConnected) return runnerFrame;
  const frame = document.createElement("iframe");
  frame.className = "basic-runner";
  frame.title = "检测运行";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.addEventListener("load", onRunnerLoad);
  document.body.appendChild(frame);
  runnerFrame = frame;
  return frame;
}

function onRunnerLoad() {
  const frame = runnerFrame;
  const job = readActiveJob();
  if (!frame?.contentWindow || !job || job.id !== bootId) return;
  const src = frame.getAttribute("src") || "";
  if (!src.includes("original-check") || !src.includes(job.id)) return;
  let href = "";
  try {
    href = frame.contentWindow.location.href || "";
  } catch {
    return;
  }
  // The runner rewrites its address to ?view=basic and drops &run=, so the live
  // location cannot be used to recognize this job.
  if (!href.includes("original-check")) return;
  if (!liveRun || liveRun.id !== job.id || !liveRun.running || cancelId === job.id || handedId === job.id) return;
  handedId = job.id;
  frame.contentWindow.postMessage({
    type: "veridrop-basic-start",
    suite: job.suite || suiteOf(job.id),
    base: job.base,
    key: job.key,
    model: job.modelId,
    candyCount: job.candyCount || 10,
  }, window.location.origin);
}

function childFrame(source) {
  if (!source) return false;
  const frames = document.querySelectorAll("iframe");
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].contentWindow === source) return true;
  }
  return false;
}

function stepRow(row, data) {
  return {
    ...row,
    status: data.status === "running" ? "" : (data.status || row.status),
    summary: data.summary || row.summary,
    raw: data.status === "running" ? row.raw : (data.raw || row.raw || ""),
    state: data.status === "running" ? "run" : "done",
  };
}

function takeCandyRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20).map((row) => ({
    title: String(row?.title || "").slice(0, 80),
    prompt: String(row?.prompt || "").slice(0, 2000),
    dimension: String(row?.dimension || "").slice(0, 20),
    level: String(row?.level || "").slice(0, 20),
    options: Array.isArray(row?.options) ? row.options.slice(0, 8).map((opt) => ({
      key: String(opt?.key || "").slice(0, 8),
      text: String(opt?.text || "").slice(0, 300),
    })) : [],
    answer: String(row?.answer || "").slice(0, 8),
    picked: String(row?.picked || "").slice(0, 500),
    expect: String(row?.expect || "").slice(0, 200),
    ok: !!row?.ok,
    missed: !!row?.missed,
  }));
}

function applyLiveStep(data) {
  if (!liveRun?.running || cancelId === liveRun.id || typeof data?.id !== "string") return;
  if (!liveRun.rows.some((row) => row.id === data.id)) return;
  const next = { ...liveRun, rows: liveRun.rows.map((row) => (row.id === data.id ? stepRow(row, data) : row)) };
  if (data.id === "candy" && Array.isArray(data.rows)) {
    const candyRows = takeCandyRows(data.rows);
    next.candyRows = candyRows;
    if (candyRows.length) {
      const right = candyRows.filter((row) => row.ok).length;
      next.partRight = right;
      next.partTotal = candyRows.length;
      next.partScore = Math.round((right / candyRows.length) * 100);
    }
  }
  if (data.id === "pelican" && typeof data.html === "string") {
    next.pelicanHtml = data.html.slice(0, 1_200_000);
  }
  publish(next);
}

function applyLiveMeter(data) {
  if (!liveRun?.running || !data) return;
  publish({
    ...liveRun,
    meter: {
      requests: data.requests,
      input: data.input,
      output: data.output,
      ttftMs: data.ttftMs,
      totalMs: data.totalMs,
    },
  });
}

function mergePart(run, id, label, status, summary) {
  if (!status || status === "idle" || status === "running") return run;
  const next = { id, label, status, summary: summary || "", raw: summary || "", state: "done" };
  const known = run.rows.some((row) => row.id === id);
  return {
    ...run,
    rows: known
      ? run.rows.map((row) => (row.id === id ? { ...row, ...next, raw: row.raw || next.raw } : row))
      : run.rows.concat(next),
  };
}

function resultOf(run) {
  const suite = run.suite || "basic";
  if (suite === "candy") {
    const row = run.rows.find((item) => item.id === "candy");
    if (row?.status === "stop") return "已停止";
    if (typeof run.partRight === "number" && typeof run.partTotal === "number" && run.partTotal > 0) return `${run.partRight}/${run.partTotal}`;
    return "没测成";
  }
  if (suite === "pelican") {
    const status = run.rows.find((item) => item.id === "pelican")?.status;
    if (status === "pass") return "通过";
    if (status === "warn") return "留意";
    if (status === "fail") return "未通过";
    if (status === "stop") return "已停止";
    return "没测成";
  }
  const rows = (run.rows || []).filter((row) => BASIC_IDS.has(row.id));
  const scored = basicScore(rows);
  if (scored.score == null) return rows.some((row) => row.status === "stop") ? "已停止" : "没测成";
  return `${scored.score} 分`;
}

function finishLive(data) {
  if (!liveRun?.running || cancelId === liveRun.id) return;
  clearWatch();
  let next = { ...liveRun, rows: liveRun.rows.map((row) => ({ ...row })) };
  if (data?.candy && data.candy !== "idle") next = mergePart(next, "candy", "糖果测试", data.candy, data.candySummary);
  if (data?.pelican && data.pelican !== "idle") next = mergePart(next, "pelican", "鹈鹕骑车", data.pelican, data.pelicanSummary);
  if (typeof data?.candyRight === "number" && typeof data?.candyTotal === "number" && data.candyTotal > 0) {
    next.partRight = data.candyRight;
    next.partTotal = data.candyTotal;
    next.partScore = Math.round((data.candyRight / data.candyTotal) * 100);
  }
  if (Array.isArray(data?.rows) && data.rows.length) {
    const candyRows = takeCandyRows(data.rows);
    const have = Array.isArray(next.candyRows) ? next.candyRows.length : 0;
    if (candyRows.length >= have) next.candyRows = candyRows;
  }
  next.running = false;
  next.interrupted = false;
  next.finishedAt = Date.now();
  next.result = resultOf(next);
  next.score = suiteScore(next).score;
  sessionStorage.removeItem(ACTIVE_KEY);
  bootId = "";
  handedId = "";
  publish(next);
  if (data?.scored !== false) {
    grant("detect", 3, "每日检测", "day");
    grant("first-detect", 5, "完成首次检测", "once");
  }
}

function finishStopped(run) {
  clearWatch();
  const next = {
    ...run,
    running: false,
    interrupted: false,
    finishedAt: Date.now(),
    result: "已停止",
    rows: run.rows.map((row) => (row.state === "run" ? { ...row, state: "done", status: "stop", summary: row.summary || "已停止" } : row)),
  };
  next.score = suiteScore(next).score;
  sessionStorage.removeItem(ACTIVE_KEY);
  bootId = "";
  handedId = "";
  publish(next);
}

function localResult(data) {
  if (data.status === "stop") return "已停止";
  if (data.suite === "candy") {
    if (typeof data.candyRight === "number" && typeof data.candyTotal === "number" && data.candyTotal > 0) {
      return `${data.candyRight}/${data.candyTotal}`;
    }
    return "没测成";
  }
  if (data.status === "pass") return "通过";
  if (data.status === "warn") return "留意";
  if (data.status === "fail") return "未通过";
  return "没测成";
}

function recordLocalSuite(data) {
  const suite = data?.suite === "candy" || data?.suite === "pelican" ? data.suite : "";
  const base = String(data?.base || "").trim().slice(0, 300);
  const modelId = String(data?.model || "").trim().slice(0, 120);
  if (!suite || !base || !modelId) return;
  const started = Number(data.started);
  const at = Number.isFinite(started) ? started : Date.now();
  const id = `${suite}-${at.toString(36)}`;
  const status = ["pass", "warn", "fail", "error", "stop", "skip"].includes(data.status) ? data.status : "error";
  const right = typeof data.candyRight === "number" ? data.candyRight : null;
  const total = typeof data.candyTotal === "number" ? data.candyTotal : null;
  const run = {
    id,
    suite,
    host: hostOf(base) || safeHost(base),
    base,
    model: String(data.modelLabel || modelId).slice(0, 80),
    modelId,
    keyMask: "",
    started: at,
    finishedAt: Date.now(),
    running: false,
    interrupted: false,
    result: localResult({ ...data, suite, status }),
    partScore: suite === "candy" && total > 0 && right != null ? Math.round((right / total) * 100) : null,
    partRight: suite === "candy" ? right : null,
    partTotal: suite === "candy" ? total : null,
    rows: [{
      id: suite,
      label: suite === "candy" ? "糖果测试" : "鹈鹕骑车",
      status,
      summary: String(data.summary || "").slice(0, 500),
      raw: "",
      state: "done",
    }],
    meter: null,
    replay: suite,
    candySeq: typeof data.candySeq === "number" ? data.candySeq : 1,
    candyRows: suite === "candy" && Array.isArray(data.rows) ? data.rows.slice(0, 20) : [],
    pelicanHtml: suite === "pelican" ? String(data.html || "").slice(0, 1200000) : "",
  };
  const stored = storedReport(run);
  const write = (report) => {
    localStorage.setItem(reportKey(report.id), JSON.stringify(report));
    rememberBasicHistory(report);
  };
  const attempts = [
    stored,
    { ...stored, pelicanHtml: "" },
    { ...stored, candyRows: [], pelicanHtml: "" },
  ];
  let saved = false;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      write(attempts[i]);
      saved = true;
      break;
    } catch {
      /* keep the candy questions when the pelican page does not fit */
    }
  }
  if (!saved) return;
  emitJob();
  if (data.scored === true) {
    grant("detect", 3, "每日检测", "day");
    grant("first-detect", 5, "完成首次检测", "once");
  }
}

const dumpSeen = new Set();

function runnerRunId(frame) {
  let live = "";
  try {
    live = new URL(frame.contentWindow.location.href).searchParams.get("run") || "";
  } catch {
    live = "";
  }
  if (/^all-[a-z0-9]{4,24}$/i.test(live)) return live;
  const src = frame.getAttribute("src") || "";
  const match = /(?:\?|&)run=(all-[a-z0-9]{4,24})/i.exec(src);
  return match ? decodeURIComponent(match[1]) : "";
}

function scrapeRunnerDetail(frame) {
  let doc;
  let win;
  try {
    win = frame.contentWindow;
    doc = frame.contentDocument;
  } catch {
    return null;
  }
  if (!doc || !win) return null;
  const id = runnerRunId(frame);
  if (!id) return null;
  const bank = Array.isArray(win.CheckGrade?.CANDY_QUESTIONS) ? win.CheckGrade.CANDY_QUESTIONS : [];
  const nodes = [...doc.querySelectorAll('[data-test="candy"] .mc-qitem')];
  const rows = nodes.map((node) => {
    const titleText = node.querySelector("strong")?.textContent || "";
    const title = titleText.replace(/^\d+\.\s*/, "").trim();
    const prompt = node.querySelector(".mc-qprompt")?.textContent || "";
    const lines = [...node.querySelectorAll("p")].map((item) => item.textContent || "");
    const pickedLine = lines.find((line) => line.startsWith("模型答案：")) || "";
    const expectLine = lines.find((line) => line.startsWith("对照：")) || "";
    const picked = pickedLine.replace(/^模型答案：/, "");
    const known = bank.find((item) => item && (item.prompt === prompt || item.title === title));
    return {
      title: known?.title || title,
      prompt: known?.prompt || prompt,
      dimension: known?.dimension || "",
      level: known?.level || "",
      options: Array.isArray(known?.options) ? known.options : [],
      answer: known?.answer || "",
      picked: picked === "没有回答" ? "" : picked,
      expect: known?.expect || expectLine.replace(/^对照：/, ""),
      ok: node.classList.contains("is-ok"),
      missed: node.classList.contains("is-miss"),
    };
  });
  const frameNode = doc.querySelector('[data-test="pelican"] iframe.lab-frame');
  const html = frameNode?.getAttribute("srcdoc") || "";
  if (!rows.length && !html) return null;
  return { id, rows, html };
}

function isRunnerSource(source) {
  if (!source) return false;
  const frames = document.querySelectorAll("iframe.basic-runner");
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].contentWindow === source) return true;
  }
  return false;
}

function mergeDump(data) {
  if (!data || typeof data.id !== "string" || !/^all-[a-z0-9]{4,24}$/i.test(data.id)) return;
  const rows = Array.isArray(data.rows) ? takeCandyRows(data.rows) : [];
  const html = typeof data.html === "string" ? data.html.slice(0, 1_200_000) : "";
  if (!rows.length && !html) return;
  const key = `${data.id}:${rows.length}:${html.length}`;
  if (dumpSeen.has(key)) return;
  const current = liveRun && liveRun.id === data.id ? liveRun : readSaved(data.id);
  if (!current || suiteOf(current.id, current.suite) !== "all") return;
  const haveRows = Array.isArray(current.candyRows) ? current.candyRows.length : 0;
  const haveHtml = typeof current.pelicanHtml === "string" ? current.pelicanHtml.length : 0;
  if (rows.length <= haveRows && html.length <= haveHtml) return;
  dumpSeen.add(key);
  const next = {
    ...current,
    candyRows: rows.length > haveRows ? rows : (current.candyRows || []),
    pelicanHtml: html.length > haveHtml ? html : (current.pelicanHtml || ""),
  };
  const stored = writeReport(next);
  if (liveRun && liveRun.id === data.id) liveRun = next;
  rememberBasicHistory(stored);
  emitJob();
}

let recovering = false;

export function keepRecoveredDetail(data) {
  if (!data || !Array.isArray(data.rows)) return;
  mergeDump({ id: data.id, rows: data.rows, html: typeof data.html === "string" ? data.html : "" });
}

export function recoverAllDetail() {
  if (recovering) return;
  recovering = true;
  try {
    document.querySelectorAll("iframe.basic-runner").forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: "veridrop-all-dump-request" }, window.location.origin);
      } catch {
        /* a blank runner has nothing to send */
      }
      mergeDump(scrapeRunnerDetail(frame));
    });
  } finally {
    recovering = false;
  }
}

function onWindowMessage(event) {
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data.type !== "string") return;
  if (data.type === "veridrop-local-record") {
    if (!childFrame(event.source) || event.source === runnerFrame?.contentWindow) return;
    recordLocalSuite(data);
    return;
  }
  if (data.type === "veridrop-all-dump") {
    if (!isRunnerSource(event.source)) return;
    mergeDump(data);
    return;
  }
  if (data.type === "veridrop-job-request") {
    if (!childFrame(event.source) || event.source === runnerFrame?.contentWindow) return;
    const suite = SUITES.has(data.suite) ? data.suite : "";
    if (!suite || typeof data.base !== "string" || typeof data.key !== "string" || typeof data.model !== "string") return;
    const started = startCheckJob({
      suite,
      base: data.base,
      key: data.key,
      modelId: data.model,
      model: typeof data.modelLabel === "string" && data.modelLabel.trim() ? data.modelLabel.trim() : data.model,
      candyCount: data.candyCount,
    });
    try {
      event.source.postMessage({
        type: "veridrop-job-reply",
        ok: started.ok,
        error: started.error || "",
        id: started.id || "",
      }, window.location.origin);
    } catch {
      /* the form frame has already gone */
    }
    if (started.ok && navigateJob) navigateJob(started.id);
    return;
  }
  if (!runnerFrame || event.source !== runnerFrame.contentWindow) return;
  if (data.type === "veridrop-basic-step") applyLiveStep(data);
  else if (data.type === "veridrop-basic-meter") applyLiveMeter(data);
  else if (data.type === "veridrop-suite-done" || data.type === "veridrop-basic-done") finishLive(data);
}

function installRunKeeper() {
  if (installed) return;
  installed = true;
  ensureFrame();
  window.addEventListener("message", onWindowMessage);
  window.addEventListener(JOB_EVENT, scheduleHandoff);
  settleOrphans();
  resumeActive();
}

export function startCheckJob(input) {
  const suite = SUITES.has(input?.suite) ? input.suite : "";
  const base = String(input?.base || "").trim();
  const key = String(input?.key || "").trim();
  const modelId = String(input?.modelId || "").trim();
  if (!suite || !base || !key || !modelId) return { ok: false, error: "请填写接口、Key 和模型" };
  if (base.length > 300 || key.length > 400 || modelId.length > 120) return { ok: false, error: "填写内容太长" };
  const current = readActiveJob();
  if (current) {
    const saved = readSaved(current.id);
    if (!saved || saved.running !== false) return { ok: false, error: "上一轮还在进行中" };
    sessionStorage.removeItem(ACTIVE_KEY);
  }
  const at = Date.now();
  const job = {
    id: `${suite}-${at.toString(36)}`,
    suite,
    base,
    key,
    modelId,
    model: String(input.model || modelId).slice(0, 80),
    candyCount: candyCountOf(input.candyCount),
    at,
  };
  cancelId = "";
  sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(job));
  publish(liveFromJob(job));
  armWatch(job);
  scheduleHandoff();
  return { ok: true, id: job.id };
}

export function stopCheckJob(onlySuite) {
  const run = liveRun;
  if (!run?.running) return;
  if (onlySuite && suiteOf(run.id, run.suite) !== onlySuite) return;
  cancelId = run.id;
  try {
    runnerFrame?.contentWindow?.postMessage({ type: "veridrop-basic-stop" }, window.location.origin);
  } catch {
    /* the runner is not ready yet */
  }
  finishStopped(run);
}

export function abandonCheckJob() {
  clearWatch();
  if (liveRun?.id) cancelId = liveRun.id;
  try {
    runnerFrame?.contentWindow?.postMessage({ type: "veridrop-basic-stop" }, window.location.origin);
  } catch {
    /* nothing is running in the frame */
  }
  liveRun = null;
  bootId = "";
  handedId = "";
  sessionStorage.removeItem(ACTIVE_KEY);
}

function reportFor(id) {
  if (liveRun && liveRun.id === id) return liveRun;
  return readSaved(id);
}

function publicAllReport(run) {
  const stored = storedReport(run);
  return {
    id: stored.id,
    suite: "all",
    host: stored.host,
    model: stored.model,
    started: stored.started,
    finishedAt: stored.finishedAt,
    running: stored.running,
    interrupted: stored.interrupted,
    result: stored.result,
    partScore: stored.partScore,
    partRight: stored.partRight,
    partTotal: stored.partTotal,
    rows: stored.rows,
    meter: stored.meter,
    candyRows: stored.candyRows,
    pelicanHtml: stored.pelicanHtml,
  };
}

export function allReportFor(id) {
  if (!acceptedId(id) || suiteOf(id) !== "all") return null;
  const run = reportFor(id);
  if (!run || suiteOf(run.id, run.suite) !== "all") return null;
  return publicAllReport(run);
}

export function latestAllReport() {
  const item = readBasicHistory().find((row) => row.suite === "all");
  return item ? allReportFor(item.id) : null;
}

export function RunKeeper() {
  const navigate = useNavigate();
  useEffect(() => {
    installRunKeeper();
    return bindJobNavigate((id) => {
      if (String(id).startsWith("all-")) {
        const next = `/check/detect?run=${encodeURIComponent(id)}`;
        if (`${window.location.pathname}${window.location.search}` !== next) navigate(next);
        return;
      }
      if (window.location.pathname !== `/b/${id}`) navigate(`/b/${id}`);
    });
  }, [navigate]);
  return null;
}
