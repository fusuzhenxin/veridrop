import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { stations } from "./data.js";
import { DETECT_ROWS, readActiveJob, readDetectReport, subscribeDetect } from "./detect.js";
import { useTitle } from "./ui.jsx";

function hostOf(value) {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).host;
  } catch {
    return value;
  }
}

function matchStation(host) {
  const name = host.toLowerCase().replace(/^www\./, "");
  return stations.find((item) => {
    const own = String(item.host || "").toLowerCase().replace(/^www\./, "");
    const site = String(item.site || "").toLowerCase();
    return own === name || site.includes(`//www.${name}`) || site.includes(`//${name}`);
  });
}

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function seconds(ms) {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function overall(rows) {
  const nums = rows.filter((row) => row.score != null).map((row) => Number(row.score));
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function DimIcon({ name }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "thinking_signature") return <svg {...common}><path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 8.6 4.2-1.4 7-4.4 7-8.6V6l-7-3z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "behavioral_signature") return <svg {...common}><path d="M3 12h3l2-7 4 16 3-9h6" /></svg>;
  if (name === "knowledge") return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
  if (name === "pdf") return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h6M8 17h5" /></svg>;
  if (name === "consistency") return <svg {...common}><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 4v5h-5" /></svg>;
  if (name === "token_usage") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3" /></svg>;
  if (name === "message_id") return <svg {...common}><path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" /></svg>;
  if (name === "integrity") return <svg {...common}><path d="m2 12 5 5 7-9" /><path d="m13 14 3 3 6-9" /></svg>;
  if (name === "protocol") return <svg {...common}><path d="m8 6-6 6 6 6" /><path d="m16 6 6 6-6 6" /></svg>;
  return <svg {...common}><path d="m12 2 9 5-9 5-9-5 9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>;
}

function contentOf(row) {
  if (row.state === "run") return "检测中";
  if (row.state !== "done") return "";
  if (row.status === "error") return "检测出错";
  if (row.status === "fail") return "未通过";
  if (row.status === "skip") return "未检测";
  return "通过";
}

function Dial({ running, score }) {
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
        {running || score == null ? <b className="ddial-run">{running ? "检测中" : "—"}</b> : (<><b>{score}</b><span>/ 100</span></>)}
      </div>
    </div>
  );
}

export function DetectRunPage() {
  const { id } = useParams();
  const location = useLocation();
  const [run, setRun] = useState(null);
  const [missing, setMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState("report");
  const [copied, setCopied] = useState(false);
  const [poster, setPoster] = useState(false);
  const saved = readDetectReport(id);
  const report = run?.report || saved;
  const rows = run?.rows || saved?.rows || DETECT_ROWS.map((item) => ({ ...item, state: "wait" }));
  const running = !report;
  useTitle(report ? `${report.host} 模型检测报告｜基础分、耗时和本次调用` : "模型检测进行中｜等待这一次调用返回");

  useEffect(() => {
    if (readDetectReport(id)) return undefined;
    const job = location.state?.id === id ? location.state : readActiveJob(id);
    if (!job) {
      setMissing(true);
      return undefined;
    }
    return subscribeDetect(job, (next) => setRun(next));
  }, [id, location.state]);

  useEffect(() => {
    if (!running || !run?.started) return undefined;
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - run.started) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [running, run?.started]);

  if (missing && !report) {
    return (
      <div className="wrap form-page">
        <h1>报告未找到</h1>
        <p>这份检测不在本机。请从首页重新填写接口和密钥。密钥不会留在地址里。</p>
        <Link to="/" className="more">返回首页</Link>
      </div>
    );
  }

  const job = location.state?.id === id ? location.state : readActiveJob(id);
  const host = report?.host || hostOf(job?.baseUrl || "");
  const baseUrl = report?.baseUrl || job?.baseUrl || "";
  const model = report?.model || job?.model || "—";
  const station = matchStation(host);
  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
  };

  const score = overall(running ? [] : rows);
  const failedAll = report?.fatal && !report.shots?.some((item) => item.ok);
  return (
    <div className="wrap report-page dpage">
      <div className="report-top">
        <div className="dcrumb">
          <Link to="/list">站点</Link>
          <span>&gt;</span>
          {station ? <Link to={station.path}>{host}</Link> : <span>{host}</span>}
          <span>&gt;</span>
          <b>{running ? "检测中" : "检测报告"}</b>
        </div>
        <div className="report-actions">
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
        <Dial running={running} score={failedAll ? null : score} />
        <div className="dmain">
          {running ? (
            <div className="dtier-run">正在检测中,已用时 {elapsed} 秒,预计用时约 30 秒</div>
          ) : (
            <div className="dtier-done">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#65A30D" strokeWidth="1.8" aria-hidden="true"><path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 8.6 4.2-1.4 7-4.4 7-8.6V6l-7-3z" /></svg>
              {failedAll ? report.fatal : "检测完成"}
            </div>
          )}
          <div className="dhost">
            <b>{host}</b>
            {baseUrl ? <a href={baseUrl} target="_blank" rel="noreferrer">{baseUrl}</a> : null}
          </div>
        </div>
        <div className="report-meta-side">
          <div><span>检测时间</span>{running ? <i className="dskel meta" /> : <b>{clock(report.finishedAt || report.at)}</b>}</div>
          <div><span>检测模型</span><b className="dmodel">{model}</b></div>
          <div><span>API Key</span>{running ? <i className="dskel meta" /> : <b>{report?.keyMask || "—"}</b>}</div>
        </div>
      </div>
      <div className="report-kpis">
        {[["首字延迟", report ? seconds(report.ttftMs) : ""], ["总耗时", report ? seconds(report.totalMs) : ""], ["输入 tokens", report ? (report.inputTokens || 0).toLocaleString("en-US") : ""], ["输出 tokens", report ? (report.outputTokens || 0).toLocaleString("en-US") : ""], ["检测请求数", report ? String(report.requests || 0) : ""]].map(([label, value]) => (
          <div key={label}><span>{label}</span>{running ? <i className="dskel kpi" /> : <b>{value}</b>}</div>
        ))}
      </div>
      <div className="tabs report-tabs detect-tabs">
        <button type="button" className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>检测报告</button>
        <button type="button" className={tab === "raw" ? "on" : ""} disabled={running} onClick={() => setTab("raw")}>原始服务器响应</button>
      </div>
      {tab === "raw" && report ? (
        <pre className="raw-box">{JSON.stringify(report.shots || [], null, 2)}</pre>
      ) : (
        <div className="dpanel">
          <table className="dtable">
            <thead>
              <tr><th>检测维度</th><th>检测内容</th><th>得分</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <span className="dim" title={row.tip}>
                      <DimIcon name={row.name} />
                      <span className="dim-link">{row.label}</span>
                    </span>
                  </td>
                  <td className="dcontent" title={row.summary || ""}>
                    {row.state === "wait" ? <i className="dskel bar" /> : contentOf(row)}
                  </td>
                  <td className="dscore">
                    {row.state !== "done"
                      ? <i className="dskel pill" />
                      : <span className={row.score == null ? "dpill mute" : row.status === "fail" || row.status === "error" ? "dpill bad" : "dpill"}>{row.score == null ? "—" : row.score}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="report-note">密钥只发给你填写的接口，报告里只保留掩码。详细说明停在每一项的悬停提示里。</p>
      {poster ? (
        <div className="th-overlay" onClick={() => setPoster(false)}>
          <div className="poster-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="poster">
              <div className="poster-hd">
                <div>
                  <div className="poster-mark">Veri<span>Drop</span></div>
                  <div className="mini">模型检测</div>
                </div>
                <button type="button" className="poster-x" onClick={() => setPoster(false)} aria-label="关闭">×</button>
              </div>
              <div className="poster-score">
                <b>{running || score == null ? "—" : score}</b>
                <span>/ 100</span>
                <em>{running ? "检测中" : failedAll ? report.fatal : "检测完成"}</em>
              </div>
              <h2>{host}</h2>
              {baseUrl ? <div className="mini">{baseUrl}</div> : null}
              <div className="poster-probes">
                {rows.map((row) => (
                  <div key={row.name}><span>{row.label}</span><b>{row.state === "done" ? (row.score == null ? "未测" : row.score) : "…"}</b></div>
                ))}
              </div>
              <div className="mini">检测模型 {model}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
