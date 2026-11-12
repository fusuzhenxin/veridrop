const FAMILY_NAME = {
  claude: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  zhipu: "GLM",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  moonshot: "Kimi",
  qwen: "Qwen",
  minimax: "MiniMax",
  other: "其他",
};

const VENDOR_FROM_MODEL = {
  gpt: "openai",
  claude: "claude",
  gemini: "gemini",
  grok: "grok",
  deepseek: "deepseek",
  kimi: "kimi",
  qwen: "qwen",
  glm: "zhipu",
};

export function familyKey(name) {
  const text = String(name || "").toLowerCase();
  if (/claude|anthropic/.test(text)) return "claude";
  if (/gemini/.test(text)) return "gemini";
  if (/grok/.test(text)) return "grok";
  if (/deepseek/.test(text)) return "deepseek";
  if (/glm|chatglm|zhipu/.test(text)) return "glm";
  if (/kimi|moonshot/.test(text)) return "kimi";
  if (/qwen|通义|千问/.test(text)) return "qwen";
  if (/gpt|codex|openai|chatgpt|\bo\d/.test(text)) return "gpt";
  return "";
}

export function minimumInputPrice(models) {
  const prices = (models || [])
    .map((row) => row.input)
    .filter((value) => value != null && value !== "" && typeof value !== "boolean")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return prices.length ? Math.min(...prices) : null;
}

function latencySeconds(value) {
  const text = String(value || "");
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*s\b/i);
  if (seconds) return Number(seconds[1]);
  const millis = text.match(/(\d+(?:\.\d+)?)\s*ms\b/i);
  if (millis) return Number(millis[1]) / 1000;
  return null;
}

function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  if (list.length % 2) return list[mid];
  return (list[mid - 1] + list[mid]) / 2;
}

function familyBalancedSeconds(models) {
  const groups = new Map();
  for (const model of models || []) {
    const seconds = latencySeconds(model.latency);
    if (seconds == null) continue;
    const family = familyKey(model.name || model.id);
    if (!family) continue;
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(seconds);
  }
  if (groups.size < 2) return null;
  return median([...groups.values()].map((list) => median(list)));
}

function priceScore(models) {
  const ratios = (models || []).map((model) => Number(model.ratio)).filter((ratio) => ratio > 0);
  if (!ratios.length) return null;
  return Math.max(0, Math.min(100, Math.round(100 - Math.min(...ratios) * 60)));
}

export function summarizePublished(models) {
  if (!models?.length) return null;
  const vendors = [];
  for (const id of models.map((model) => familyKey(model.name)).filter(Boolean)) {
    const vendor = VENDOR_FROM_MODEL[id] || id;
    if (vendor && !vendors.includes(vendor)) vendors.push(vendor);
  }
  const familyNames = vendors.map((name) => FAMILY_NAME[name === "zhipu" ? "glm" : name] || name).filter(Boolean);
  const balancedSeconds = familyBalancedSeconds(models);
  return {
    vendors,
    listedCount: new Set(models.map((model) => model.name || model.id).filter(Boolean)).size,
    balancedMs: balancedSeconds == null ? null : balancedSeconds * 1000,
    latencyNote: balancedSeconds == null ? "" : "各家中位数，同一家只算一次",
    price: priceScore(models),
    lineup: familyNames.join("、"),
  };
}

export function sameModel(model, slug) {
  const id = String(model?.id || "").toLowerCase();
  const name = String(model?.name || "").toLowerCase();
  const key = String(slug || "").toLowerCase();
  if (!key) return false;
  return id === key || name === key || id.replace(/\./g, "-") === key || name.replace(/\./g, "-") === key;
}
