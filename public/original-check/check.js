(function () {
  const G = window.CheckGrade;
  const STORE = "veridrop.check.v1";
  const STATUS_TEXT = {
    idle: "未测",
    running: "进行中",
    pass: "通过",
    warn: "留意",
    fail: "未通过",
    skip: "不支持",
    error: "没测成",
    stop: "已停止",
  };

  const $ = function (id) {
    return document.getElementById(id);
  };

  const state = {
    jobs: {},
    lastCurl: "",
    claudeViaOpenAI: false,
  };

  function randomToken(prefix, alphabet, length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = prefix || "";
    for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function digits(length) {
    return randomToken("", "0123456789", length);
  }

  function escapeText(value) {
    return String(value || "");
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function writeStore(data) {
    localStorage.setItem(STORE, JSON.stringify(data));
  }

  function keyMode() {
    const box = $("rememberKey");
    return box && box.checked ? "saved" : "page";
  }

  function chosenModel() {
    const select = $("model");
    return select ? select.value.trim() : "";
  }

  function setModel(id) {
    const select = $("model");
    const name = String(id || "").trim();
    if (!select || !name) return;
    const has = Array.prototype.some.call(select.options, function (option) {
      return option.value === name;
    });
    if (!has) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    select.value = name;
  }

  function persist() {
    const remember = keyMode() === "saved";
    const data = {
      base: $("base").value.trim(),
      model: chosenModel(),
      remember: remember,
    };
    if (remember) data.key = $("apiKey").value;
    writeStore(data);
    $("keyMode").textContent = remember ? "Key 记在这台浏览器" : "Key 只留在这次打开的页面里";
  }

  function restore() {
    const data = readStore();
    if (data.base) $("base").value = data.base;
    if (data.model) {
      const has = Array.prototype.some.call($("model").options, function (option) {
        return option.value === data.model;
      });
      if (has) setModel(data.model);
      else setModel(data.model);
    }
    if (data.remember && data.key) {
      $("rememberKey").checked = true;
      $("apiKey").value = data.key;
    }
    $("keyMode").textContent = data.remember ? "Key 记在这台浏览器" : "Key 只留在这次打开的页面里";
    applyProtocolForModel();
  }

  function claudeModel(name) {
    return /claude|anthropic/i.test(name || "");
  }

  function applyProtocolForModel() {
    const model = chosenModel();
    if (state.protocolModel !== model) {
      state.protocolModel = model;
      state.claudeViaOpenAI = false;
    }
    paintProtocolHint();
  }

  function protocolFor(model) {
    return claudeModel(model) && !state.claudeViaOpenAI ? "claude" : "openai";
  }

  function paintProtocolHint() {
    const hint = $("protocolHint");
    if (!hint) return;
    const model = chosenModel();
    if (!model) {
      hint.textContent = "";
      return;
    }
    if (claudeModel(model) && !state.claudeViaOpenAI) hint.textContent = "Claude Messages";
    else if (claudeModel(model)) hint.textContent = "Claude 原生接口调不通，已改用 OpenAI 兼容";
    else hint.textContent = "OpenAI 兼容";
  }

  function shortModelError(err) {
    const text = String((err && err.message) || "");
    if (!text || /failed to fetch|networkerror|load failed|network error/i.test(text)) {
      return "没有读到模型列表，先用页面里的常用模型";
    }
    const line = text.split(/[。\n]/)[0].trim().slice(0, 36);
    return line ? "没有读到模型列表：" + line : "没有读到模型列表，先用页面里的常用模型";
  }

  function setModelStatus(text) {
    const node = $("modelStatus");
    if (node) node.textContent = text || "";
  }

  function setNote(text) {
    const node = $("runNote");
    if (node) node.textContent = text || "";
  }

  function showJobNote(text) {
    const nodes = document.querySelectorAll("[data-job-note]");
    Array.prototype.forEach.call(nodes, function (node) {
      node.hidden = !text;
      node.textContent = text || "";
    });
  }

  var BASIC_TESTS = ["connect", "echo", "history", "needle"];
  var EXTRA_TESTS = ["candy", "pelican"];

  function cards() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-test]"));
  }

  function badge(card, status) {
    const el = card.querySelector("[data-badge]");
    el.className = "lab-badge " + status;
    el.textContent = STATUS_TEXT[status] || status;
  }

  function renderQuestionRows(out, rows) {
    const list = document.createElement("ol");
    list.className = "mc-qlist";
    rows.forEach(function (row, index) {
      const item = document.createElement("li");
      const verdict = row.missed ? "未完成" : row.ok ? "对" : "错";
      item.className = "mc-qitem" + (row.missed ? " is-miss" : row.ok ? " is-ok" : " is-bad");
      const head = document.createElement("div");
      head.className = "mc-qhead";
      const title = document.createElement("strong");
      title.textContent = index + 1 + ". " + (row.title || "题目");
      const mark = document.createElement("span");
      mark.textContent = verdict;
      head.appendChild(title);
      head.appendChild(mark);
      const prompt = document.createElement("p");
      prompt.className = "mc-qprompt";
      prompt.textContent = row.prompt || "";
      const picked = document.createElement("p");
      picked.textContent = "模型答案：" + (row.picked || "没有回答");
      const expect = document.createElement("p");
      expect.textContent = "对照：" + (row.expect || "");
      item.appendChild(head);
      item.appendChild(prompt);
      item.appendChild(picked);
      item.appendChild(expect);
      list.appendChild(item);
    });
    out.appendChild(list);
  }

  function showResult(card, status, summary, detail, svg, html, rows, server) {
    badge(card, status);
    const out = card.querySelector("[data-out]");
    out.replaceChildren();
    if (summary) {
      const line = document.createElement("p");
      line.className = "lab-summary";
      line.textContent = summary;
      out.appendChild(line);
    }
    const page = html ? preparePlayableHtml(html) : svg ? wrapSvgPage(sanitizeSvg(svg)) : "";
    if (page) {
      const frame = document.createElement("iframe");
      frame.className = "lab-frame";
      frame.setAttribute("sandbox", "allow-scripts allow-forms");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("title", "鹈鹕骑车");
      frame.srcdoc = page;
      out.appendChild(frame);
      const bar = document.createElement("div");
      bar.className = "lab-actions";
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "mc-btn";
      openBtn.textContent = "在新标签打开";
      openBtn.addEventListener("click", function () {
        openHtmlPage(page, bar);
      });
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "mc-btn";
      downBtn.textContent = "下载 HTML";
      downBtn.addEventListener("click", function () {
        downloadHtml(page, "pelican-bicycle.html");
      });
      bar.appendChild(openBtn);
      bar.appendChild(downBtn);
      out.appendChild(bar);
    } else if (html || svg) {
      const warn = document.createElement("p");
      warn.className = "lab-summary";
      warn.textContent = "画面没有通过安全渲染，下面只保留文字。";
      out.appendChild(warn);
    }
    if (rows && rows.length) renderQuestionRows(out, rows);
    const testId = card.getAttribute("data-test");
    if (testId) {
      const picked = server != null && String(server) !== "" ? String(server) : String(detail || "");
      tell({
        type: "veridrop-basic-step",
        id: testId,
        status: status,
        summary: summary || "",
        raw: picked.length > 4000 ? picked.slice(0, 4000) + "\n…已截断" : picked,
      });
    }
    if (card.getAttribute("data-test") === "candy") {
      if (rows && rows.some(function (row) { return !row.missed; })) renderCandyReport(rows);
      else showCandyStart();
    }
    paintDetectRows();
    if (detail && card.getAttribute("data-raw") === "1") {
      const box = document.createElement("details");
      box.className = "lab-raw";
      const title = document.createElement("summary");
      title.textContent = "原始回复";
      const pre = document.createElement("pre");
      const text = escapeText(detail);
      pre.textContent = text.length > 6000 ? text.slice(0, 6000) + "\n…已截断" : text;
      box.appendChild(title);
      box.appendChild(pre);
      out.appendChild(box);
    }
  }

  function wrapSvgPage(svg) {
    if (!svg) return "";
    return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0;background:#fff\">" + svg + "</body></html>";
  }

  function htmlBlob(page) {
    return new Blob([page], { type: "text/html;charset=utf-8" });
  }

  function openHtmlPage(page, noteHost) {
    const url = URL.createObjectURL(htmlBlob(page));
    const opened = window.open(url, "_blank");
    if (!opened) {
      setNote("浏览器拦住了新标签。可以改用下载 HTML。");
      if (noteHost && !noteHost.querySelector(".lab-summary")) {
        const warn = document.createElement("p");
        warn.className = "lab-summary";
        warn.textContent = "浏览器拦住了新标签。请改用下载 HTML。";
        noteHost.appendChild(warn);
      }
    }
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 120000);
  }

  function downloadHtml(page, filename) {
    const url = URL.createObjectURL(htmlBlob(page));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function preparePlayableHtml(raw) {
    return String(raw || "")
      .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, "")
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
      .replace(/<(object|embed|base)\b[^>]*>/gi, "");
  }

  function sanitizeSvg(raw) {
    if (typeof DOMParser === "undefined") return "";
    const doc = new DOMParser().parseFromString(String(raw || ""), "image/svg+xml");
    if (!doc || doc.querySelector("parsererror")) return "";
    const svg = doc.querySelector("svg");
    if (!svg) return "";
    svg.querySelectorAll("script,foreignObject,iframe,object,embed,audio,video").forEach(function (node) {
      node.remove();
    });
    svg.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || "").trim().toLowerCase();
        if (name.indexOf("on") === 0) el.removeAttribute(attr.name);
        if ((name === "href" || name.slice(-5) === ":href") && (value.indexOf("javascript:") === 0 || value.indexOf("data:text/html") === 0)) {
          el.removeAttribute(attr.name);
        }
        if (name === "style" && (value.indexOf("javascript:") >= 0 || value.indexOf("expression(") >= 0)) {
          el.removeAttribute(attr.name);
        }
      });
    });
    if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
    return svg.outerHTML;
  }

  function usageLine(reply) {
    const usage = (reply && reply.usage) || {};
    const parts = [];
    if (usage.prompt != null) parts.push("输入 " + usage.prompt);
    if (usage.completion != null) parts.push("输出 " + usage.completion);
    if (usage.reasoning != null) parts.push("推理 " + usage.reasoning);
    return parts.join(" · ");
  }

  function decorate(graded, ms, reply) {
    const extra = [ms + " ms"];
    const usage = usageLine(reply);
    if (usage) extra.push(usage);
    return {
      status: graded.status,
      summary: (reply && reply.note ? reply.note : "") + graded.summary + " " + extra.join(" · "),
      detail: reply && reply.content ? reply.content : "",
      svg: graded.svg || "",
      html: graded.html || "",
    };
  }

  function shellCurl(url, headerLines, body) {
    const lines = ["curl -sS '" + String(url).replace(/'/g, "'\\''") + "'"];
    headerLines.forEach(function (header) {
      lines.push("  -H '" + header.replace(/'/g, "'\\''") + "'");
    });
    if (body != null) lines.push("  --data-binary '" + JSON.stringify(body).replace(/'/g, "'\\''") + "'");
    return lines.join(" \\\n");
  }

  function context() {
    const base = G.normalizeBase($("base").value);
    const key = $("apiKey").value.trim();
    const model = chosenModel();
    const protocol = protocolFor(model);
    if (!key) throw new Error("先填写 Key");
    if (!model) throw new Error("先填写或选择模型");
    if (location.protocol === "https:" && base.indexOf("http://") === 0) {
      throw new Error("这个页面是 https，浏览器会拦住发往 http 接口的请求。可以换 https 地址，或用本机 curl。");
    }
    return { base: base, key: key, model: model, protocol: protocol, endpoints: G.endpoints(base, protocol) };
  }

  function headersFor(ctx, listOnly, headerMode) {
    const headers = { Authorization: "Bearer " + ctx.key };
    if (listOnly) return headers;
    headers["Content-Type"] = "application/json";
    if (ctx.protocol === "claude" && headerMode !== "bearer") {
      headers["x-api-key"] = ctx.key;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
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
        body.tools = spec.tools.map(function (tool) {
          const fn = tool.function || tool;
          return {
            name: fn.name,
            description: fn.description || "",
            input_schema: fn.parameters || fn.input_schema,
          };
        });
      }
      if (spec.tool_choice && spec.tool_choice.function) {
        body.tool_choice = { type: "tool", name: spec.tool_choice.function.name };
      }
      return body;
    }
    const body = {
      model: ctx.model,
      messages: spec.messages,
      stream: !!(options && options.stream),
    };
    if (useTemperature) body.temperature = spec.temperature == null ? 0 : spec.temperature;
    if (spec.max_tokens) {
      if (useCompletionLimit) body.max_completion_tokens = spec.max_tokens;
      else body.max_tokens = spec.max_tokens;
    }
    if (spec.stop) body.stop = spec.stop;
    if (spec.tools) body.tools = spec.tools;
    if (spec.tool_choice) body.tool_choice = spec.tool_choice;
    if (spec.response_format) body.response_format = spec.response_format;
    if (spec.reasoning_effort) body.reasoning_effort = spec.reasoning_effort;
    return body;
  }

  async function readJson(res) {
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = null;
    }
    return { text: text, json: json };
  }

  async function postOnce(ctx, spec, signal, options) {
    const headers = headersFor(ctx, false, options && options.headerMode);
    const body = bodyFor(ctx, spec, options);
    const started = Date.now();
    let res;
    try {
      res = await fetch(ctx.endpoints.chat, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
        signal: signal,
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      noteCall(null, Date.now() - started);
      const wrapped = new Error(networkMessage(err, false, ctx.endpoints.chat));
      wrapped.network = true;
      wrapped.curl = shellCurl(ctx.endpoints.chat, headerList(headers), body);
      throw wrapped;
    }
    const parsed = await readJson(res);
    const ms = Date.now() - started;
    if (!res.ok) {
      noteCall(null, ms);
      const message = G.errorText(parsed.json, parsed.text, res.status);
      const error = new Error(message);
      error.status = res.status;
      error.curl = shellCurl(ctx.endpoints.chat, headerList(headers), body);
      throw error;
    }
    const headerNames = [];
    res.headers.forEach(function (_value, key) {
      headerNames.push(key);
    });
    const reply = G.readReply(parsed.json);
    noteCall(reply, ms);
    return { reply: reply, ms: ms, raw: parsed.json, headers: headerNames };
  }

  let leaving = false;
  window.addEventListener("pagehide", function () {
    leaving = true;
  });

  function tell(payload) {
    if (leaving || window.parent === window) return;
    window.parent.postMessage(payload, location.origin);
  }

  function noteCall(reply, ms) {
    const meter = state.meter;
    if (!meter) return;
    meter.requests += 1;
    const usage = (reply && reply.usage) || {};
    if (usage.prompt != null) meter.input += Number(usage.prompt) || 0;
    if (usage.completion != null) meter.output += Number(usage.completion) || 0;
    if (meter.ttftMs == null && ms != null) meter.ttftMs = ms;
    tell({
      type: "veridrop-basic-meter",
      requests: meter.requests,
      input: meter.input,
      output: meter.output,
      ttftMs: meter.ttftMs,
      totalMs: Date.now() - meter.started,
    });
  }

  function headerList(headers) {
    return Object.keys(headers).map(function (key) {
      return key + ": " + headers[key];
    });
  }

  function networkMessage(err, long, url) {
    const text = String((err && err.message) || err || "");
    if (!/failed to fetch|networkerror|load failed|network error/i.test(text)) return text || "请求失败";
    if (long) {
      return "这条长请求中途断了。地址如果刚才能测通，就不是没开跨域。鹈鹕要生成一整页动画，对方若一直不往外吐字，连接会被掐掉。请再跑一次；还不行就点「显示本机 curl」。";
    }
    const where = url ? "这次请求的是 " + url + "。" : "";
    return "请求没有发出去。" + where + "多半是浏览器跨域限制。Claude 模型会先走 /v1/messages；若网页调不通，会自动改用允许网页直接调用的 OpenAI 兼容接口。Key 还在这台浏览器里。";
  }

  async function readEventStream(res, signal) {
    if (!res.body || !res.body.getReader) throw new Error("这个浏览器读不了流式响应");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let model = "";
    let chunks = 0;
    const onAbort = function () {
      reader.cancel();
    };
    if (signal) signal.addEventListener("abort", onAbort);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (let i = 0; i < lines.length; i += 1) {
          const trimmed = lines[i].trim();
          if (trimmed.indexOf("data:") !== 0) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (err) {
            json = null;
          }
          if (!json) continue;
          if (json.error || json.type === "error") {
            const failure = new Error(G.errorText(json.error ? json : { error: json.error || json }, data, 400));
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
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    return { content: content, model: model, chunks: chunks };
  }

  async function postStream(ctx, spec, signal, options) {
    const headers = headersFor(ctx, false, options && options.headerMode);
    const opts = Object.assign({ stream: true }, options || {});
    const body = bodyFor(ctx, spec, opts);
    const started = Date.now();
    let res;
    try {
      res = await fetch(ctx.endpoints.chat, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
        signal: signal,
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      noteCall(null, Date.now() - started);
      const wrapped = new Error(networkMessage(err, true));
      wrapped.network = true;
      wrapped.curl = shellCurl(ctx.endpoints.chat, headerList(headers), body);
      throw wrapped;
    }
    if (!res.ok) {
      const parsed = await readJson(res);
      noteCall(null, Date.now() - started);
      const error = new Error(G.errorText(parsed.json, parsed.text, res.status));
      error.status = res.status;
      error.curl = shellCurl(ctx.endpoints.chat, headerList(headers), body);
      throw error;
    }
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    if (type.indexOf("text/event-stream") < 0) {
      const parsed = await readJson(res);
      const reply = G.readReply(parsed.json);
      const ms = Date.now() - started;
      noteCall(reply, ms);
      return { reply: reply, ms: ms, partial: false };
    }
    try {
      const streamed = await readEventStream(res, signal);
      const ms = Date.now() - started;
      const reply = {
        content: streamed.content,
        model: streamed.model || "",
        usage: {},
        toolCalls: [],
      };
      noteCall(reply, ms);
      return {
        reply: reply,
        chunks: streamed.chunks,
        ms: ms,
        partial: false,
      };
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      if (err && err.status) throw err;
      const wrapped = new Error(networkMessage(err, true));
      wrapped.network = true;
      wrapped.curl = shellCurl(ctx.endpoints.chat, headerList(headers), body);
      throw wrapped;
    }
  }

  function openAICtx(ctx) {
    return {
      base: ctx.base,
      key: ctx.key,
      model: ctx.model,
      protocol: "openai",
      endpoints: G.endpoints(ctx.base, "openai"),
    };
  }

  function claudeRouteFailed(err) {
    if (!err || err.name === "AbortError") return false;
    if (err.status === 401 || err.status === 402 || err.status === 403 || err.status === 429) return false;
    if (/thinking|budget_tokens|max_tokens/i.test(String(err.message || ""))) return false;
    return true;
  }

  async function postChat(ctx, spec, signal) {
    const attempt = function (target, options) {
      const opts = Object.assign({}, options || {});
      if (spec.stream) opts.stream = true;
      if (opts.stream) return postStream(target, spec, signal, opts);
      return postOnce(target, spec, signal, opts);
    };
    try {
      return await attempt(ctx, {});
    } catch (err) {
      if (err.name === "AbortError") throw err;
      const message = String(err.message || "");
      if (ctx.protocol === "claude" && err.network) {
        try {
          return await attempt(ctx, { headerMode: "bearer" });
        } catch (bearerErr) {
          err = bearerErr;
        }
      }
      if (ctx.protocol === "claude" && claudeRouteFailed(err)) {
        state.claudeViaOpenAI = true;
        paintProtocolHint();
        persist();
        const out = await attempt(openAICtx(ctx), {});
        if (out.reply) out.reply.note = "浏览器调不通 /v1/messages，已改用 OpenAI 兼容接口。";
        return out;
      }
      if (err.network || !err.status) throw err;
      if (ctx.protocol === "claude" && /thinking|budget_tokens/i.test(message)) {
        return attempt(ctx, { maxTokens: Math.max(spec.max_tokens || 0, 4096) });
      }
      if (spec.stream && err.status === 400 && /stream/i.test(message)) {
        return postOnce(ctx, spec, signal, {});
      }
      if (err.status === 400 && /temperature/i.test(message)) {
        return attempt(ctx, { temperature: false });
      }
      if (err.status === 400 && /max_tokens/i.test(message) && spec.max_tokens && ctx.protocol !== "claude") {
        return attempt(ctx, { completionLimit: true });
      }
      throw err;
    }
  }

  function user(content) {
    return [{ role: "user", content: G.present(content) }];
  }

  function toolDef(account) {
    return {
      messages: user("查询账户 " + account + " 的余额。必须调用 get_balance，不要自己编一个数字。"),
      max_tokens: 200,
      tools: [
        {
          type: "function",
          function: {
            name: "get_balance",
            description: "Get the balance of an account",
            parameters: {
              type: "object",
              properties: { account: { type: "string" } },
              required: ["account"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "get_balance" } },
    };
  }

  function candyNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function showCandyStart() {
    const start = $("candyStart");
    const run = $("candyRun");
    const report = $("candyReport");
    if (start) start.hidden = false;
    if (run) run.hidden = true;
    if (report) report.hidden = true;
  }

  function nextCandySeq() {
    let n = 1;
    try {
      n = Number(localStorage.getItem("veridrop.check.candySeq") || 0) + 1;
      localStorage.setItem("veridrop.check.candySeq", String(n));
    } catch (err) {
      n = (state.candySeq || 0) + 1;
    }
    state.candySeq = n;
    return n;
  }

  function candyStamp(date) {
    const d = date || new Date();
    const pad = function (value) {
      return value < 10 ? "0" + value : String(value);
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function candyCount() {
    const picked = document.querySelector('input[name="candyCount"]:checked');
    const count = picked ? Number(picked.value) : 10;
    return count === 5 || count === 15 || count === 20 ? count : 10;
  }

  function candyPrompt(question) {
    const lines = [question.prompt, ""];
    (question.options || []).forEach(function (opt) {
      lines.push(opt.key + ". " + opt.text);
    });
    lines.push("");
    lines.push("只回复一个选项字母。");
    return lines.join("\n");
  }

  async function waitCandyPause(signal) {
    while (state.candyUi && state.candyUi.pause && !state.candyUi.finish && !state.candyUi.stop && !(signal && signal.aborted)) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 200);
      });
    }
  }

  function renderCandyRun(question, index, total, rows) {
    const run = $("candyRun");
    const start = $("candyStart");
    const report = $("candyReport");
    if (!run) return;
    if (start) start.hidden = true;
    if (report) report.hidden = true;
    run.hidden = false;
    const ui = state.candyUi || {};
    const right = rows.filter(function (row) {
      return row.ok && !row.missed;
    }).length;
    const revealed = rows.length;
    run.replaceChildren();
    run.appendChild(candyNode("p", "cd-crumb", "糖果测试页 / 测试进行中"));
    run.appendChild(candyNode("h1", "cd-title", "糖果测试-第" + (ui.seq || 1) + "次"));
    const sub = candyNode("p", "cd-sub");
    sub.appendChild(candyNode("i", "cd-dot"));
    sub.appendChild(document.createTextNode(" " + (chosenModel() || "未选模型") + " · 困难 · 共 " + total + " 题"));
    run.appendChild(sub);
    const bar = candyNode("div", "cd-bar");
    const fill = candyNode("i");
    fill.style.width = Math.round((revealed / total) * 100) + "%";
    bar.appendChild(fill);
    run.appendChild(bar);
    run.appendChild(candyNode("p", "cd-progress", "进度 " + revealed + " / " + total));
    const grid = candyNode("div", "cd-grid");
    const card = candyNode("article", "cd-card");
    if (question) {
      card.appendChild(candyNode("span", "cd-chip", question.dimension + " · " + question.level));
      card.appendChild(candyNode("h2", "", "第 " + (index + 1) + " 题"));
      card.appendChild(candyNode("p", "cd-ask", question.prompt));
      (question.options || []).forEach(function (opt) {
        const row = candyNode("div", "cd-opt");
        row.appendChild(candyNode("b", "", opt.key));
        row.appendChild(candyNode("span", "", opt.text));
        card.appendChild(row);
      });
    }
    card.appendChild(candyNode("p", "cd-calling", ui.pause ? "已暂停，当前题结束后不再继续。" : "正在调用接口..."));
    const actions = candyNode("div", "cd-actions");
    const pauseBtn = candyNode("button", "mc-btn", ui.pause ? "继续" : "暂停");
    pauseBtn.type = "button";
    pauseBtn.addEventListener("click", function () {
      if (!state.candyUi) return;
      state.candyUi.pause = !state.candyUi.pause;
      renderCandyRun(question, index, total, rows);
    });
    const finishBtn = candyNode("button", "mc-btn mc-btn-solid cd-finish", "直接完成并出报告");
    finishBtn.type = "button";
    finishBtn.addEventListener("click", function () {
      if (!state.candyUi) return;
      state.candyUi.finish = true;
      state.candyUi.pause = false;
    });
    const stopBtn = candyNode("button", "mc-btn", "终止测试");
    stopBtn.type = "button";
    stopBtn.addEventListener("click", function () {
      if (!state.candyUi) return;
      state.candyUi.stop = true;
      state.candyUi.pause = false;
      if (state.jobs.candy) state.jobs.candy.abort();
    });
    actions.appendChild(pauseBtn);
    actions.appendChild(finishBtn);
    actions.appendChild(stopBtn);
    card.appendChild(actions);
    const side = candyNode("aside", "cd-side");
    side.appendChild(candyNode("h3", "", "当前统计"));
    [
      ["已揭示", revealed + " / " + total],
      ["当前答对", String(right)],
      ["状态", ui.pause ? "已暂停" : "进行中"],
    ].forEach(function (pair) {
      const line = candyNode("div", "cd-stat");
      line.appendChild(candyNode("span", "", pair[0]));
      line.appendChild(candyNode("b", "", pair[1]));
      side.appendChild(line);
    });
    grid.appendChild(card);
    grid.appendChild(side);
    run.appendChild(grid);
  }

  function renderCandyReport(rows) {
    const report = $("candyReport");
    if (!report) return;
    const ui = state.candyUi || {};
    const asked = rows.filter(function (row) {
      return !row.missed;
    });
    const right = rows.filter(function (row) {
      return row.ok;
    }).length;
    const total = rows.length;
    const pct = total ? Math.round((right / total) * 100) : 0;
    const verdict = !asked.length ? "未完成" : right === total ? "正常" : pct >= 60 ? "不稳" : "异常";
    if ($("candyStart")) $("candyStart").hidden = true;
    if ($("candyRun")) $("candyRun").hidden = true;
    report.hidden = false;
    report.replaceChildren();
    const back = candyNode("button", "cd-crumb cd-back", "返回列表 / 测试报告");
    back.type = "button";
    back.addEventListener("click", showCandyStart);
    report.appendChild(back);
    report.appendChild(candyNode("h1", "cd-title", "糖果测试-第" + (ui.seq || 1) + "次"));
    const sub = candyNode("p", "cd-sub");
    sub.appendChild(candyNode("i", "cd-dot"));
    sub.appendChild(document.createTextNode(" " + (chosenModel() || "未选模型") + " · 困难 · " + candyStamp(ui.at)));
    report.appendChild(sub);
    const stats = candyNode("div", "cd-scorebar");
    const ringCard = candyNode("div", "cd-score");
    const ring = candyNode("div", "cd-ring");
    ring.style.setProperty("--p", String(pct));
    const hole = candyNode("i");
    hole.appendChild(candyNode("b", "", String(pct)));
    hole.appendChild(candyNode("span", "", "/100"));
    ring.appendChild(hole);
    ringCard.appendChild(ring);
    const judge = candyNode("div", "cd-score");
    judge.appendChild(candyNode("span", "", "判定"));
    judge.appendChild(candyNode("em", verdict === "正常" ? "cd-pill" : "cd-pill cd-pill-bad", verdict));
    const hit = candyNode("div", "cd-score");
    hit.appendChild(candyNode("span", "", "答对"));
    hit.appendChild(candyNode("strong", "", right + " / " + total));
    const rate = candyNode("div", "cd-score");
    rate.appendChild(candyNode("span", "", "题目正确率"));
    rate.appendChild(candyNode("strong", "", pct + "%"));
    stats.appendChild(ringCard);
    stats.appendChild(judge);
    stats.appendChild(hit);
    stats.appendChild(rate);
    report.appendChild(stats);
    const grid = candyNode("div", "cd-grid");
    const main = candyNode("section", "cd-card");
    const head = candyNode("div", "cd-listhead");
    head.appendChild(candyNode("h3", "", "题目明细"));
    const filters = candyNode("div", "cd-filters");
    let mode = "all";
    const list = candyNode("ol", "cd-list");
    function paintList() {
      list.replaceChildren();
      rows.forEach(function (row, index) {
        if (mode === "ok" && !row.ok) return;
        if (mode === "bad" && row.ok) return;
        const item = candyNode("li", "cd-item");
        item.appendChild(candyNode("b", "", index + 1 < 10 ? "0" + (index + 1) : String(index + 1)));
        const body = candyNode("div");
        body.appendChild(candyNode("p", "", row.prompt || row.title || ""));
        body.appendChild(candyNode("p", "cd-pick", "模型答案：" + (row.picked || "没有回答")));
        item.appendChild(body);
        item.appendChild(candyNode("em", row.ok ? "cd-pill" : "cd-pill cd-pill-bad", row.missed ? "未完成" : row.ok ? "答对" : "答错"));
        list.appendChild(item);
      });
    }
    ["全部", "只看答错", "只看答对"].forEach(function (label, index) {
      const key = index === 1 ? "bad" : index === 2 ? "ok" : "all";
      const button = candyNode("button", key === "all" ? "cd-filter is-on" : "cd-filter", label);
      button.type = "button";
      button.addEventListener("click", function () {
        mode = key;
        filters.querySelectorAll("button").forEach(function (item) {
          item.classList.toggle("is-on", item === button);
        });
        paintList();
      });
      filters.appendChild(button);
    });
    head.appendChild(filters);
    main.appendChild(head);
    paintList();
    main.appendChild(list);
    const side = candyNode("aside", "cd-side");
    side.appendChild(candyNode("h3", "", "维度得分"));
    ["迷惑辨析", "数量关系", "约束求解", "演绎"].forEach(function (name) {
      const group = asked.filter(function (row) {
        return row.dimension === name;
      });
      const got = group.filter(function (row) {
        return row.ok;
      }).length;
      const score = group.length ? Math.round((got / group.length) * 100) : 0;
      const line = candyNode("div", "cd-dim");
      line.appendChild(candyNode("span", "", name));
      const track = candyNode("b");
      const inner = candyNode("i");
      inner.style.width = score + "%";
      track.appendChild(inner);
      line.appendChild(track);
      line.appendChild(candyNode("em", "", String(score)));
      side.appendChild(line);
    });
    const stable = asked.length && right === asked.length;
    side.appendChild(
      candyNode(
        "p",
        "cd-note",
        stable ? "该模型在各项测试中的表现稳定，未检测到明显的降智现象。" : "有题目没对上。这只说明这一轮不稳，不能据此认定模型被换掉。"
      )
    );
    const again = candyNode("button", "mc-btn mc-btn-solid cd-again", "再测一次");
    again.type = "button";
    again.addEventListener("click", function () {
      const button = $("runCandy");
      if (button) button.click();
    });
    const save = candyNode("button", "mc-btn", "导出 JSON");
    save.type = "button";
    save.addEventListener("click", function () {
      const payload = {
        model: chosenModel(),
        at: candyStamp(ui.at),
        right: right,
        total: total,
        rows: rows.map(function (row) {
          return { title: row.title, prompt: row.prompt, picked: row.picked, answer: row.answer || row.expect, ok: !!row.ok, dimension: row.dimension || "" };
        }),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "candy-report.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    });
    const buttons = candyNode("div", "cd-actions");
    buttons.appendChild(again);
    buttons.appendChild(save);
    side.appendChild(buttons);
    grid.appendChild(main);
    grid.appendChild(side);
    report.appendChild(grid);
  }

  const RUNNERS = {
    connect: function (ctx, signal) {
      return postChat(ctx, { messages: user(G.CONNECT_PROMPT), max_tokens: 256 }, signal).then(function (out) {
        return decorate(G.gradeConnect(out.reply, ctx.model), out.ms, out.reply);
      });
    },
    echo: function (ctx, signal) {
      const nonce = randomToken("", "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 12);
      return postChat(ctx, { messages: user(G.echoPrompt(nonce)), max_tokens: 256 }, signal).then(function (out) {
        return decorate(G.gradeEcho(out.reply.content, nonce), out.ms, out.reply);
      });
    },
    copy: function (ctx, signal) {
      const value = digits(32);
      return postChat(ctx, { messages: user(G.copyPrompt(value)), max_tokens: 256 }, signal).then(function (out) {
        return decorate(G.gradeCopy(out.reply.content, value), out.ms, out.reply);
      });
    },
    history: function (ctx, signal) {
      const code = randomToken("BLUE-", "0123456789", 4);
      return postChat(ctx, { messages: G.historyMessages(code), max_tokens: 256 }, signal).then(function (out) {
        return decorate(G.gradeHistory(out.reply.content, code), out.ms, out.reply);
      });
    },
    stop: async function (ctx, signal) {
      try {
        const out = await postChat(ctx, { messages: user(G.STOP_PROMPT), max_tokens: 256, stop: ["5"] }, signal);
        return decorate(G.gradeStop(out.reply.content), out.ms, out.reply);
      } catch (err) {
        if (G.looksUnsupported(err.message, ["stop", "stop_sequences", "停止"])) {
          return { status: "skip", summary: "这个接口不接受停止词。", detail: err.message, svg: "" };
        }
        throw err;
      }
    },
    tools: async function (ctx, signal) {
      const account = randomToken("acct-", "0123456789", 4);
      try {
        const out = await postChat(ctx, toolDef(account), signal);
        return decorate(G.gradeTools(out.reply, account), out.ms, out.reply);
      } catch (err) {
        if (G.looksUnsupported(err.message, ["tool", "tools", "function", "工具"])) {
          return { status: "skip", summary: "这个接口不支持工具调用。", detail: err.message, svg: "" };
        }
        throw err;
      }
    },
    needle: function (ctx, signal) {
      const code = randomToken("KITE-", "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);
      return postChat(ctx, { messages: user(G.buildNeedlePrompt(code)), max_tokens: 64 }, signal).then(function (out) {
        return decorate(G.gradeNeedle(out.reply.content, code), out.ms, out.reply);
      });
    },
    limit: function (ctx, signal) {
      return postChat(ctx, { messages: user(G.MAX_PROMPT), max_tokens: 16 }, signal).then(function (out) {
        return decorate(G.gradeMaxTokens(out.reply), out.ms, out.reply);
      });
    },
    candy: async function (ctx, signal) {
      const questions = (G.CANDY_QUESTIONS || []).slice(0, candyCount());
      const rows = [];
      const details = [];
      let reasoning = 0;
      let sawReason = false;
      let note = "";
      const started = Date.now();

      function pack(status, summary) {
        let text = (note ? note : "") + summary + " " + (Date.now() - started) + " ms";
        if (sawReason) text += " · 推理 " + reasoning;
        return { status: status, summary: text, detail: details.join("\n\n"), svg: "", html: "", rows: rows.slice() };
      }

      function summarize(lead) {
        const asked = rows.filter(function (row) {
          return !row.missed;
        });
        const right = asked.filter(function (row) {
          return row.ok;
        }).length;
        const wrong = asked.length - right;
        const missed = rows.length - asked.length;
        const bits = [];
        if (lead) bits.push(lead);
        bits.push("共 " + questions.length + " 题");
        bits.push("对了 " + right + " 题");
        if (wrong) bits.push("错了 " + wrong + " 题");
        if (missed) bits.push(missed + " 题没跑完");
        let status = "pass";
        if (!asked.length) status = lead === "已中断" ? "stop" : "error";
        else if (wrong && !right) status = "fail";
        else if (wrong || missed) status = "warn";
        return pack(status, bits.join("，") + "。");
      }

      function markRest(from, picked) {
        for (let j = from; j < questions.length; j += 1) {
          const question = questions[j];
          rows.push({
            title: question.title,
            prompt: question.prompt,
            dimension: question.dimension,
            level: question.level,
            options: question.options,
            answer: question.answer,
            picked: picked,
            expect: question.expect,
            ok: false,
            missed: true,
          });
        }
      }

      state.candyUi = { pause: false, finish: false, stop: false, seq: nextCandySeq(), at: new Date() };

      for (let i = 0; i < questions.length; i += 1) {
        if (signal.aborted || state.candyUi.stop) break;
        if (state.candyUi.finish) break;
        await waitCandyPause(signal);
        if (signal.aborted || state.candyUi.stop || state.candyUi.finish) break;
        const question = questions[i];
        renderCandyRun(question, i, questions.length, rows);
        let out;
        try {
          out = await postChat(ctx, { messages: user(candyPrompt(question)), max_tokens: question.max || 800 }, signal);
        } catch (err) {
          if (signal.aborted || (err && err.name === "AbortError")) {
            markRest(i, "还没问到");
            return summarize("已中断");
          }
          const hard = err && (err.network || err.status === 401 || err.status === 402 || err.status === 403 || err.status === 429);
          if (hard && !rows.length) throw err;
          const picked = httpSummary(err) || "这题没有返回";
          if (hard) {
            markRest(i, picked);
            return summarize("后面的题没有继续");
          }
          rows.push({
            title: question.title,
            prompt: question.prompt,
            picked: picked,
            expect: question.expect,
            ok: false,
            missed: true,
          });
          details.push("【" + question.title + "】\n" + ((err && err.message) || "失败"));
          continue;
        }
        const row = G.gradeCandyQuestion(question, out.reply.content);
        rows.push(row);
        if (out.reply && out.reply.note) note = out.reply.note;
        if (out.reply && out.reply.usage && out.reply.usage.reasoning != null) {
          reasoning += Number(out.reply.usage.reasoning) || 0;
          sawReason = true;
        }
        details.push("【" + question.title + "】\n" + ((out.reply && out.reply.content) || ""));
        renderCandyRun(question, i, questions.length, rows);
      }
      if (rows.length < questions.length) markRest(rows.length, "未作答");
      return summarize(state.candyUi && (state.candyUi.stop || signal.aborted) ? "已中断" : state.candyUi && state.candyUi.finish ? "提前结束" : "");
    },
    pelican: function (ctx, signal) {
      return postChat(
        ctx,
        { messages: [{ role: "user", content: G.PELICAN_PROMPT }], max_tokens: 12000, stream: true },
        signal
      ).then(function (out) {
        const graded = G.gradePelican(out.reply.content);
        const decorated = decorate(graded, out.ms, out.reply);
        if (out.partial) decorated.summary = "连接中途断了，下面是已经收到的页面。" + decorated.summary;
        return decorated;
      });
    },
  };

  function timeoutFor(id) {
    if (id === "candy") return 600000;
    if (id === "pelican") return 300000;
    return 180000;
  }

  function linkSignal(parent, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, ms);
    const onParent = function () {
      ctrl.abort();
    };
    if (parent) parent.addEventListener("abort", onParent);
    return {
      signal: ctrl.signal,
      finish: function () {
        clearTimeout(timer);
        if (parent) parent.removeEventListener("abort", onParent);
      },
    };
  }

  function httpSummary(err) {
    if (err && err.name === "AbortError") return "";
    if (err && err.status === 401) return "密钥没有通过。";
    if (err && err.status === 403) return "对方拒绝了这次请求。";
    if (err && err.status === 404) return "这个地址上没有对应的对话接口。";
    if (err && err.status === 402) return "额度不足。";
    if (err && err.status === 429) return "请求太密，对方限流了。";
    if (/short-input|heartbeat probing|distillation/i.test(String((err && err.message) || ""))) {
      return "对方上游拒绝了这次请求。它把过短的提问当成心跳或套取，不是本站少填了地址或 Key。刷新后再测；若还出现，是这条线路的策略。";
    }
    return err && err.message ? err.message : "请求失败";
  }

  async function runOne(id, ctx, parent) {
    const card = document.querySelector('[data-test="' + id + '"]');
    badge(card, "running");
    tell({ type: "veridrop-basic-step", id: id, status: "running", summary: "" });
    card.querySelector("[data-out]").replaceChildren();
    const gate = linkSignal(parent, timeoutFor(id));
    try {
      const outcome = await RUNNERS[id](ctx, gate.signal);
      showResult(card, outcome.status, outcome.summary, outcome.detail, outcome.svg, outcome.html, outcome.rows);
    } catch (err) {
      if (parent && parent.aborted) {
        showResult(card, "stop", "已停止", "", "");
        return "stop";
      }
      if (err && err.name === "AbortError") {
        const waited = id === "candy" ? "超过 10 分钟" : id === "pelican" ? "超过 5 分钟" : "超过 3 分钟";
        showResult(card, "error", waited + "还没有返回。思考模型有时会更慢，可以再跑一次。", "", "");
        return "error";
      }
      if (err && err.curl) {
        state.lastCurl = err.curl;
        $("curlBtn").hidden = false;
      }
      showResult(card, "error", httpSummary(err), err && err.message ? err.message : "", "");
      return "error";
    } finally {
      gate.finish();
    }
    return card.querySelector("[data-badge]").className.replace("lab-badge ", "");
  }

  function tally() {
    const counts = { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 };
    cards().forEach(function (card) {
      const status = card.querySelector("[data-badge]").className.replace("lab-badge ", "");
      if (counts[status] != null) counts[status] += 1;
    });
    const parts = [];
    if (counts.pass) parts.push("通过 " + counts.pass);
    if (counts.warn) parts.push("留意 " + counts.warn);
    if (counts.fail) parts.push("未通过 " + counts.fail);
    if (counts.skip) parts.push("不支持 " + counts.skip);
    if (counts.error) parts.push("出错 " + counts.error);
    $("tally").textContent = parts.join(" · ");
  }

  var PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  function stepResult(status, summary) {
    return { status: status, summary: summary, detail: "", svg: "", html: "" };
  }

  function blockedOrUnsupported(err, hints) {
    const message = String((err && err.message) || "");
    return /short-input|heartbeat|distillation/i.test(message) || G.looksUnsupported(message, hints);
  }

  async function runStep(id, signal, timeout, fn) {
    const card = document.querySelector('[data-test="' + id + '"]');
    if (!card) return "skip";
    if (signal.aborted) {
      showResult(card, "stop", "已停止", "", "");
      return "stop";
    }
    badge(card, "running");
    tell({ type: "veridrop-basic-step", id: id, status: "running", summary: "" });
    const gate = linkSignal(signal, timeout);
    try {
      const outcome = await fn(gate.signal);
      showResult(card, outcome.status, outcome.summary, outcome.detail, outcome.svg, outcome.html, outcome.rows, outcome.server);
      return outcome.status;
    } catch (err) {
      if (signal.aborted || (err && err.name === "AbortError")) {
        showResult(card, "stop", "已停止", "", "");
        return "stop";
      }
      showResult(card, "error", httpSummary(err), (err && err.message) || "", "");
      return "error";
    } finally {
      gate.finish();
    }
  }

  function serverBody(value) {
    if (value == null || value === "") return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return "";
    }
  }

  function withServer(outcome, raw) {
    const text = serverBody(raw);
    if (!outcome || !text) return outcome;
    return Object.assign({}, outcome, { server: text });
  }

  async function runBasicSuite(ctx, signal) {
    const started = Date.now();
    state.meter = { requests: 0, input: 0, output: 0, ttftMs: null, started: started };
    const steps = ["proto", "consistent", "stream", "control", "memory", "system", "tools", "vision", "reasoning", "replay", "context"];
    let index = 0;
    const nextNote = function (name) {
      index += 1;
      setNote("基础检测 " + index + " / " + steps.length + " · " + name);
    };
    let stopped = false;
    const go = async function (id, name, timeout, fn) {
      if (stopped) return;
      nextNote(name);
      const status = await runStep(id, signal, timeout, fn);
      if (status === "stop") stopped = true;
    };

    let first = null;
    await go("proto", "协议识别", 180000, async function (stepSignal) {
      first = await postChat(ctx, { messages: user("用一句话说明你收到了这条消息。"), max_tokens: 128 }, stepSignal);
      const graded = G.gradeProtocol(first.raw);
      return withServer(decorate(graded, first.ms, first.reply), first.raw);
    });
    if (first) {
      showReady("structure", withServer(decorate(G.gradeStructure(first.raw), first.ms, first.reply), first.raw));
      showReady("modelecho", withServer(decorate(G.gradeConnect(first.reply, ctx.model), first.ms, first.reply), first.raw));
      showReady("usage", withServer(decorate(G.gradeUsage(first.reply), first.ms, first.reply), first.raw));
    } else if (!stopped) {
      ["structure", "modelecho", "usage"].forEach(function (id) {
        showReady(id, stepResult("error", "没测成。第一问没有返回，这几项没法从同一次回复里读取。"));
      });
    }

    if (!stopped) {
      await go("consistent", "模型一致性", 180000, async function (stepSignal) {
        const seen = [];
        if (first && first.reply) seen.push(String(first.reply.model || ""));
        const out = await postChat(ctx, { messages: user("只回复 OK。"), max_tokens: 16 }, stepSignal);
        seen.push(String((out.reply && out.reply.model) || ""));
        return withServer(decorate(G.gradeConsistency(seen, ctx.model), out.ms, out.reply), out.raw);
      });
    }

    if (!stopped) {
      await go("stream", "流式响应", 180000, async function (stepSignal) {
        const out = await postChat(
          ctx,
          { messages: user("从一数到三，用顿号分开，不要解释。"), max_tokens: 128, stream: true },
          stepSignal
        );
        const text = String((out.reply && out.reply.content) || "");
        if (out.chunks > 0 && text) return withServer(stepResult("pass", "收到了 " + out.chunks + " 段流式正文。"), text);
        if (text) return withServer(stepResult("warn", "有正文，但不是一段段流式返回的。"), text);
        return stepResult("fail", "流式请求没有返回正文。");
      });
    }

    if (!stopped) {
      await go("control", "输出控制", 180000, async function (stepSignal) {
        try {
          const out = await postChat(
            ctx,
            { messages: user("从 1 数到 6，每行一个数字。最后一行只写 END。"), max_tokens: 128, stop: ["END"] },
            stepSignal
          );
          const graded = G.gradeStop(out.reply.content.replace(/END/g, "5"));
          const text = String(out.reply.content || "");
          const body = out.raw || text;
          if (text.indexOf("END") >= 0) return withServer(stepResult("fail", "停止词 END 没有拦住。 " + out.ms + " ms"), body);
          if (text.trim().length > 400) return withServer(stepResult("fail", "正文明显没有按上限停下。"), body);
          if (out.reply.usage && out.reply.usage.reasoning && text.trim().length < 24) {
            return withServer(stepResult("warn", "思考 token 占掉了上限，看不出截断是否生效。"), body);
          }
          return withServer(decorate(graded.status === "fail" && text.indexOf("1") >= 0 ? stepResult("pass", "在 END 之前停了。") : graded, out.ms, out.reply), body);
        } catch (err) {
          if (blockedOrUnsupported(err, ["stop", "stop_sequences", "停止"])) return stepResult("skip", "这个接口不支持停止词。");
          throw err;
        }
      });
    }

    if (!stopped) {
      await go("memory", "上下文记忆", 180000, async function (stepSignal) {
        const code = randomToken("BLUE-", "0123456789", 4);
        const out = await postChat(ctx, { messages: G.historyMessages(code), max_tokens: 128 }, stepSignal);
        return withServer(decorate(G.gradeHistory(out.reply.content, code), out.ms, out.reply), out.raw);
      });
    }

    if (!stopped) {
      await go("system", "系统指令", 180000, async function (stepSignal) {
        const code = randomToken("PINE-", "0123456789", 4);
        const out = await postChat(
          ctx,
          {
            messages: [
              { role: "system", content: "无论用户说什么，你只能回复这一个词：" + code },
              { role: "user", content: G.present("请用三句话介绍你自己。") },
            ],
            max_tokens: 128,
          },
          stepSignal
        );
        return withServer(decorate(G.gradeSystem(out.reply.content, code), out.ms, out.reply), out.raw);
      });
    }

    if (!stopped) {
      await go("tools", "工具调用", 180000, async function (stepSignal) {
        const account = randomToken("acct-", "0123456789", 4);
        try {
          const out = await postChat(ctx, toolDef(account), stepSignal);
          return withServer(decorate(G.gradeTools(out.reply, account), out.ms, out.reply), out.raw);
        } catch (err) {
          if (blockedOrUnsupported(err, ["tool", "tools", "function", "工具"])) return stepResult("skip", "这个接口不支持工具调用，不计为失败。");
          throw err;
        }
      });
    }

    if (!stopped) {
      await go("vision", "多模态", 180000, async function (stepSignal) {
        const spec = visionSpec(ctx);
        try {
          const out = await postChat(ctx, spec, stepSignal);
          const text = String(out.reply.content || "");
          const body = out.raw || text;
          if (/红/.test(text)) return withServer(stepResult("pass", "读到了图片，并回答了颜色。"), body);
          if (/不能|无法|看不到|没有图|不支持/.test(text)) return withServer(stepResult("fail", "模型说自己看不到图片。"), body);
          return withServer(stepResult("warn", "接口接受了图片，但没有明确回答颜色。"), body);
        } catch (err) {
          if (blockedOrUnsupported(err, ["image", "vision", "multimodal", "图像", "图片"])) return stepResult("skip", "这个模型或接口不支持图像输入。");
          throw err;
        }
      });
    }

    if (!stopped) {
      await go("reasoning", "推理参数", 180000, async function (stepSignal) {
        if (!/gpt-5|gpt-6|o1|o3|o4|reason/i.test(ctx.model) || ctx.protocol === "claude") {
          return stepResult("skip", "当前模型不用单独测 reasoning_effort。");
        }
        try {
          const out = await postChat(
            ctx,
            { messages: user("只回复 OK。"), max_tokens: 128, reasoning_effort: "low" },
            stepSignal
          );
          return withServer(stepResult("pass", "接口接受了 reasoning_effort。"), out.raw);
        } catch (err) {
          if (blockedOrUnsupported(err, ["reasoning", "reasoning_effort"])) return stepResult("skip", "这个接口不接受推理力度参数。");
          throw err;
        }
      });
    }

    if (!stopped) {
      await go("replay", "缓存与重放", 180000, async function (stepSignal) {
        const spec = { messages: user("用一个词回答：企鹅生活在哪里？"), max_tokens: 64 };
        const a = await postChat(ctx, spec, stepSignal);
        const b = await postChat(ctx, spec, stepSignal);
        return withServer(decorate(G.gradeReplay(G.responseId(a.raw), G.responseId(b.raw)), a.ms + b.ms, b.reply), b.raw);
      });
    }

    if (!stopped) {
      await go("context", "长上下文真实性", 180000, async function (stepSignal) {
        const code = randomToken("KITE-", "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);
        const prompt = G.buildNeedlePrompt(code);
        const out = await postChat(ctx, { messages: user(prompt), max_tokens: 64 }, stepSignal);
        const graded = G.gradeNeedle(out.reply.content, code);
        graded.summary += " 这篇约 " + prompt.length + " 字，不是百万级上下文。";
        return withServer(decorate(graded, out.ms, out.reply), out.raw);
      });
    }
    state.basicMs = Date.now() - started;
    const view = viewFromLocation();
    if (!signal.aborted && (view === "basic" || view === "home" || view === "detect")) showMcView("detect", true);
  }

  function showReady(id, outcome) {
    const card = document.querySelector('[data-test="' + id + '"]');
    if (!card) return;
    showResult(card, outcome.status, outcome.summary, outcome.detail, outcome.svg, outcome.html, outcome.rows, outcome.server);
  }

  function visionSpec(ctx) {
    const ask = "这张图更接近红、绿还是蓝？只回答一个字。";
    if (ctx.protocol === "claude") {
      return {
        passthrough: true,
        max_tokens: 64,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL_PNG } },
              { type: "text", text: ask },
            ],
          },
        ],
      };
    }
    return {
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ask },
            { type: "image_url", image_url: { url: "data:image/png;base64," + PIXEL_PNG } },
          ],
        },
      ],
    };
  }

  function setBusy() {
    const jobs = state.jobs;
    const all = !!jobs.all;
    document.querySelectorAll("[data-run-set]").forEach(function (button) {
      const set = button.getAttribute("data-run-set");
      const same = !!jobs[set];
      const blockedAll = set === "all" && (jobs.basic || jobs.candy || jobs.pelican);
      button.disabled = all || same || blockedAll;
    });
    $("stopBtn").disabled = !Object.keys(jobs).length;
  }

  async function runIds(ids, ctx, signal) {
    for (let i = 0; i < ids.length; i += 1) {
      if (signal.aborted) {
        const card = document.querySelector('[data-test="' + ids[i] + '"]');
        if (card && card.querySelector("[data-badge]").classList.contains("running")) {
          showResult(card, "stop", "已停止", "", "");
        }
        break;
      }
      setNote("正在跑 " + (i + 1) + " / " + ids.length);
      const status = await runOne(ids[i], ctx, signal);
      if (status === "stop") break;
    }
  }

  async function runProtected(suite, work) {
    if (!guardSetup()) return;
    if (suite === "all") {
      if (state.jobs.basic || state.jobs.candy || state.jobs.pelican || state.jobs.all) return;
    } else if (state.jobs[suite] || state.jobs.all) return;
    let ctx;
    try {
      ctx = context();
    } catch (err) {
      setNote(err.message || String(err));
      return;
    }
    persist();
    const ctrl = new AbortController();
    state.jobs[suite] = ctrl;
    setBusy();
    setNote("正在直接请求 " + ctx.endpoints.chat);
    try {
      await work(ctx, ctrl.signal);
    } finally {
      delete state.jobs[suite];
      setBusy();
      setNote("这一轮结束。结果只在这台浏览器里。");
      try {
        tally();
        renderScore();
      } catch (err) {
        /* the parent still needs the finished message */
      }
      tellSuiteDone(suite);
    }
  }

  function summaryOf(id) {
    const card = document.querySelector('[data-test="' + id + '"]');
    if (!card) return "";
    const line = card.querySelector(".lab-summary");
    return line ? line.textContent.trim() : "";
  }

  function candyCounts() {
    const text = summaryOf("candy");
    const total = /共\s*(\d+)\s*题/.exec(text);
    const right = /对了\s*(\d+)\s*题/.exec(text);
    return {
      right: right ? Number(right[1]) : null,
      total: total ? Number(total[1]) : null,
    };
  }

  function tellSuiteDone(suite) {
    const counts = candyCounts();
    const candy = cardStatus("candy");
    const pelican = cardStatus("pelican");
    let scored = false;
    if (suite === "basic" || suite === "all") scored = basicReachedApi();
    else if (suite === "candy") scored = candy === "pass" || candy === "warn" || candy === "fail";
    else if (suite === "pelican") scored = pelican === "pass" || pelican === "warn" || pelican === "fail";
    const rawScore = $("scoreValue") ? $("scoreValue").textContent.trim() : "";
    tell({
      type: "veridrop-suite-done",
      suite: suite,
      scored: scored,
      score: /^\d+$/.test(rawScore) ? Number(rawScore) : null,
      candy: candy,
      pelican: pelican,
      candySummary: summaryOf("candy"),
      pelicanSummary: summaryOf("pelican"),
      candyRight: counts.right,
      candyTotal: counts.total,
    });
    if (suite === "basic" || suite === "all") tell({ type: "veridrop-basic-done", scored: basicReachedApi() });
  }

  function basicReachedApi() {
    const ids = ["proto", "structure", "modelecho", "consistent", "stream", "control", "memory", "system", "tools", "vision", "reasoning", "usage", "replay", "context"];
    return ids.some(function (id) {
      const status = cardStatus(id);
      return status === "pass" || status === "warn" || status === "fail";
    });
  }

  function cardStatus(id) {
    const card = document.querySelector('[data-test="' + id + '"]');
    if (!card) return "idle";
    const text = card.querySelector("[data-badge]").textContent.trim();
    const map = { 未测: "idle", 进行中: "running", 通过: "pass", 留意: "warn", 未通过: "fail", 不支持: "skip", 出错: "error", 没测成: "error", 已停止: "stop" };
    return map[text] || "idle";
  }

  function formatDuration(ms) {
    if (ms == null) return "还没记到";
    const total = Math.round(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (!minutes) return Math.max(total, 1) + " 秒";
    return minutes + " 分 " + seconds + " 秒";
  }

  function renderScore() {
    const scored = ["proto", "structure", "modelecho", "consistent", "stream", "control", "memory", "system", "tools", "vision", "reasoning", "usage", "replay", "context"];
    const names = {
      modelecho: "模型回显",
      consistent: "模型一致性",
      context: "长上下文真实性",
      stream: "流式响应",
      control: "输出控制",
      memory: "上下文记忆",
      system: "系统指令",
      tools: "工具调用",
      vision: "多模态",
      usage: "用量审计",
      replay: "重放",
      proto: "协议识别",
      structure: "响应结构",
      reasoning: "推理参数",
    };
    let points = 0;
    let counted = 0;
    let fails = 0;
    let errors = 0;
    const issues = [];
    scored.forEach(function (id) {
      const status = cardStatus(id);
      if (status === "idle" || status === "skip" || status === "running" || status === "stop") return;
      if (status === "error") {
        errors += 1;
        return;
      }
      counted += 1;
      if (status === "pass") points += 1;
      else if (status === "warn") {
        points += 0.5;
        issues.push(names[id]);
      } else if (status === "fail") {
        fails += 1;
        issues.push(names[id]);
      }
    });
    if (!counted && !errors && cardStatus("candy") === "idle" && cardStatus("pelican") === "idle") return;
    const score = counted ? Math.round((points / counted) * 100) : null;
    let verdict = "证据不足";
    let tone = "warn";
    if (counted >= 5 && score != null && fails === 0 && score >= 85) {
      verdict = "通过";
      tone = "pass";
    } else if (counted >= 5 && score != null && score >= 70) {
      verdict = "留意";
      tone = "warn";
    } else if (counted >= 5 && score != null) {
      verdict = "未通过";
      tone = "fail";
    }
    const candy = cardStatus("candy");
    const pelican = cardStatus("pelican");
    let mind = "糖果和鹈鹕还没跑，这次不能判断降智。";
    if (candy === "error" || pelican === "error") mind = "能力题没有测完，看不出降智。";
    else if (candy === "fail" || pelican === "fail") mind = "有能力题没对上。这只说明这一轮不稳，不能据此认定模型被换掉。";
    else if (candy !== "idle" && pelican !== "idle" && candy !== "skip" && pelican !== "skip") {
      mind = candy === "pass" && pelican === "pass" ? "两道能力题都完成了，这一轮没有看到明显降智。" : "能力题有一项需要看原结果，降智证据还不够。";
    } else if (candy !== "idle" || pelican !== "idle") mind = "只跑了一道能力题，还不能下降智结论。";
    let channel = "适用项里没有看到改写或功能被拿掉。";
    if (issues.length) channel = "要看这几项：" + issues.join("、") + "。";
    const box = $("labScore");
    if (box) {
      box.classList.remove("pass", "warn", "fail");
      box.classList.add(tone);
    }
    $("scoreValue").textContent = score == null ? "—" : String(score);
    $("scoreVerdict").textContent = verdict;
    $("scoreTime").textContent = formatDuration(state.basicMs);
    $("scoreCoverage").textContent = counted ? "计入 " + counted + " 项" + (errors ? "，另有 " + errors + " 项没测成" : "") : "测成的项目还不够";
    $("scoreMind").textContent = mind;
    $("scoreChannel").textContent = channel;
    $("scoreNote").textContent = "分数只算测成了的项目。不支持的不扣分，第一问没返回而跟着没测成的也不扣分。这不是官方原厂鉴定。";
    paintBoard(score, candy, pelican);
    paintDetectRows();
    rememberRun(score, verdict);
  }

  function statusWord(status) {
    if (status === "pass") return "正常";
    if (status === "warn") return "轻微异常";
    if (status === "fail") return "明显异常";
    if (status === "error") return "没测成";
    if (status === "skip") return "不支持";
    if (status === "running") return "进行中";
    return "未测";
  }

  function paintBoard(score, candy, pelican) {
    const ring = $("scoreRing");
    if (ring) ring.style.setProperty("--p", String(score == null ? 0 : score));
    if ($("scoreModel")) $("scoreModel").textContent = chosenModel() || "模型还没选";
    if ($("scoreBasic")) $("scoreBasic").textContent = score == null ? "—" : score + "分";
    if ($("scoreBasicTag")) $("scoreBasicTag").textContent = score == null ? "未测" : statusWord(score >= 85 ? "pass" : score >= 70 ? "warn" : "fail");
    if ($("scoreCandy")) $("scoreCandy").textContent = candy === "idle" ? "—" : statusWord(candy);
    if ($("scoreCandyTag")) $("scoreCandyTag").textContent = statusWord(candy);
    if ($("scorePelican")) $("scorePelican").textContent = pelican === "idle" ? "—" : statusWord(pelican);
    if ($("scorePelicanTag")) $("scorePelicanTag").textContent = statusWord(pelican);
    paintHistory();
  }

  function loadRuns() {
    try {
      return JSON.parse(localStorage.getItem("veridrop.check.runs") || "[]");
    } catch (err) {
      return [];
    }
  }

  function snapshotItems() {
    const ids = ["proto", "structure", "modelecho", "stream", "control", "memory", "system", "tools", "vision", "reasoning", "usage", "replay", "candy", "pelican"];
    const items = [];
    ids.forEach(function (id) {
      const card = document.querySelector('[data-test="' + id + '"]');
      if (!card) return;
      if (cardStatus(id) === "idle") return;
      const questions = [];
      card.querySelectorAll(".mc-qitem").forEach(function (row) {
        const bits = [];
        row.querySelectorAll("strong, span, p").forEach(function (el) {
          bits.push(el.textContent.trim());
        });
        if (bits.length) questions.push(bits.join("\n"));
      });
      const summary = card.querySelector(".lab-summary");
      items.push({
        name: card.querySelector("h2").textContent.trim(),
        status: card.querySelector("[data-badge]").textContent.trim(),
        summary: summary ? summary.textContent.trim() : "",
        questions: questions,
      });
    });
    return items;
  }

  function rememberRun(score, headline) {
    const item = {
      at: new Date().toISOString(),
      model: chosenModel(),
      score: score == null ? "" : String(score),
      headline: headline,
      candy: cardStatus("candy"),
      pelican: cardStatus("pelican"),
      basic: cardStatus("proto"),
      items: snapshotItems(),
    };
    item.key = [item.model, item.score, item.candy, item.pelican, item.basic, item.headline].join("|");
    const runs = loadRuns();
    if (runs[0] && runs[0].key === item.key) {
      runs[0] = item;
    } else {
      runs.unshift(item);
    }
    try {
      localStorage.setItem("veridrop.check.runs", JSON.stringify(runs.slice(0, 8)));
    } catch (err) {
      item.items.forEach(function (row) {
        row.questions = [];
      });
      localStorage.setItem("veridrop.check.runs", JSON.stringify(runs.slice(0, 8)));
    }
    paintHistory();
  }

  function paintDetectRows() {
    const box = $("detectRows");
    if (!box) return;
    const ids = ["proto", "structure", "modelecho", "stream", "control", "memory", "system", "tools", "vision", "reasoning", "usage", "replay", "candy", "pelican"];
    box.replaceChildren();
    ids.forEach(function (id) {
      const card = document.querySelector('[data-test="' + id + '"]');
      if (!card) return;
      const status = cardStatus(id);
      if (status === "idle") return;
      const row = document.createElement("div");
      row.className = "mc-drow";
      const name = document.createElement("strong");
      name.textContent = card.querySelector("h2").textContent.trim();
      const badge = document.createElement("span");
      badge.textContent = card.querySelector("[data-badge]").textContent.trim();
      badge.className = "mc-dstatus " + status;
      const summary = document.createElement("p");
      const line = card.querySelector(".lab-summary");
      summary.textContent = line ? line.textContent.trim() : "";
      row.appendChild(name);
      row.appendChild(badge);
      row.appendChild(summary);
      const questions = card.querySelector(".mc-qlist");
      if (questions) row.appendChild(questions.cloneNode(true));
      box.appendChild(row);
    });
    if (!box.childNodes.length) {
      const empty = document.createElement("p");
      empty.className = "mc-meta";
      empty.textContent = "还没有检测结果。去基础测试页跑一轮，每一项会出现在这里。";
      box.appendChild(empty);
    }
  }

  function historyTone(text) {
    var value = String(text || "");
    if (/正常|通过|完成/.test(value)) return " is-ok";
    if (/留意|轻微/.test(value)) return " is-warn";
    if (/没测成|失败|未通过|明显/.test(value)) return " is-bad";
    return "";
  }

  function paintHistory() {
    const box = $("mcHistory");
    if (!box) return;
    const runs = loadRuns();
    box.replaceChildren();
    if (!runs.length) {
      const empty = document.createElement("p");
      empty.className = "mc-meta";
      empty.textContent = "还没有检测记录。跑完一轮后会出现在这里。";
      box.appendChild(empty);
      return;
    }
    runs.forEach(function (run) {
      const item = document.createElement("div");
      item.className = "mc-hitem";
      const row = document.createElement("button");
      row.type = "button";
      row.className = "mc-hrow";
      const name = document.createElement("strong");
      name.className = "mc-htag" + historyTone(run.headline);
      name.textContent = run.headline || "检测";
      const meta = document.createElement("span");
      const when = run.at ? run.at.replace("T", " ").slice(0, 16) : "";
      meta.textContent = (run.model || "") + "  " + when;
      row.appendChild(name);
      row.appendChild(meta);
      const detail = document.createElement("div");
      detail.className = "mc-hdetail";
      detail.hidden = true;
      if (run.items && run.items.length) {
        run.items.forEach(function (part) {
          const block = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = part.name + " · " + (part.status || "");
          block.appendChild(title);
          if (part.summary) {
            const line = document.createElement("p");
            line.textContent = part.summary;
            block.appendChild(line);
          }
          (part.questions || []).forEach(function (text) {
            const line = document.createElement("p");
            line.textContent = text;
            block.appendChild(line);
          });
          detail.appendChild(block);
        });
      } else {
        const line = document.createElement("p");
        line.textContent = "这次只记下了结论和时间，没有留下每项内容。";
        detail.appendChild(line);
      }
      row.addEventListener("click", function () {
        const opening = detail.hidden;
        box.querySelectorAll(".mc-hdetail").forEach(function (node) {
          node.hidden = true;
        });
        detail.hidden = !opening;
      });
      item.appendChild(row);
      item.appendChild(detail);
      box.appendChild(item);
    });
  }

  var VIEW_SEO = {
    home: {
      title: "GPT降智检测_糖果测试与鹈鹕骑车_API中转站导航",
      description: "在浏览器里检测 API 中转有没有降智。用你自己的地址和 Key 跑基础检测、糖果测试和鹈鹕骑车，对照 GPT、Claude、DeepSeek 这一次调用。Key 不经过本站，也不能当成官方原厂鉴定。",
      keywords: "API中转站,API中转检测,GPT降智,ChatGPT降智,GPT-6 Astra,中转站降智,模型降智测试,糖果测试,鹈鹕骑车,Claude中转,OpenAI兼容接口,DeepSeek API,GPT中转,模型自测",
    },
    detect: {
      title: "模型检测结果_中转降智与基础分_API中转站导航",
      description: "汇总 API 中转基础分、耗时和降智判断。这一页不连接中转站，只展示已经跑过的基础检测、糖果测试和鹈鹕骑车。Key 不经过本站。",
      keywords: "模型检测,GPT降智,中转站降智,API中转检测,糖果测试,鹈鹕骑车,模型自测",
    },
    basic: {
      title: "API中转基础检测_OpenAI兼容与Claude_API中转站导航",
      description: "检测 OpenAI 兼容接口和 Claude Messages：协议、流式、上下文、工具调用和用量。GPT 中转、Claude 中转、DeepSeek API 都能填。不支持的项跳过，不直接当成降智。",
      keywords: "API中转检测,OpenAI兼容接口,Claude中转,GPT中转,DeepSeek API,中转站降智,模型自测",
    },
    candy: {
      title: "糖果测试_GPT降智逻辑题_API中转站导航",
      description: "糖果测试用 20 道固定选择题看这一次 API 中转调用会不会做错逻辑题。可选 5、10、15 或 20 道，做完给出正确率、对错，以及迷惑辨析、数量关系、约束求解、演绎四项得分。Key 不经过本站。",
      keywords: "糖果测试,GPT降智,ChatGPT降智,逻辑题,模型降智测试,中转站降智,API中转检测",
    },
    pelican: {
      title: "鹈鹕骑车_SVG动画HTML检测_API中转站导航",
      description: "鹈鹕骑车用固定提示词让模型交回 SVG 动画 HTML，跑完可以播放和下载。用来看 GPT、Claude 中转这一次的画功，不是问答题。Key 不经过本站。",
      keywords: "鹈鹕骑车,鹈鹕骑自行车,GPT降智,ChatGPT降智,模型降智测试,API中转检测",
    },
  };

  function setMeta(name, content) {
    const el = document.querySelector('meta[name="' + name + '"]');
    if (el) el.setAttribute("content", content);
  }

  function setProp(name, content) {
    const el = document.querySelector('meta[property="' + name + '"]');
    if (el) el.setAttribute("content", content);
  }

  function applyViewSeo(name) {
    const seo = VIEW_SEO[name] || VIEW_SEO.home;
    document.title = seo.title;
    setMeta("description", seo.description);
    setMeta("keywords", seo.keywords);
    setProp("og:title", seo.title);
    setProp("og:description", seo.description);
    setMeta("twitter:title", seo.title);
    setMeta("twitter:description", seo.description);
    const path = pathForView(name);
    setProp("og:url", location.origin + path);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", location.origin + path);
  }

  function pathForView(name) {
    const view = !name || name === "home" ? "home" : name;
    return "/original-check/check.html?view=" + view;
  }

  function viewFromPath(pathname) {
    const path = String(pathname || "").replace(/\/$/, "");
    if (path === "/check") return "home";
    const match = path.match(/^\/check\/(detect|basic|candy|pelican)$/);
    return match ? match[1] : "";
  }

  function viewFromLocation() {
    const queryView = new URLSearchParams(location.search).get("view");
    if (["home", "detect", "basic", "candy", "pelican"].indexOf(queryView) >= 0) return queryView;
    const path = location.pathname.replace(/\/$/, "");
    const sub = path.match(/^\/check\/(detect|basic|candy|pelican)$/);
    if (sub) return sub[1];
    const hash = (location.hash || "").replace("#", "");
    if (["home", "detect", "basic", "candy", "pelican"].indexOf(hash) >= 0) return hash;
    return "home";
  }

  function showMcView(name, push) {
    const names = ["home", "detect", "basic", "candy", "pelican"];
    if (names.indexOf(name) < 0) name = "home";
    applyViewSeo(name);
    document.querySelectorAll(".mc-view").forEach(function (view) {
      view.classList.toggle("is-on", view.getAttribute("data-view-panel") === name);
    });
    document.querySelectorAll(".mc-links a").forEach(function (link) {
      link.classList.toggle("is-on", link.getAttribute("data-view") === name);
    });
    const setup = $("mcSetup");
    const slot = document.getElementById("setup-" + name);
    if (setup && slot) slot.appendChild(setup);
    if (!inParentCheck()) {
      const path = pathForView(name);
      if (location.pathname.replace(/\/$/, "") + location.search !== path) {
        const method = push ? "pushState" : "replaceState";
        history[method]({ view: name }, "", path);
      }
    }
    paintSetupGate();
    paintDetectRows();
  }

  function inParentCheck() {
    try {
      return window.parent !== window && !isHiddenRunner();
    } catch (err) {
      return false;
    }
  }

  function tellParentView(name) {
    if (!inParentCheck()) return;
    window.parent.postMessage({ type: "veridrop-check-view", view: name }, location.origin);
  }

  function missingSetup() {
    const missing = [];
    if (!$("base").value.trim()) missing.push("接口地址");
    if (!$("apiKey").value.trim()) missing.push("Key");
    return missing;
  }

  function hasSetup() {
    return !missingSetup().length;
  }

  function missingLabel(missing) {
    if (missing.length > 1) return "接口地址和 Key";
    return missing[0];
  }

  function setupRemindText(missing) {
    return "还不能检测：还没填 " + missingLabel(missing) + "。填好后才能开始。这些内容只存在这台浏览器里。";
  }

  function paintSetupGate() {
    const missing = missingSetup();
    const ready = !missing.length;
    const remind = $("setupRemind");
    if (remind) {
      remind.hidden = ready;
      remind.textContent = ready ? "" : setupRemindText(missing);
    }
    if ($("base")) $("base").classList.toggle("is-missing", !$("base").value.trim());
    if ($("apiKey")) $("apiKey").classList.toggle("is-missing", !$("apiKey").value.trim());
    const gate = $("needSetup");
    if (gate) {
      gate.hidden = ready;
      const title = gate.querySelector("h2");
      const copy = gate.querySelector("p");
      if (title) title.textContent = "还不能检测";
      if (copy && !ready) copy.textContent = "还没填 " + missingLabel(missing) + "。到基础测试页填写。地址、Key 和检测结果只存在这台浏览器里。";
    }
    if (!$("scoreVerdict")) return;
    if (!ready) {
      $("scoreVerdict").textContent = "还不能检测";
      $("scoreMind").textContent = "先填写 " + missingLabel(missing) + "。填好之后再跑，结果才会出现在这一页。";
      return;
    }
    if ($("scoreVerdict").textContent === "还不能检测") {
      $("scoreVerdict").textContent = "还没有检测";
      $("scoreMind").textContent = "地址和 Key 已经有了。去基础测试跑一轮，分数和降智判断会汇总到这里。";
    }
  }

  function guardSetup() {
    const missing = missingSetup();
    if (!missing.length) {
      try {
        G.normalizeBase($("base").value);
      } catch (err) {
        const panel = document.querySelector(".mc-view.is-on");
        const name = panel ? panel.getAttribute("data-view-panel") : "";
        if (name !== "basic" && name !== "candy" && name !== "pelican") {
          if (inParentCheck()) tellParentView("basic");
          else showMcView("basic", true);
        }
        paintSetupGate();
        const remind = $("setupRemind");
        const message = err.message || "接口地址无法使用";
        if (remind) {
          remind.hidden = false;
          remind.textContent = message;
        }
        $("base").classList.add("is-missing");
        $("base").focus();
        setNote(message);
        return false;
      }
      return true;
    }
    paintSetupGate();
    const panel = document.querySelector(".mc-view.is-on");
    const name = panel ? panel.getAttribute("data-view-panel") : "";
    if (name !== "basic" && name !== "candy" && name !== "pelican") {
      if (inParentCheck()) tellParentView("basic");
      else showMcView("basic", true);
    }
    (!$("base").value.trim() ? $("base") : $("apiKey")).focus();
    setNote(setupRemindText(missing));
    const remind = $("setupRemind");
    if (remind) remind.scrollIntoView({ block: "nearest" });
    return false;
  }

  async function loadModels() {
    let ctx;
    try {
      ctx = context();
    } catch (err) {
      if (!/模型/.test(err.message || "")) {
        setNote(err.message || String(err));
        return;
      }
      try {
        ctx = {
          base: G.normalizeBase($("base").value),
          key: $("apiKey").value.trim(),
          protocol: protocolFor(chosenModel() || ""),
        };
      } catch (inner) {
        setNote(inner.message || String(inner));
        return;
      }
      if (!ctx.key) {
        setNote("先填写 Key");
        return;
      }
      if (location.protocol === "https:" && ctx.base.indexOf("http://") === 0) {
        setNote("这个页面是 https，浏览器会拦住发往 http 接口的请求。可以换 https 地址，或用本机 curl。");
        return;
      }
      ctx.endpoints = G.endpoints(ctx.base, ctx.protocol);
    }
    const urls = [ctx.endpoints.models].concat(ctx.endpoints.modelsAlt ? [ctx.endpoints.modelsAlt] : []);
    let last = null;
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const headers = headersFor(ctx, true);
        const res = await fetch(urls[i], {
          headers: headers,
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        const parsed = await readJson(res);
        if (!res.ok) {
          const error = new Error(G.errorText(parsed.json, parsed.text, res.status));
          error.status = res.status;
          if (!last) {
            last = error;
            state.lastCurl = shellCurl(urls[0], headerList(headers), null);
            if ($("curlBtn")) $("curlBtn").hidden = false;
          }
          continue;
        }
        const models = G.parseModelList(parsed.json);
        if (!models.length) {
          setModelStatus("接口有响应，但没有模型 id");
          return false;
        }
        if (state.jobs.basic || state.jobs.candy || state.jobs.pelican || state.jobs.all) {
          setModelStatus("检测进行中，模型列表先不换");
          return false;
        }
        const previous = chosenModel();
        const select = $("model");
        select.replaceChildren();
        models.forEach(function (id) {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = id;
          select.appendChild(option);
        });
        setModel(previous && models.indexOf(previous) >= 0 ? previous : models[0]);
        persist();
        applyProtocolForModel();
        setModelStatus("已读取 " + models.length + " 个模型");
        return true;
      } catch (err) {
        if (!last) {
          last = err;
          const failedHeaders = headersFor(ctx, true);
          state.lastCurl = shellCurl(urls[0], headerList(failedHeaders), null);
          if ($("curlBtn")) $("curlBtn").hidden = false;
        }
      }
    }
    setModelStatus(shortModelError(last));
    return false;
  }

  function isHiddenRunner() {
    try {
      return window.parent !== window && window.frameElement && window.frameElement.classList.contains("basic-runner");
    } catch (err) {
      return false;
    }
  }

  let modelTimer = 0;
  let modelFetched = "";
  let modelLoading = false;

  function runModelLoad(token) {
    if (modelLoading) return;
    modelLoading = true;
    const button = $("fetchModels");
    if (button) button.disabled = true;
    setModelStatus("正在读取模型…");
    loadModels().then(function (ok) {
      if (ok) modelFetched = token;
    }).finally(function () {
      modelLoading = false;
      if (button) button.disabled = false;
    });
  }

  function scheduleModels() {
    if (isHiddenRunner()) return;
    window.clearTimeout(modelTimer);
    const base = $("base") ? $("base").value.trim() : "";
    const key = $("apiKey") ? $("apiKey").value.trim() : "";
    if (!base || key.length < 8) {
      if (!base || !key) setModelStatus("");
      return;
    }
    const token = base + "\n" + key;
    if (token === modelFetched || modelLoading) return;
    setModelStatus("正在读取模型…");
    modelTimer = window.setTimeout(function () {
      runModelLoad(token);
    }, 600);
  }

  function fetchModelsNow() {
    if (isHiddenRunner() || modelLoading) return;
    window.clearTimeout(modelTimer);
    const base = $("base") ? $("base").value.trim() : "";
    const key = $("apiKey") ? $("apiKey").value.trim() : "";
    if (!base || key.length < 8) {
      setModelStatus("先填写地址和 Key");
      return;
    }
    runModelLoad(base + "\n" + key);
  }

  function reportText() {
    let baseText = $("base").value.trim();
    try {
      baseText = G.normalizeBase(baseText);
    } catch (err) {
      baseText = "已省略";
    }
    const lines = ["API中转站导航 · 模型自测", "接口：" + baseText, "模型：" + chosenModel(), ""];
    if (!$("labScore").hidden) {
      lines.push("基础分：" + $("scoreValue").textContent + " · " + $("scoreVerdict").textContent);
      lines.push("耗时：" + $("scoreTime").textContent);
      lines.push("降智：" + $("scoreMind").textContent);
      lines.push("通道：" + $("scoreChannel").textContent);
      lines.push("");
    }
    cards().forEach(function (card) {
      const name = card.querySelector("h2").textContent.trim();
      const status = card.querySelector("[data-badge]").textContent.trim();
      const summary = card.querySelector(".lab-summary");
      lines.push(name + " · " + status);
      if (summary) lines.push(summary.textContent.trim());
      card.querySelectorAll(".mc-qitem").forEach(function (item) {
        const bits = [];
        item.querySelectorAll("strong, span, p").forEach(function (el) {
          bits.push(el.textContent.trim());
        });
        if (bits.length) lines.push(bits.join("\n"));
      });
      lines.push("");
    });
    lines.push("Key 不在这段文字里。结果只代表这一次调用。");
    return lines.join("\n");
  }

  function paintCandyList() {
    const list = $("candyList");
    if (!list || !G.CANDY_QUESTIONS) return;
    list.replaceChildren();
    G.CANDY_QUESTIONS.forEach(function (question, index) {
      const item = document.createElement("li");
      item.textContent = index + 1 + ". " + question.title;
      list.appendChild(item);
    });
  }

  function takeHomeRun() {
    const key = "veridrop-basic-run";
    let data = null;
    try {
      data = JSON.parse(sessionStorage.getItem(key) || "null");
    } catch (err) {
      data = null;
    }
    sessionStorage.removeItem(key);
    if (!data || !data.base || !data.key || !data.model) return null;
    if (typeof data.at !== "number" || Date.now() - data.at > 120000) return null;
    return data;
  }

  function applyCandyCount(count) {
    const allowed = { 5: true, 10: true, 15: true, 20: true };
    const wanted = allowed[Number(count)] ? String(Number(count)) : "10";
    const nodes = document.querySelectorAll('input[name="candyCount"]');
    Array.prototype.forEach.call(nodes, function (node) {
      node.checked = node.value === wanted;
    });
  }

  function failParentStart(suite, summary) {
    tell({ type: "veridrop-basic-step", id: "proto", status: "error", summary: summary || "接口地址无法使用" });
    tell({
      type: "veridrop-suite-done",
      suite: suite,
      scored: false,
      score: null,
      candy: "idle",
      pelican: "idle",
      candySummary: "",
      pelicanSummary: "",
      candyRight: null,
      candyTotal: null,
    });
    tell({ type: "veridrop-basic-done", scored: false });
  }

  function startFromParent(data) {
    if (!isHiddenRunner() || !data || viewFromLocation() !== "basic") return;
    const suite = data.suite === "candy" || data.suite === "pelican" || data.suite === "all" ? data.suite : "basic";
    if (state.jobs.basic || state.jobs.candy || state.jobs.pelican || state.jobs.all) return;
    try {
      $("base").value = G.normalizeBase(data.base);
    } catch (err) {
      failParentStart(suite, err.message || "接口地址无法使用");
      return;
    }
    $("apiKey").value = String(data.key || "");
    setModel(data.model);
    applyCandyCount(data.candyCount);
    applyProtocolForModel();
    paintSetupGate();
    if (suite === "candy") runProtected("candy", function (ctx, signal) { return runIds(["candy"], ctx, signal); });
    else if (suite === "pelican") runProtected("pelican", function (ctx, signal) { return runIds(["pelican"], ctx, signal); });
    else if (suite === "all") {
      runProtected("all", async function (ctx, signal) {
        await runBasicSuite(ctx, signal);
        if (!signal.aborted) await runIds(EXTRA_TESTS, ctx, signal);
      });
    } else runProtected("basic", runBasicSuite);
    if (!state.jobs[suite]) failParentStart(suite, "这一轮没有开始");
  }

  function parentJobFields(suite) {
    const labelNode = $("modelPickLabel");
    const label = labelNode && labelNode.textContent.trim();
    const countNode = document.querySelector('input[name="candyCount"]:checked');
    return {
      type: "veridrop-job-request",
      suite: suite,
      base: G.normalizeBase($("base").value),
      key: $("apiKey").value.trim(),
      model: chosenModel(),
      modelLabel: label || chosenModel(),
      candyCount: countNode ? Number(countNode.value) : 10,
    };
  }

  function requestParentJob(suite) {
    if (!inParentCheck()) return false;
    if (!guardSetup()) return true;
    let payload;
    try {
      payload = parentJobFields(suite);
    } catch (err) {
      showJobNote(err.message || "接口地址无法使用");
      return true;
    }
    showJobNote("正在开始…");
    window.parent.postMessage(payload, location.origin);
    return true;
  }

  function applyHomeRun() {
    const data = takeHomeRun();
    if (!data || viewFromLocation() !== "basic") return;
    try {
      $("base").value = G.normalizeBase(data.base);
    } catch (err) {
      $("base").value = String(data.base || "");
      $("apiKey").value = String(data.key || "");
      setModel(data.model);
      applyProtocolForModel();
      paintSetupGate();
      setNote(err.message || "接口地址无法使用");
      return;
    }
    $("apiKey").value = String(data.key || "");
    setModel(data.model);
    applyProtocolForModel();
    persist();
    paintSetupGate();
    runProtected("basic", runBasicSuite);
  }

  function applyIncomingBase() {
    const incoming = new URLSearchParams(location.search).get("base");
    if (!incoming || !$("base")) return;
    let text = "";
    try {
      text = G.normalizeBase(incoming);
    } catch (err) {
      return;
    }
    $("base").value = text;
    persist();
    paintSetupGate();
    const kept = new URLSearchParams(location.search);
    kept.delete("base");
    const rest = kept.toString();
    if (history.replaceState) history.replaceState({}, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  }

  function bind() {
    restore();
    applyIncomingBase();
    paintCandyList();
    ["base", "apiKey", "rememberKey"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        persist();
        paintSetupGate();
        scheduleModels();
      });
    });
    $("model").addEventListener("change", function () {
      applyProtocolForModel();
      persist();
    });
    $("apiKey").addEventListener("input", function () {
      if ($("rememberKey").checked) persist();
      paintSetupGate();
      scheduleModels();
    });
    $("base").addEventListener("input", function () {
      paintSetupGate();
      scheduleModels();
    });
    scheduleModels();
    if ($("fetchModels")) $("fetchModels").addEventListener("click", fetchModelsNow);
    $("rememberKey").addEventListener("change", function () {
      if (!$("rememberKey").checked) {
        const data = readStore();
        delete data.key;
        data.remember = false;
        writeStore(data);
      }
      persist();
    });
    $("toggleKey").addEventListener("click", function () {
      const input = $("apiKey");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      $("toggleKey").textContent = show ? "隐藏" : "显示";
    });
    function runLocal(suite) {
      if (suite === "basic") {
        runProtected("basic", runBasicSuite);
        return;
      }
      if (suite === "all") {
        runProtected("all", async function (ctx, signal) {
          await runBasicSuite(ctx, signal);
          if (!signal.aborted) await runIds(EXTRA_TESTS, ctx, signal);
        });
        return;
      }
      runProtected(suite, function (ctx, signal) {
        return runIds([suite], ctx, signal);
      });
    }
    function onSuiteClick(suite) {
      return function () {
        if (requestParentJob(suite)) return;
        runLocal(suite);
      };
    }
    $("runBtn").addEventListener("click", onSuiteClick("basic"));
    $("runCandy").addEventListener("click", onSuiteClick("candy"));
    $("runPelican").addEventListener("click", onSuiteClick("pelican"));
    $("runCandyCard").addEventListener("click", onSuiteClick("candy"));
    $("runPelicanCard").addEventListener("click", onSuiteClick("pelican"));
    $("runAll").addEventListener("click", onSuiteClick("all"));
    if ($("runAllCandy")) $("runAllCandy").addEventListener("click", onSuiteClick("all"));
    if ($("runAllPelican")) $("runAllPelican").addEventListener("click", onSuiteClick("all"));
    $("stopBtn").addEventListener("click", function () {
      Object.keys(state.jobs).forEach(function (key) {
        state.jobs[key].abort();
      });
    });
    showMcView(viewFromLocation(), false);
    window.addEventListener("popstate", function () {
      if (inParentCheck()) return;
      showMcView(viewFromLocation(), false);
    });
    document.addEventListener("click", function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
      const link = event.target.closest("a");
      if (!link || link.target === "_blank") return;
      let url;
      try {
        url = new URL(link.getAttribute("href"), location.origin);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      const name = viewFromPath(url.pathname);
      if (!name) return;
      event.preventDefault();
      if (inParentCheck()) {
        if (name !== "basic") showMcView(name, false);
        tellParentView(name);
        return;
      }
      showMcView(name, true);
      if (link.id === "goSetup") (!$("base").value.trim() ? $("base") : $("apiKey")).focus();
    });
    paintHistory();
    applyHomeRun();
    window.addEventListener("message", function (event) {
      if (event.origin !== location.origin) return;
      const data = event.data;
      if (!data || !data.type) return;
      if (data.type === "veridrop-check-show") {
        if (isHiddenRunner()) return;
        const next = ["home", "detect", "basic", "candy", "pelican"].indexOf(data.view) >= 0 ? data.view : "home";
        const on = document.querySelector(".mc-view.is-on");
        if (on && on.getAttribute("data-view-panel") === next) return;
        showMcView(next, false);
        return;
      }
      if (data.type === "veridrop-job-reply") {
        if (isHiddenRunner()) return;
        if (data.ok) showJobNote("已开始。离开这个页面也会继续，检测历史里能看到进行中。");
        else showJobNote(data.error || "上一轮还在进行中");
        return;
      }
      if (data.type === "veridrop-basic-stop") {
        Object.keys(state.jobs).forEach(function (name) {
          state.jobs[name].abort();
        });
        return;
      }
      if (data.type === "veridrop-basic-start") startFromParent(data);
    });
    $("copyReport").addEventListener("click", function () {
      const text = reportText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            setNote("报告已复制，里面没有 Key。");
          },
          function () {
            setNote("复制失败，请手动选择下面的报告。");
          }
        );
      }
      $("report").hidden = false;
      $("report").value = text;
    });
    $("curlBtn").addEventListener("click", function () {
      $("curlBox").hidden = false;
      $("curlBox").value = state.lastCurl || "";
      setNote("这段 curl 里有 Key，只贴到你自己的终端。");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();

