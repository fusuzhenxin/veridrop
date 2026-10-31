import { readFileSync, writeFileSync } from "fs";

const pricing = JSON.parse(readFileSync(process.env.TEMP + "/yyapi-body.txt", "utf8"));
const groups = pricing.group_ratio || {};
const models = [];

function fixedPrice(expr) {
  const match = String(expr || "").match(/fixed\(\s*(\d+(?:\.\d+)?)\s*\)/);
  return match ? Number(match[1]) : null;
}

function cheapest(names) {
  let best = null;
  for (const name of names || []) {
    const ratio = Number(groups[name]);
    if (!Number.isFinite(ratio)) continue;
    if (!best || ratio < best.ratio) best = { name, ratio };
  }
  return best;
}

for (const row of pricing.data || []) {
  const name = String(row.model_name || "").trim();
  if (!name) continue;
  const picked = cheapest(row.enable_groups);
  const ratio = picked ? picked.ratio : null;
  const endpoints = row.supported_endpoint_types || [];
  const perCall = Number(row.quota_type) === 1;
  let input = null;
  let output = null;
  let unit = "";
  if (perCall) {
    const fixed = fixedPrice(row.billing_expr);
    const base = fixed != null ? fixed : Number(row.model_price);
    if (Number.isFinite(base) && ratio != null) input = Math.round(base * ratio * 10000) / 10000;
    unit = endpoints.some((item) => /image|video/.test(item)) ? "张" : "次";
  } else if (ratio != null) {
    const modelRatio = Number(row.model_ratio);
    const completion = Number(row.completion_ratio);
    if (Number.isFinite(modelRatio)) {
      input = Math.round(modelRatio * ratio * 2 * 10000) / 10000;
      output = Number.isFinite(completion) ? Math.round(input * completion * 10000) / 10000 : null;
    }
  }
  models.push({
    id: name,
    name,
    group: picked ? picked.name : (row.enable_groups || [])[0] || "公开",
    ratio: ratio,
    input,
    output: perCall ? null : output,
    unit,
    currency: "CNY",
  });
}

const root = "G:/Project/html/veridrop-okk";
const pubPath = `${root}/src/station-public.json`;
const pub = JSON.parse(readFileSync(pubPath, "utf8"));
pub.stations["1977"] = { models };
writeFileSync(pubPath, JSON.stringify(pub));

const verdPath = `${root}/src/verd-index.json`;
const verd = JSON.parse(readFileSync(verdPath, "utf8"));
const station = verd.stations.find((item) => item.id === 1977);
const familyOf = (name) => {
  const text = name.toLowerCase();
  if (/claude|anthropic/.test(text)) return "claude";
  if (/gemini/.test(text)) return "gemini";
  if (/grok/.test(text)) return "grok";
  if (/deepseek/.test(text)) return "deepseek";
  if (/glm|chatglm|zhipu/.test(text)) return "glm";
  if (/kimi|moonshot/.test(text)) return "kimi";
  if (/qwen|通义|千问/.test(text)) return "qwen";
  if (/gpt|codex|openai|chatgpt|image/.test(text)) return /image/.test(text) ? "image" : "gpt";
  if (/video|sora|sd2/.test(text)) return "video";
  return "";
};
const ids = [];
for (const model of models) {
  const family = familyOf(model.name);
  if (family && !ids.includes(family)) ids.push(family);
}
station.modelIds = ids;
station.modelCount = models.length;
station.modelLabels = ids.join("、");
writeFileSync(verdPath, JSON.stringify(verd));
const sample = models.find((item) => item.name === "[超分] gpt-image-2");
console.log("models", models.length, "priced", models.filter((item) => item.input != null).length);
console.log("sample", JSON.stringify(sample));
console.log("families", ids.join(","));
