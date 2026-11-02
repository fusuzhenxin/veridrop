import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sameModel, summarizePublished } from "../src/price-summary.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stationPublic = JSON.parse(fs.readFileSync(path.join(root, "src/station-public.json"), "utf8"));
const verd = JSON.parse(fs.readFileSync(path.join(root, "src/verd-index.json"), "utf8"));
const modelRows = JSON.parse(fs.readFileSync(path.join(root, "src/model-rows.json"), "utf8"));
const slugs = modelRows.map((row) => row.slug).filter(Boolean);
const priceRoot = path.join(root, "public/prices");
const stationDir = path.join(priceRoot, "station");
const modelDir = path.join(priceRoot, "model");
fs.rmSync(priceRoot, { recursive: true, force: true });
fs.mkdirSync(stationDir, { recursive: true });
fs.mkdirSync(modelDir, { recursive: true });

const buckets = new Map(slugs.map((slug) => [slug, new Map()]));
let stationFiles = 0;
for (const [id, value] of Object.entries(stationPublic.stations || {})) {
  const models = Array.isArray(value?.models) ? value.models : [];
  if (!models.length && !value?.notice) continue;
  fs.writeFileSync(path.join(stationDir, `${id}.json`), JSON.stringify({
    models,
    notice: value?.notice || "",
  }));
  stationFiles += 1;
  for (const model of models) {
    for (const slug of slugs) {
      if (!sameModel(model, slug)) continue;
      const group = buckets.get(slug);
      if (!group.has(id)) group.set(id, []);
      group.get(id).push(model);
    }
  }
}

let modelFiles = 0;
for (const [slug, group] of buckets) {
  if (!group.size) continue;
  const payload = {};
  for (const [id, models] of group) payload[id] = models;
  fs.writeFileSync(path.join(modelDir, `${slug}.json`), JSON.stringify(payload));
  modelFiles += 1;
}

const derived = {};
for (const row of verd.stations || []) {
  const published = stationPublic.stations?.[String(row.id)];
  const summary = summarizePublished(published?.models);
  if (summary) derived[String(row.id)] = summary;
}
fs.writeFileSync(path.join(root, "src/station-derived.json"), JSON.stringify(derived));
const version = createHash("sha1").update(fs.readFileSync(path.join(root, "src/station-public.json"))).digest("hex").slice(0, 10);
fs.writeFileSync(path.join(root, "src/price-version.js"), `export const priceVersion = "${version}";\n`);
console.log(JSON.stringify({ stationFiles, modelFiles, derived: Object.keys(derived).length, version }));
