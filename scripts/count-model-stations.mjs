import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rows = JSON.parse(readFileSync(resolve(root, "src/model-rows.json"), "utf8"));
const verd = JSON.parse(readFileSync(resolve(root, "src/verd-index.json"), "utf8")).stations || [];
const pub = JSON.parse(readFileSync(resolve(root, "src/station-public.json"), "utf8")).stations || {};

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sameModel(model, slug) {
  const id = String(model?.id || "").toLowerCase();
  const name = String(model?.name || "").toLowerCase();
  const key = String(slug || "").toLowerCase();
  if (!key) return false;
  return id === key || name === key || id.replace(/\./g, "-") === key || name.replace(/\./g, "-") === key;
}

function boardOf(slug) {
  try {
    return JSON.parse(readFileSync(resolve(root, "public/model-board", `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
}

let changed = 0;
for (const row of rows) {
  const board = boardOf(row.slug);
  const crawled = board?.rows || [];
  const taken = { slugs: new Set(), names: new Set(), hosts: new Set() };
  for (const item of crawled) {
    if (item.slug) taken.slugs.add(String(item.slug).toLowerCase());
    const name = norm(item.name);
    if (name) taken.names.add(name);
    const host = hostOf(item.href);
    if (host) taken.hosts.add(host);
  }
  let own = 0;
  for (const station of verd) {
    const models = pub[String(station.id)]?.models || station.modelRows || [];
    if (!models.some((model) => sameModel(model, row.slug))) continue;
    const slugKey = String(station.token || "").toLowerCase();
    const name = norm(station.name);
    const host = hostOf(station.url) || String(station.domain || "").replace(/^www\./, "").toLowerCase();
    if ((slugKey && taken.slugs.has(slugKey)) || (name && taken.names.has(name)) || (host && taken.hosts.has(host))) continue;
    own += 1;
  }
  const next = crawled.length + own;
  if (next !== row.stations) changed += 1;
  row.stations = next;
}

writeFileSync(resolve(root, "src/model-rows.json"), `${JSON.stringify(rows, null, 2)}\n`);
const sample = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "gpt-6-astra", "gpt-6.1-sol", "gemini-3.1-pro-preview", "deepseek-v4.1-flash", "gemini-4-argon", "claude-haiku-5-5"];
for (const slug of sample) {
  const row = rows.find((item) => item.slug === slug);
  console.log(`${row.title}\t${row.stations}`);
}
console.log(`updated ${changed}/${rows.length}`);
