import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReport } from "../server/basic_report_store.mjs";
import { runBasicSuite } from "./basic-suite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "data", "basic-daily.json");

function hostOf(base) {
  try {
    return new URL(base).host;
  } catch {
    return "";
  }
}

if (!fs.existsSync(configPath)) {
  console.log("没有 data/basic-daily.json，今天不跑。名单格式见 data/basic-daily.example.json，密钥放在环境变量里。");
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const stations = Array.isArray(config.stations) ? config.stations : [];
if (!stations.length) {
  console.log("名单是空的，今天不跑。");
  process.exit(0);
}

for (const station of stations) {
  const label = station.host || station.base || station.stationId || "站点";
  const key = String(process.env[station.keyEnv || ""] || "");
  if (!station.base || !station.model || key.length < 12) {
    console.log(`${label} 跳过：缺接口、模型或环境变量 ${station.keyEnv || ""}`);
    continue;
  }
  try {
    const report = await runBasicSuite({
      key,
      base: station.base,
      model: station.model,
      apiHost: hostOf(station.base),
    });
    if (report.score == null) {
      console.log(`${label} ${station.model} 没测成，不写报告`);
      continue;
    }
    const id = writeReport(report, {
      stationId: station.stationId ?? null,
      host: station.host || hostOf(station.base),
      model: station.model,
      score: report.score,
      at: new Date(report.finishedAt).toISOString(),
      channel: station.channel || "",
    }, key);
    console.log(`${label} ${station.model} ${report.score} 分 ${id}`);
  } catch (err) {
    const message = String(err && err.message || err).split(key).join("[redacted]");
    console.log(`${label} ${station.model} 失败：${message}`);
  }
}
