import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(readFileSync("C:/Users/Admin/AppData/Local/Temp/veridrop-down-recheck.json", "utf8"));
const verd = JSON.parse(readFileSync(resolve(root, "src", "verd-index.json"), "utf8"));
const catalog = JSON.parse(readFileSync(resolve(root, "src", "catalog.json"), "utf8"));

function hostOf(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
}

const drop = new Set();
const heal = new Set();
for (const row of report.results) {
  const host = hostOf(row.host);
  if (!host) continue;
  if (row.kind === "dns" || row.kind === "refused" || (row.kind === "http" && (row.status === 404 || row.status === 410)) || host === "topjl.cn" || host === "api.topjl.cn") {
    drop.add(host);
  } else if (row.kind === "open" && host !== "openai-sb.com") {
    heal.add(host);
  }
}

const beforeVerd = verd.stations.length;
const beforeCatalog = catalog.stations.length;
const removedTokens = new Set();
const removedSlugs = new Set();
verd.stations = verd.stations.filter((row) => {
  const host = hostOf(row.domain || row.host || row.url);
  if (!drop.has(host)) return true;
  if (row.token) removedTokens.add(row.token);
  return false;
});
catalog.stations = catalog.stations.filter((row) => {
  const host = hostOf(row.host || row.url);
  if (!drop.has(host)) return true;
  if (row.slug) removedSlugs.add(row.slug);
  return false;
});
if (Array.isArray(verd.attach)) {
  verd.attach = verd.attach.filter((row) => !drop.has(hostOf(row.host)));
}

let healedVerd = 0;
let healedCatalog = 0;
for (const row of verd.stations) {
  const host = hostOf(row.domain || row.host || row.url);
  if (!heal.has(host) || row.online === true) continue;
  row.online = true;
  healedVerd += 1;
}
for (const row of verd.attach || []) {
  if (heal.has(hostOf(row.host))) row.online = true;
}
for (const row of catalog.stations) {
  const host = hostOf(row.host || row.url);
  if (!heal.has(host) || row.cnDown !== true) continue;
  row.cnDown = false;
  healedCatalog += 1;
}

writeFileSync(resolve(root, "src", "verd-index.json"), JSON.stringify(verd));
writeFileSync(resolve(root, "src", "catalog.json"), JSON.stringify(catalog));

function stripSitemap(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n").filter((line) => {
    const match = line.match(/\/site\/([^<]+)</);
    if (!match) return true;
    const key = decodeURIComponent(match[1]);
    return !removedTokens.has(key) && !removedSlugs.has(key);
  });
  writeFileSync(file, lines.join("\n"));
  return text.split("\n").length - lines.length;
}

const sitemapPages = stripSitemap(resolve(root, "public", "sitemap-pages.xml"));
const sitemapSites = stripSitemap(resolve(root, "public", "sitemap-sites.xml"));
console.log(JSON.stringify({
  dropHosts: drop.size,
  healHosts: heal.size,
  removedVerd: beforeVerd - verd.stations.length,
  removedCatalog: beforeCatalog - catalog.stations.length,
  healedVerd,
  healedCatalog,
  sitemapPages,
  sitemapSites,
}));
