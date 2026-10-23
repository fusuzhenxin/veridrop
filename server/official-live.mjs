import dns from "node:dns/promises";
import net from "node:net";

const DAY_COUNT = 90;
const MAX_BYTES = 2_000_000;

export const OFFICIAL_PROVIDERS = [
  {
    provider: "openai",
    label: "OpenAI",
    models: ["gpt"],
    rss: "https://status.openai.com/history.rss",
    api: "https://status.openai.com/api/v2/summary.json",
    kind: "statuspage",
    seeds: ["Responses", "Codex API", "Images", "Embeddings", "Realtime", "Batch", "Fine-tuning", "Sora", "Audio", "Files"],
  },
  {
    provider: "anthropic",
    label: "Claude",
    models: ["claude"],
    rss: "https://status.claude.com/history.rss",
    api: "https://status.claude.com/api/v2/summary.json",
    kind: "statuspage",
    seeds: ["claude.ai", "Claude API (api.anthropic.com)", "Claude Code", "Claude Console (platform.claude.com)"],
  },
  {
    provider: "gemini",
    label: "Gemini",
    models: ["gemini"],
    rss: "https://status.cloud.google.com/en/feed.atom",
    rssFallbacks: ["https://aistudio.google.com/status"],
    api: "https://status.cloud.google.com/incidents.json",
    kind: "google",
    seeds: ["Gemini API", "Multimodal Live API", "Google AI Studio"],
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    models: ["deepseek"],
    rss: "https://status.deepseek.com/feed.rss",
    rssFallbacks: ["https://status.deepseek.com/feed.atom"],
    kind: "rss",
    seeds: [
      "DeepSeek V4 Pro API服务(API Service)",
      "DeepSeek V4 Flash API服务(API Service)",
      "DeepSeek-V4-Flash-Vision-Exp API服务(API Service)",
      "对话服务(Chat Service)",
      "快速模式(Instant Mode)",
      "专家模式(Expert Mode)",
      "识图模式(Vision Mode)",
      "上传文件服务(File Upload Service)",
      "搜索服务(Search Service)",
    ],
  },
  {
    provider: "moonshot",
    label: "Kimi",
    models: ["kimi"],
    rss: "https://status.moonshot.cn/history.rss",
    api: "https://status.moonshot.cn/api/v2/summary.json",
    kind: "statuspage",
    seeds: ["Open API", "API Service", "Text Model", "Vision Model", "Thinking Model", "K2 Model", "File uploads"],
  },
  {
    provider: "xai",
    label: "Grok",
    models: ["grok"],
    rss: "https://status.x.ai/feed.xml",
    rssFallbacks: ["https://status.x.ai/history.rss", "https://status.x.ai/history.atom"],
    api: "https://status.x.ai/api/v2/summary.json",
    kind: "rss",
    seeds: ["API", "Grok", "Imagine"],
  },
];

const HOSTS = new Set(OFFICIAL_PROVIDERS.flatMap((item) => [item.rss, item.api, ...(item.rssFallbacks || [])].filter(Boolean).map((value) => new URL(value).hostname)));
HOSTS.add("www.veridrop.cn");

function privateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return true;
}

function decodeXml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#xA;/g, "\n");
}

function tagText(block, name) {
  const match = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return decodeXml(match ? match[1] : "").trim();
}

function stripHtml(html) {
  return decodeXml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayKey(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
}

function parseFeed(xml) {
  const items = [];
  const blocks = String(xml || "").match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    const title = tagText(block, "title");
    const rawDesc = tagText(block, "description") || tagText(block, "content") || tagText(block, "summary");
    const desc = stripHtml(rawDesc);
    const dateText = tagText(block, "pubDate") || tagText(block, "updated") || tagText(block, "published");
    const statusHit =
      rawDesc.match(/Status:<\/strong>\s*([a-z]+)/i) ||
      rawDesc.match(/<b>Status:\s*([a-z]+)/i) ||
      rawDesc.match(/Status:\s*<\/?(?:strong|b)>\s*([a-z]+)/i) ||
      rawDesc.match(/<(?:strong|b)>(Resolved|Investigating|Identified|Monitoring|Update|Scheduled)<\/(?:strong|b)>/i);
    let affected = [];
    const inlineAffected = rawDesc.match(/Affected components:<\/strong>\s*([^<]+)/i);
    if (inlineAffected) {
      affected = inlineAffected[1].split(",").map((part) => part.trim()).filter(Boolean);
    } else {
      const listBlock = (rawDesc.match(/Affected components<\/(?:strong|b)>[\s\S]*?<ul[\s\S]*?<\/ul>/i) || [])[0] || "";
      affected = [...listBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((match) => stripHtml(match[1]).replace(/\s*\((degraded performance|partial outage|major outage|operational|under maintenance)\)\s*$/i, "").trim())
        .filter(Boolean);
    }
    const blob = (title + " " + desc + " " + (statusHit ? statusHit[1] : "")).toLowerCase();
    const status = String(statusHit ? statusHit[1] : "").toLowerCase();
    const resolved = /resolved|completed|postmortem|已解决|已恢复/.test(blob);
    items.push({
      title,
      desc,
      date: dateText,
      day: dayKey(dateText),
      status: status || (resolved ? "resolved" : ""),
      open: !resolved && /investigating|identified|monitoring|detected|degraded|outage|异常|故障|中断/.test(blob),
      affected,
    });
  }
  return items;
}

function translateBanner(indicator, hasOpen) {
  if (hasOpen) return { banner: "部分系统降级", sub: "部分服务未按预期运行", level: "minor" };
  if (indicator === "minor") return { banner: "部分系统降级", sub: "部分服务出现性能下降", level: "minor" };
  if (indicator === "major" || indicator === "critical") return { banner: "系统存在故障", sub: "部分服务中断", level: "major" };
  return { banner: "一切运行正常", sub: "所有系统均按预期运行", level: "none" };
}

function buildDays(incidents) {
  const days = [];
  const now = new Date();
  for (let i = DAY_COUNT - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const key = dayKey(day);
    const hit = incidents.find((item) => item.day === key);
    days.push({ date: key, level: hit ? (hit.open ? "down" : "warn") : "ok" });
  }
  return days;
}

function uptimeOf(days) {
  const bad = days.filter((day) => day.level !== "ok").length;
  return Number((((DAY_COUNT - bad) / DAY_COUNT) * 100).toFixed(2));
}

function parseSummaryComponents(json) {
  if (!json || !json.components) return [];
  return json.components
    .filter((item) => item && !item.group && item.name && item.status)
    .map((item) => ({ name: item.name, status: item.status }));
}

function findLive(liveComps, name) {
  const needle = String(name || "").toLowerCase();
  return liveComps.find((item) => {
    const current = String(item.name || "").toLowerCase();
    return current === needle || current.includes(needle) || needle.includes(current);
  });
}

function assembleOfficial(item, feedXml, extraJson) {
  const incidents = parseFeed(feedXml || "").filter((entry) => {
    if (item.kind !== "google") return true;
    return /gemini|generative|ai studio|vertex|nano banana|multimodal live/i.test(entry.title + " " + entry.desc);
  });
  let indicator = "none";
  let liveComps = [];
  if (item.kind === "statuspage" && extraJson && extraJson.status) {
    indicator = extraJson.status.indicator || "none";
    liveComps = parseSummaryComponents(extraJson);
  }
  if (item.kind === "google" && Array.isArray(extraJson)) {
    const open = extraJson.filter((row) => !row.end && /gemini|generative language|vertex gemini|ai studio/i.test(JSON.stringify(row)));
    if (open.length) indicator = "minor";
  }
  const components = item.seeds.map((name) => {
    const related = incidents.filter((entry) => {
      if (entry.affected.length) {
        return entry.affected.some((affected) => affected.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(affected.toLowerCase()));
      }
      const blob = (entry.title + " " + entry.desc).toLowerCase();
      const needle = name.toLowerCase();
      const short = needle.split("(")[0].trim();
      return blob.includes(needle) || (short.length > 4 && blob.includes(short));
    });
    const live = findLive(liveComps, name);
    const days = buildDays(related);
    return {
      name,
      status: live ? live.status : related.some((entry) => entry.open) ? "degraded_performance" : "operational",
      uptime: uptimeOf(days),
      days,
    };
  });
  const liveIssue = components.some((part) => part.status && part.status !== "operational" && part.status !== "unknown");
  const hasOpen = incidents.some((entry) => entry.open) || liveIssue;
  const head = translateBanner(indicator, hasOpen);
  return {
    provider: item.provider,
    label: item.label,
    models: item.models,
    online: head.level === "none",
    level: head.level,
    status: head.banner,
    sub: head.sub,
    components,
    incidents: incidents.slice(0, 10).map((entry) => ({
      title: entry.title,
      desc: entry.desc.slice(0, 160),
      date: entry.date,
      status: entry.open ? "进行中" : "已恢复",
    })),
  };
}

function failedOfficial(item, reason) {
  return {
    provider: item.provider,
    label: item.label,
    models: item.models,
    online: null,
    level: "unknown",
    status: "拉取失败",
    sub: reason || "无订阅数据",
    components: item.seeds.map((name) => ({ name, status: "unknown", uptime: null, days: [] })),
    incidents: [],
  };
}

function failureReason(error) {
  const code = error?.cause?.code || "";
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT") return "timeout";
  return error?.message || String(error);
}

async function fetchText(rawUrl, hops = 0, signal) {
  if (hops > 3) throw new Error("redirect");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) throw new Error("host");
  const looked = await dns.lookup(url.hostname, { all: true });
  if (!looked.length || looked.some((item) => privateIp(item.address))) throw new Error("private");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/json, text/xml, */*",
        "User-Agent": "XianTan/1.0 (official status)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect");
      return fetchText(new URL(location, url).href, hops + 1, signal);
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new Error("large");
    return new TextDecoder().decode(buffer);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function feedXml(text) {
  return Boolean(text && /<rss\b|<feed\b|<item\b|<entry\b/i.test(text));
}

async function readFeed(item, signal) {
  let lastErr = "";
  for (const remote of [item.rss, ...(item.rssFallbacks || [])]) {
    if (signal.aborted) break;
    try {
      const text = await fetchText(remote, 0, signal);
      if (feedXml(text)) return { xml: text, lastErr };
      lastErr = "不是订阅源";
    } catch (error) {
      lastErr = failureReason(error);
      if (lastErr === "timeout") break;
    }
  }
  return { xml: "", lastErr };
}

function proxyFeed(provider) {
  let timer = null;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => {
      fetchText(`https://www.veridrop.cn/api/official/${provider}`)
        .then((text) => resolve(feedXml(text) ? text : ""))
        .catch(() => resolve(""));
    }, 2000);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export async function loadOfficial(provider) {
  const item = OFFICIAL_PROVIDERS.find((row) => row.provider === provider);
  if (!item) return null;
  const directSignal = AbortSignal.timeout(8000);
  const feedTask = readFeed(item, directSignal);
  const proxy = proxyFeed(item.provider);
  const first = await Promise.race([
    feedTask.then((value) => ({ from: "direct", ...value })),
    proxy.promise.then((xml) => ({ from: "proxy", xml })),
  ]);
  let xml = "";
  let extra = null;
  let lastErr = "";
  let useDirect = false;
  if (first.from === "direct" && first.xml) {
    proxy.cancel();
    xml = first.xml;
    useDirect = true;
    lastErr = first.lastErr;
  } else if (first.from === "proxy" && first.xml) {
    xml = first.xml;
  } else if (first.from === "direct") {
    xml = await proxy.promise;
    lastErr = first.lastErr;
  } else {
    const feed = await feedTask;
    xml = feed.xml;
    useDirect = Boolean(feed.xml);
    lastErr = feed.lastErr;
  }
  if (useDirect && item.api) {
    try {
      extra = JSON.parse(await fetchText(item.api));
    } catch (error) {
      if (!lastErr) lastErr = failureReason(error);
    }
  }
  if (!xml && extra == null) return failedOfficial(item, lastErr || "无订阅数据");
  return assembleOfficial(item, xml, extra);
}
