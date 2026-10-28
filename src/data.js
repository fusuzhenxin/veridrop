import catalog from "./catalog.json";
import codexRows from "./codex.json";
import extra from "./station-extra.json";
import iqRows from "./iq.json";
import verd from "./verd-index.json";
import officialBars from "./official-bars.json";
import voteCounts from "./vote-counts.json";
import listedDates from "./listed-dates.json";
import stationPublic from "./station-public.json";
import { CAT_LABEL } from "./verd-meta.js";

export const modelTotal = catalog.modelTotal;

const MODEL_FROM_VENDOR = {
  openai: "gpt",
  claude: "claude",
  gemini: "gemini",
  grok: "grok",
  deepseek: "deepseek",
  kimi: "kimi",
  qwen: "qwen",
  zhipu: "glm",
  glm: "glm",
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

function normHost(value) {
  let text = String(value || "").trim().toLowerCase();
  text = text.replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split(":")[0];
  if (text.startsWith("www.")) text = text.slice(4);
  return text;
}

function unique(list) {
  const seen = [];
  for (const item of list || []) {
    if (item && !seen.includes(item)) seen.push(item);
  }
  return seen;
}

export function logoUrl(src) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
  return `/${src}`;
}

export function siteOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export const models = [
  { slug: "claude-opus-5-5", name: "Claude Opus 5.5", vendor: "claude", score: 96 },
  { slug: "claude-fable-5-1", name: "Claude Fable 5.1", vendor: "claude", score: 92 },
  { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", vendor: "claude", score: 94 },
  { slug: "gpt-6-astra", name: "GPT 6 Astra", vendor: "openai", score: 91 },
  { slug: "gpt-6.1-sol", name: "GPT 6.1 Sol", vendor: "openai", score: 81 },
  { slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", vendor: "gemini", score: 88 },
];

const VENDOR_FROM = { anthropic: "claude", moonshot: "kimi" };

export const iq = iqRows.map((row) => ({
  name: row.display,
  vendor: VENDOR_FROM[row.ven] || row.ven,
  score: row.cur,
}));

export function latestCodex() {
  const time = Math.max(...codexRows.map((row) => new Date(String(row.announcedAt).replace(/^\$D/, "")).getTime()));
  const days = (Date.now() - time) / 86400000;
  const label = days < 1 ? `${Math.max(1, Math.round(days * 24))} 小时` : `${days.toFixed(1)} 天`;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
  return { label, day };
}

export const latestTests = [
  { model: "claude-opus-4-8", channel: "官方渠道", date: "10-19", vendor: "claude", slug: "queqiaoapi" },
  { model: "gpt-5.6-terra", channel: "官方渠道", date: "10-19", vendor: "openai", slug: "queqiaoapi" },
  { model: "gpt-5.5", channel: "混合渠道", date: "10-19", vendor: "cat", slug: "catbeeai" },
  { model: "claude-opus-4-8", channel: "官方渠道", date: "10-19", vendor: "claude", slug: "catbeeai" },
];

export const perks = [
  {
    kind: "免费 API",
    name: "tencent/hy3",
    host: "OpenRouter",
    desc: "20 次/分钟；免费账号 50 次/天；充值 $10 后免费模型 1,000 次/天",
    tags: ["免绑卡", "需海外网络", "长期"],
    href: "https://openrouter.ai/tencent/hy3:free",
  },
  {
    kind: "免费 API",
    name: "Laguna M.1 Free",
    host: "OpenRouter",
    desc: "20次/分钟；免费账号 50 次/天；充值 $10 后 1,000 次/天",
    tags: ["免绑卡", "需海外网络", "长期"],
    href: "https://openrouter.ai/",
  },
  {
    kind: "中转站福利",
    name: "ChatGPT Work",
    host: "share-chatgpt-work.openai.chatgpt.site",
    desc: "分享一个自己使用 ChatGPT Work 的真实案例，审核通过后可获得 $100 ChatGPT credits",
    tags: ["长期"],
    href: "https://share-chatgpt-work.openai.chatgpt.site/",
  },
];

export const activities = [
  {
    name: "deepseek-v4-pro",
    host: "NVIDIA NIM",
    vendor: "deepseek",
    ctx: "1M",
    out: "384K",
    quota: "约 40 次/分钟",
    modes: ["文本", "推理"],
    gate: ["免绑卡", "需海外网络"],
    until: "长期",
    href: "https://build.nvidia.com/",
  },
  {
    name: "Gemini 3.5 Flash",
    host: "Gemini",
    vendor: "gemini",
    ctx: "1M",
    out: "64K",
    quota: "15 次/分钟，1,500 次/天",
    modes: ["文本", "图像", "视频", "pdf", "推理"],
    gate: ["免绑卡", "需海外网络"],
    until: "长期",
    href: "https://aistudio.google.com/",
  },
  {
    name: "NVIDIA: Nemotron 3 Ultra",
    host: "OpenRouter",
    vendor: "nvidia",
    ctx: "1.0M",
    out: "66K",
    quota: "每天 200 个请求（免费档）",
    modes: ["文本", "推理"],
    gate: ["免绑卡", "需海外网络"],
    until: "长期",
    href: "https://openrouter.ai/",
  },
  {
    name: "agnes-2.0-flash",
    host: "Agnes",
    vendor: "agnes",
    ctx: "128K",
    out: "16K",
    quota: "免费额度每日刷新",
    modes: ["文本"],
    gate: ["免绑卡"],
    until: "长期",
    href: "https://agnes-ai.com/",
  },
];

export const codexPosts = [
  { ago: "4 天前", time: "10-15 14:28", text: "Done and dusted", gap: "2.1 天" },
  { ago: "6 天前", time: "10-13 13:06", text: "What would you like with your side of reset? It's done.", gap: "2.0 天" },
  { ago: "8 天前", time: "10-08 11:44", text: "Put the reset in the bag. All propagated.", gap: "4.1 天" },
  { ago: "11 天前", time: "10-05 09:18", text: "Reset's out. Go build something.", gap: "3.2 天" },
  { ago: "14 天前", time: "10-02 16:40", text: "Limits restored. You're clear.", gap: "2.6 天" },
];

const PAY_WORDS = [
  ["支付宝", "alipay"],
  ["微信", "wechat"],
  ["USDT", "usdt"],
  ["淘宝", "taobao"],
  ["银行卡", "bank"],
  ["对公", "corp"],
  ["PayPal", "paypal"],
];

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

function pays(text) {
  const lower = String(text || "").toLowerCase();
  const found = [];
  for (const [word, key] of PAY_WORDS) {
    const at = lower.indexOf(word.toLowerCase());
    if (at >= 0 && !found.some((item) => item.key === key)) found.push({ key, at });
  }
  found.sort((a, b) => a.at - b.at);
  return found.map((item) => item.key);
}

function markInvoice(value) {
  if (!value) return "—";
  if (value === "是" || value === "✓") return "✓";
  if (value === "否" || value === "✗") return "✗";
  return value;
}

function cleanUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url || "";
  }
}

function tally(items, key) {
  const counts = new Map();
  for (const review of items) {
    for (const tag of review[key] || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function listedDay(id, row) {
  const direct = row && typeof row.listed === "string" ? row.listed.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const saved = listedDates[String(id ?? "")];
  return typeof saved === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : "";
}

function cuidDay(id) {
  const text = String(id || "");
  if (!/^c[0-9a-z]{8}$/.test(text.slice(0, 9))) return "";
  const ms = Number.parseInt(text.slice(1, 9), 36);
  if (!Number.isFinite(ms) || ms < 1_500_000_000_000 || ms > 2_000_000_000_000) return "";
  const shifted = new Date(ms + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const okkStations = [...catalog.stations]
  .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
  .map((row) => {
    const families = [];
    for (const name of row.families || []) {
      const vendor = name === "moonshot" ? "kimi" : name;
      if (!families.includes(vendor)) families.push(vendor);
    }
    const reviews = row.reviews || [];
    const ratingCount = reviews.length;
    const rating = ratingCount ? reviews.reduce((sum, review) => sum + (review.rating || 0), 0) / ratingCount : null;
    const names = families.map((name) => FAMILY_NAME[name] || name);
    return {
      slug: row.slug,
      name: row.name,
      listed: cuidDay(row.id),
      uptime: row.uptime == null ? null : Math.round(row.uptime),
      latency: row.latency == null ? null : Math.round(row.latency / 100) / 10,
      min: row.minTopup || "—",
      pay: pays(row.payment),
      paymentText: row.payment || "—",
      refund: row.refund || "—",
      invoice: markInvoice(row.invoice),
      rating,
      ratingCount,
      modelsHome: row.modelCount || (row.models || []).length,
      extra: Math.max(0, families.length - 4),
      modelsList: row.modelCount || (row.models || []).length,
      tags: row.tags || [],
      vendors: families,
      img: row.logoUrl || "",
      site: cleanUrl(row.url),
      host: row.host || "",
      issue: Boolean(row.cnDown),
      speed: row.speed == null ? null : Math.round(row.speed),
      upShown: row.upValue == null ? (row.uptime == null ? null : Math.round(row.uptime)) : Math.round(row.upValue),
      speedShown: row.speedValue == null ? (row.speed == null ? null : Math.round(row.speed)) : Math.round(row.speedValue),
      upDelta: row.upDelta ?? null,
      speedDelta: row.speedDelta ?? null,
      socials: row.socials || [],
      cover: row.cover || row.modelCount || (row.models || []).length,
      coverText: row.coverText || "",
      familiesText: row.familiesText || "",
      week: row.week,
      month: row.month,
      meanLatency: row.meanLatency || "",
      blurb: row.intro || "",
      lineup: names.length ? "支持 " + names.join("、") : "",
      links: row.links || [],
      events: row.events || [],
      announcements: row.announcements || [],
      models: row.models || [],
      tests: extra.stations?.[row.slug]?.tests || [],
      baseUrl: extra.stations?.[row.slug]?.baseUrl || "",
      windows: extra.stations?.[row.slug]?.windows || null,
      familiesMenu: extra.stations?.[row.slug]?.families || null,
      labels: extra.stations?.[row.slug]?.labels || null,
      reviews,
      radar: row.radar || null,
      path: `/site/${row.slug}`,
      categories: [],
      modelIds: unique(families.map((name) => MODEL_FROM_VENDOR[name]).filter(Boolean)),
      source: "okkmax",
      online: row.cnDown ? false : null,
      ownerPick: false,
      verdRank: null,
      catalogRank: row.rank || null,
      voteUp: 0,
      voteDown: 0,
      voteScore: 0,
      siteToken: "",
      aliases: [],
      verdId: null,
    };
  });

const byHost = new Map();
for (const station of okkStations) {
  const host = normHost(station.host || station.site);
  if (host && !byHost.has(host)) byHost.set(host, station);
}

function catalogVotes(id, row) {
  if (row && Number.isFinite(row.voteUp)) return { up: row.voteUp || 0, down: row.voteDown || 0 };
  const pair = voteCounts[String(id ?? "")];
  return pair ? { up: pair[0] || 0, down: pair[1] || 0 } : { up: 0, down: 0 };
}

for (const extraRow of verd.attach || []) {
  const station = byHost.get(normHost(extraRow.host));
  if (!station) continue;
  if (!station.siteToken) station.siteToken = extraRow.token;
  if (extraRow.token) station.path = `/site/${extraRow.token}`;
  if (extraRow.token && !station.aliases.includes(extraRow.token)) station.aliases.push(extraRow.token);
  station.verdId = station.verdId || extraRow.id;
  const attachedListed = listedDay(extraRow.id, extraRow);
  if (attachedListed) station.listed = attachedListed;
  station.categories = unique([...(station.categories || []), ...(extraRow.categories || [])]);
  station.modelIds = unique([...(station.modelIds || []), ...(extraRow.modelIds || [])]);
  if (extraRow.online != null) station.online = extraRow.online;
  if (extraRow.online === false) station.issue = true;
  if (station.uptime == null && extraRow.uptime != null) station.uptime = Math.round(extraRow.uptime);
  if (station.latency == null && (extraRow.avgMs != null || extraRow.ms != null)) {
    const attachedMs = extraRow.avgMs != null ? extraRow.avgMs : extraRow.ms;
    station.latency = Math.round(attachedMs / 100) / 10;
  }
  if (extraRow.ownerPick) station.ownerPick = true;
  if (station.verdRank == null) station.verdRank = extraRow.rank;
  const attachedVotes = catalogVotes(extraRow.id, extraRow);
  station.voteUp = attachedVotes.up;
  station.voteDown = attachedVotes.down;
  station.voteScore = attachedVotes.up - attachedVotes.down;
  const attachedTotal = attachedVotes.up + attachedVotes.down;
  if (attachedTotal > 0) {
    station.rating = (attachedVotes.up / attachedTotal) * 5;
    station.ratingCount = attachedTotal;
  }
  if (extraRow.invoice && station.invoice === "—") station.invoice = "✓";
  for (const pay of extraRow.pay || []) {
    if (!station.pay.includes(pay)) station.pay.push(pay);
  }
  const labels = (station.categories || []).map((id) => CAT_LABEL[id]).filter(Boolean).slice(0, 4);
  for (const label of labels) {
    if (!station.tags.includes(label)) station.tags.push(label);
  }
}

function plainNotice(value) {
  return String(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .trim();
}

function familyKey(name) {
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

function mapVerdStation(row) {
  const published = stationPublic.stations?.[String(row.id)] || null;
  const publishedModels = published?.models?.length ? published.models : null;
  const vendors = [];
  const sourceIds = publishedModels
    ? publishedModels.map((model) => familyKey(model.name)).filter(Boolean)
    : (row.modelIds || []);
  for (const id of sourceIds) {
    const vendor = VENDOR_FROM_MODEL[id] || id;
    if (vendor && !vendors.includes(vendor)) vendors.push(vendor);
  }
  const familyNames = vendors.map((name) => FAMILY_NAME[name === "zhipu" ? "glm" : name] || name).filter(Boolean);
  const tags = (row.categories || []).map((id) => CAT_LABEL[id]).filter(Boolean).slice(0, 4);
  const ms = row.avgMs != null ? row.avgMs : row.ms;
  const votes = catalogVotes(row.id, row);
  const modelCount = publishedModels ? publishedModels.length : (row.modelCount || 0);
  const lineup = publishedModels && familyNames.length ? familyNames.join("、") : (row.modelLabels || "");
  return {
    slug: row.token,
    path: `/site/${row.token}`,
    siteToken: row.token,
    aliases: [],
    name: row.name,
    listed: listedDay(row.id, row),
    uptime: row.uptime == null ? null : Math.round(row.uptime),
    latency: ms == null ? null : Math.round(ms / 100) / 10,
    min: "—",
    pay: row.pay || [],
    paymentText: (row.pay || []).length ? (row.pay || []).join("、") : "—",
    refund: "—",
    invoice: row.invoice ? "✓" : "—",
    rating: votes.up + votes.down ? (votes.up / (votes.up + votes.down)) * 5 : null,
    ratingCount: votes.up + votes.down,
    modelsHome: modelCount,
    extra: Math.max(0, vendors.length - 4),
    modelsList: modelCount,
    tags,
    vendors,
    img: row.logo || "",
    site: row.url || "",
    host: row.domain || "",
    issue: row.online === false,
    speed: null,
    upShown: row.uptime == null ? null : Math.round(row.uptime),
    speedShown: null,
    upDelta: null,
    speedDelta: null,
    socials: [],
    cover: modelCount,
    coverText: row.tag || "",
    familiesText: lineup,
    week: null,
    month: null,
    meanLatency: ms == null ? "" : `${Math.round(ms)} ms`,
    blurb: row.description || "",
    lineup: lineup ? `支持 ${lineup}` : "",
    links: [],
    events: [],
    announcements: published?.notice ? [{ id: `${row.id}-notice`, title: "公告", content: plainNotice(published.notice), date: "" }] : [],
    models: publishedModels || row.modelRows || [],
    tests: [],
    baseUrl: "",
    windows: null,
    familiesMenu: null,
    labels: null,
    reviews: [],
    radar: null,
    categories: row.categories || [],
    modelIds: row.modelIds || [],
    source: "veridrop",
    online: row.online,
    ownerPick: Boolean(row.ownerPick),
    verdRank: row.rank,
    voteUp: votes.up,
    voteDown: votes.down,
    voteScore: votes.up - votes.down,
    verdId: row.id,
  };
}

function hasNumber(value) {
  return value != null && Number.isFinite(Number(value));
}

function isDown(station) {
  return Boolean(station.issue) || station.online === false;
}

export function compareStations(a, b, mode = "overall") {
  const down = Number(isDown(a)) - Number(isDown(b));
  if (down) return down;
  if (mode === "latency") {
    const missing = Number(!hasNumber(a.latency)) - Number(!hasNumber(b.latency));
    if (missing) return missing;
    if (hasNumber(a.latency) && a.latency !== b.latency) return a.latency - b.latency;
  } else {
    const missing = Number(!hasNumber(a.uptime)) - Number(!hasNumber(b.uptime));
    if (missing) return missing;
    if (hasNumber(a.uptime) && a.uptime !== b.uptime) return b.uptime - a.uptime;
    const latencyMissing = Number(!hasNumber(a.latency)) - Number(!hasNumber(b.latency));
    if (latencyMissing) return latencyMissing;
    if (hasNumber(a.latency) && a.latency !== b.latency) return a.latency - b.latency;
  }
  return String(a.name || "").localeCompare(String(b.name || ""), "zh");
}

export const stations = [...okkStations, ...(verd.stations || []).map(mapVerdStation)].sort(compareStations);
stations.forEach((station, index) => {
  station.place = index + 1;
});

export const stationTotal = stations.length;

const stationByKey = new Map();
for (const station of stations) {
  stationByKey.set(station.slug, station);
  if (station.siteToken) stationByKey.set(station.siteToken, station);
  for (const token of station.aliases || []) stationByKey.set(token, station);
}

export function stationPath(item) {
  return item?.path || (item?.slug ? `/site/${item.slug}` : "/list");
}

function officialDays(provider, name, existing) {
  if (existing?.length) return existing;
  const coded = officialBars[provider]?.[name];
  if (!coded?.bars) return [];
  const start = new Date(`${coded.start}T00:00:00Z`);
  const known = !Number.isNaN(start.getTime());
  return [...coded.bars].map((mark, index) => {
    const time = known ? new Date(start.getTime() + index * 86400000) : null;
    return {
      date: time ? time.toISOString().slice(0, 10) : "",
      level: mark === "w" ? "warn" : mark === "d" ? "down" : "ok",
    };
  });
}

export const officialBoards = (verd.official || []).map((board) => ({
  ...board,
  components: (board.components || []).map((part) => ({
    ...part,
    days: officialDays(board.provider, part.name, part.days),
  })),
}));
export const officialUpdated = verd.officialUpdated || "2026-09-01T03:06:16.852Z";

export function findOfficial(provider) {
  return officialBoards.find((item) => item.provider === provider) || null;
}

export const reviews = stations
  .flatMap((station) =>
    station.reviews.map((review) => ({
      ...review,
      text: review.body,
      tags: review.pros || [],
      stars: review.rating,
      station: station.name,
      slug: station.slug,
    })),
  )
  .sort((a, b) => (b.votes - a.votes) || (b.rating - a.rating) || String(b.body).length - String(a.body).length);

export const reputation = stations
  .filter((station) => station.reviews.length)
  .map((station) => ({
    name: station.name,
    slug: station.slug,
    host: station.host,
    img: station.img,
    desc: station.blurb,
    pros: tally(station.reviews, "pros"),
    cons: tally(station.reviews, "cons"),
    score: station.rating || 0,
    count: station.ratingCount,
    reviews: station.reviews,
  }))
  .sort((a, b) => b.count - a.count || b.score - a.score);

export function findStation(slug) {
  return stationByKey.get(String(slug || "")) || null;
}

export function findReport(id) {
  return extra.reports?.[id] || null;
}

export const headlineModels = [
  { label: "GPT 6 Astra", id: "gpt-6-astra", fresh: true },
  { label: "Fable 5.1", id: "claude-fable-5-1", fresh: true },
  { label: "Opus 5", id: "claude-opus-5" },
  { label: "Fable 5", id: "claude-fable-5" },
  { label: "Opus 4.8", id: "claude-opus-4-8" },
  { label: "Sonnet 5", id: "claude-sonnet-5" },
  { label: "GPT 5.6 Sol", id: "gpt-5.6-sol" },
  { label: "GPT 5.6 Terra", id: "gpt-5.6-terra" },
  { label: "GPT 5.6 Luna", id: "gpt-5.6-luna" },
  { label: "GPT 5.5", id: "gpt-5.5" },
  { label: "Gemini 3.1 Pro", id: "gemini-3.1-pro-preview" },
];
