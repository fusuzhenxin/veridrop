import crypto from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gradePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/original-check/check-grade.js");
const gradeModule = new Module(gradePath);
gradeModule.filename = gradePath;
gradeModule.paths = Module._nodeModulePaths(path.dirname(gradePath));
gradeModule._compile(fs.readFileSync(gradePath, "utf8"), gradePath);
const G = gradeModule.exports;

const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function randomToken(prefix, alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let out = prefix || "";
  for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function claudeModel(name) {
  return /claude|anthropic/i.test(name || "");
}

function headersFor(ctx, headerMode) {
  const headers = { Authorization: `Bearer ${ctx.key}`, "Content-Type": "application/json" };
  if (ctx.protocol === "claude" && headerMode !== "bearer") {
    headers["x-api-key"] = ctx.key;
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

function bodyFor(ctx, spec, options) {
  const useTemperature = !options || options.temperature !== false;
  const useCompletionLimit = options && options.completionLimit;
  if (ctx.protocol === "claude") {
    const body = {
      model: ctx.model,
      messages: spec.passthrough ? spec.messages : G.claudeMessages(spec.messages),
      max_tokens: (options && options.maxTokens) || spec.max_tokens || 1024,
    };
    const system = G.claudeSystem(spec.messages);
    if (system) body.system = system;
    if (options && options.stream) body.stream = true;
    if (spec.stop) body.stop_sequences = spec.stop;
    if (spec.tools) {
      body.tools = spec.tools.map((tool) => {
        const fn = tool.function || tool;
        return { name: fn.name, description: fn.description || "", input_schema: fn.parameters || fn.input_schema };
      });
    }
    if (spec.tool_choice && spec.tool_choice.function) body.tool_choice = { type: "tool", name: spec.tool_choice.function.name };
    return body;
  }
  const body = { model: ctx.model, messages: spec.messages, stream: !!(options && options.stream) };
  if (useTemperature) body.temperature = spec.temperature == null ? 0 : spec.temperature;
  if (spec.max_tokens) {
    if (useCompletionLimit) body.max_completion_tokens = spec.max_tokens;
    else body.max_tokens = spec.max_tokens;
  }
  if (spec.stop) body.stop = spec.stop;
  if (spec.tools) body.tools = spec.tools;
  if (spec.tool_choice) body.tool_choice = spec.tool_choice;
  if (spec.reasoning_effort) body.reasoning_effort = spec.reasoning_effort;
  return body;
}

function user(content) {
  return [{ role: "user", content: G.present(content) }];
}

function usageLine(reply) {
  const usage = (reply && reply.usage) || {};
  const parts = [];
  if (usage.prompt != null) parts.push(`输入 ${usage.prompt}`);
  if (usage.completion != null) parts.push(`输出 ${usage.completion}`);
  if (usage.reasoning != null) parts.push(`推理 ${usage.reasoning}`);
  return parts.join(" · ");
}

function decorate(graded, ms, reply) {
  const extra = [`${ms} ms`];
  const usage = usageLine(reply);
  if (usage) extra.push(usage);
  const note = reply && reply.note ? reply.note : "";
  return { status: graded.status, summary: `${note}${graded.summary} ${extra.join(" · ")}` };
}

function blockedOrUnsupported(err, hints) {
  const message = String((err && err.message) || "");
  return /short-input|heartbeat|distillation/i.test(message) || G.looksUnsupported(message, hints);
}

function serverBody(value, secret) {
  if (value == null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.split(secret).join("[redacted]").slice(0, 120000);
}

function pack(outcome, raw, secret) {
  return { status: outcome.status, summary: String(outcome.summary || "").split(secret).join("[redacted]"), raw: serverBody(raw == null ? "" : raw, secret) };
}

async function readError(res, secret) {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  const error = new Error(String(G.errorText(json, text, res.status)).split(secret).join("[redacted]"));
  error.status = res.status;
  return error;
}

function noteCall(meter, reply, ms) {
  meter.requests += 1;
  const usage = (reply && reply.usage) || {};
  if (usage.prompt != null) meter.input += Number(usage.prompt) || 0;
  if (usage.completion != null) meter.output += Number(usage.completion) || 0;
  if (meter.ttftMs == null && ms != null) meter.ttftMs = ms;
}

async function postOnce(ctx, spec, signal, options, meter) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(ctx.endpoints.chat, {
      method: "POST",
      headers: headersFor(ctx, options && options.headerMode),
      body: JSON.stringify(bodyFor(ctx, spec, options)),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    noteCall(meter, null, Date.now() - started);
    const wrapped = new Error(String(err.message || err).split(ctx.key).join("[redacted]"));
    wrapped.network = true;
    throw wrapped;
  }
  const ms = Date.now() - started;
  if (!res.ok) {
    noteCall(meter, null, ms);
    throw await readError(res, ctx.key);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  const reply = G.readReply(json);
  noteCall(meter, reply, ms);
  return { reply, ms, raw: json };
}

async function readEventStream(res, secret) {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model = "";
  let chunks = 0;
  const reader = res.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json = null;
      try { json = JSON.parse(data); } catch { json = null; }
      if (!json) continue;
      if (json.error || json.type === "error") {
        const failure = new Error(String(G.errorText(json.error ? json : { error: json.error || json }, data, 400)).split(secret).join("[redacted]"));
        failure.status = 400;
        throw failure;
      }
      if (json.model) model = json.model;
      const piece = G.takeStreamText(json);
      if (piece) {
        content += piece;
        chunks += 1;
      }
    }
  }
  return { content, model, chunks };
}

async function postStream(ctx, spec, signal, options, meter) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(ctx.endpoints.chat, {
      method: "POST",
      headers: headersFor(ctx, options && options.headerMode),
      body: JSON.stringify(bodyFor(ctx, spec, Object.assign({ stream: true }, options || {}))),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    noteCall(meter, null, Date.now() - started);
    const wrapped = new Error(String(err.message || err).split(ctx.key).join("[redacted]"));
    wrapped.network = true;
    throw wrapped;
  }
  if (!res.ok) {
    noteCall(meter, null, Date.now() - started);
    throw await readError(res, ctx.key);
  }
  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/event-stream")) {
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    const reply = G.readReply(json);
    const ms = Date.now() - started;
    noteCall(meter, reply, ms);
    return { reply, chunks: 0, ms, raw: json };
  }
  const streamed = await readEventStream(res, ctx.key);
  const ms = Date.now() - started;
  const reply = { content: streamed.content, model: streamed.model || "", usage: {}, toolCalls: [] };
  noteCall(meter, reply, ms);
  return { reply, chunks: streamed.chunks, ms, raw: streamed.content };
}

function claudeRouteFailed(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 402 || err.status === 403 || err.status === 429) return false;
  if (/thinking|budget_tokens|max_tokens/i.test(String(err.message || ""))) return false;
  return true;
}

async function postChat(ctx, spec, signal, meter) {
  const attempt = (target, options) => {
    const opts = Object.assign({}, options || {});
    if (spec.stream) opts.stream = true;
    return opts.stream ? postStream(target, spec, signal, opts, meter) : postOnce(target, spec, signal, opts, meter);
  };
  try {
    return await attempt(ctx, {});
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError") throw err;
    let current = err;
    if (ctx.protocol === "claude" && current.network) {
      try {
        return await attempt(ctx, { headerMode: "bearer" });
      } catch (bearerErr) {
        current = bearerErr;
      }
    }
    if (ctx.protocol === "claude" && claudeRouteFailed(current)) {
      const open = { ...ctx, protocol: "openai", endpoints: G.endpoints(ctx.base, "openai") };
      const out = await attempt(open, {});
      if (out.reply) out.reply.note = "浏览器调不通 /v1/messages，已改用 OpenAI 兼容接口。";
      ctx.protocol = "openai";
      ctx.endpoints = open.endpoints;
      return out;
    }
    if (current.network || !current.status) throw current;
    if (ctx.protocol === "claude" && /thinking|budget_tokens/i.test(String(current.message || ""))) {
      return attempt(ctx, { maxTokens: Math.max(spec.max_tokens || 0, 4096) });
    }
    if (spec.stream && current.status === 400 && /stream/i.test(current.message || "")) return postOnce(ctx, spec, signal, {}, meter);
    if (current.status === 400 && /temperature/i.test(current.message || "")) return attempt(ctx, { temperature: false });
    if (current.status === 400 && /max_tokens/i.test(current.message || "") && spec.max_tokens && ctx.protocol !== "claude") {
      return attempt(ctx, { completionLimit: true });
    }
    throw current;
  }
}

async function withTimeout(ms, fn, secret) {
  const signal = AbortSignal.timeout(ms);
  try {
    return await fn(signal);
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { status: "error", summary: `超过 ${Math.max(1, Math.round(ms / 1000))} 秒还没有返回。`, raw: "" };
    }
    return { status: "error", summary: String(err.message || err).split(secret).join("[redacted]"), raw: "" };
  }
}

function toolDef(account) {
  return {
    messages: user(`查询账户 ${account} 的余额。必须调用 get_balance，不要自己编一个数字。`),
    max_tokens: 200,
    tools: [{
      type: "function",
      function: {
        name: "get_balance",
        description: "Get the balance of an account",
        parameters: { type: "object", properties: { account: { type: "string" } }, required: ["account"] },
      },
    }],
    tool_choice: { type: "function", function: { name: "get_balance" } },
  };
}

function visionSpec(ctx) {
  const ask = "这张图更接近红、绿还是蓝？只回答一个字。";
  if (ctx.protocol === "claude") {
    return {
      passthrough: true,
      max_tokens: 64,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL_PNG } },
          { type: "text", text: ask },
        ],
      }],
    };
  }
  return {
    max_tokens: 64,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: ask },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL_PNG}` } },
      ],
    }],
  };
}

const LABELS = [
  ["proto", "协议识别"],
  ["structure", "响应结构"],
  ["modelecho", "模型回显"],
  ["consistent", "模型一致性"],
  ["stream", "流式响应"],
  ["control", "输出控制"],
  ["memory", "上下文记忆"],
  ["system", "系统指令"],
  ["tools", "工具调用"],
  ["vision", "多模态"],
  ["reasoning", "推理参数"],
  ["usage", "用量审计"],
  ["replay", "缓存与重放"],
  ["context", "长上下文真实性"],
];

// Use the browser's question bank, prompts, transport and graders for scheduled checks.
export async function runAbilitySuites(job) {
  const base = G.normalizeBase(job.base);
  const protocol = claudeModel(job.model) ? "claude" : "openai";
  const ctx = { base, key: job.key, model: job.model, protocol, endpoints: G.endpoints(base, protocol) };
  const meter = { requests: 0, input: 0, output: 0, ttftMs: null };
  const started = Date.now();
  const count = [5, 10, 15, 20].includes(job.candyCount) ? job.candyCount : 10;
  const questions = G.CANDY_QUESTIONS.slice(0, count);
  const candyRows = [];
  const candyGate = AbortSignal.timeout(480000);
  let stop = false;
  for (const question of questions) {
    const missed = (message) => ({
      title: question.title, prompt: question.prompt, dimension: question.dimension,
      level: question.level, options: question.options, answer: question.answer,
      expect: question.expect, picked: message, ok: false, missed: true,
    });
    if (stop || candyGate.aborted) {
      candyRows.push(missed("未作答"));
      continue;
    }
    try {
      const prompt = [question.prompt, "", ...question.options.map((opt) => `${opt.key}. ${opt.text}`), "", "只回复一个选项字母。"].join("\n");
      const out = await postChat(ctx, { messages: user(prompt), max_tokens: question.max || 800 }, AbortSignal.any([candyGate, AbortSignal.timeout(60000)]), meter);
      candyRows.push(G.gradeCandyQuestion(question, out.reply.content));
    } catch (err) {
      const hard = err.network || [401, 402, 403, 429].includes(err.status);
      // A rejected key/quota is not a wrong answer; preserve every unasked question.
      candyRows.push(missed(String(err.message || err).split(job.key).join("[redacted]")));
      if (hard) stop = true;
    }
  }
  const asked = candyRows.filter((row) => !row.missed);
  const right = asked.filter((row) => row.ok).length;
  const wrong = asked.length - right;
  const missed = candyRows.length - asked.length;
  const candy = {
    id: "candy", label: "糖果测试", state: "done",
    status: !asked.length ? "error" : wrong && !right ? "fail" : wrong || missed ? "warn" : "pass",
    summary: `共 ${count} 题，对了 ${right} 题${wrong ? `，错了 ${wrong} 题` : ""}${missed ? `，${missed} 题没跑完` : ""}。 ${Date.now() - started} ms`, raw: "",
  };
  if (job.suite === "candy") {
    return {
      rows: [candy], candyRows, partRight: right, partTotal: count,
      partScore: Math.round(right / count * 100), pelicanHtml: "",
      meter: { ...meter, totalMs: Date.now() - started }, complete: !missed,
    };
  }
  let pelicanHtml = "";
  const pelican = await withTimeout(180000, async (signal) => {
    const out = await postChat(ctx, { messages: [{ role: "user", content: G.PELICAN_PROMPT }], max_tokens: 12000, stream: true }, signal, meter);
    const graded = G.gradePelican(out.reply.content);
    pelicanHtml = String(graded.html || "").split(job.key).join("[redacted]");
    return pack(decorate(graded, out.ms, out.reply), "", job.key);
  }, job.key);
  return {
    rows: [candy, { ...pelican, id: "pelican", label: "鹈鹕骑车", state: "done" }],
    candyRows, partRight: right, partTotal: count, partScore: Math.round(right / count * 100),
    pelicanHtml, meter: { ...meter, totalMs: Date.now() - started },
    complete: !missed && pelican.status !== "error",
  };
}

export async function runBasicSuite(job) {
  const secret = job.key;
  const base = G.normalizeBase(job.base);
  const protocol = claudeModel(job.model) ? "claude" : "openai";
  const ctx = { base, key: secret, model: job.model, protocol, endpoints: G.endpoints(base, protocol) };
  const meter = { requests: 0, input: 0, output: 0, ttftMs: null };
  const started = Date.now();
  const rows = [];
  const push = (id, outcome) => {
    rows.push({ id, label: LABELS.find((item) => item[0] === id)?.[1] || id, status: outcome.status, summary: outcome.summary, raw: outcome.raw || "", state: "done" });
  };
  let first = null;
  const proto = await withTimeout(90000, async (signal) => {
    first = await postChat(ctx, { messages: user("用一句话说明你收到了这条消息。"), max_tokens: 128 }, signal, meter);
    return pack(decorate(G.gradeProtocol(first.raw), first.ms, first.reply), first.raw, secret);
  }, secret);
  push("proto", proto);
  if (/401|403|invalid api key|unauthorized|密钥无效|令牌无效/i.test(proto.summary)) {
    const error = new Error("接口拒绝了密钥");
    error.auth = true;
    throw error;
  }
  if (first) {
    push("structure", pack(decorate(G.gradeStructure(first.raw), first.ms, first.reply), first.raw, secret));
    push("modelecho", pack(decorate(G.gradeConnect(first.reply, ctx.model), first.ms, first.reply), first.raw, secret));
    rows.push({ id: "usage-hold", ...pack(decorate(G.gradeUsage(first.reply), first.ms, first.reply), first.raw, secret) });
  } else {
    const missed = { status: "error", summary: "没测成。第一问没有返回，这几项没法从同一次回复里读取。", raw: "" };
    push("structure", missed);
    push("modelecho", missed);
    rows.push({ id: "usage-hold", ...missed });
  }
  push("consistent", await withTimeout(90000, async (signal) => {
    const seen = [];
    if (first && first.reply) seen.push(String(first.reply.model || ""));
    const out = await postChat(ctx, { messages: user("只回复 OK。"), max_tokens: 16 }, signal, meter);
    seen.push(String((out.reply && out.reply.model) || ""));
    return pack(decorate(G.gradeConsistency(seen, ctx.model), out.ms, out.reply), out.raw, secret);
  }, secret));
  push("stream", await withTimeout(90000, async (signal) => {
    const out = await postChat(ctx, { messages: user("从一数到三，用顿号分开，不要解释。"), max_tokens: 128, stream: true }, signal, meter);
    const text = String((out.reply && out.reply.content) || "");
    if (out.chunks > 0 && text) return pack({ status: "pass", summary: `收到了 ${out.chunks} 段流式正文。` }, text, secret);
    if (text) return pack({ status: "warn", summary: "有正文，但不是一段段流式返回的。" }, text, secret);
    return pack({ status: "fail", summary: "流式请求没有返回正文。" }, "", secret);
  }, secret));
  push("control", await withTimeout(90000, async (signal) => {
    try {
      const out = await postChat(ctx, { messages: user("从 1 数到 6，每行一个数字。最后一行只写 END。"), max_tokens: 128, stop: ["END"] }, signal, meter);
      const graded = G.gradeStop(out.reply.content.replace(/END/g, "5"));
      const text = String(out.reply.content || "");
      const body = out.raw || text;
      if (text.includes("END")) return pack({ status: "fail", summary: `停止词 END 没有拦住。 ${out.ms} ms` }, body, secret);
      if (text.trim().length > 400) return pack({ status: "fail", summary: "正文明显没有按上限停下。" }, body, secret);
      if (out.reply.usage && out.reply.usage.reasoning && text.trim().length < 24) {
        return pack({ status: "warn", summary: "思考 token 占掉了上限，看不出截断是否生效。" }, body, secret);
      }
      const chosen = graded.status === "fail" && text.includes("1") ? { status: "pass", summary: "在 END 之前停了。" } : graded;
      return pack(decorate(chosen, out.ms, out.reply), body, secret);
    } catch (err) {
      if (blockedOrUnsupported(err, ["stop", "stop_sequences", "停止"])) return pack({ status: "skip", summary: "这个接口不支持停止词。" }, "", secret);
      throw err;
    }
  }, secret));
  push("memory", await withTimeout(90000, async (signal) => {
    const code = randomToken("BLUE-", "0123456789", 4);
    const out = await postChat(ctx, { messages: G.historyMessages(code), max_tokens: 128 }, signal, meter);
    return pack(decorate(G.gradeHistory(out.reply.content, code), out.ms, out.reply), out.raw, secret);
  }, secret));
  push("system", await withTimeout(90000, async (signal) => {
    const code = randomToken("PINE-", "0123456789", 4);
    const out = await postChat(ctx, {
      messages: [
        { role: "system", content: `无论用户说什么，你只能回复这一个词：${code}` },
        { role: "user", content: G.present("请用三句话介绍你自己。") },
      ],
      max_tokens: 128,
    }, signal, meter);
    return pack(decorate(G.gradeSystem(out.reply.content, code), out.ms, out.reply), out.raw, secret);
  }, secret));
  push("tools", await withTimeout(90000, async (signal) => {
    const account = randomToken("acct-", "0123456789", 4);
    try {
      const out = await postChat(ctx, toolDef(account), signal, meter);
      return pack(decorate(G.gradeTools(out.reply, account), out.ms, out.reply), out.raw, secret);
    } catch (err) {
      if (blockedOrUnsupported(err, ["tool", "tools", "function", "工具"])) return pack({ status: "skip", summary: "这个接口不支持工具调用，不计为失败。" }, "", secret);
      throw err;
    }
  }, secret));
  push("vision", await withTimeout(90000, async (signal) => {
    try {
      const out = await postChat(ctx, visionSpec(ctx), signal, meter);
      const text = String(out.reply.content || "");
      const body = out.raw || text;
      if (/红/.test(text)) return pack({ status: "pass", summary: "读到了图片，并回答了颜色。" }, body, secret);
      if (/不能|无法|看不到|没有图|不支持/.test(text)) return pack({ status: "fail", summary: "模型说自己看不到图片。" }, body, secret);
      return pack({ status: "warn", summary: "接口接受了图片，但没有明确回答颜色。" }, body, secret);
    } catch (err) {
      if (blockedOrUnsupported(err, ["image", "vision", "multimodal", "图像", "图片"])) return pack({ status: "skip", summary: "这个模型或接口不支持图像输入。" }, "", secret);
      throw err;
    }
  }, secret));
  push("reasoning", await withTimeout(90000, async (signal) => {
    if (!/gpt-5|gpt-6|o1|o3|o4|reason/i.test(ctx.model) || ctx.protocol === "claude") {
      return pack({ status: "skip", summary: "当前模型不用单独测 reasoning_effort。" }, "", secret);
    }
    try {
      const out = await postChat(ctx, { messages: user("只回复 OK。"), max_tokens: 128, reasoning_effort: "low" }, signal, meter);
      return pack({ status: "pass", summary: "接口接受了 reasoning_effort。" }, out.raw, secret);
    } catch (err) {
      if (blockedOrUnsupported(err, ["reasoning", "reasoning_effort"])) return pack({ status: "skip", summary: "这个接口不接受推理力度参数。" }, "", secret);
      throw err;
    }
  }, secret));
  const usageHold = rows.find((row) => row.id === "usage-hold");
  push("usage", { status: usageHold.status, summary: usageHold.summary, raw: usageHold.raw });
  push("replay", await withTimeout(120000, async (signal) => {
    const spec = { messages: user("用一个词回答：企鹅生活在哪里？"), max_tokens: 64 };
    const a = await postChat(ctx, spec, signal, meter);
    const b = await postChat(ctx, spec, signal, meter);
    return pack(decorate(G.gradeReplay(G.responseId(a.raw), G.responseId(b.raw)), a.ms + b.ms, b.reply), b.raw, secret);
  }, secret));
  push("context", await withTimeout(90000, async (signal) => {
    const code = randomToken("KITE-", "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);
    const prompt = G.buildNeedlePrompt(code);
    const out = await postChat(ctx, { messages: user(prompt), max_tokens: 64 }, signal, meter);
    const graded = G.gradeNeedle(out.reply.content, code);
    graded.summary += ` 这篇约 ${prompt.length} 字，不是百万级上下文。`;
    return pack(decorate(graded, out.ms, out.reply), out.raw, secret);
  }, secret));
  const order = LABELS.map(([id]) => id);
  const finalRows = order.map((id) => rows.find((row) => row.id === id)).filter(Boolean);
  let points = 0;
  let counted = 0;
  for (const row of finalRows) {
    if (row.status === "pass") { counted += 1; points += 1; }
    else if (row.status === "warn") { counted += 1; points += 0.5; }
    else if (row.status === "fail") counted += 1;
  }
  const score = counted ? Math.round((points / counted) * 100) : null;
  const finished = Date.now();
  const id = `basic-${crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8).toLowerCase()}`;
  return {
    id,
    suite: "basic",
    host: job.apiHost || "",
    base,
    model: job.model,
    modelId: job.model,
    keyMask: "—",
    started,
    finishedAt: finished,
    running: false,
    interrupted: false,
    result: score == null ? "没测成" : `${score} 分`,
    partScore: null,
    partRight: null,
    partTotal: null,
    rows: finalRows,
    meter: { requests: meter.requests, input: meter.input, output: meter.output, ttftMs: meter.ttftMs, totalMs: finished - started },
    replay: "",
    candySeq: null,
    candyRows: [],
    pelicanHtml: "",
    score,
  };
}
