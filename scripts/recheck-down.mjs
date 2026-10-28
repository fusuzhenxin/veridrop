import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verd = JSON.parse(readFileSync(resolve(root, "src", "verd-index.json"), "utf8"));
const catalog = JSON.parse(readFileSync(resolve(root, "src", "catalog.json"), "utf8"));

function hostOf(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
}

const targets = [];
for (const row of verd.stations || []) {
  if (row.online !== false) continue;
  targets.push({ source: "verd", id: row.id, name: row.name, url: row.url || (row.domain ? `https://${row.domain}` : ""), host: hostOf(row.domain || row.host || row.url) });
}
for (const row of catalog.stations || []) {
  if (!row.cnDown) continue;
  targets.push({ source: "catalog", id: row.slug, name: row.name, url: row.url || "", host: hostOf(row.host || row.url) });
}

const byHost = new Map();
for (const item of targets) {
  if (!item.url) continue;
  if (!byHost.has(item.host)) byHost.set(item.host, item);
}

async function probe(item) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(item.url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "VeriDropCatalog/1.0", Accept: "text/html" },
    });
    let finalHost = "";
    try { finalHost = hostOf(res.url); } catch { finalHost = ""; }
    const kind = res.status >= 200 && res.status < 400 ? "open" : "http";
    return { ...item, kind, status: res.status, ms: Date.now() - started, finalHost, moved: Boolean(finalHost && item.host && finalHost !== item.host) };
  } catch (error) {
    const message = String(error?.cause?.code || error?.code || error?.name || error?.message || "error");
    let kind = "error";
    if (/abort|timeout/i.test(message)) kind = "timeout";
    else if (/ENOTFOUND|EAI_AGAIN|dns/i.test(message)) kind = "dns";
    else if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(message)) kind = "refused";
    else if (/cert|ssl|tls/i.test(message)) kind = "tls";
    return { ...item, kind, status: 0, ms: Date.now() - started, error: message.slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const unique = [...byHost.values()].filter((item) => /^https?:\/\//i.test(item.url));
console.log(JSON.stringify({ marked: targets.length, uniqueHosts: unique.length, noUrl: targets.filter((item) => !/^https?:\/\//i.test(item.url)).length }));
const results = [];
let done = 0;
const queue = unique.slice();
await Promise.all(Array.from({ length: 20 }, async () => {
  while (queue.length) {
    const item = queue.shift();
    results.push(await probe(item));
    done += 1;
    if (done % 100 === 0) console.log(JSON.stringify({ done, left: unique.length - done }));
  }
}));

const summary = {};
for (const row of results) summary[row.kind] = (summary[row.kind] || 0) + 1;
const moved = results.filter((row) => row.moved).length;
const out = resolve("C:/Users/Admin/AppData/Local/Temp", "veridrop-down-recheck.json");
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), marked: targets.length, unique: unique.length, summary, moved, results }, null, 2));
console.log(JSON.stringify({ unique: unique.length, summary, moved, file: out }));
