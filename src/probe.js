const HISTORY_KEY = "okk-speed-history";
const QUOTA_KEY = "okk-speed-quota";

export const LIMITS = {
  guest: { concurrency: 10, requests: 30, cache_samples: 10, roll_turns: 8, daily: 3 },
  user: { concurrency: 50, requests: 200, cache_samples: 60, roll_turns: 20, daily: 30 },
  cache_interval: [2, 60],
  prefix_tokens: [500, 20000],
  max_tokens: [16, 4096],
};

const CC_BETA = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "prompt-caching-2024-07-31",
  "effort-2025-11-24",
].join(",");
const CC_BILLING = "x-anthropic-billing-header: cc_version=2.1.247.cfd; cc_entrypoint=cli;";
const CC_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const PARAGRAPH = "You are a senior software engineer working on a large codebase. Follow the existing conventions, handle every error, and keep changes small. The text below stays the same for the whole session so a gateway can cache it. ";

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
  url.search = "";
  url.hash = "";
  return { url: url.toString(), origin: url.origin };
}

export function quotaState() {
  const logged = Boolean(localStorage.getItem("okk-user") || localStorage.getItem("veridrop-token"));
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

function headersFor(key, protocol, profile) {
  const headers = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (protocol === "messages") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    if (profile === "claude-code") {
      headers["anthropic-beta"] = CC_BETA;
      headers["user-agent"] = "claude-cli/1.0.5 (external, cli)";
      headers["x-stainless-lang"] = "js";
      headers["x-stainless-os"] = "darwin";
      headers["x-stainless-runtime"] = "node";
      headers["x-stainless-runtime-version"] = "v20.0.0";
      headers["x-stainless-package-version"] = "0.26.1";
    } else {
      headers["user-agent"] = "veridrop-bench/1.0";
    }
  } else {
    headers["user-agent"] = "veridrop-bench/1.0";
  }
  return headers;
}

function hex(bytes) {
  const list = new Uint8Array(bytes);
  crypto.getRandomValues(list);
  return [...list].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function buildPrefix(tokens) {
  const target = Math.max(1, Number(tokens) || 1) * 4;
  let text = "";
  while (text.length < target) text += PARAGRAPH;
  return text.slice(0, target);
}

function block(text, cache) {
  const item = { type: "text", text };
  if (cache) item.cache_control = { type: "ephemeral" };
  return item;
}

function noteToken(state) {
  const now = performance.now();
  if (state.first == null) state.first = now;
  else if (state.last != null) state.itls.push(now - state.last);
  state.last = now;
}

function absorb(json, state) {
  if (!json || typeof json !== "object") return;
  const type = json.type || "";
  if (type === "error" || json.error) {
    const error = json.error || {};
    state.error = error.message || error.type || state.error || "接口返回错误";
  }
  const usage = json.usage || json.message?.usage || json.response?.usage || null;
  if (usage && typeof usage === "object") state.usage = { ...state.usage, ...usage };
  if (json.message?.id) state.id = String(json.message.id);
  if (json.response?.id) state.id = String(json.response.id);
  const echoed = json.message?.model || json.response?.model || json.model || "";
  if (echoed && typeof echoed === "string") state.model = echoed;
  const stop = json.delta?.stop_reason || json.message?.stop_reason || json.stop_reason || json.choices?.[0]?.finish_reason || "";
  if (stop) state.stop = String(stop);

  if (type === "content_block_delta") {
    const delta = json.delta || {};
    const piece = typeof delta.text === "string" ? delta.text : typeof delta.thinking === "string" ? delta.thinking : "";
    if (piece || delta.type === "text_delta" || delta.type === "thinking_delta") noteToken(state);
    if (typeof delta.text === "string") state.text += delta.text;
    return;
  }
  if (type === "response.output_text.delta" && typeof json.delta === "string") {
    noteToken(state);
    state.text += json.delta;
    return;
  }
  const choice = json.choices?.[0];
  const chunk = choice?.delta?.content || choice?.message?.content || "";
  if (typeof chunk === "string" && chunk) {
    noteToken(state);
    state.text += chunk;
  } else if (choice?.delta?.reasoning_content) {
    noteToken(state);
  }
  if (typeof json.output_text === "string" && json.output_text && !state.text) state.text = json.output_text;
  const blocks = [].concat(json.content || []).concat(json.message?.content || []);
  const joined = blocks.map((item) => (item && typeof item.text === "string" ? item.text : "")).join("");
  if (joined && !state.text) state.text = joined;
}

async function readStream(response, signal) {
  const status = Number(response.headers.get("x-upstream-status") || 0);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const state = { text: "", first: null, last: null, itls: [], usage: {}, error: "", raw: "", id: "", model: "", stop: "", streamed: false };
  if (!reader) return { status, ...state };
  let pending = "";
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const step = await reader.read();
    if (step.done) break;
    const chunk = decoder.decode(step.value, { stream: true });
    if (state.raw.length < 1_500_000) state.raw += chunk;
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      state.streamed = true;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        absorb(JSON.parse(data), state);
      } catch {
        state.text += data;
        noteToken(state);
      }
    }
    if (state.error && typeIsFatal(state.error)) break;
  }
  if (!state.streamed && state.raw) {
    try {
      absorb(JSON.parse(state.raw), state);
    } catch {
      if (!state.error && state.raw.trim().startsWith("<")) state.error = "响应不是接口数据";
    }
  }
  return { status, ...state };
}

function typeIsFatal(error) {
  return /overloaded|invalid|unauthorized|permission/i.test(error);
}

function cleanError(text, key) {
  let out = String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (key && key.length > 6) out = out.split(key).join("***");
  return out;
}

function usageParts(usage) {
  const source = usage || {};
  const anthropic = source.cache_read_input_tokens != null || source.cache_creation_input_tokens != null;
  if (anthropic) {
    const read = Number(source.cache_read_input_tokens) || 0;
    const creation = Number(source.cache_creation_input_tokens) || 0;
    const input = Number(source.input_tokens) || 0;
    return { read, creation, input, total: input + read + creation, hasRead: source.cache_read_input_tokens != null };
  }
  const cached = Number(source.input_tokens_details?.cached_tokens ?? source.prompt_tokens_details?.cached_tokens ?? 0);
  const inputTokens = Number(source.input_tokens ?? source.prompt_tokens ?? 0);
  const hasRead = source.input_tokens_details?.cached_tokens != null || source.prompt_tokens_details?.cached_tokens != null;
  return { read: cached, creation: 0, input: Math.max(0, inputTokens - cached), total: inputTokens, hasRead };
}

function emptyShot(started, error) {
  return {
    ok: false,
    error,
    status: 0,
    ttftMs: null,
    totalMs: Math.round(performance.now() - started),
    tpotMs: null,
    tokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    text: "",
    input: 0,
    totalIn: 0,
    hasRead: false,
    streamed: false,
    stop: "",
  };
}

export async function callApi({ url, key, protocol, profile, payload, signal, timeoutMs = 90000 }) {
  const started = performance.now();
  let response;
  try {
    response = await fetch("/__probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        method: "POST",
        headers: headersFor(key, protocol, profile),
        body: JSON.stringify(payload),
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
    const error = reason === "private" ? "该地址指向内网，不能测试。" : reason === "timeout" ? "请求超时" : reason === "tls" ? "证书校验没有通过。" : reason === "bad" ? "地址格式不对。" : "连接失败";
    return emptyShot(started, error);
  }
  const parsed = await readStream(response, signal);
  const ended = performance.now();
  const parts = usageParts(parsed.usage);
  const tokens = Number(parsed.usage.output_tokens || parsed.usage.completion_tokens || 0);
  const totalMs = Math.round(ended - started);
  const ttftMs = parsed.first == null ? null : Math.round(parsed.first - started);
  const tpotMs = parsed.streamed && ttftMs != null && tokens > 1 ? (totalMs - ttftMs) / (tokens - 1) : null;
  let error = parsed.error ? cleanError(parsed.error, key) : "";
  if (!error && parsed.status >= 400) {
    error = parsed.status === 401 ? "密钥没有被接受" : parsed.status === 404 ? "找不到这个接口" : parsed.status === 429 ? "被限流" : parsed.status >= 500 ? "服务端错误" : `HTTP ${parsed.status}`;
  }
  if (!error && parsed.status > 0 && parsed.status < 400 && ttftMs == null && !parsed.text) {
    error = parsed.stop === "max_tokens" ? "输出预算被用完，没有正文。可以把最大输出调大。" : "接口返回了，但没有正文。";
  }
  const failed = Boolean(error) || parsed.status >= 400 || (parsed.status === 0 && ttftMs == null && !parsed.text);
  return {
    ok: !failed,
    status: parsed.status,
    error,
    ttftMs: parsed.streamed ? ttftMs : null,
    totalMs,
    tpotMs,
    tokens,
    text: parsed.text.slice(0, 2000),
    cacheRead: parts.read,
    cacheWrite: parts.creation,
    input: parts.input,
    totalIn: parts.total,
    hasRead: parts.hasRead,
    streamed: parsed.streamed,
    stop: parsed.stop || "",
  };
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * (p / 100);
  const low = Math.floor(rank);
  const high = Math.min(low + 1, sorted.length - 1);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function pack(values) {
  if (!values.length) return null;
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p99: percentile(values, 99),
    mean: values.reduce((sum, item) => sum + item, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function rollStats(rows) {
  if (!rows.length) return null;
  const reads = rows.map((item) => item.read);
  const totals = rows.map((item) => item.total);
  let warm = rows.findIndex((item) => item.total > 0 && item.read >= item.total * 0.5);
  if (warm < 0 || warm >= rows.length - 1) warm = 0;
  const histGrowth = totals[totals.length - 1] - totals[warm];
  const readGrowth = reads[reads.length - 1] - reads[warm];
  const capture = histGrowth > 0 ? readGrowth / histGrowth : 0;
  const sumTotal = totals.reduce((sum, item) => sum + item, 0);
  const sumInput = rows.reduce((sum, item) => sum + item.input, 0);
  let verdict = "命中区几乎不增长。长对话的费用会跟着轮数往上走。";
  let level = "warn";
  if (rows.length - warm < 3) {
    verdict = "去掉冷启动之后样本不够，这次不下结论。";
    level = "warn";
  } else if (!rows.some((item) => item.hasRead)) {
    verdict = "响应里没有缓存读字段，看不出有没有命中。";
    level = "bad";
  } else if (Math.max(...reads) === 0) {
    verdict = "全程没有读到缓存。";
    level = "bad";
  } else if (capture >= 0.5) {
    verdict = `命中区跟着对话变长，捕获 ${Math.round(capture * 100)}%。`;
    level = "ok";
  } else if (capture > 0.15) {
    verdict = `只接住了一部分新增内容，捕获 ${Math.round(capture * 100)}%。`;
    level = "warn";
  }
  return {
    warmTurn: rows[warm].turn,
    histGrowth,
    readGrowth,
    capture,
    perTurn: histGrowth / Math.max(1, rows.length - 1 - warm),
    sumTotal,
    sumInput,
    saved: sumTotal ? (1 - sumInput / sumTotal) * 100 : 0,
    verdict,
    level,
  };
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

function tally(errors) {
  const map = new Map();
  for (const item of errors) {
    const text = item || "失败";
    map.set(text, (map.get(text) || 0) + 1);
  }
  return [...map.entries()].slice(0, 6).map(([text, count]) => ({ text, count }));
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

export async function runBenchmark(form, hooks) {
  try {
    return await runBenchmarkInner(form, hooks);
  } catch (error) {
    if (error?.name === "AbortError") return { stopped: true };
    return { error: "网络异常，请检查网络后重试。" };
  }
}

function messagesPayload({ model, maxTokens, profile, system, messages, userId, thinking }) {
  const payload = { model, max_tokens: maxTokens, stream: true, messages };
  if (system?.length) payload.system = system;
  if (profile === "claude-code" && userId) payload.metadata = { user_id: userId };
  if (thinking && maxTokens > 1200) payload.thinking = { type: "enabled", budget_tokens: 1024 };
  return payload;
}

function responsesPayload({ model, maxTokens, instructions, input }) {
  const payload = { model, max_output_tokens: maxTokens, stream: true, input };
  if (instructions) payload.instructions = instructions;
  return payload;
}

async function runBenchmarkInner(form, { signal, onProgress }) {
  const protocol = form.protocol === "responses" ? "responses" : "messages";
  const profile = form.profile === "claude-code" && protocol === "messages" ? "claude-code" : "generic";
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
  const prefixTokens = Number(form.prefix_tokens) || 8000;
  const baseUser = `user_${hex(16)}`;
  const stableUser = `${baseUser}_account_${hex(8)}_session_cache`;
  let thinking = profile === "claude-code";
  const loadPrefix = buildPrefix(prefixTokens);
  const startedAt = Date.now();
  const phases = {
    preflight: { done: 0, total: 1 },
    load: { done: 0, total: requests },
    cache: { done: 0, total: samples },
    roll: { done: 0, total: turns >= 2 ? turns : 0 },
  };
  const tell = (id, done) => {
    phases[id].done = done;
    const sent = phases.preflight.done + phases.load.done + phases.cache.done + phases.roll.done;
    const planned = phases.preflight.total + phases.load.total + phases.cache.total + phases.roll.total;
    onProgress?.({
      id,
      phases: {
        preflight: { ...phases.preflight },
        load: { ...phases.load },
        cache: { ...phases.cache },
        roll: { ...phases.roll },
      },
      sent,
      planned,
    });
  };

  function varyUser() {
    return `${baseUser}_account_${hex(8)}_session_${hex(8)}`;
  }

  function loadPayload(index) {
    if (protocol === "responses") {
      return responsesPayload({
        model,
        maxTokens,
        instructions: loadPrefix,
        input: `压测请求 #${index}，用一句话回答。`,
      });
    }
    const system = profile === "claude-code"
      ? [block(CC_BILLING, false), block(CC_IDENTITY, false), block(loadPrefix, true)]
      : [block(loadPrefix, true)];
    return messagesPayload({
      model,
      maxTokens,
      profile,
      system,
      messages: [{ role: "user", content: `压测请求 #${index}，用一句话回答。` }],
      userId: varyUser(),
      thinking,
    });
  }

  async function send(payload, timeoutMs = 90000) {
    return callApi({ url: target.url, key, protocol, profile, payload, signal, timeoutMs });
  }

  tell("preflight", 0);
  let probe = await send(loadPayload(0), 60000);
  if (!probe.ok && thinking && probe.status === 400) {
    thinking = false;
    probe = await send(loadPayload(0), 60000);
  }
  if (signal.aborted) return { stopped: true };
  if (!probe.ok) return { error: probe.error || "预检没有通过，已停止，没有继续压测。" };
  tell("preflight", 1);

  const wallStart = performance.now();
  tell("load", 0);
  let finished = 0;
  const burst = await pool(requests, concurrency, async (index) => {
    const shot = await send(loadPayload(index + 1));
    finished += 1;
    tell("load", finished);
    return shot;
  }, signal);
  if (signal.aborted) return { stopped: true };
  const wallMs = performance.now() - wallStart;
  const ok = burst.filter((item) => item && item.ok);
  const ttfts = ok.map((item) => item.ttftMs).filter((item) => item != null);
  const tpots = ok.map((item) => item.tpotMs).filter((item) => item != null);
  const totals = ok.map((item) => item.totalMs).filter((item) => item != null);
  const outTokens = ok.reduce((sum, item) => sum + (item.tokens || 0), 0);
  const ttftPack = pack(ttfts);
  const bench = {
    ok: ok.length,
    fail: burst.length - ok.length,
    wallMs,
    reqPerSec: wallMs ? ok.length / (wallMs / 1000) : 0,
    tokPerSec: wallMs ? outTokens / (wallMs / 1000) : 0,
    tps: tpots.length ? 1000 / percentile(tpots, 50) : null,
    n: ttfts.length,
    ttft: ttftPack,
    tpot: pack(tpots),
    total: pack(totals),
    unstreamed: ok.filter((item) => !item.streamed).length,
  };

  const cachePoints = [];
  if (samples > 0) {
    const bulk = `[cache-${hex(4)}]\n\n${buildPrefix(prefixTokens)}`;
    for (let index = 0; index < samples; index += 1) {
      if (signal.aborted) return { stopped: true };
      if (index > 0 && interval > 0) await wait(interval * 1000, signal);
      tell("cache", index);
      const cold = index < 2;
      const tail = `缓存持久性 #${index}，简短回答。`;
      let payload;
      if (protocol === "responses") {
        payload = responsesPayload({ model, maxTokens: Math.min(maxTokens, 128), input: `${bulk}\n\n${tail}` });
      } else {
        const system = profile === "claude-code" ? [block(CC_BILLING, false), block(CC_IDENTITY, false)] : [];
        payload = messagesPayload({
          model,
          maxTokens: Math.min(maxTokens, 128),
          profile,
          system,
          messages: [
            { role: "user", content: [block(bulk, true)] },
            { role: "assistant", content: [block("收到，请继续。", false)] },
            { role: "user", content: tail },
          ],
          userId: stableUser,
          thinking: false,
        });
      }
      const shot = await send(payload, 60000);
      const ratio = shot.totalIn ? shot.cacheRead / shot.totalIn : 0;
      let kind = "miss";
      if (!shot.ok) kind = "err";
      else if (cold && shot.cacheRead === 0) kind = "cold";
      else if (shot.cacheRead > 0 && ratio >= 0.5) kind = "hit";
      else if (shot.cacheRead > 0) kind = "partial";
      cachePoints.push({
        t: index * interval,
        cold,
        kind,
        ok: shot.ok,
        error: shot.error || "",
        ttftMs: shot.ttftMs,
        totalMs: shot.totalMs,
        hit: shot.cacheRead > 0,
        read: shot.cacheRead,
        creation: shot.cacheWrite,
        input: shot.input,
        total: shot.totalIn,
        ratio,
        hasRead: shot.hasRead,
      });
      tell("cache", index + 1);
    }
  }
  if (signal.aborted) return { stopped: true };

  const scored = cachePoints.filter((item) => item.ok);
  const cacheHits = scored.filter((item) => item.hit).length;
  const tokenRead = scored.reduce((sum, item) => sum + item.read, 0);
  const tokenDen = scored.reduce((sum, item) => sum + item.read + item.creation + item.input, 0);
  const cacheErrors = cachePoints.filter((item) => !item.ok).length;
  let cache = null;
  if (samples > 0) {
    const hitRate = scored.length ? cacheHits / scored.length : null;
    let level = "warn";
    let verdict = "有效样本太少，命中率不能当结论。";
    if (scored.length >= 3 && cacheErrors <= cachePoints.length * 0.3) {
      if (!scored.some((item) => item.hasRead)) {
        verdict = "响应里没有缓存字段，看不出命中没有。";
        level = "bad";
      } else if (hitRate >= 0.8) {
        verdict = "同一段前缀能反复命中。";
        level = "ok";
      } else if (hitRate >= 0.4) {
        verdict = "有时命中，有时丢失。";
        level = "warn";
      } else {
        verdict = "前缀基本没有被复用。";
        level = "bad";
      }
    }
    cache = {
      points: cachePoints,
      n: scored.length,
      hits: cacheHits,
      errors: cacheErrors,
      hitRate,
      tokenHitRate: tokenDen ? tokenRead / tokenDen : null,
      firstHit: cachePoints.find((item) => item.hit)?.t ?? null,
      interval,
      verdict,
      level,
    };
  }

  const rollRows = [];
  if (turns >= 2) {
    const bulk = `[roll-${hex(4)}]\n\n${buildPrefix(prefixTokens)}`;
    const filler = buildPrefix(180);
    const history = [
      { role: "user", content: [block("你好，我们开始。", false)] },
      { role: "assistant", content: [block("收到，请继续。", false)] },
    ];
    let transcript = `${bulk}\n\n你好，我们开始。\n收到，请继续。\n`;
    for (let turn = 1; turn <= turns; turn += 1) {
      if (signal.aborted) return { stopped: true };
      tell("roll", turn - 1);
      const question = `第${turn}轮：用一句话回答，${turn} 加 ${turn} 等于几。${filler}`;
      let payload;
      if (protocol === "responses") {
        payload = responsesPayload({
          model,
          maxTokens: Math.min(maxTokens, 128),
          input: `${transcript}用户：${question}\n请只回答这个加法。`,
        });
      } else {
        const messages = history.map((item) => ({
          role: item.role,
          content: item.content.map((piece) => ({ ...piece })),
        }));
        const last = messages[messages.length - 1].content;
        last[last.length - 1].cache_control = { type: "ephemeral" };
        messages.push({ role: "user", content: question });
        payload = messagesPayload({
          model,
          maxTokens: Math.min(maxTokens, 128),
          profile,
          system: profile === "claude-code"
            ? [block(CC_BILLING, false), block(CC_IDENTITY, true), block(bulk, true)]
            : [block("You are a helpful assistant.", true), block(bulk, true)],
          messages,
          userId: stableUser,
          thinking: false,
        });
      }
      const shot = await send(payload, 90000);
      if (!shot.ok && turn === 1) {
        rollRows.push({ turn, ok: false, error: shot.error, total: 0, input: 0, read: 0, creation: 0, hasRead: false });
        break;
      }
      rollRows.push({
        turn,
        ok: shot.ok,
        error: shot.error || "",
        total: shot.totalIn,
        input: shot.input,
        read: shot.cacheRead,
        creation: shot.cacheWrite,
        hasRead: shot.hasRead,
      });
      const answer = shot.text || "（空）";
      if (protocol === "responses") transcript += `用户：${question}\n助手：${answer}\n`;
      else {
        history.push({ role: "user", content: [block(question, false)] });
        history.push({ role: "assistant", content: [block(answer, false)] });
      }
      if (turn < turns) await wait(1500, signal);
    }
    tell("roll", turns);
  }

  const counted = rollRows.filter((item) => item.ok);
  const roll = counted.length
    ? { rows: counted, ...rollStats(counted) }
    : rollRows[0]?.error
      ? { rows: [], capture: null, saved: null, verdict: rollRows[0].error, level: "bad" }
      : null;
  const p50 = ttftPack?.p50 ?? null;
  const rate = burst.length ? ok.length / burst.length : 0;
  const report = {
    id: `local-${Date.now()}`,
    at: new Date().toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    host: (() => { try { return new URL(target.url).host; } catch { return ""; } })(),
    path: target.url,
    model,
    protocol,
    profile,
    requests,
    concurrency,
    maxTokens,
    prefixTokens,
    ok: ok.length,
    fail: burst.length - ok.length,
    ttftMs: p50 == null ? null : Math.round(p50),
    p90: ttftPack?.p90 ?? null,
    p99: ttftPack?.p99 ?? null,
    min: ttftPack?.min ?? null,
    max: ttftPack?.max ?? null,
    avg: ttftPack?.mean ?? null,
    speed: bench.tps == null ? null : Math.round(bench.tps * 100) / 100,
    rate,
    ttftWord: wordTtft(p50),
    rateWord: wordRate(rate),
    bench,
    cache,
    samples: cachePoints.filter((item) => !item.cold).map((item) => ({ ok: item.ok, ttftMs: item.ttftMs, hit: item.hit, read: item.read })),
    cacheHit: cache?.hitRate ?? null,
    roll: roll?.rows?.map((item) => ({ turn: item.turn, ok: item.ok, input: item.input, read: item.read, total: item.total })) || [],
    rollSummary: roll,
    errors: tally(burst.filter((item) => item && !item.ok).map((item) => item.error)),
    shots: burst.map((item) => ({ ok: Boolean(item?.ok), ttftMs: item?.ttftMs ?? null, error: item?.error || "" })),
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
  try {
    localStorage.setItem(`okk-speed-report:${report.id}`, JSON.stringify(report));
  } catch {
    report.shots = report.shots.slice(0, 40);
    report.cache = report.cache ? { ...report.cache, points: report.cache.points.slice(0, 40) } : null;
    localStorage.setItem(`okk-speed-report:${report.id}`, JSON.stringify(report));
  }
  return { report };
}

export async function listModels(rawUrl, key, protocol = "messages") {
  const target = endpoint(rawUrl, protocol === "responses" ? "responses" : "messages");
  if (target.error) return { error: target.error };
  const modelsUrl = target.url.replace(/\/(messages|responses)$/i, "/models");
  let response;
  try {
    response = await fetch("/__probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: modelsUrl,
        method: "GET",
        headers: headersFor(key, protocol === "responses" ? "responses" : "messages", "generic"),
        timeoutMs: 15000,
      }),
    });
  } catch {
    return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  }
  if (!response.ok) {
    const reason = await response.text();
    if (reason === "private") return { error: "该地址指向内网，不能获取模型列表。" };
    if (reason === "tls") return { error: "证书校验没有通过，可以直接手动输入模型名。" };
    return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  }
  const status = Number(response.headers.get("x-upstream-status") || 0);
  const text = await response.text();
  if (status === 401 || status === 403) return { error: "密钥没有被接受，可以直接手动输入模型名。" };
  if (status >= 400) return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  try {
    const json = JSON.parse(text);
    const models = (json.data || json.models || []).map((item) => (typeof item === "string" ? item : item.id || item.name)).filter(Boolean);
    if (!models.length) return { error: "这个接口没有返回模型名，可以直接手动输入。" };
    return { models: [...new Set(models)].slice(0, 400) };
  } catch {
    return { error: "获取模型列表失败，可以直接手动输入模型名。" };
  }
}
