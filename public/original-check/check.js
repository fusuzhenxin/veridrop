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
      const payload = {
        type: "veridrop-basic-step",
        id: testId,
        status: status,
        summary: summary || "",
        raw: picked.length > 4000 ? picked.slice(0, 4000) + "\n…已截断" : picked,
      };
      if (testId === "candy") payload.rows = plainCandyRows(rows);
      if (testId === "pelican") payload.html = String(html || "").slice(0, 1200000);
      tell(payload);
    }
    if (card.getAttribute("data-test") === "candy") {
      state.candyRows = plainCandyRows(rows);
      if (rows && rows.some(function (row) { return !row.missed; })) renderCandyReport(rows);
      else showCandyStart();
    }
    if (card.getAttribute("data-test") === "pelican") {
      state.pelicanHtml = String(html || "").slice(0, 1200000);
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

  function abortError() {
    try {
      return new DOMException("The operation was aborted.", "AbortError");
    } catch (err) {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return error;
    }
  }

  async function raceAbort(work, signal) {
    if (signal && signal.aborted) throw abortError();
    let onAbort = null;
    const aborted = new Promise(function (_resolve, reject) {
      if (!signal) return;
      onAbort = function () {
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort);
      if (signal.aborted) {
        signal.removeEventListener("abort", onAbort);
        onAbort = null;
        throw abortError();
      }
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async function readJson(res, signal) {
    let text = "";
    try {
      text = await raceAbort(res.text(), signal);
    } catch (err) {
      if (res.body && res.body.cancel) res.body.cancel().catch(function () {});
      throw err;
    }
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
    const parsed = await readJson(res, signal);
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
    if (window.parent === window) return;
    if (leaving && !isHiddenRunner()) return;
    try {
      window.parent.postMessage(payload, location.origin);
      return;
    } catch (err) {
      /* a large pelican page can fail the clone; the conclusion still has to leave */
    }
    if (!payload || typeof payload !== "object" || !payload.html) return;
    var slim = {};
    Object.keys(payload).forEach(function (key) {
      if (key !== "html") slim[key] = payload[key];
    });
    try {
      window.parent.postMessage(slim, location.origin);
    } catch (err2) {
      /* suite-done still carries the conclusion and the candy rows */
    }
  }

  window.addEventListener("pageshow", function () {
    leaving = false;
  });

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
      reader.cancel().catch(function () {});
    };
    if (signal) signal.addEventListener("abort", onAbort);
    try {
      while (true) {
        const chunk = await raceAbort(reader.read(), signal);
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
      const parsed = await readJson(res, signal);
      noteCall(null, Date.now() - started);
      const error = new Error(G.errorText(parsed.json, parsed.text, res.status));
      error.status = res.status;
      error.curl = shellCurl(ctx.endpoints.chat, headerList(headers), body);
      throw error;
    }
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    if (type.indexOf("text/event-stream") < 0) {
      const parsed = await readJson(res, signal);
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
    sub.appendChild(document.createTextNode(" " + (ui.model || chosenModel() || "未选模型") + " · 困难 · " + candyStamp(ui.at)));
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

      function publishCandy() {
        tell({
          type: "veridrop-basic-step",
          id: "candy",
          status: "running",
          summary: "已完成 " + rows.length + " / " + questions.length + " 题",
          rows: plainCandyRows(rows),
        });
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
        publishCandy();
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
        const questionGate = linkSignal(signal, 60000);
        try {
          out = await postChat(ctx, { messages: user(candyPrompt(question)), max_tokens: question.max || 800 }, questionGate.signal);
        } catch (err) {
          if (signal.aborted) {
            markRest(i, "还没问到");
            return summarize("已中断");
          }
          if (err && err.name === "AbortError") {
            rows.push({
              title: question.title,
              prompt: question.prompt,
              dimension: question.dimension,
              level: question.level,
              options: question.options,
              answer: question.answer,
              picked: "这题超过 60 秒没有返回",
              expect: question.expect,
              ok: false,
              missed: true,
            });
            details.push("【" + question.title + "】\n超过 60 秒没有返回");
            publishCandy();
            continue;
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
          publishCandy();
          continue;
        } finally {
          questionGate.finish();
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
        publishCandy();
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
    if (id === "candy") return 480000;
    if (id === "pelican") return 180000;
    return 90000;
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
        const waited = id === "candy" ? "超过 8 分钟" : id === "pelican" ? "超过 3 分钟" : "超过 90 秒";
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
      if (signal.aborted) {
        showResult(card, "stop", "已停止", "", "");
        return "stop";
      }
      if (err && err.name === "AbortError") {
        const seconds = Math.max(1, Math.round(timeout / 1000));
        showResult(card, "error", "超过 " + seconds + " 秒还没有返回。", "", "");
        return "error";
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
    await go("proto", "协议识别", 90000, async function (stepSignal) {
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
      await go("consistent", "模型一致性", 90000, async function (stepSignal) {
        const seen = [];
        if (first && first.reply) seen.push(String(first.reply.model || ""));
        const out = await postChat(ctx, { messages: user("只回复 OK。"), max_tokens: 16 }, stepSignal);
        seen.push(String((out.reply && out.reply.model) || ""));
        return withServer(decorate(G.gradeConsistency(seen, ctx.model), out.ms, out.reply), out.raw);
      });
    }

    if (!stopped) {
      await go("stream", "流式响应", 90000, async function (stepSignal) {
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
      await go("control", "输出控制", 90000, async function (stepSignal) {
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
      await go("memory", "上下文记忆", 90000, async function (stepSignal) {
        const code = randomToken("BLUE-", "0123456789", 4);
        const out = await postChat(ctx, { messages: G.historyMessages(code), max_tokens: 128 }, stepSignal);
        return withServer(decorate(G.gradeHistory(out.reply.content, code), out.ms, out.reply), out.raw);
      });
    }

    if (!stopped) {
      await go("system", "系统指令", 90000, async function (stepSignal) {
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
      await go("tools", "工具调用", 90000, async function (stepSignal) {
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
      await go("vision", "多模态", 90000, async function (stepSignal) {
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
      await go("reasoning", "推理参数", 90000, async function (stepSignal) {
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
      await go("replay", "缓存与重放", 120000, async function (stepSignal) {
        const spec = { messages: user("用一个词回答：企鹅生活在哪里？"), max_tokens: 64 };
        const a = await postChat(ctx, spec, stepSignal);
        const b = await postChat(ctx, spec, stepSignal);
        return withServer(decorate(G.gradeReplay(G.responseId(a.raw), G.responseId(b.raw)), a.ms + b.ms, b.reply), b.raw);
      });
    }

    if (!stopped) {
      await go("context", "长上下文真实性", 90000, async function (stepSignal) {
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
    state.suiteStarted = Date.now();
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
      rows: plainCandyRows(state.candyRows || []),
    });
    if (suite === "basic" || suite === "all") tell({ type: "veridrop-basic-done", scored: basicReachedApi() });
    if ((suite === "candy" || suite === "pelican") && inParentCheck()) recordLocal(suite);
  }

  function plainCandyRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 20).map(function (row) {
      const options = Array.isArray(row && row.options) ? row.options.slice(0, 8).map(function (opt) {
        return {
          key: String(opt && opt.key || "").slice(0, 8),
          text: String(opt && opt.text || "").slice(0, 300),
        };
      }) : [];
      return {
        title: String(row && row.title || "").slice(0, 80),
        prompt: String(row && row.prompt || "").slice(0, 2000),
        dimension: String(row && row.dimension || "").slice(0, 20),
        level: String(row && row.level || "").slice(0, 20),
        options: options,
        answer: String(row && row.answer || "").slice(0, 8),
        picked: String(row && row.picked || "").slice(0, 500),
        expect: String(row && row.expect || "").slice(0, 200),
        ok: !!(row && row.ok),
        missed: !!(row && row.missed),
      };
    });
  }

  function recordLocal(suite) {
    let base = "";
    try {
      base = G.normalizeBase($("base").value);
    } catch (err) {
      base = String($("base").value || "").trim();
    }
    const labelNode = $("modelPickLabel");
    const label = labelNode && labelNode.textContent.trim();
    const counts = candyCounts();
    const status = cardStatus(suite);
    const ui = state.candyUi || {};
    tell({
      type: "veridrop-local-record",
      suite: suite,
      base: base,
      model: chosenModel(),
      modelLabel: label || chosenModel(),
      status: status,
      summary: summaryOf(suite),
      candyRight: counts.right,
      candyTotal: counts.total,
      candySeq: ui.seq || 1,
      started: state.suiteStarted || Date.now(),
      rows: suite === "candy" ? (state.candyRows || []) : [],
      html: suite === "pelican" ? String(state.pelicanHtml || "") : "",
      scored: status === "pass" || status === "warn" || status === "fail",
    });
  }

  function replaySaved(data) {
    if (isHiddenRunner() || !data || typeof data.id !== "string") return;
    if (!/^(candy|pelican)-[a-z0-9]{4,24}$/i.test(data.id)) return;
    let report = null;
    try {
      report = JSON.parse(localStorage.getItem("veridrop-basic-report:" + data.id) || "null");
    } catch (err) {
      report = null;
    }
    if (!report || report.id !== data.id) return;
    const view = document.querySelector(".mc-view.is-on");
    const name = view ? view.getAttribute("data-view-panel") : "";
    if (report.suite === "candy" && name === "candy" && Array.isArray(report.candyRows) && report.candyRows.length) {
      state.candyUi = {
        seq: report.candySeq || 1,
        at: report.finishedAt ? new Date(report.finishedAt) : new Date(),
        model: report.model || "",
      };
      renderCandyReport(report.candyRows);
      return;
    }
    if (report.suite === "pelican" && name === "pelican") {
      const card = document.querySelector("[data-test='pelican']");
      if (!card) return;
      const row = Array.isArray(report.rows) ? report.rows[0] : null;
      const status = row && row.status ? row.status : "pass";
      showResult(card, status, (row && row.summary) || report.result || "", "", "", report.pelicanHtml || "", null);
    }
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
    const pelicanFrame = document.querySelector('[data-test="pelican"] iframe.lab-frame');
    item.pelicanHtml = pelicanFrame ? String(pelicanFrame.getAttribute("srcdoc") || "").slice(0, 1200000) : "";
    const kept = runs.slice(0, 8);
    try {
      localStorage.setItem("veridrop.check.runs", JSON.stringify(kept));
    } catch (err) {
      item.pelicanHtml = "";
      try {
        localStorage.setItem("veridrop.check.runs", JSON.stringify(kept));
      } catch (err2) {
        item.items.forEach(function (row) {
          row.questions = [];
        });
        try {
          localStorage.setItem("veridrop.check.runs", JSON.stringify(kept));
        } catch (err3) {
          /* the open page still has this run */
        }
      }
    }
    paintHistory();
  }

  var allReportCache = null;
  var allClockTimer = 0;
  var AX_BASIC = [
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

  function axEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function axEmpty(title, copy) {
    var card = axEl("section", "ax-card");
    card.appendChild(axEl("h2", "", title));
    card.appendChild(axEl("p", "ax-lead", copy));
    return card;
  }

  function axStart(card, label) {
    if (hasSetup()) {
      var button = axEl("button", "mc-btn mc-btn-solid", label || "开始三项检测");
      button.type = "button";
      button.addEventListener("click", function () {
        var run = $("runAll");
        if (run) run.click();
      });
      card.appendChild(button);
      return;
    }
    var link = axEl("a", "mc-btn mc-btn-solid", label || "去基础测试页开始");
    link.href = "/check/basic";
    card.appendChild(link);
  }

  function axRowOf(report, id) {
    var rows = Array.isArray(report.rows) ? report.rows : [];
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i] && rows[i].id === id) return rows[i];
    }
    return null;
  }

  function axWord(row) {
    if (!row || row.state === "wait" || !row.state) return ["未测", "mute"];
    if (row.state === "run") return ["进行中", "run"];
    if (row.status === "pass") return ["通过", "ok"];
    if (row.status === "warn") return ["留意", "warn"];
    if (row.status === "fail") return ["未通过", "bad"];
    if (row.status === "error") return ["没测成", "bad"];
    if (row.status === "skip") return ["不支持", "mute"];
    if (row.status === "stop") return ["已停止", "mute"];
    return ["未测", "mute"];
  }

  function axBasicScore(report) {
    var points = 0;
    var counted = 0;
    AX_BASIC.forEach(function (pair) {
      var row = axRowOf(report, pair[0]);
      if (!row || row.state === "run" || row.state === "wait" || !row.state) return;
      if (row.status === "pass") {
        counted += 1;
        points += 1;
      } else if (row.status === "warn") {
        counted += 1;
        points += 0.5;
      } else if (row.status === "fail") counted += 1;
    });
    return { score: counted ? Math.round((points / counted) * 100) : null, counted: counted };
  }

  function axSeconds(ms) {
    if (ms == null || !isFinite(Number(ms))) return "—";
    return (Number(ms) / 1000).toFixed(1) + " 秒";
  }

  function axNum(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function axClock(ms) {
    var n = Number(ms);
    if (!isFinite(n) || !n) return "";
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(n));
    } catch (err) {
      return "";
    }
  }

  function axTotalMs(report) {
    var meter = report.meter || {};
    if (report.running) return Math.max(0, Date.now() - Number(report.started || Date.now()));
    if (meter.totalMs != null) return meter.totalMs;
    return Math.max(0, Number(report.finishedAt || Date.now()) - Number(report.started || Date.now()));
  }

  function axDuration(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n < 0) return "—";
    var sec = n / 1000;
    if (sec < 60) return (sec < 10 ? sec.toFixed(1) : String(Math.round(sec))) + " 秒";
    var whole = Math.round(sec);
    return Math.floor(whole / 60) + " 分 " + (whole % 60) + " 秒";
  }

  function axNeedsCare(report) {
    var ids = AX_BASIC.map(function (pair) { return pair[0]; }).concat(["candy", "pelican"]);
    return ids.some(function (id) {
      var row = axRowOf(report, id);
      return row && (row.status === "warn" || row.status === "fail" || row.status === "error");
    });
  }

  function axTitle(report) {
    if (report.running) return "这一轮还在进行";
    if (report.interrupted) return "这一轮中断了";
    if (report.result === "已停止") return "这一轮已停止";
    if (axNeedsCare(report)) return "有需要留意的地方";
    return "这一轮完成了";
  }

  function axParentUrl() {
    try {
      if (window.parent !== window) return String(window.parent.location.href || "");
    } catch (err) {
      /* the report link stays on this frame */
    }
    return String(location.href || "");
  }

  function axDownload(report) {
    var copy = {
      id: report.id,
      host: report.host || "",
      model: report.model || "",
      started: report.started || null,
      finishedAt: report.finishedAt || null,
      result: report.result || "",
      rows: Array.isArray(report.rows) ? report.rows : [],
      meter: report.meter || null,
      partRight: typeof report.partRight === "number" ? report.partRight : null,
      partTotal: typeof report.partTotal === "number" ? report.partTotal : null,
      candyRows: Array.isArray(report.candyRows) ? report.candyRows : [],
      pelicanHtml: typeof report.pelicanHtml === "string" ? report.pelicanHtml : "",
    };
    var blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    var host = String(report.host || "veridrop").replace(/[^\w.\-]+/g, "-").slice(0, 40);
    link.href = url;
    link.download = host + "-三项检测.json";
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function axHead(report) {
    var top = axEl("div", "ax-top");
    var main = axEl("div");
    main.appendChild(axEl("h2", "ax-title", axTitle(report)));
    var when = report.running ? axClock(report.started) : axClock(report.finishedAt || report.started);
    var meta = axEl("p", "ax-meta");
    [report.host || "未记下站点", report.model || "未选模型", when].filter(Boolean).forEach(function (bit, index) {
      if (index) meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(document.createTextNode(bit));
    });
    meta.appendChild(document.createTextNode(" · "));
    var dur = axEl("span", "", axDuration(axTotalMs(report)));
    if (report.running) dur.setAttribute("data-ax-elapsed", "1");
    meta.appendChild(dur);
    main.appendChild(meta);
    if (report.running) main.appendChild(axEl("p", "ax-live", "离开这个页面后，这一轮仍会继续。检测历史里显示进行中。"));
    top.appendChild(main);
    var actions = axEl("div", "ax-tools");
    var copy = axEl("button", "mc-btn", "复制报告链接");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var url = axParentUrl();
      var done = function () {
        copy.textContent = "已复制";
        setTimeout(function () { copy.textContent = "复制报告链接"; }, 1600);
      };
      var fail = function () { copy.textContent = "请手动复制地址栏"; };
      var legacy = function () {
        var area = document.createElement("textarea");
        area.value = url;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
        area.remove();
        if (ok) done();
        else fail();
      };
      if (!(navigator.clipboard && navigator.clipboard.writeText)) {
        legacy();
        return;
      }
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) legacy();
      }, 1200);
      navigator.clipboard.writeText(url).then(function () {
        settled = true;
        clearTimeout(timer);
        done();
      }, function () {
        settled = true;
        clearTimeout(timer);
        legacy();
      });
    });
    var save = axEl("button", "mc-btn", "下载 JSON");
    save.type = "button";
    save.addEventListener("click", function () { axDownload(report); });
    actions.appendChild(copy);
    actions.appendChild(save);
    if (report.running) {
      var stop = axEl("button", "mc-btn", "停止");
      stop.type = "button";
      stop.addEventListener("click", function () {
        if (window.parent !== window) window.parent.postMessage({ type: "veridrop-all-stop" }, location.origin);
      });
      actions.appendChild(stop);
    } else axStart(actions, "重新检测");
    top.appendChild(actions);
    return top;
  }

  function axFillMarked(node, text) {
    var src = String(text || "");
    var re = /(\d[\d,]*\s*ms|推理\s*\d[\d,]*)/g;
    var last = 0;
    var match;
    var any = false;
    while ((match = re.exec(src))) {
      any = true;
      if (match.index > last) node.appendChild(document.createTextNode(src.slice(last, match.index)));
      node.appendChild(axEl("b", "ax-time", match[1]));
      last = re.lastIndex;
    }
    if (!any) node.textContent = src;
    else if (last < src.length) node.appendChild(document.createTextNode(src.slice(last)));
  }

  function axKpi(label, value, caption, elapsed) {
    var cell = axEl("div", "ax-kpi");
    cell.appendChild(axEl("span", "", label));
    var timed = !!elapsed || label === "首次响应" || label === "总耗时";
    var num = axEl("b", timed ? "ax-time" : "", value);
    if (elapsed) num.setAttribute("data-ax-elapsed", "1");
    cell.appendChild(num);
    if (caption) cell.appendChild(axEl("small", "", caption));
    return cell;
  }

  function axKpis(report) {
    var meter = report.meter || {};
    var waiting = !!(report.running && !meter.requests);
    var scored = axBasicScore(report);
    var candyRows = Array.isArray(report.candyRows) ? report.candyRows : [];
    var candyRow = axRowOf(report, "candy");
    var candyValue = "—";
    var candyCap = "还没有结果";
    if (candyRows.length) {
      var right = candyRows.filter(function (item) { return item && item.ok; }).length;
      candyValue = right + "/" + candyRows.length;
      candyCap = "答对 / 题数";
    } else if (typeof report.partRight === "number" && typeof report.partTotal === "number" && report.partTotal > 0) {
      candyValue = report.partRight + "/" + report.partTotal;
      candyCap = "只留下了对错";
    } else if (candyRow && candyRow.state === "run") {
      candyValue = "进行中";
      candyCap = "题目会陆续出现";
    }
    var pelicanRow = axRowOf(report, "pelican");
    var pelicanWord = axWord(pelicanRow);
    var html = typeof report.pelicanHtml === "string" ? report.pelicanHtml : "";
    var pelicanCap = "还没有页面";
    if (html) pelicanCap = "已留下页面";
    else if (pelicanRow && pelicanRow.state === "done") pelicanCap = "没有留下页面";
    else if (pelicanRow && pelicanRow.state === "run") pelicanCap = "页面跑完后出现";
    var strip = axEl("div", "ax-kpis");
    strip.appendChild(axKpi("基础分", scored.score == null ? "—" : String(scored.score), scored.counted ? "计入 " + scored.counted + " 项" : "还没有计入的项"));
    strip.appendChild(axKpi("糖果", candyValue, candyCap));
    strip.appendChild(axKpi("鹈鹕", pelicanWord[0], pelicanCap));
    strip.appendChild(axKpi("首次响应", waiting ? "—" : axDuration(meter.ttftMs), "第一次请求用时"));
    strip.appendChild(axKpi("总耗时", axDuration(axTotalMs(report)), "整轮用时", true));
    return strip;
  }

  function axBasic(report) {
    var card = axEl("section", "ax-card");
    var scored = axBasicScore(report);
    var head = axEl("div", "ax-sec-h");
    head.appendChild(axEl("h2", "", "基础测试"));
    var mark = axEl("div", "ax-mark");
    mark.appendChild(axEl("b", "", scored.score == null ? "—" : String(scored.score)));
    mark.appendChild(axEl("span", "", scored.counted ? "计入 " + scored.counted + " 项" : "还没有计入的项"));
    head.appendChild(mark);
    card.appendChild(head);
    card.appendChild(axEl("p", "ax-lead", "不支持的不扣分，没测成的不补成 0 分。"));
    var columns = axEl("div", "ax-row ax-row-h");
    columns.appendChild(axEl("span", "", "项目"));
    columns.appendChild(axEl("span", "", "结果"));
    columns.appendChild(axEl("span", "", "结论"));
    card.appendChild(columns);
    AX_BASIC.forEach(function (pair) {
      var row = axRowOf(report, pair[0]);
      var word = axWord(row);
      var line = axEl("div", "ax-row");
      line.appendChild(axEl("strong", "", pair[1]));
      line.appendChild(axEl("em", "ax-pill is-" + word[1], word[0]));
      var body = axEl("div");
      if (row && row.summary) {
        var summary = axEl("p");
        axFillMarked(summary, row.summary);
        body.appendChild(summary);
      }
      if (row && row.raw && row.state === "done") {
        var box = axEl("details", "ax-raw");
        box.appendChild(axEl("summary", "", "原始回复"));
        box.appendChild(axEl("pre", "", row.raw));
        body.appendChild(box);
      }
      line.appendChild(body);
      card.appendChild(line);
    });
    return card;
  }

  function axCandy(report) {
    var card = axEl("section", "ax-card");
    var row = axRowOf(report, "candy");
    var word = axWord(row);
    var rows = Array.isArray(report.candyRows) ? report.candyRows : [];
    var right = rows.filter(function (item) { return item && item.ok; }).length;
    var head = axEl("div", "ax-sec-h");
    head.appendChild(axEl("h2", "", "糖果测试"));
    var mark = axEl("div", "ax-mark");
    if (rows.length) {
      mark.appendChild(axEl("b", "", right + " / " + rows.length));
      mark.appendChild(axEl("span", "", "答对"));
    } else mark.appendChild(axEl("em", "ax-pill is-" + word[1], word[0]));
    head.appendChild(mark);
    card.appendChild(head);
    if (row && row.summary) {
      var lead = axEl("p", "ax-lead");
      axFillMarked(lead, row.summary);
      card.appendChild(lead);
    }
    if (rows.length && typeof report.partTotal === "number" && report.partTotal > rows.length) {
      card.appendChild(axEl("p", "ax-miss", "记录里找到了 " + rows.length + " 题，结论写的是共 " + report.partTotal + " 题。"));
    }
    if (!rows.length) {
      var pending = !row || row.state === "wait" || !row.state || row.state === "run";
      card.appendChild(axEl("p", "ax-miss", pending ? "题目会在答完后出现在这里。" : "这一轮只留下了结论，没有留下每一题。"));
      if (row && row.raw && row.state === "done") {
        var box = axEl("details", "ax-raw");
        box.open = true;
        box.appendChild(axEl("summary", "", "查看留下的回复"));
        box.appendChild(axEl("pre", "", row.raw));
        card.appendChild(box);
      }
      return card;
    }
    var dims = axEl("div", "ax-dims");
    ["迷惑辨析", "数量关系", "约束求解", "演绎"].forEach(function (name) {
      var group = rows.filter(function (item) { return item && item.dimension === name && !item.missed; });
      var got = group.filter(function (item) { return item.ok; }).length;
      var score = group.length ? Math.round((got / group.length) * 100) : 0;
      var line = axEl("div", "ax-dim");
      line.appendChild(axEl("span", "", name));
      var track = axEl("b");
      var inner = axEl("i");
      inner.style.width = (group.length ? score : 0) + "%";
      track.appendChild(inner);
      line.appendChild(track);
      line.appendChild(axEl("em", "", group.length ? String(score) : "—"));
      dims.appendChild(line);
    });
    card.appendChild(dims);
    var list = axEl("div", "ax-qs");
    rows.forEach(function (item, index) {
      var block = axEl("article", "ax-q");
      var qh = axEl("div", "ax-qhead");
      var title = (index + 1) + ". " + (item.title || "题目");
      if (item.dimension) title += " · " + item.dimension;
      qh.appendChild(axEl("strong", "", title));
      var verdict = item.missed ? "未完成" : item.ok ? "答对" : "答错";
      var tone = item.missed ? "mute" : item.ok ? "ok" : "bad";
      qh.appendChild(axEl("em", "ax-pill is-" + tone, verdict));
      block.appendChild(qh);
      if (item.prompt) block.appendChild(axEl("p", "ax-prompt", item.prompt));
      if (item.options && item.options.length) {
        block.appendChild(axEl("p", "ax-ans", "选项：" + item.options.map(function (opt) {
          return (opt.key ? opt.key + ". " : "") + (opt.text || "");
        }).join("    ")));
      }
      block.appendChild(axEl("p", "ax-ans", "模型答案：" + (item.picked || "没有回答")));
      block.appendChild(axEl("p", "ax-ans", "对照：" + (item.expect || item.answer || "")));
      list.appendChild(block);
    });
    card.appendChild(list);
    return card;
  }

  function axPelican(report) {
    var card = axEl("section", "ax-card");
    var row = axRowOf(report, "pelican");
    var word = axWord(row);
    var head = axEl("div", "ax-sec-h");
    head.appendChild(axEl("h2", "", "鹈鹕骑车"));
    head.appendChild(axEl("em", "ax-pill is-" + word[1], word[0]));
    card.appendChild(head);
    if (row && row.summary) {
      var lead = axEl("p", "ax-lead");
      axFillMarked(lead, row.summary);
      card.appendChild(lead);
    }
    var html = typeof report.pelicanHtml === "string" ? report.pelicanHtml : "";
    if (!html) {
      var pending = !row || row.state === "wait" || !row.state || row.state === "run";
      card.appendChild(axEl("p", "ax-miss", pending ? "生成的页面会在这一项跑完后出现在这里。" : "这一轮只留下了结论，没有留下生成的页面。"));
      if (row && row.raw && row.state === "done") {
        var box = axEl("details", "ax-raw");
        box.open = true;
        box.appendChild(axEl("summary", "", "查看留下的回复"));
        box.appendChild(axEl("pre", "", row.raw));
        card.appendChild(box);
      }
      return card;
    }
    if (report.pelicanNote) card.appendChild(axEl("p", "ax-miss", report.pelicanNote));
    var page = preparePlayableHtml(html);
    if (!page) {
      card.appendChild(axEl("p", "ax-miss", "页面没有通过安全渲染。"));
      return card;
    }
    var stage = axEl("div", "ax-stage");
    var peek = axEl("div", "ax-peek");
    peek.setAttribute("role", "button");
    peek.tabIndex = 0;
    peek.setAttribute("aria-label", "在新标签打开鹈鹕页面");
    var frame = axEl("iframe", "ax-frame");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("scrolling", "no");
    frame.title = "鹈鹕骑车预览";
    frame.srcdoc = page;
    peek.appendChild(frame);
    var bar = axEl("div", "ax-actions");
    var openBtn = axEl("button", "mc-btn mc-btn-solid", "在新标签打开");
    openBtn.type = "button";
    openBtn.addEventListener("click", function () { openHtmlPage(page, bar); });
    var downBtn = axEl("button", "mc-btn", "下载 HTML");
    downBtn.type = "button";
    downBtn.addEventListener("click", function () { downloadHtml(page, "pelican-bicycle.html"); });
    function openPeek(event) {
      if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
      if (event.type === "keydown") event.preventDefault();
      openHtmlPage(page, bar);
    }
    peek.addEventListener("click", openPeek);
    peek.addEventListener("keydown", openPeek);
    bar.appendChild(openBtn);
    bar.appendChild(downBtn);
    stage.appendChild(peek);
    stage.appendChild(bar);
    card.appendChild(stage);
    return card;
  }

  var axRecoverPosted = {};

  function axSameSummary(left, right) {
    var a = String(left || "").replace(/\s+/g, "");
    var b = String(right || "").replace(/\s+/g, "");
    if (!a || !b) return false;
    if (a === b) return true;
    var mark = a.match(/(\d+)ms/);
    return !!(mark && b.indexOf(mark[1] + "ms") >= 0);
  }

  function axQuestionBank() {
    return (G && Array.isArray(G.CANDY_QUESTIONS)) ? G.CANDY_QUESTIONS : [];
  }

  function axKnownQuestion(title, prompt) {
    var bank = axQuestionBank();
    for (var i = 0; i < bank.length; i += 1) {
      if (bank[i] && (bank[i].title === title || (prompt && bank[i].prompt === prompt))) return bank[i];
    }
    return null;
  }

  function axParseQuestion(text) {
    var lines = String(text || "").split("\n");
    var title = (lines[0] || "").replace(/^\d+\.\s*/, "").trim();
    var verdict = (lines[1] || "").trim();
    var promptLines = [];
    var picked = "";
    var expect = "";
    for (var i = 2; i < lines.length; i += 1) {
      if (lines[i].indexOf("模型答案：") === 0) picked = lines[i].slice("模型答案：".length).trim();
      else if (lines[i].indexOf("对照：") === 0) expect = lines[i].slice("对照：".length).trim();
      else promptLines.push(lines[i]);
    }
    var prompt = promptLines.join("\n").trim();
    var known = axKnownQuestion(title, prompt);
    return {
      title: known && known.title ? known.title : title,
      prompt: known && known.prompt ? known.prompt : prompt,
      dimension: known && known.dimension ? known.dimension : "",
      level: known && known.level ? known.level : "",
      options: known && Array.isArray(known.options) ? known.options : [],
      answer: known && known.answer ? known.answer : "",
      picked: picked === "没有回答" ? "" : picked,
      expect: expect || (known && known.expect ? known.expect : ""),
      ok: verdict === "对",
      missed: verdict === "未完成",
    };
  }

  function axCandyFromRuns(report) {
    var row = axRowOf(report, "candy");
    var summary = row && row.summary || "";
    if (!summary) return [];
    var runs = [];
    try {
      runs = JSON.parse(localStorage.getItem("veridrop.check.runs") || "[]");
    } catch (err) {
      runs = [];
    }
    if (!Array.isArray(runs)) return [];
    var finished = Number(report.finishedAt || report.started || 0);
    var best = null;
    var bestGap = Infinity;
    runs.forEach(function (run) {
      if (!run || !Array.isArray(run.items)) return;
      var item = null;
      for (var i = 0; i < run.items.length; i += 1) {
        if (run.items[i] && run.items[i].name === "糖果") item = run.items[i];
      }
      if (!item || !item.questions || !item.questions.length || !axSameSummary(summary, item.summary)) return;
      var at = Date.parse(run.at || "");
      var gap = finished && at ? Math.abs(finished - at) : 0;
      if (gap < bestGap) {
        best = item;
        bestGap = gap;
      }
    });
    if (!best) return [];
    return best.questions.map(axParseQuestion).filter(function (item) {
      return item && (item.title || item.prompt);
    });
  }

  function axCandyFromRaw(row) {
    var raw = row && row.raw ? String(row.raw) : "";
    if (raw.indexOf("【") < 0 || !G || typeof G.gradeCandyQuestion !== "function") return [];
    var truncated = raw.indexOf("…已截断") >= 0;
    var bits = raw.replace(/\n?…已截断$/, "").split("【").slice(1);
    var rows = [];
    bits.forEach(function (bit) {
      var cut = bit.indexOf("】");
      if (cut < 0) return;
      var known = axKnownQuestion(bit.slice(0, cut).trim(), "");
      var content = bit.slice(cut + 1).trim();
      if (!known || !content) return;
      var graded = G.gradeCandyQuestion(known, content);
      if (graded) rows.push(graded);
    });
    if (truncated && rows.length) rows.pop();
    return rows;
  }

  function axPelicanFromRaw(row) {
    var raw = row && row.raw ? String(row.raw) : "";
    if (!/<(svg|html)\b/i.test(raw) || raw.length < 40) return { html: "", note: "" };
    var truncated = raw.indexOf("…已截断") >= 0 || !/<\/(html|svg)>/i.test(raw);
    return {
      html: raw.replace(/\n?…已截断$/, ""),
      note: truncated ? "完整页面没有留在这台浏览器里，下面是当时记下的开头。" : "",
    };
  }

  function axPelicanFromRuns(report) {
    var row = axRowOf(report, "pelican");
    var summary = row && row.summary || "";
    if (!summary) return "";
    var runs = [];
    try {
      runs = JSON.parse(localStorage.getItem("veridrop.check.runs") || "[]");
    } catch (err) {
      runs = [];
    }
    if (!Array.isArray(runs)) return "";
    var found = "";
    runs.forEach(function (run) {
      if (!run || !Array.isArray(run.items) || !run.pelicanHtml) return;
      var item = null;
      for (var i = 0; i < run.items.length; i += 1) {
        if (run.items[i] && run.items[i].name === "鹈鹕骑车") item = run.items[i];
      }
      if (item && axSameSummary(summary, item.summary)) found = String(run.pelicanHtml);
    });
    return found;
  }

  function axFillReport(report) {
    var copy = {};
    Object.keys(report).forEach(function (key) { copy[key] = report[key]; });
    var hadRows = Array.isArray(report.candyRows) && report.candyRows.length > 0;
    var rows = [];
    if (!hadRows) {
      rows = axCandyFromRuns(report);
      if (!rows.length) rows = axCandyFromRaw(axRowOf(report, "candy"));
      if (rows.length) copy.candyRows = rows;
    }
    var savedPage = "";
    if (!copy.pelicanHtml) {
      savedPage = axPelicanFromRuns(report);
      if (savedPage) copy.pelicanHtml = savedPage;
      else {
        var found = axPelicanFromRaw(axRowOf(report, "pelican"));
        if (found.html) {
          copy.pelicanHtml = found.html;
          copy.pelicanNote = found.note;
        }
      }
    }
    if (report.id && !axRecoverPosted[report.id] && window.parent !== window && (rows.length || savedPage)) {
      axRecoverPosted[report.id] = true;
      window.parent.postMessage({
        type: "veridrop-all-recovered",
        id: report.id,
        rows: rows,
        html: savedPage,
      }, location.origin);
    }
    return copy;
  }

  function paintAllBoard(report, missing) {
    var board = $("allBoard");
    if (!board) return;
    if (allClockTimer) {
      clearInterval(allClockTimer);
      allClockTimer = 0;
    }
    allReportCache = report && report.suite === "all" ? axFillReport(report) : null;
    board.replaceChildren();
    if (missing) {
      board.appendChild(axEmpty("这台浏览器里没有这份三项结果", "三项结果只留在当时检测的那台浏览器里。链接本身不带记录，也不带 Key。"));
      return;
    }
    if (!allReportCache) {
      var empty = axEmpty("还没有三项一起测的结果", "到基础测试页填写地址和 Key，点「三项一起测」。基础每一项、糖果每一题、鹈鹕生成的页面会列在这里。单独的基础测试仍打开原来的报告。");
      axStart(empty);
      board.appendChild(empty);
      return;
    }
    board.appendChild(axHead(allReportCache));
    board.appendChild(axKpis(allReportCache));
    var split = axEl("div", "ax-split");
    split.appendChild(axCandy(allReportCache));
    split.appendChild(axPelican(allReportCache));
    board.appendChild(split);
    board.appendChild(axBasic(allReportCache));
    board.appendChild(axEl("p", "ax-foot", "密钥只发给你填写的接口。这一页的地址、检测历史和下载的 JSON 里都没有密钥。分数只来自这一轮实际返回，没有测成的项不补成分数。"));
    axFitSplit();
    if (allReportCache.running) {
      allClockTimer = setInterval(function () {
        if (!allReportCache || !allReportCache.running) return;
        var text = axDuration(Date.now() - Number(allReportCache.started || Date.now()));
        document.querySelectorAll("[data-ax-elapsed]").forEach(function (node) {
          node.textContent = text;
        });
      }, 1000);
    }
    setTimeout(function () {
      axFitSplit();
      if (window.parent !== window) window.parent.postMessage({ type: "veridrop-frame-fit" }, location.origin);
    }, 0);
  }

  function axFitSplit() {
    var split = document.querySelector("#allBoard .ax-split");
    if (!split) return;
    var candy = split.querySelector(".ax-card");
    var pelican = candy ? candy.nextElementSibling : null;
    if (!candy || !pelican || !pelican.classList.contains("ax-card")) return;
    var wide = window.matchMedia("(min-width: 901px)").matches && !!pelican.querySelector(".ax-stage");
    if (!wide) {
      if (candy.style.height) candy.style.height = "";
      return;
    }
    if (candy.style.height) {
      var qs = candy.querySelector(".ax-qs");
      var want = Math.round(pelican.getBoundingClientRect().height);
      if (qs && qs.scrollHeight > qs.clientHeight + 1 && want >= 80) {
        if (candy.style.height !== want + "px") candy.style.height = want + "px";
        return;
      }
    }
    candy.style.height = "";
    var height = Math.round(pelican.getBoundingClientRect().height);
    var candyH = Math.round(candy.getBoundingClientRect().height);
    var next = height >= 80 && candyH > height + 1 ? height + "px" : "";
    if (candy.style.height !== next) candy.style.height = next;
  }

  if (!window.__axSplitFit) {
    window.__axSplitFit = true;
    window.addEventListener("resize", function () {
      if (allReportCache) axFitSplit();
    });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function () {
        if (allReportCache) axFitSplit();
      }).observe(document.documentElement);
    }
    window.matchMedia("(max-width: 900px)").addEventListener("change", function () {
      if (allReportCache) axFitSplit();
    });
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
      let path = pathForView(name);
      if (isHiddenRunner()) {
        const run = new URLSearchParams(location.search).get("run");
        if (run) path += "&run=" + encodeURIComponent(run);
      }
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
        if (suite === "candy" || suite === "pelican") {
          runLocal(suite);
          return;
        }
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
    paintAllBoard(null);
    window.addEventListener("message", function (event) {
      if (event.origin !== location.origin) return;
      const data = event.data;
      if (!data || !data.type) return;
      if (data.type === "veridrop-all-report") {
        if (isHiddenRunner()) return;
        paintAllBoard(data.report, !!data.missing);
        return;
      }
      if (data.type === "veridrop-all-html") {
        if (isHiddenRunner() || !allReportCache || allReportCache.id !== data.id) return;
        if (typeof data.html !== "string" || !data.html) return;
        if (allReportCache.pelicanHtml && allReportCache.pelicanHtml.length >= data.html.length) return;
        paintAllBoard(Object.assign({}, allReportCache, { pelicanHtml: data.html }), false);
        return;
      }
      if (data.type === "veridrop-all-dump-request") {
        if (!isHiddenRunner()) return;
        var runId = "";
        try {
          runId = new URLSearchParams(location.search).get("run") || "";
        } catch (err) {
          runId = "";
        }
        tell({
          type: "veridrop-all-dump",
          id: runId,
          rows: plainCandyRows(state.candyRows || []),
          html: String(state.pelicanHtml || "").slice(0, 1200000),
        });
        return;
      }
      if (data.type === "veridrop-check-show") {
        if (isHiddenRunner()) return;
        const next = ["home", "detect", "basic", "candy", "pelican"].indexOf(data.view) >= 0 ? data.view : "home";
        const on = document.querySelector(".mc-view.is-on");
        if (on && on.getAttribute("data-view-panel") === next) return;
        showMcView(next, false);
        return;
      }
      if (data.type === "veridrop-replay") {
        replaySaved(data);
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
    if (inParentCheck() && viewFromLocation() === "detect") tell({ type: "veridrop-all-ready" });
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

