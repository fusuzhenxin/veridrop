import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const api = "G:\\Project\\html\\api";
const origin = "https://www.veridrop.cn";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normHost(value) {
  let text = String(value || "").trim().toLowerCase();
  text = text.replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0];
  if (text.startsWith("www.")) text = text.slice(4);
  return text;
}

function clip(value, max) {
  const text = String(value || "").replace(/\r/g, "").replace(/\s+\n/g, "\n").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function listedDay(value) {
  const matched = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (year < 2020 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
}

const STATUS_TAGS = new Set(["highup", "fast"]);

function withStatusTags(site) {
  const categories = (site.categories || []).filter((id) => !STATUS_TAGS.has(id));
  const status = site.status || {};
  const up = num(status.uptime);
  const ms = status.avgMs != null ? num(status.avgMs) : num(status.ms);
  if (status.online && up != null && up >= 99.8) categories.push("highup");
  if (ms != null && ms > 0 && ms < 400) categories.push("fast");
  return categories;
}

const raw = JSON.parse(readFileSync(resolve(api, "data", "stations.json"), "utf8"));
const catalog = JSON.parse(readFileSync(resolve(root, "src", "catalog.json"), "utf8"));
const modelRows = JSON.parse(readFileSync(resolve(root, "src", "model-rows.json"), "utf8"));
const skins = JSON.parse(readFileSync(resolve(root, "src", "skins.json"), "utf8"));
const sitemap = readFileSync(resolve(api, "sitemap-sites.xml"), "utf8");
const tokenById = new Map();
for (const match of sitemap.matchAll(/\/site\/([^<\s]+)/g)) {
  const token = decodeURIComponent(match[1]).replace(/\/$/, "");
  const id = token.match(/^(\d+)/)?.[1];
  if (id && !tokenById.has(id)) tokenById.set(id, token);
}

const okkHosts = new Set();
for (const row of catalog.stations || []) {
  const host = normHost(row.host || row.url);
  if (host) okkHosts.add(host);
}

function tokenFor(site) {
  const known = tokenById.get(String(site.id));
  if (known) return known;
  const slug = slugify(site.domain || site.name || "");
  return slug ? `${site.id}-${slug}` : String(site.id);
}

function payOf(categories) {
  const pay = [];
  if (categories.includes("crypto")) pay.push("usdt");
  if (categories.includes("pay")) pay.push("国内");
  return pay;
}

const stations = [];
const attach = [];
const tokens = new Set();
let matched = 0;

for (const site of raw.stations || []) {
  const categories = withStatusTags(site);
  const models = Array.isArray(site.models) ? site.models : [];
  const modelIds = [];
  const modelRowsOut = [];
  const labels = [];
  for (const model of models) {
    const id = String(model.id || "").toLowerCase();
    if (!id || modelIds.includes(id)) continue;
    modelIds.push(id);
    const label = String(model.label || id);
    labels.push(label);
    const rate = num(model.rate);
    modelRowsOut.push({ id, name: label, group: "目录", ratio: rate });
  }
  const votes = site.votes && typeof site.votes === "object" ? site.votes : {};
  const up = num(votes.up) || 0;
  const down = num(votes.down) || 0;
  const status = site.status || {};
  const token = tokenFor(site);
  const record = {
    id: site.id,
    token,
    name: String(site.name || site.domain || token),
    domain: String(site.domain || ""),
    host: normHost(site.domain || site.url),
    url: String(site.url || ""),
    logo: String(site.logo || ""),
    tag: String(site.tag || ""),
    description: clip(site.description, 1200),
    categories,
    modelIds,
    modelCount: modelIds.length,
    modelLabels: labels.slice(0, 12).join("、"),
    modelRows: modelRowsOut,
    rank: num(site.rank),
    listed: listedDay(site.createdAt),
    voteUp: up,
    voteDown: down,
    voteScore: up - down,
    online: typeof status.online === "boolean" ? status.online : null,
    uptime: num(status.uptime),
    ms: num(status.ms),
    avgMs: num(status.avgMs),
    ownerPick: Boolean(site.ownerPick),
    invoice: categories.includes("invoice"),
    pay: payOf(categories),
  };
  if (record.logo.startsWith("/")) record.logo = `${origin}${record.logo}`;
  if (tokens.has(token)) record.token = `${token}-${site.id}`;
  tokens.add(record.token);
  if (record.host && okkHosts.has(record.host)) {
    matched += 1;
    attach.push({
      host: record.host,
      token: record.token,
      id: record.id,
      categories: record.categories,
      modelIds: record.modelIds,
      online: record.online,
      ownerPick: record.ownerPick,
      rank: record.rank,
      listed: record.listed,
      voteUp: record.voteUp,
      voteDown: record.voteDown,
      voteScore: record.voteScore,
      invoice: record.invoice,
      pay: record.pay,
    });
  } else {
    stations.push(record);
  }
}

stations.sort((a, b) => (a.rank ?? 999999) - (b.rank ?? 999999) || (b.voteScore - a.voteScore) || (a.id - b.id));

const official = (raw.official || []).map((item) => ({
  provider: item.provider,
  label: item.label || item.provider,
  online: item.online === true,
  level: item.level || "",
  status: item.status || "",
  sub: item.sub || "",
  components: (item.components || []).slice(0, 16).map((part) => ({
    name: part.label || part.name || "",
    status: part.status || "",
    uptime: num(part.uptime),
    days: (part.days || []).slice(0, 90).map((day) => ({
      date: day.date || "",
      level: day.level === "warn" || day.level === "down" ? day.level : "ok",
    })),
  })),
  incidents: (item.incidents || []).slice(0, 6).map((incident) => ({
    title: clip(incident.title, 160),
    status: incident.status || "",
    date: incident.date || "",
    desc: clip(incident.desc, 220),
  })),
}));

const missing = [];
for (const token of tokenById.values()) {
  const aliased = attach.some((item) => item.token === token);
  const listed = stations.some((item) => item.token === token);
  if (!aliased && !listed) missing.push(token);
}
if (missing.length) {
  throw new Error(`sitemap tokens missing: ${missing.slice(0, 8).join(", ")}`);
}

writeFileSync(resolve(root, "src", "verd-index.json"), JSON.stringify({
  stations,
  attach,
  official,
  officialUpdated: raw.officialUpdatedAt || raw.updatedAt || "",
}));

function xml(url) {
  return `  <url><loc>${origin}${url}</loc><lastmod>2026-10-30</lastmod></url>`;
}

const pages = [
  "/",
  "/list",
  "/check",
  "/apply",
  "/check/detect",
  "/check/basic",
  "/check/candy",
  "/check/pelican",
  "/reputation",
  "/activity",
  "/availability",
  "/model",
  "/help",
  "/about",
  "/disclaimer",
  "/privacy",
  "/terms",
  "/points",
  "/agents",
  "/tools/iq",
  "/tools/codex-resets",
  "/tools/skins",
  "/tools/api-speed",
];
for (const [id] of [
  ["charity"], ["owner"], ["checkin"], ["gift"], ["cheaprate"], ["fast"], ["pay"], ["invite"], ["crypto"], ["invoice"], ["highup"], ["stable"], ["cheap"], ["special"], ["new"], ["online"],
]) pages.push(`/cat/${id}`);
for (const id of ["gpt", "claude", "gemini", "grok", "deepseek", "kimi", "qwen", "glm", "image", "video"]) pages.push(`/model/${id}`);
for (const id of ["openai", "anthropic", "gemini", "deepseek", "moonshot", "xai"]) pages.push(`/official/${id}`);
for (const row of catalog.stations || []) pages.push(`/site/${row.slug}`);
for (const row of modelRows) if (row.slug) pages.push(`/model/${row.slug}`);
for (const skin of skins) if (skin.id) pages.push(`/tools/skins/${skin.id}`);

const siteUrls = [];
for (const token of tokenById.values()) siteUrls.push(`/site/${token}`);
for (const row of stations) {
  const path = `/site/${row.token}`;
  if (!siteUrls.includes(path)) siteUrls.push(path);
}
for (const row of attach) {
  const path = `/site/${row.token}`;
  if (!siteUrls.includes(path)) siteUrls.push(path);
}

const pageXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(xml).join("\n")}\n</urlset>\n`;
const siteXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${siteUrls.map(xml).join("\n")}\n</urlset>\n`;
const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap><loc>${origin}/sitemap-pages.xml</loc><lastmod>2026-10-30</lastmod></sitemap>\n  <sitemap><loc>${origin}/sitemap-sites.xml</loc><lastmod>2026-10-30</lastmod></sitemap>\n</sitemapindex>\n`;
writeFileSync(resolve(root, "public", "sitemap-pages.xml"), pageXml);
writeFileSync(resolve(root, "public", "sitemap-sites.xml"), siteXml);
writeFileSync(resolve(root, "public", "sitemap.xml"), indexXml);
writeFileSync(resolve(root, "public", "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);

const counts = {};
for (const row of stations) {
  for (const id of row.categories) counts[id] = (counts[id] || 0) + 1;
}
console.log(JSON.stringify({
  verd: (raw.stations || []).length,
  added: stations.length,
  aliased: matched,
  sitemapTokens: tokenById.size,
  siteUrls: siteUrls.length,
  pages: pages.length,
  okk: (catalog.stations || []).length,
  counts,
}, null, 2));
