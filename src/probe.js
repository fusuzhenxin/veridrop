const HISTORY_KEY = "okk-speed-history";
const QUOTA_KEY = "okk-speed-quota";

export const LIMITS = {
  guest: { concurrency: 10, requests: 30, cache_samples: 10, roll_turns: 8, daily: 3 },
  user: { concurrency: 50, requests: 200, cache_samples: 60, roll_turns: 20, daily: 30 },
  cache_interval: [2, 60],
  prefix_tokens: [500, 20000],
  max_tokens: [16, 4096],
};

export function endpoint(raw, protocol = "messages") {
  const text = String(raw || "").trim();
  if (!text) return { error: "请输入站点地址。" };
  if (text.length > 2048) return { error: "地址太长，请检查是否复制了多余内容。" };
  if (/\s/.test(text)) return { error: "地址里不能有空格。" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) return { error: "地址格式不对，请填写类似 https://api.example.com 的地址。" };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "地址格式不对，请填写类似 https://api.example.com 的地址。" };
  }
  if (url.username || url.password) return { error: "地址里不能带用户名和密码，请把密钥填在密钥栏。" };
  const query = `${url.search}`.toLowerCase();
  if (/key=|token=|secret=|sk-/.test(query)) return { error: "地址的参数里不能带密钥，请把密钥填在密钥栏。" };
  let path = url.pathname.replace(/\/+$/, "").replace(/\/(messages|responses)$/i, "");
  path = /\/v\d+$/i.test(path) ? `${path}/${protocol}` : `${path}/v1/${protocol}`;
  url.pathname = path;
  url.hash = "";
  return { url: url.toString(), origin: url.origin };
}

export function quotaState() {
  const logged = Boolean(localStorage.getItem("okk-user"));
  const cap = logged ? LIMITS.user.daily : LIMITS.guest.daily;
  const today = new Date().toISOString().slice(0, 10);
  let used = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(QUOTA_KEY) || "{}");
    if (saved.date === today) used = Number(saved.count) || 0;
  } catch {
    used = 0;
  }
  return { logged, cap, used, left: Math.max(0, cap - used) };
}

export function takeQuota() {
  const state = quotaState();
  if (state.left <= 0) return state;
  localStorage.setItem(QUOTA_KEY, JSON.stringify({ date: new Date().toISOString().slice(0, 10), count: state.used + 1 }));
  return { ...state, used: state.used + 1, left: state.left - 1 };
}

export function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 40)));
}

function headersFor(key, protocol) {
  const headers = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (protocol === "messages") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

function bodyFor(protocol, model, maxTokens, prompt, system, thinking, extra = {}) {
  const stream = extra.stream !== false;
  if (protocol === "responses") {
    return JSON.stringify({
      model,
      stream,
      max_output_tokens: maxTokens,
      input: extra.input || (system ? `${system}\n\n${prompt}` : prompt),
    });
  }
  const payload = {
    model,
    stream,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: extra.content || prompt }],
  };
  if (thinking) payload.thinking = { type: "enabled", budget_tokens: Math.min(thinking, Math.max(64, maxTokens - 1)) };
  if (system) {
    payload.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }
  return JSON.stringify(payload);
}

function absorb(json, state) {
  const type = json.type || "";
  const delta = json.delta?.text || json.delta?.thinking || json.delta || "";
  if (typeof delta === "string" && delta && (type.includes("delta") || type === "content_block_delta" || type === "response.output_text.delta")) {
    state.text += delta;
    if (state.first == null) state.first = performance.now();
  }
  if (typeof json.output_text === "string" && json.output_text) {
    state.text += json.output_text;
    if (state.first == null) state.first = performance.now();
  }
  const usage = json.usage || json.message?.usage || json.response?.usage || json.delta?.usage;
  if (usage) state.usage = { ...state.usage, ...usage };
  if (json.delta?.type === "signature_delta" && json.delta.signature) state.signature = true;
  const blocks = []
    .concat(json.content || [])
    .concat(json.message?.content || [])
    .concat(json.content_block ? [json.content_block] : []);
  if (blocks.some((block) => block && block.signature)) state.signature = true;
  const id = json.message?.id || json.response?.id || "";
  if (id) state.id = String(id);
  if (typeof json.id === "string" && /^(msg_|resp_|chatcmpl_)/.test(json.id)) state.id = json.id;
  const echoed = json.message?.model || json.response?.model || "";
  if (echoed) state.model = String(echoed);
  const stop = json.message?.stop_reason || json.delta?.stop_reason || json.stop_reason || json.finish_reason || "";
  if (stop) state.stop = String(stop);
  if (json.content_block?.type && state.types.length < 12) state.types.push(json.content_block.type);
  if (json.error) state.error = json.error.message || json.error.type || "接口返回错误";
}

async function readStream(response, signal) {
  const status = Number(response.headers.get("x-upstream-status") || 0);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const state = { text: "", first: null, usage: {}, error: "", raw: "", signature: false, id: "", model: "", stop: "", types: [] };
  if (!reader) return { status, ...state, streamed: false };
  let pending = "";
  let streamed = false;
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const step = await reader.read();
    if (step.done) break;
    const chunk = decoder.decode(step.value, { stream: true });
    state.raw += chunk;
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      streamed = true;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        absorb(JSON.parse(data), state);
      } catch {
        state.text += data;
        if (state.first == null) state.first = performance.now();
      }
    }
  }
  if (!streamed && state.raw) {
    try {
      const json = JSON.parse(state.raw);
      absorb(json, state);
      const message = json.content?.map?.((item) => item.text).filter(Boolean).join("") || json.output_text || json.error?.message;
      if (message && !state.text) state.text = String(message);
      if (json.error && !state.error) state.error = json.error.message || "接口返回错误";
    } catch {
      state.error = state.error || "响应不是流式";
    }
  }
  return { status, ...state, streamed };
}

function emptyShot(started, error) {
  return {
    ok: false,
    error,
    status: 0,
    ttftMs: null,
    totalMs: performance.now() - started,
    tokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    text: "",
    signature: false,
    id: "",
    echoModel: "",
    stop: "",
    input: 0,
    streamed: false,
  };
}

export async function callApi({ url, key, protocol, model, maxTokens, prompt, system, thinking = 0, signal, timeoutMs = 60000, stream = true, content = null, textLimit = 240 }) {
  const started = performance.now();
  let response;
  try {
    response = await fetch("/__probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        method: "POST",
        headers: headersFor(key, protocol),
        body: bodyFor(protocol, model, maxTokens, prompt, system, thinking, { stream, content }),
        timeoutMs,
      }),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return emptyShot(started, "连接失败");
  }
  if (!response.ok) {
    const reason = await response.text();
    const error = reason === "private" ? "该地址指向内网，不能测试。" : reason === "timeout" ? "请求超时" : "连接失败";
    return emptyShot(started, error);
  }
  const parsed = await readStream(response, signal);
  const ended = performance.now();
  const tokens = Number(parsed.usage.output_tokens || parsed.usage.completion_tokens || 0) || (parsed.text ? Math.max(1, Math.round(parsed.text.length / 2)) : 0);
  const cacheRead = Number(parsed.usage.cache_read_input_tokens || parsed.usage.input_tokens_details?.cached_tokens || parsed.usage.cache_read_tokens || 0);
  const cacheWrite = Number(parsed.usage.cache_creation_input_tokens || parsed.usage.cache_creation_tokens || 0);
  const failed = parsed.status >= 400 || (!parsed.text && parsed.error);
  return {
    ok: !failed && parsed.status > 0 && parsed.status < 400,
    status: parsed.status,
    error: failed ? parsed.error || (parsed.status === 401 ? "未授权" : parsed.status === 404 ? "找不到" : parsed.status === 429 ? "被限流" : parsed.status >= 500 ? "服务端错误" : "接口返回错误") : "",
    ttftMs: parsed.first == null ? null : Math.round(parsed.first - started),
    totalMs: Math.round(ended - started),
    tokens: parsed.text ? tokens : 0,
    text: parsed.text.slice(0, textLimit),
    signature: Boolean(parsed.signature),
    cacheRead,
    cacheWrite,
    input: Number(parsed.usage.input_tokens || parsed.usage.prompt_tokens || 0),
    streamed: parsed.streamed,
    id: parsed.id || "",
    echoModel: parsed.model || "",
    stop: parsed.stop || "",
  };
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

function wordTtft(ms) {
  if (ms == null) return "无数据";
  if (ms < 800) return "很快";
  if (ms < 2000) return "较快";
  if (ms < 5000) return "偏慢";
  return "很慢";
}

function wordRate(rate) {
  if (rate >= 0.99) return "可靠";
  if (rate >= 0.9) return "基本可靠";
  if (rate >= 0.7) return "不稳定";
  return "不可用";
}

async function pool(total, concurrency, worker, signal) {
  const results = new Array(total);
  let cursor = 0;
  async function run() {
    while (cursor < total) {
      if (signal.aborted) return;
      const index = cursor;
      cursor += 1;
      results[index] = await worker(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => run()));
  return results;
}

function prefixText(tokens) {
  const unit = "这段文字只为占住缓存前缀，请不要复述。";
  const times = Math.max(1, Math.ceil(tokens / 12));
  return unit.repeat(times).slice(0, tokens * 2);
}

export async function runBenchmark(form, hooks) {
  try {
    return await runBenchmarkInner(form, hooks);
  } catch (error) {
    if (error?.name === "AbortError") return { stopped: true };
    return { error: "网络异常，请检查网络后重试。" };
  }
}

async function runBenchmarkInner(form, { signal, onProgress }) {
  const protocol = form.protocol === "responses" ? "responses" : "messages";
  const target = endpoint(form.url, protocol);
  if (target.error) return { error: target.error };
  const key = form.key.trim();
  const model = form.model.trim();
  const concurrency = Number(form.concurrency);
  const requests = Number(form.requests);
  const samples = Number(form.cache_samples);
  const interval = Number(form.cache_interval);
  const turns = Number(form.roll_turns);
  const maxTokens = Number(form.max_tokens);
  const system = form.profile === "claude-code" ? "You are a coding assistant. Answer briefly." : "";
  const shots = [];
  onProgress?.({ phase: "首字压测", done: 0, total: requests });
  const burst = await pool(requests, concurrency, async (index) => {
    const shot = await callApi({
      url: target.url,
      key,
      protocol,
      model,
      maxTokens,
      prompt: "请只回答一个词：pong",
      system,
      signal,
      timeoutMs: 45000,
    });
    shots.push(shot);
    onProgress?.({ phase: "首字压测", done: shots.length, total: requests });
    return shot;
  }, signal);
  if (signal.aborted) return { stopped: true };
  const cache = [];
  if (samples > 0) {
    const prefix = prefixText(Number(form.prefix_tokens) || 8000);
    for (let index = 0; index < samples; index += 1) {
      if (signal.aborted) return { stopped: true };
      onProgress?.({ phase: "缓存采样", done: index, total: samples });
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      if (signal.aborted) return { stopped: true };
      cache.push(await callApi({
        url: target.url,
        key,
        protocol,
        model,
        maxTokens: Math.min(64, maxTokens),
        prompt: "如果看到了前缀，只回答 ok。",
        system: prefix,
        signal,
        timeoutMs: 45000,
      }));
    }
  }
  const roll = [];
  if (turns >= 2) {
    let memory = "";
    for (let index = 0; index < turns; index += 1) {
      if (signal.aborted) return { stopped: true };
      onProgress?.({ phase: "长对话", done: index, total: turns });
      memory += `\n第 ${index + 1} 轮：请记住数字 ${index + 1}。`;
      roll.push(await callApi({
        url: target.url,
        key,
        protocol,
        model,
        maxTokens: Math.min(64, maxTokens),
        prompt: `当前是第 ${index + 1} 轮，只回答 ${index + 1}。`,
        system: memory,
        signal,
        timeoutMs: 45000,
      }));
    }
  }
  const ok = burst.filter((item) => item && item.ok);
  const ttfts = ok.map((item) => item.ttftMs).filter((item) => item != null);
  const speeds = ok.filter((item) => item.ttftMs != null && item.totalMs > item.ttftMs && item.tokens > 0).map((item) => item.tokens / ((item.totalMs - item.ttftMs) / 1000));
  const p50 = percentile(ttfts, 0.5);
  const rate = burst.length ? ok.length / burst.length : 0;
  const cacheHits = cache.filter((item) => item.cacheRead > 0).length;
  const report = {
    id: `local-${Date.now()}`,
    at: new Date().toISOString(),
    host: (() => { try { return new URL(target.url).host; } catch { return ""; } })(),
    path: target.url,
    model,
    protocol,
    profile: form.profile,
    requests,
    concurrency,
    ok: ok.length,
    fail: burst.length - ok.length,
    ttftMs: p50,
    p90: percentile(ttfts, 0.9),
    p99: ttfts.length >= 20 ? percentile(ttfts, 0.99) : null,
    min: ttfts.length ? Math.min(...ttfts) : null,
    max: ttfts.length ? Math.max(...ttfts) : null,
    avg: ttfts.length ? Math.round(ttfts.reduce((sum, item) => sum + item, 0) / ttfts.length) : null,
    speed: speeds.length ? Math.round(speeds.reduce((sum, item) => sum + item, 0) / speeds.length) : null,
    rate,
    ttftWord: wordTtft(p50),
    rateWord: wordRate(rate),
    samples: cache.map((item) => ({ ok: item.ok, ttftMs: item.ttftMs, hit: item.cacheRead > 0, read: item.cacheRead })),
    cacheHit: samples ? cacheHits / samples : null,
    roll: roll.map((item, index) => ({ turn: index + 1, ok: item.ok, input: item.input, read: item.cacheRead })),
    errors: burst.filter((item) => item && !item.ok).map((item) => item.error).slice(0, 6),
    shots: burst.map((item) => ({ ok: item?.ok, ttftMs: item?.ttftMs ?? null, error: item?.error || "" })),
  };
  const history = readHistory();
  history.unshift({
    id: report.id,
    at: report.at,
    host: report.host,
    model,
    protocol,
    ttftMs: report.ttftMs,
    speed: report.speed,
    rate,
    ok: report.ok,
    fail: report.fail,
  });
  writeHistory(history);
  return { report };
}

export async function listModels(rawUrl, key) {
  const target = endpoint(rawUrl, "messages");
  if (target.error) return { error: target.error };
  const response = await fetch("/__probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${target.origin}/v1/models`,
      method: "GET",
      headers: headersFor(key, "messages"),
      timeoutMs: 15000,
    }),
  });
  if (!response.ok) return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  const status = Number(response.headers.get("x-upstream-status") || 0);
  const text = await response.text();
  if (status >= 400) return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  try {
    const json = JSON.parse(text);
    const models = (json.data || json.models || []).map((item) => item.id || item.name).filter(Boolean);
    return { models };
  } catch {
    return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  }
}
