import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "model-board");
const source = "https://www.okkmax.com/model/";

function flightText(html) {
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g;
  let out = "";
  let match;
  while ((match = re.exec(html))) {
    try {
      const parsed = JSON.parse(match[1]);
      if (typeof parsed[1] === "string") out += parsed[1];
    } catch {
      /* keep going; a chunk that is not JSON is not the offer table */
    }
  }
  return out;
}

function sliceJson(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (char === "\\") esc = true;
      else if (char === '"') inStr = false;
      continue;
    }
    if (char === '"') {
      inStr = true;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function cleanHref(url) {
  try {
    const next = new URL(url);
    if (/(^|\.)okkmax\.com$/i.test(next.hostname)) return "";
    for (const key of [...next.searchParams.keys()]) {
      const name = key.toLowerCase();
      if (name.startsWith("utm_") || name === "aff") next.searchParams.delete(key);
    }
    return next.toString();
  } catch {
    return "";
  }
}

function cleanLogo(url) {
  if (!url || url.startsWith("/")) return "";
  try {
    const next = new URL(url);
    if (/(^|\.)okkmax\.com$/i.test(next.hostname)) return "";
    return next.toString();
  } catch {
    return "";
  }
}

function packGroup(group) {
  if (!group || typeof group !== "object") return null;
  return {
    name: group.name || "",
    in: group.in ?? null,
    out: group.out ?? null,
    cache: group.cache ?? null,
    avail: group.avail ?? null,
    latencyMs: group.latencyMs ?? null,
    points: Array.isArray(group.points) ? group.points.map((point) => [point?.t || 0, point?.av ?? -1]) : [],
  };
}

function decodeText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseModelHtml(html) {
  const flight = flightText(html);
  const marker = flight.indexOf('"rows":[');
  let rows = [];
  if (marker >= 0) {
    const json = sliceJson(flight, marker + '"rows":'.length).replaceAll('"$undefined"', "null");
    if (json) rows = JSON.parse(json);
  }
  const descMatch = html.match(/class="mb-desc"[^>]*>([\s\S]*?)<\/div>/);
  return {
    desc: descMatch ? decodeText(descMatch[1]) : "",
    rows: rows.map((row) => ({
      slug: row.slug || "",
      name: row.name || "",
      usd: Boolean(row.usd),
      cnDown: Boolean(row.cnDown),
      href: cleanHref(row.url || ""),
      logo: cleanLogo(row.logoUrl || ""),
      main: packGroup(row.main),
      others: Array.isArray(row.others) ? row.others.map(packGroup).filter(Boolean) : [],
    })),
  };
}

async function fetchHtml(slug) {
  const response = await fetch(`${source}${encodeURIComponent(slug)}`, {
    headers: {
      "accept-language": "zh-CN,zh;q=0.9",
      "user-agent": "Mozilla/5.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

async function pullOne(slug) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const html = await fetchHtml(slug);
      const board = parseModelHtml(html);
      if (!board.rows.length && !board.desc) throw new Error("empty");
      await writeFile(join(outDir, `${slug}.json`), JSON.stringify(board));
      return board.rows.length;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw last;
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  const failures = [];
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const slug = items[index];
      try {
        const count = await worker(slug);
        if ((index + 1) % 10 === 0 || index === 0) console.log(`${index + 1}/${items.length} ${slug} ${count}`);
      } catch (error) {
        failures.push(`${slug} ${error.message}`);
        console.log(`fail ${slug} ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return failures;
}

const local = process.argv[2];
if (local === "--file") {
  const html = await readFile(process.argv[3], "utf8");
  const board = parseModelHtml(html);
  console.log(board.rows.length, board.rows[0]?.name, board.rows[0]?.main?.in, board.desc.slice(0, 40));
} else {
  const rows = JSON.parse(await readFile(join(root, "src", "model-rows.json"), "utf8"));
  const slugs = rows.map((row) => row.slug);
  await mkdir(outDir, { recursive: true });
  const failures = await mapPool(slugs, 4, pullOne);
  console.log(`done ${slugs.length - failures.length}/${slugs.length}`);
  if (failures.length) console.log(failures.join("\n"));
}
