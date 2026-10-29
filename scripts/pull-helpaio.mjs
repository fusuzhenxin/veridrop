import https from "node:https";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const publicPath = resolve(root, "src", "station-public.json");
const livePath = resolve(root, "src", "relay-live.json");

function get(url) {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 60000);
    const req = https.request({
      host: target.hostname,
      servername: target.hostname,
      path: target.pathname,
      method: "GET",
      headers: {
        Host: target.host,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
    }, (page) => {
      const chunks = [];
      page.on("data", (chunk) => chunks.push(chunk));
      page.on("end", () => {
        clearTimeout(timer);
        resolvePromise(Buffer.concat(chunks).toString("utf8"));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const FAMILIES = [
  ["gpt", "GPT", /gpt|chatgpt|openai|codex|\bo[134]\b/i],
  ["claude", "Claude", /claude|anthropic|sonnet|opus|fable/i],
  ["gemini", "Gemini", /gemini/i],
  ["grok", "Grok", /\bgrok\b/i],
  ["deepseek", "DeepSeek", /deepseek/i],
  ["kimi", "Kimi", /kimi|moonshot/i],
  ["qwen", "Qwen", /qwen|通义|千问/i],
  ["glm", "GLM", /\bglm\b|智谱|chatglm/i],
];

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function save(path, data) {
  const text = JSON.stringify(data);
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  try { renameSync(tmp, path); } catch { writeFileSync(path, text); }
}

const html = await get("https://www.helpaio.com/transit");
let compare = "";
try { compare = await get("https://www.helpaio.com/transit/compare"); } catch { compare = ""; }
const marks = [];
const stationRe = /noAffUrl\\":\\"(https:[^"\\]+)\\"\}\],\\"stationName\\":\\"([^"\\]+)\\",\\"availabilityPercentage\\":([0-9.]+)/g;
let match;
while ((match = stationRe.exec(html))) {
  marks.push({ at: match.index, url: match[1], name: match[2], uptime: Number(match[3]), models: [] });
}
const blockAt = [];
let cursor = 0;
while (cursor < html.length) {
  const at = html.indexOf("channelGroupsByPayModel", cursor);
  if (at < 0) break;
  blockAt.push(at);
  cursor = at + 24;
}
const priceRe = /groupName\\":\\"([^"\\]+)\\"|modelKey\\":\\"([^"\\]+)\\",\\"inputPricePer1m\\":([0-9.]+),\\"outputPricePer1m\\":([0-9.]+)[\s\S]{0,180}?priceMultiplier\\":([0-9.]+)/g;
for (let index = 0; index < blockAt.length && index < marks.length; index += 1) {
  const slice = html.slice(blockAt[index], blockAt[index + 1] || blockAt[index] + 120000);
  let group = "公开";
  for (const item of slice.matchAll(priceRe)) {
    if (item[1]) {
      group = item[1].replace(/-.*/, "");
      continue;
    }
    const station = marks[index];
    if (station.models.some((model) => model.name === item[2] && model.group === group)) continue;
    station.models.push({
      name: item[2],
      group,
      input: Number(item[3]),
      output: Number(item[4]),
      ratio: Number(item[5]),
      currency: "CNY",
    });
  }
}
const advantageGroups = html.split("优势亮点").slice(1).map((part) => {
  const end = part.indexOf("改进空间");
  const slice = part.slice(0, end > 0 ? end : 800);
  return [...slice.matchAll(/\\"li\\",\\"([^"\\]{8,220})\\"/g)].map((item) => item[1]);
}).filter((items) => items.length);
for (let index = 0; index < marks.length && index < advantageGroups.length; index += 1) {
  marks[index].highlights = advantageGroups[index];
}

const verd = JSON.parse(readFileSync(verdPath, "utf8"));
const pub = JSON.parse(readFileSync(publicPath, "utf8"));
pub.stations = pub.stations || {};
const live = JSON.parse(readFileSync(livePath, "utf8"));

function normName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function findRow(station) {
  const host = hostOf(station.url);
  const byDomain = verd.stations.find((row) => {
    const domain = String(row.domain || "").replace(/^www\./, "").toLowerCase();
    return domain === host || domain === `api.${host}` || domain === `www.${host}` || host === `api.${domain}` || host === `www.${domain}`;
  });
  if (byDomain) return byDomain;
  const key = normName(station.name);
  if (key.length < 4) return null;
  const hits = verd.stations.filter((row) => normName(row.name) === key);
  return hits.length === 1 ? hits[0] : null;
}

const report = [];
for (const station of marks) {
  const host = hostOf(station.url);
  const row = findRow(station);
  const item = { name: station.name, host, uptime: station.uptime, models: station.models.length, matched: Boolean(row), wroteModels: false, wroteUptime: false, wroteBlurb: false };
  if (!row) { report.push(item); continue; }
  if (station.models.length) {
    const previous = pub.stations[String(row.id)] || {};
    const merged = new Map((previous.models || []).map((model) => [String(model.name || model.id).toLowerCase(), { ...model }]));
    for (const model of station.models) {
      const key = model.name.toLowerCase();
      const prior = merged.get(key) || { id: model.name, name: model.name };
      merged.set(key, {
        ...prior,
        id: prior.id || model.name,
        name: model.name,
        group: model.group || prior.group || "公开",
        ratio: model.ratio,
        input: model.input,
        output: model.output,
        currency: "CNY",
      });
    }
    const models = [...merged.values()];
    const families = [];
    const blob = models.map((model) => model.name).join("\n");
    for (const [id, label, re] of FAMILIES) if (re.test(blob)) families.push([id, label]);
    row.modelCount = Math.max(row.modelCount || 0, models.length);
    if (families.length) {
      row.modelIds = families.map((entry) => entry[0]);
      row.modelLabels = families.map((entry) => entry[1]).join("、");
    }
    pub.stations[String(row.id)] = { ...previous, models: models.slice(0, 400) };
    item.wroteModels = true;
  }
  if (station.highlights?.length && !String(row.description || "").includes(station.highlights[0])) {
    const note = `优势：${station.highlights.join("；")}`;
    row.description = String(row.description || "").trim() ? `${row.description.trim()}\n${note}` : note;
    item.wroteBlurb = true;
  }
  const current = live[row.domain];
  if (station.uptime > 0 && (!current || current.uptime == null)) {
    live[row.domain] = { uptime: station.uptime, latency: current?.latency ?? null, promo: current?.promo || "" };
    item.wroteUptime = true;
  }
  report.push(item);
}

for (const domain of ["sub.micuapi.ai", "codecdn.bytecatcode.org", "api.yunwu.ai"]) {
  if (live[domain] && live[domain].promo === "" && live[domain].latency == null) delete live[domain];
}
save(verdPath, verd);
save(publicPath, pub);
save(livePath, live);
const matched = report.filter((item) => item.matched).length;
const wroteModels = report.filter((item) => item.wroteModels).length;
const wroteUptime = report.filter((item) => item.wroteUptime).length;
console.log(JSON.stringify({ stations: marks.length, matched, wroteModels, wroteUptime, report }, null, 2));
