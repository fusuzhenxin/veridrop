import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runBasicSuite, runAbilitySuites } from "./basic-suite.mjs";
import { publicReport, writeReport } from "../server/basic_report_store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "data/check-schedule.local");
const lockPath = path.join(root, "data/check-schedule-lock.local");
export const chinaDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export function planCheck(previous = {}, day, basicOnly = false) {
  const fullDue = !previous.fullDay || (Date.parse(day) - Date.parse(previous.fullDay)) / 86400000 >= 3;
  if (!basicOnly && fullDue && previous.fullAttemptDay !== day) return "all";
  return previous.basicAttemptDay === day ? "skip" : "basic";
}

function loadState() {
  if (!fs.existsSync(statePath)) return { stations: {} };
  const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!parsed.stations || Array.isArray(parsed.stations)) throw new Error("执行记录格式不正确，请先检查，不会重新跑全部任务");
  return parsed;
}
function saveState(state) {
  const temp = path.join(root, "data/check-schedule-temp.local");
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, statePath);
}
function shareReport(report) {
  const script = "import json,sys;sys.path.insert(0,'server');import shared_reports;print(json.dumps(shared_reports.create(json.load(sys.stdin),'scheduled')))";
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
  for (const key of Object.keys(env)) if (/_BASIC_KEY$/.test(key)) delete env[key];
  const out = spawnSync(process.env.PYTHON || "python", ["-c", script], { cwd: root, env, input: JSON.stringify(report), encoding: "utf8", maxBuffer: 4000000, windowsHide: true });
  if (out.status !== 0) throw new Error("完整报告保存失败，请检查 Python 和报告目录");
  return JSON.parse(out.stdout).path;
}

export async function main(args = process.argv.slice(2)) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "data/basic-daily.json"), "utf8").replace(/^\uFEFF/, ""));
  if (!config.stations?.length) throw new Error("自动检测名单为空");
  const state = loadState();
  const day = chinaDay();
  const basicOnly = args.includes("--basic-only");
  for (const station of config.stations) {
    const url = new URL(station.base);
    if (url.protocol !== "https:" || url.username || url.password || url.search) throw new Error("自动检测地址必须是没有密钥的 HTTPS 地址");
    if (!station.model || !process.env[station.keyEnv]) throw new Error(`${station.host} 缺少模型或加密密钥`);
  }
  if (args.includes("--dry-run")) {
    for (const station of config.stations) console.log(JSON.stringify({ host: station.host, model: station.model, day, next: planCheck(state.stations[station.stationId], day, basicOnly), keyLoaded: true }));
    return;
  }
  let lock;
  try { lock = fs.openSync(lockPath, "wx"); }
  catch (err) {
    if (err.code !== "EEXIST") throw err;
    throw new Error("已有检测运行或上次异常退出留下锁；先确认进程状态，避免重复扣费");
  }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  let failed = false;
  try {
    // Re-read after acquiring the lock, so overlapping launches cannot use stale state.
    const current = loadState();
    for (const station of config.stations) {
      const previous = current.stations[station.stationId] || {};
      const kind = planCheck(previous, day, basicOnly);
      if (kind === "skip") { console.log(`${station.host} 今天已经执行，跳过`); continue; }
      const record = { ...previous, basicAttemptDay: day, ...(kind === "all" ? { fullAttemptDay: day } : {}), startedAt: new Date().toISOString(), status: "running" };
      current.stations[station.stationId] = record;
      saveState(current);
      const key = process.env[station.keyEnv];
      const job = { base: station.base, model: station.model, apiHost: new URL(station.base).hostname, key, candyCount: config.candyCount || 10 };
      try {
        console.log(`${station.host} 开始${kind === "all" ? "三项全测" : "基础测试"} (${station.model})`);
        const basic = await runBasicSuite(job);
        const id = writeReport(basic, { stationId: station.stationId, host: station.host, model: station.model, score: basic.score, at: new Date(basic.finishedAt).toISOString(), channel: station.channel || "OpenAI" }, key);
        record.basicPath = `/b/${id}`;
        record.basicDay = day;
        record.score = basic.score;
        saveState(current);
        if (kind === "all") {
          const abilities = await runAbilitySuites(job);
          const finishedAt = Date.now();
          const report = publicReport({ ...basic, ...abilities, id: `all-${crypto.randomBytes(6).toString("hex")}`, suite: "all", finishedAt,
            rows: [...basic.rows, ...abilities.rows], meter: { requests: basic.meter.requests + abilities.meter.requests,
              input: basic.meter.input + abilities.meter.input, output: basic.meter.output + abilities.meter.output,
              ttftMs: basic.meter.ttftMs, totalMs: finishedAt - basic.started } }, key);
          delete report.complete;
          record.fullPath = shareReport(report);
          if (abilities.complete && basic.score != null) record.fullDay = day;
          else throw new Error(`三项测试未全部完成，已保存报告 ${record.fullPath}`);
        }
        if (basic.score == null) throw new Error("基础测试没有取得有效分数，已保留失败报告");
        record.status = "complete";
        delete record.error;
        console.log(JSON.stringify({ host: station.host, kind, score: record.score, basicPath: record.basicPath, fullPath: kind === "all" ? record.fullPath : undefined }));
      } catch (err) {
        failed = true;
        record.status = "failed";
        record.error = publicReport({ message: String(err.message || err) }, key).message;
        console.error(`${station.host} 失败：${record.error}`);
      } finally {
        record.finishedAt = new Date().toISOString();
        saveState(current);
      }
    }
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("自动检测启动失败，请检查配置、执行记录或运行锁（未输出凭据）"); process.exitCode = 1; });
}
