import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(resolve(root, "src", "catalog.json"), "utf8"));
const verd = JSON.parse(readFileSync(resolve(root, "src", "verd-index.json"), "utf8"));

function hostOf(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
}

const byHost = new Map();
const map = {};
for (const row of catalog.stations || []) {
  if (!row.slug) continue;
  map[row.slug] = `/site/${row.slug}`;
  const host = hostOf(row.host || row.url);
  if (host && !byHost.has(host)) byHost.set(host, row.slug);
}
for (const row of verd.attach || []) {
  const slug = byHost.get(hostOf(row.host));
  if (!slug || !row.token) continue;
  map[slug] = `/site/${row.token}`;
  map[row.token] = `/site/${row.token}`;
}
for (const row of verd.stations || []) {
  if (row.token) map[row.token] = `/site/${row.token}`;
}
writeFileSync(resolve(root, "data", "station-redirects.json"), JSON.stringify(map));
console.log(JSON.stringify({ keys: Object.keys(map).length }));
