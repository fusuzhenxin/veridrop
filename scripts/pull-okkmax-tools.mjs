import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iqFile = join(root, "src", "iq.json");
const codexFile = join(root, "src", "codex.json");

function extractRows(html, marker) {
  const hit = html.indexOf(marker);
  if (hit < 0) throw new Error(`页面里没有 ${marker}`);
  const start = html.lastIndexOf('{\\"rows\\":[', hit);
  if (start < 0) throw new Error("没有找到 rows");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = start;
  for (; end < html.length; end += 1) {
    const char = html[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  const parsed = JSON.parse(html.slice(start, end).replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  if (!Array.isArray(parsed.rows) || !parsed.rows.length) throw new Error("rows 是空的");
  return parsed.rows;
}

async function page(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.text();
}

const [iqHtml, codexHtml] = await Promise.all([
  page("https://www.okkmax.com/tools/iq"),
  page("https://www.okkmax.com/tools/codex-resets"),
]);
const iqRows = extractRows(iqHtml, '\\"hmed\\"');
const codexRows = extractRows(codexHtml, "announcedAt");
if (!iqRows.every((row) => row.slug && Number.isFinite(row.cur))) throw new Error("智商榜缺字段");
if (!codexRows.every((row) => row.id && row.announcedAt)) throw new Error("重置记录缺字段");

const localIq = JSON.parse(await readFile(iqFile, "utf8"));
const localCodex = JSON.parse(await readFile(codexFile, "utf8"));
const localScore = new Map(localIq.map((row) => [row.slug, row.cur]));
const localIds = new Set(localCodex.map((row) => row.id));
const scoreChanges = iqRows.filter((row) => localScore.get(row.slug) !== row.cur);
const dropped = localIq.filter((row) => !iqRows.some((row2) => row2.slug === row.slug)).map((row) => row.slug);
const addedResets = codexRows.filter((row) => !localIds.has(row.id));

if (!scoreChanges.length && !dropped.length && !addedResets.length && iqRows.length === localIq.length) {
  console.log(`没有新数据。智商榜 ${iqRows.length} 条，重置 ${codexRows.length} 条。`);
} else {
  await writeFile(iqFile, `${JSON.stringify(iqRows, null, 2)}\n`);
  await writeFile(codexFile, JSON.stringify(codexRows));
  console.log(`智商榜 ${localIq.length} -> ${iqRows.length}，分数变化 ${scoreChanges.length}，去掉 ${dropped.join("、") || "无"}`);
  console.log(scoreChanges.slice(0, 8).map((row) => `${row.display} ${localScore.get(row.slug) ?? "新"} -> ${row.cur}`).join("\n"));
  console.log(`重置新增 ${addedResets.length}`);
  console.log(addedResets.map((row) => `${String(row.announcedAt).replace(/^\$D/, "")} ${row.textEn}`).join("\n"));
}
