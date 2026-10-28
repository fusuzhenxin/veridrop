import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "src", "verd-index.json");
const verd = JSON.parse(readFileSync(file, "utf8"));

function clean(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function junk(text, name) {
  const value = clean(text);
  if (value.length < 20 || value.length > 800) return true;
  const lower = value.toLowerCase();
  if (/just a moment|attention required|enable javascript|cloudflare|access denied|403 forbidden|404 not found|nginx|welcome to nginx/i.test(lower)) return true;
  if (/^(登录|注册|首页|欢迎|welcome|sign in|log in)[.!！。\s]*$/i.test(value)) return true;
  const station = clean(name);
  if (station && (value === station || value.replace(/\s/g, "") === station.replace(/\s/g, ""))) return true;
  return false;
}

function meta(html, pattern) {
  const match = html.match(pattern);
  return match ? clean(match[1]) : "";
}

function fromHtml(html, name) {
  const found = [
    meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    meta(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i),
    meta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    meta(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i),
    meta(html, /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i),
    meta(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i),
  ];
  const jsonBlock = found.pop() || "";
  if (jsonBlock) {
    const desc = jsonBlock.match(/"description"\s*:\s*"([^"\\]{20,500})"/);
    if (desc) found.push(clean(desc[1]));
  }
  const title = meta(html, /<title>([^<]{8,160})<\/title>/i);
  if (title && !title.startsWith(clean(name))) found.push(title);
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const paragraph = clean(plain).split(/(?<=[。！？.!?])\s+/).find((part) => part.length >= 24 && part.length <= 280);
  if (paragraph) found.push(paragraph);
  return found.find((item) => !junk(item, name)) || "";
}

async function fetchText(url, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "VeriDropCatalog/1.0", Accept: "text/html,text/plain" },
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok) return "";
    try {
      if (new URL(res.url).host !== new URL(url).host && !url.includes("r.jina.ai")) return "";
    } catch {
      return "";
    }
    if (type && !/text\/html|text\/plain|markdown/i.test(type) && !url.includes("r.jina.ai")) return "";
    return (await res.text()).slice(0, 220000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function fromJina(text, name) {
  const body = text.split("Markdown Content:")[1] || text;
  const lines = body.split("\n").map((line) => clean(line.replace(/^#+\s*/, ""))).filter(Boolean);
  return lines.find((line) => !junk(line, name) && !/^title:|^url source:/i.test(line)) || "";
}

async function mapPool(items, limit, worker) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

const blanks = verd.stations.filter((row) => !clean(row.description) && /^https?:\/\//i.test(row.url || ""));
console.log(JSON.stringify({ blanks: blanks.length }));
let homeFound = 0;
let seen = 0;
await mapPool(blanks, 12, async (row) => {
  seen += 1;
  const html = await fetchText(row.url, 8000);
  const text = html ? fromHtml(html, row.name) : "";
  if (text) {
    row.description = text.slice(0, 500);
    homeFound += 1;
  }
  if (seen % 200 === 0) console.log(JSON.stringify({ seen, homeFound, left: blanks.length - seen }));
});

const still = verd.stations.filter((row) => !clean(row.description) && /^https?:\/\//i.test(row.url || ""));
let jinaFound = 0;
let jinaSeen = 0;
await mapPool(still, 4, async (row) => {
  jinaSeen += 1;
  const text = fromJina(await fetchText(`https://r.jina.ai/${row.url}`, 14000), row.name);
  if (text) {
    row.description = text.slice(0, 500);
    jinaFound += 1;
  }
  if (jinaSeen % 100 === 0) console.log(JSON.stringify({ jinaSeen, jinaFound, left: still.length - jinaSeen }));
});

const counts = new Map();
for (const row of verd.stations) {
  const text = clean(row.description);
  if (text) counts.set(text, (counts.get(text) || 0) + 1);
}
let cleared = 0;
for (const row of verd.stations) {
  const text = clean(row.description);
  if (text && counts.get(text) >= 5) {
    row.description = "";
    cleared += 1;
  }
}
const described = verd.stations.filter((row) => clean(row.description)).length;
writeFileSync(file, JSON.stringify(verd));
console.log(JSON.stringify({ homeFound, jinaFound, cleared, described, blank: verd.stations.length - described }));
