import { useEffect, useRef, useState } from "react";
import { renderBasicPoster } from "./poster-canvas.js";
import "./report-share.css";

const NAMES = { candy: "糖果测试", pelican: "鹈鹕骑车", all: "三项检测" };
const WORDS = { pass: "通过", warn: "留意", fail: "未通过", error: "没测成", skip: "不支持", stop: "已停止" };

export function sharePosterInfo(report, url) {
  const rows = report.candyRows || [];
  const basic = (report.rows || []).filter(row => row.id !== "candy" && row.id !== "pelican");
  const counted = basic.filter(row => ["pass", "warn", "fail"].includes(row.status));
  const score = report.suite === "candy"
    ? (rows.length ? Math.round(rows.filter(row => row.ok).length / rows.length * 100) : null)
    : report.suite === "all" && counted.length
      ? Math.round(counted.reduce((n, row) => n + (row.status === "pass" ? 1 : row.status === "warn" ? 0.5 : 0), 0) / counted.length * 100) : null;
  const result = report.result || WORDS[report.rows?.[0]?.status] || "检测结束";
  const duration = report.meter?.totalMs ?? (report.finishedAt - report.started);
  return {
    title: NAMES[report.suite], host: report.host, base: report.base, model: report.model,
    note: "用户自测 · 仅代表本轮调用",
    score, mark: report.suite === "pelican" ? (WORDS[report.rows?.[0]?.status] || "已结束") : "",
    verdict: report.suite === "candy" ? "本轮答对 " + rows.filter(row => row.ok).length + " / " + rows.length + " 题" : result,
    kpis: [["测试类型", NAMES[report.suite]], ["总耗时", Number.isFinite(duration) ? (duration / 1000).toFixed(1) + "s" : "—"],
      ["答对题数", rows.length ? rows.filter(row => row.ok).length + "/" + rows.length : "—"], ["画面结果", WORDS[report.rows?.find(row => row.id === "pelican")?.status] || "—"]],
    rows: report.suite === "candy"
      ? ["迷惑辨析", "数量关系", "约束求解", "演绎"].map(label => {
        const group = rows.filter(row => row.dimension === label && !row.missed);
        return { label, word: group.length ? group.filter(row => row.ok).length + "/" + group.length : "未覆盖" };
      }) : (report.rows || []).map(row => ({ label: row.label, word: WORDS[row.status] || "未测" })),
    time: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(report.finishedAt || report.started)),
    url,
  };
}

// Strip credentials before anything leaves this browser, including echoed keys.
export function publicSharePayload(report, secrets = []) {
  function clean(value) {
    if (typeof value === "string") {
      let text = value;
      secrets.filter(Boolean).forEach(secret => { text = text.split(secret).join("[redacted]"); });
      return text.replace(/sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]");
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["key", "apiKey", "authorization", "keyMask", "raw"].includes(key))
      .map(([key, item]) => [key, clean(item)]));
    return value;
  }
  const keys = ["id", "suite", "host", "base", "model", "modelId", "started", "finishedAt", "running", "interrupted", "result", "partScore", "partRight", "partTotal", "rows", "meter", "candySeq", "candyRows", "pelicanHtml"];
  const payload = clean(Object.fromEntries(keys.map(key => [key, report[key]])));
  try { const base = new URL(payload.base); payload.base = base.origin; } catch { payload.base = ""; }
  return payload;
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return true; } catch {
    const input = document.createElement("textarea");
    input.value = value; input.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(input); input.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } finally { input.remove(); }
    return ok;
  }
}

export function ReportShare({ sharedReport, sharedUrl }) {
  const [dialog, setDialog] = useState(null);
  const [copied, setCopied] = useState(false);
  const canvas = useRef(null);
  const generation = useRef(0);
  const cache = useRef(new Map());
  const trigger = useRef(null);
  const closeButton = useRef(null);

  function close() { generation.current += 1; setDialog(null); trigger.current?.focus(); }

  useEffect(() => {
    async function open(event) {
      const ticket = ++generation.current;
      trigger.current = document.activeElement;
      setCopied(false);
      setDialog({ busy: true, mode: event.detail?.mode });
      try {
        const data = event.detail || {};
        const report = sharedReport || data.report || JSON.parse(localStorage.getItem("veridrop-basic-report:" + data.id) || "null");
        if (!report || report.running) throw new Error("请等待检测结束后再分享。");
        const secrets = [document.querySelector(".check-host #apiKey")?.value];
        for (const [store, key] of [[sessionStorage, "veridrop-basic-active"], [localStorage, "veridrop.check.v1"]]) {
          try { secrets.push(JSON.parse(store.getItem(key) || "null")?.key); } catch { /* no stored key */ }
        }
        const payload = publicSharePayload(report, secrets);
        const fingerprint = JSON.stringify(payload);
        let url = sharedUrl || cache.current.get(fingerprint);
        if (!url) {
          const response = await fetch("/api/shared-reports", { method: "POST", headers: { "Content-Type": "application/json", "X-Veridrop-Share": "1" }, body: fingerprint });
          const result = await response.json();
          if (!response.ok || !/^\/check\/(candy|pelican|detect)\?share=[A-Za-z0-9_-]{24}$/.test(result.path || "")) throw new Error(result.error || "分享链接没有生成，请重试。");
          url = new URL(result.path, location.origin).href;
          cache.current.set(fingerprint, url);
        }
        if (ticket !== generation.current) return;
        setDialog({ report: payload, url, mode: data.mode });
        if (data.mode === "link") setCopied(await copyText(url));
      } catch (error) {
        if (ticket === generation.current) setDialog({ error: error.message || "分享未成功，请重试。" });
      }
    }
    window.addEventListener("veridrop-share-open", open);
    return () => { generation.current += 1; window.removeEventListener("veridrop-share-open", open); };
  }, [sharedReport, sharedUrl]);

  useEffect(() => {
    if (!dialog) return undefined;
    closeButton.current?.focus();
    function keyboard(event) {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const buttons = [...document.querySelectorAll(".report-share-dialog button, .report-share-dialog input, .report-share-dialog a")];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [Boolean(dialog)]);
  useEffect(() => {
    if (canvas.current && dialog?.report) renderBasicPoster(canvas.current, sharePosterInfo(dialog.report, dialog.url), 3);
  }, [dialog]);

  function download() {
    canvas.current?.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = "VeriDrop-" + NAMES[dialog.report.suite] + "-分享海报.png"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  }
  if (!dialog) return null;
  return <div className="report-share-overlay" onClick={close}>
    <section className="report-share-dialog" role="dialog" aria-modal="true" aria-labelledby="report-share-title" onClick={event => event.stopPropagation()}>
      <header><div><h2 id="report-share-title">{dialog.mode === "poster" ? "分享检测海报" : "分享检测结果"}</h2><p>好友打开链接或扫描海报二维码，即可查看本轮结果。</p></div><button ref={closeButton} type="button" aria-label="关闭分享" onClick={close}>×</button></header>
      {dialog.busy ? <p role="status">正在生成可分享的报告…</p> : dialog.error ? <p role="alert">{dialog.error}</p> : <>
        {dialog.mode === "poster" ? <canvas ref={canvas} className="report-share-canvas" role="img" aria-label={NAMES[dialog.report.suite] + "分享海报"} /> : <p className="report-share-ready">报告已生成，任何人都可以通过这个链接查看。</p>}
        <label className="report-share-link">结果链接<input readOnly value={dialog.url} onFocus={event => event.target.select()} /></label>
        <div className="report-share-actions"><button className="ghost-btn" type="button" onClick={async () => setCopied(await copyText(dialog.url))}>{copied ? "已复制链接" : "复制链接"}</button><a className="ghost-btn" href={dialog.url} target="_blank" rel="noopener noreferrer">打开报告</a>{dialog.mode === "poster" ? <button className="solid-btn" type="button" onClick={download}>下载海报</button> : <button className="solid-btn" type="button" onClick={() => setDialog(value => ({ ...value, mode: "poster" }))}>生成海报</button>}</div>
        <p className="report-share-note">分享包含站点、模型和测试结果，不包含 API Key。结果来自用户自测。</p>
      </>}
    </section>
  </div>;
}
