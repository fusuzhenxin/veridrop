import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data", "basic-reports");
const indexPath = path.join(dir, "index.json");

function scrubText(text, secret) {
  let next = String(text ?? "");
  if (secret) next = next.split(secret).join("[redacted]");
  return next.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

function scrubValue(value, secret) {
  if (typeof value === "string") return scrubText(value, secret);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, secret));
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "key" || key === "apiKey" || key === "authorization") continue;
    copy[key] = scrubValue(item, secret);
  }
  return copy;
}

export function publicReport(report, secret = "") {
  const copy = scrubValue(report, secret);
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) return null;
  copy.keyMask = "—";
  delete copy.key;
  delete copy.apiKey;
  return copy;
}

function safeId(id) {
  const text = String(id || "");
  return /^basic-[a-z0-9]{6,16}$/.test(text) ? text : "";
}

export function readIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return Array.isArray(parsed.reports) ? parsed.reports : [];
  } catch {
    return [];
  }
}

export function readReport(id) {
  const safe = safeId(id);
  if (!safe) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${safe}.json`), "utf8"));
    const report = publicReport(parsed);
    if (!report || report.id !== safe || report.suite !== "basic" || !Array.isArray(report.rows)) return null;
    return report;
  } catch {
    return null;
  }
}

export function summariesFor(stationId, host) {
  const verd = stationId == null ? "" : String(stationId);
  const name = String(host || "").replace(/^www\./, "").toLowerCase();
  return readIndex().filter((row) => {
    const rowHost = String(row.host || "").replace(/^www\./, "").toLowerCase();
    return (verd && String(row.stationId) === verd) || (name && (rowHost === name || rowHost === `api.${name}` || name === `api.${rowHost}`));
  });
}

export function recentSummaries(limit = 20) {
  return readIndex().filter((row) => safeId(row?.id) && typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0 && row.score <= 100 && Number.isFinite(Date.parse(row.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((row) => Object.fromEntries(["id", "stationId", "host", "model", "score", "at", "channel"].map((key) => [key, scrubValue(row[key])])));
}

export function bootFor(pathname) {
  const pathName = String(pathname || "/").split("?")[0];
  if (pathName.startsWith("/b/basic-")) {
    const id = decodeURIComponent(pathName.slice("/b/".length).split("/")[0] || "");
    const report = readReport(id);
    return { report: report && report.id === id ? report : null, index: null };
  }
  if (pathName === "/" || pathName.startsWith("/site/")) return { report: null, index: readIndex() };
  return { report: null, index: null };
}

export function writeReport(report, summary, secret = "") {
  const safe = publicReport(report, secret);
  const id = safeId(safe?.id);
  if (!id || safe.suite !== "basic" || !Array.isArray(safe.rows) || safe.rows.length < 1) {
    throw new Error("报告不完整");
  }
  if (secret && JSON.stringify(safe).includes(secret)) throw new Error("报告里还有密钥");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(safe));
  const reports = readIndex().filter((row) => row.id !== id);
  reports.unshift({
    id,
    stationId: summary.stationId ?? null,
    host: summary.host || safe.host || "",
    model: summary.model || safe.model || "",
    score: summary.score ?? null,
    at: summary.at || new Date(safe.finishedAt || Date.now()).toISOString(),
    channel: summary.channel || "",
  });
  fs.writeFileSync(indexPath, JSON.stringify({ reports }));
  return id;
}
