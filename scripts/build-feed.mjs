import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verd = JSON.parse(readFileSync(resolve(root, "src/verd-index.json"), "utf8"));
const dates = JSON.parse(readFileSync(resolve(root, "src/listed-dates.json"), "utf8"));
const origin = "https://www.veridrop.cn";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pubDate(day) {
  return new Date(`${day}T00:00:00Z`).toUTCString();
}

const items = (verd.stations || [])
  .map((row) => ({ row, day: dates[String(row.id)] || "" }))
  .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day))
  .sort((a, b) => b.day.localeCompare(a.day) || String(a.row.name).localeCompare(String(b.row.name), "zh"))
  .slice(0, 40);

const body = items.map(({ row, day }) => {
  const link = `${origin}/site/${row.token}`;
  const blurb = String(row.description || "").replace(/\s+/g, " ").trim().slice(0, 140);
  return `  <item>
    <title>${esc(`收录 ${row.name}`)}</title>
    <link>${esc(link)}</link>
    <description>${esc(blurb || `${row.name} 已收录到维渡 AI。`)}</description>
    <guid isPermaLink="false">${esc(`${row.token}-${day}`)}</guid>
    <pubDate>${esc(pubDate(day))}</pubDate>
  </item>`;
}).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>维渡 AI 站点动态</title>
  <link>${origin}/</link>
  <description>中转站收录与公开信息更新</description>
  <language>zh-CN</language>
${body}
</channel>
</rss>
`;
writeFileSync(resolve(root, "public/feed.xml"), xml);
console.log(JSON.stringify({ items: items.length }));
