import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verdPath = resolve(root, "src", "verd-index.json");
const publicPath = resolve(root, "src", "station-public.json");
const progressPath = resolve(root, "data", "model-list-progress.json");
const proxyUrl = new URL(process.env.HTTPS_PROXY || "http://127.0.0.1:7897");
mkdirSync(resolve(root, "data"), { recursive: true });

const FAMILIES = [
  ["gpt", "GPT", /gpt|chatgpt|openai|codex|\bo[134]\b/i],
  ["claude", "Claude", /claude|anthropic|sonnet|opus|fable/i],
  ["gemini", "Gemini", /gemini/i],
  ["grok", "Grok", /\bgrok\b/i],
  ["deepseek", "DeepSeek", /deepseek/i],
  ["kimi", "Kimi", /kimi|moonshot/i],
  ["qwen", "Qwen", /qwen|通义|千问/i],
  ["glm", "GLM", /\bglm\b|智谱|chatglm/i],
  ["image", "生图", /dall-e|flux|midjourney|stable-diffusion|imagen|生图/i],
  ["video", "视频", /\bsora\b|kling|veo-|生视频/i],
];

const verd = JSON.parse(readFileSync(verdPath, "utf8"));
const pub = JSON.parse(readFileSync(publicPath, "utf8"));
pub.stations = pub.stations || {};
let progress = {};
try { progress = JSON.parse(readFileSync(progressPath, "utf8")); } catch { progress = {}; }

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function saveJson(path, data) {
  const text = JSON.stringify(data);
  const tmp = path + ".tmp";
  writeFileSync(tmp, text);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { renameSync(tmp, path); return; } catch { await sleep(250); }
  }
  writeFileSync(path, text);
}

function request(url, proxy) {
  const target = new URL(url);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise({ status: 0, body: "" }), proxy ? 10000 : 8000);
    const headers = {
      Host: target.host,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: `${target.origin}/pricing`,
    };
    const finish = (status, chunks) => { clearTimeout(timer); resolvePromise({ status, body: Buffer.concat(chunks).toString("utf8") }); };
    const collect = (page) => {
      const chunks = [];
      let size = 0;
      page.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1500000) { page.destroy(); finish(page.statusCode || 0, chunks); return; }
        chunks.push(chunk);
      });
      page.on("end", () => finish(page.statusCode || 0, chunks));
    };
    const start = (socket) => {
      const req = https.request({
        host: target.hostname,
        servername: target.hostname,
        path: target.pathname + target.search,
        method: "GET",
        headers,
        socket,
        agent: socket ? false : undefined,
      }, collect);
      req.on("error", () => { clearTimeout(timer); resolvePromise({ status: 0, body: "" }); });
      req.end();
    };
    if (proxy) {
      const connect = http.request({ host: proxyUrl.hostname, port: proxyUrl.port || 80, method: "CONNECT", path: `${target.hostname}:443` });
      connect.on("connect", (res, socket) => {
        if ((res.statusCode || 0) !== 200) { socket.destroy(); clearTimeout(timer); resolvePromise({ status: 0, body: "" }); return; }
        start(socket);
      });
      connect.on("error", () => { clearTimeout(timer); resolvePromise({ status: 0, body: "" }); });
      connect.end();
      return;
    }
    start();
  });
}

async function fetchUrl(url) {
  const direct = await request(url, false);
  if (direct.status >= 200 && direct.status < 400 && direct.body && !/Attention Required|you have been blocked/i.test(direct.body)) return direct;
  return request(url, true);
}

function addModel(list, seen, name, ratio) {
  const text = String(name || "").trim();
  if (!text || text.length > 100 || seen.has(text.toLowerCase())) return;
  if (!/[a-z0-9]/i.test(text)) return;
  seen.add(text.toLowerCase());
  const numeric = Number(ratio);
  list.push({ name: text, ratio: Number.isFinite(numeric) ? numeric : null });
}

function modelsFrom(body) {
  let json;
  try { json = JSON.parse(body); } catch { return []; }
  const list = [];
  const seen = new Set();
  const data = Array.isArray(json?.data) ? json.data : [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    addModel(list, seen, item.model_name || item.id || item.name, item.model_ratio);
  }
  const groups = json.groups || json.data?.groups || [];
  if (Array.isArray(groups)) {
    for (const group of groups) {
      for (const model of group?.models || []) {
        if (typeof model === "string") addModel(list, seen, model, null);
        else addModel(list, seen, model?.name || model?.model_name || model?.id, model?.model_ratio ?? model?.ratio);
      }
    }
  }
  return list;
}

function familiesOf(models) {
  const found = [];
  const text = models.map((model) => model.name).join("\n");
  for (const [id] of FAMILIES) {
    const rule = FAMILIES.find((item) => item[0] === id);
    if (rule[2].test(text) && !found.includes(id)) found.push(id);
  }
  return found;
}

function apply(row, models) {
  const families = familiesOf(models);
  row.modelCount = models.length;
  row.modelIds = families;
  row.modelLabels = families.map((id) => FAMILIES.find((item) => item[0] === id)?.[1] || id).join("、");
  row.modelRows = families.map((id) => ({ id, name: FAMILIES.find((item) => item[0] === id)?.[1] || id, group: "公开", ratio: null }));
  const previous = pub.stations[String(row.id)] || {};
  pub.stations[String(row.id)] = {
    ...previous,
    models: models.slice(0, 600).map((model) => ({ id: model.name, name: model.name, group: "公开", ratio: model.ratio })),
  };
}

const jobs = (verd.stations || []).filter((row) => {
  if (!/^https?:\/\//i.test(row.url || "")) return false;
  if (progress[row.token]) return false;
  const count = row.modelCount || 0;
  return count <= 2 || row.domain === "fluxlane.cn" || row.domain === "wawapii.com";
});
console.log(JSON.stringify({ todo: jobs.length }));

let done = 0;
let filled = 0;
const queue = jobs.slice();

async function one(row) {
  let origin = "";
  try { origin = new URL(row.url).origin; } catch { return { status: "bad-url", count: 0 }; }
  const paths = ["/api/pricing", "/api/v1/model-plaza", "/api/provider/pricing"];
  let best = [];
  let last = "empty";
  for (const path of paths) {
    const page = await fetchUrl(origin + path);
    if (!page.body) { last = "down"; continue; }
    if (page.status === 401 || page.status === 403) { last = "auth"; continue; }
    const models = modelsFrom(page.body);
    if (models.length > best.length) {
      best = models;
      last = "ok";
    }
    if (best.length > (row.modelCount || 0)) break;
  }
  if (best.length > (row.modelCount || 0)) {
    apply(row, best);
    filled += 1;
    return { status: "filled", count: best.length };
  }
  return { status: last, count: best.length };
}

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    let result = { status: "error", count: 0 };
    try { result = await one(row); } catch { result = { status: "error", count: 0 }; }
    progress[row.token] = result;
    done += 1;
    if (done % 20 === 0 || done === jobs.length) {
      await saveJson(progressPath, progress);
      if (filled) {
        await saveJson(verdPath, verd);
        await saveJson(publicPath, pub);
      }
      console.log(JSON.stringify({ done, left: jobs.length - done, filled, last: row.domain, ...result }));
    }
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()));
await saveJson(progressPath, progress);
await saveJson(verdPath, verd);
await saveJson(publicPath, pub);
console.log(JSON.stringify({ done, filled }));
