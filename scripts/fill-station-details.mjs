import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = "https://www.zuiquanapi.com";
const write = process.argv.includes("--write");

const MODEL_DEFS = [
  { id: "gpt", label: "GPT", re: /gpt|openai|chatgpt|codex/i },
  { id: "claude", label: "Claude", re: /claude|anthropic|sonnet|opus|fable/i },
  { id: "gemini", label: "Gemini", re: /gemini|谷歌/i },
  { id: "grok", label: "Grok", re: /grok|\bxai\b/i },
  { id: "deepseek", label: "DeepSeek", re: /deepseek/i },
  { id: "kimi", label: "Kimi", re: /kimi|moonshot/i },
  { id: "qwen", label: "Qwen", re: /qwen|通义|千问/i },
  { id: "glm", label: "GLM", re: /glm|智谱/i },
  { id: "image", label: "生图", re: /生图|绘图|image|flux|banana|imagine|midjourney/i },
  { id: "video", label: "视频", re: /视频|video|sora|runway|kling/i },
];

const FEATURE_DEFS = [
  { id: "checkin", re: /签到|打卡领|每日领|签到送|签到领/ },
  { id: "gift", re: /注册送|新用户.{0,8}送|赠送.{0,8}(余额|额度|刀)|试用额度|免费额度|注册即/ },
  { id: "invite", re: /邀请|返利|推广奖励/ },
  { id: "pay", re: /支付宝|微信支付|微信充值|对公/ },
  { id: "crypto", re: /USDT|加密货币/ },
  { id: "cheaprate", re: /低倍率|0\.0\d+|倍率\s*0\.[0-2]/ },
  { id: "invoice", re: /发票|专票|普票/ },
];

function extractBalanced(text, start) {
  if (text[start] !== "[") return "";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function siteArrays(html) {
  const plain = html.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  const arrays = [];
  const marker = "\"sites\":";
  let idx = 0;
  while (idx < plain.length) {
    const at = plain.indexOf(marker, idx);
    if (at < 0) break;
    const start = at + marker.length;
    idx = start + 1;
    if (plain[start] !== "[") continue;
    const raw = extractBalanced(plain, start);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed[0]?.id) arrays.push(parsed);
    } catch (err) {
      if (!arrays.err) arrays.err = err.message + " len=" + raw.length;
    }
  }
  return arrays;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

function inferModels(text) {
  const models = [];
  for (const def of MODEL_DEFS) {
    if (!def.re.test(text)) continue;
    let rate = null;
    const hit = text.match(new RegExp("(?:" + def.id + "|" + def.label + ")(?:-\\d+(?:\\.\\d+)?)?[^0-9]{0,16}(0\\.\\d+)", "i"));
    if (hit && Number(hit[1]) <= 1.5) rate = Number(hit[1]);
    models.push({ id: def.id, label: def.label, rate, mentioned: true });
  }
  return models;
}

function featuresOf(text) {
  return FEATURE_DEFS.filter((def) => def.re.test(text)).map((def) => def.id);
}

function logoOf(value) {
  const text = String(value || "").trim();
  if (!text || text === "?") return "";
  if (text.startsWith("http://") || text.startsWith("https://")) return text;
  if (text.startsWith("/")) return source + text;
  return "";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function metaDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(decodeEntities(match[1]));
  }
  return "";
}

async function pageDescription(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "VeriDropCatalog/1.0", Accept: "text/html" },
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || (type && !/text\/html|text\/plain/i.test(type))) return "";
    try {
      if (new URL(res.url).host !== new URL(url).host) return "";
    } catch {
      return "";
    }
    const html = (await res.text()).slice(0, 180000);
    const text = metaDescription(html);
    if (text.length < 16) return "";
    return text.slice(0, 500);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool(items, limit, worker) {
  const queue = items.slice();
  const runners = Array.from({ length: limit }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

const homeRes = await fetch(source + "/", { headers: { "User-Agent": "VeriDropCatalog/1.0", Accept: "text/html" } });
if (!homeRes.ok) throw new Error("homepage HTTP " + homeRes.status);
const html = await homeRes.text();
const arrays = siteArrays(html);
const remote = new Map();
for (const list of arrays) {
  for (const row of list) {
    if (!row?.id) continue;
    const prev = remote.get(row.id);
    const description = cleanText(row.description);
    if (!prev || description.length > cleanText(prev.description).length) remote.set(row.id, row);
  }
}
const bootRes = await fetch(source + "/api/bootstrap", { headers: { "User-Agent": "VeriDropCatalog/1.0", Accept: "application/json" } });
if (!bootRes.ok) throw new Error("bootstrap HTTP " + bootRes.status);
const bootstrap = await bootRes.json();
const statusMap = bootstrap.status || {};

const verd = JSON.parse(readFileSync(resolve(root, "src", "verd-index.json"), "utf8"));
const stats = { matched: 0, description: 0, models: 0, logo: 0, pay: 0, status: 0, stillBlank: 0 };

function apply(record) {
  const row = remote.get(Number(record.id));
  const status = statusMap[String(record.id)];
  if (!row && !status) return;
  if (row) stats.matched += 1;
  const description = cleanText(row?.description);
  if (description && description.length > cleanText(record.description).length) {
    record.description = description.slice(0, 1200);
    stats.description += 1;
  }
  const text = `${record.name || ""} ${record.description || ""} ${row?.tag || ""}`;
  if (!(record.modelRows || []).length) {
    const models = Array.isArray(row?.models) && row.models.length ? row.models : inferModels(text);
    if (models.length) {
      record.modelIds = [];
      record.modelRows = [];
      const labels = [];
      for (const model of models) {
        const id = String(model.id || "").toLowerCase();
        if (!id || record.modelIds.includes(id)) continue;
        record.modelIds.push(id);
        labels.push(String(model.label || id));
        const rate = Number(model.rate);
        record.modelRows.push({ id, name: String(model.label || id), group: "目录", ratio: Number.isFinite(rate) ? rate : null });
      }
      record.modelCount = record.modelIds.length;
      record.modelLabels = labels.slice(0, 12).join("、");
      stats.models += 1;
    }
  }
  const logo = logoOf(row?.logo);
  if (logo && !record.logo) {
    record.logo = logo;
    stats.logo += 1;
  }
  const nextCategories = [...new Set([...(record.categories || []), ...featuresOf(text)])];
  if (nextCategories.length !== (record.categories || []).length) record.categories = nextCategories;
  const pay = [];
  if (nextCategories.includes("crypto")) pay.push("usdt");
  if (nextCategories.includes("pay")) pay.push("国内");
  if (pay.length && !(record.pay || []).length) {
    record.pay = pay;
    stats.pay += 1;
  }
  record.invoice = nextCategories.includes("invoice");
  if (status) {
    if (typeof status.online === "boolean") record.online = status.online;
    if (status.uptime != null) record.uptime = Number(status.uptime);
    if (status.ms != null) record.ms = Number(status.ms);
    if (status.avgMs != null) record.avgMs = Number(status.avgMs);
    stats.status += 1;
  }
}

for (const record of verd.stations) apply(record);

const blanks = verd.stations.filter((row) => !cleanText(row.description) && /^https?:\/\//i.test(row.url || ""));
let fetched = 0;
let found = 0;
await mapPool(blanks, 16, async (record) => {
  fetched += 1;
  const description = await pageDescription(record.url);
  if (!description || description === record.name) return;
  record.description = description;
  found += 1;
  const text = `${record.name || ""} ${description}`;
  if (!(record.modelRows || []).length) {
    const models = inferModels(text);
    if (models.length) {
      record.modelIds = models.map((model) => model.id);
      record.modelRows = models.map((model) => ({ id: model.id, name: model.label, group: "目录", ratio: model.rate }));
      record.modelCount = models.length;
      record.modelLabels = models.map((model) => model.label).slice(0, 12).join("、");
      stats.models += 1;
    }
  }
  const nextCategories = [...new Set([...(record.categories || []), ...featuresOf(text)])];
  record.categories = nextCategories;
  if (!(record.pay || []).length) {
    const pay = [];
    if (nextCategories.includes("crypto")) pay.push("usdt");
    if (nextCategories.includes("pay")) pay.push("国内");
    if (pay.length) record.pay = pay;
  }
  record.invoice = nextCategories.includes("invoice");
  if (fetched % 200 === 0) console.log(JSON.stringify({ fetched, found, left: blanks.length - fetched }));
});
stats.pageDescriptions = found;
const counts = new Map();
for (const row of verd.stations) {
  const text = cleanText(row.description);
  if (text) counts.set(text, (counts.get(text) || 0) + 1);
}
let cleared = 0;
for (const row of verd.stations) {
  const text = cleanText(row.description);
  if (text && counts.get(text) >= 5) {
    row.description = "";
    cleared += 1;
  }
}
stats.clearedTemplates = cleared;
stats.stillBlank = verd.stations.filter((row) => !cleanText(row.description)).length;

console.log(JSON.stringify({
  remote: remote.size,
  remoteWithDesc: [...remote.values()].filter((row) => cleanText(row.description)).length,
  sampleDesc: cleanText([...remote.values()].find((row) => cleanText(row.description))?.description || "").slice(0, 80),
  arrays: arrays.map((list) => list.length),
  parseError: arrays.err || "",
  ...stats,
  write,
}, null, 2));

if (write) {
  writeFileSync(resolve(root, "src", "verd-index.json"), JSON.stringify(verd));
}
