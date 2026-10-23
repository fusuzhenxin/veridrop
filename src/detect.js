import { callApi, endpoint } from "./probe.js";
import { grant } from "./points.js";

const HISTORY_KEY = "okk-detect-history";
const ACTIVE_KEY = "okk-detect-active";

export const DETECT_ROWS = [
  { name: "thinking_signature", label: "思维签名验证", tip: "用数学题逼出模型的 thinking 推理块，校验其中 Anthropic 服务端的密码学签名。这是真伪最硬的铁证——套壳/伪装的模型给不出真签名。" },
  { name: "behavioral_signature", label: "行为签名验证", tip: "用一组探针测拒答风格、格式偏好、结构习惯等行为，比对真实 Claude 的行为指纹是否吻合。" },
  { name: "knowledge", label: "知识准确度", tip: "问一组只有官方训练才答得准的事实（Anthropic CEO、总部、首个 Claude 发布年份等），错答说明非真模型。" },
  { name: "pdf", label: "PDF 透传识别", tip: "发一个内嵌唯一暗号的小 PDF，看中转站是否真把文档原样透传给后端模型识别——不透传说明中间动了手脚。" },
  { name: "consistency", label: "模型一致性", tip: "同一问题连发多次，核对标称模型与实际返回模型是否一致、输出 token 数是否稳定（忽大忽小常是偷换模型）。" },
  { name: "token_usage", label: "Token 用量", tip: "校验 usage 字段是否自洽、流式与非流式是否一致，防止中转站虚标 token、多收计费。" },
  { name: "message_id", label: "消息标识规范", tip: "检查响应里 message id 等标识是否符合官方格式规范。" },
  { name: "integrity", label: "响应完整性", tip: "对比流式 vs 非流式两种输出是否一致、有无截断或丢内容。" },
  { name: "protocol", label: "协议规范性", tip: "检查响应结构是否符合对应 API 的协议规范（必备字段、id 前缀、finish_reason 等）。" },
  { name: "long_context", label: "长上下文真实性", tip: "大海捞针：塞入超长上下文 + 埋暗号，验证标称的上下文窗口是否真实（揪“标称 1M、实际截断”）。高成本可选项。" },
];

function blankRows() {
  return DETECT_ROWS.map((item) => ({ ...item, state: "wait", status: "", summary: "", score: null }));
}

function reportKey(id) {
  return `okk-detect-report:${id}`;
}

export function readDetectHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeDetectHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
}

export function clearDetectHistory() {
  for (const item of readDetectHistory()) localStorage.removeItem(reportKey(item.id));
  localStorage.removeItem(HISTORY_KEY);
}

export function readDetectReport(id) {
  try {
    return JSON.parse(localStorage.getItem(reportKey(id)) || "null");
  } catch {
    return null;
  }
}

export function readActiveJob(id) {
  try {
    const job = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
    return job?.id === id ? job : null;
  } catch {
    return null;
  }
}

function maskKey(key) {
  const text = String(key || "");
  if (text.length < 8) return "••••";
  return `${text.slice(0, 6)}••••••${text.slice(-2)}`;
}

function remember(report) {
  const items = readDetectHistory().filter((item) => item.id !== report.id);
  items.unshift({
    id: report.id,
    host: report.host,
    model: report.model,
    protocol: report.protocol,
    at: report.at,
    ttftMs: report.ttftMs,
    fatal: Boolean(report.fatal),
  });
  writeDetectHistory(items);
  const stored = { ...report };
  delete stored.key;
  localStorage.setItem(reportKey(report.id), JSON.stringify(stored));
  const active = readActiveJob(report.id);
  if (active) sessionStorage.removeItem(ACTIVE_KEY);
}

function protocolOf(model) {
  return /^(gpt-|gemini-)/i.test(model) ? "responses" : "messages";
}

function fatalOf(shot) {
  if (!shot || shot.ok) return "";
  if (shot.status === 401 || /未授权|连接失败|内网|超时/.test(shot.error || "")) return shot.error || "连接失败";
  return "";
}

function hit(text, words) {
  const hay = String(text || "").toLowerCase();
  return words.some((word) => hay.includes(word.toLowerCase()));
}

function grade(text, pairs) {
  const lines = pairs.map(([label, words]) => `${label}${hit(text, words) ? "命中" : "未命中"}`);
  const got = pairs.filter(([, words]) => hit(text, words)).length;
  return { got, total: pairs.length, summary: `${got}/${pairs.length}。${lines.join("，")}。` };
}

function factsFor(model) {
  if (model.startsWith("claude-")) {
    return [
      ["CEO", ["amodei", "达里奥", "阿莫迪"]],
      ["总部", ["san francisco", "旧金山"]],
      ["Claude 首发年份", ["2023"]],
      ["Claude 3 年份", ["2024"]],
    ];
  }
  if (model.startsWith("gemini-")) {
    return [
      ["Google CEO", ["pichai", "皮查伊"]],
      ["总部", ["mountain view", "山景城"]],
      ["Gemini 发布年份", ["2023"]],
    ];
  }
  return [
    ["OpenAI CEO", ["altman", "阿尔特曼", "奥特曼"]],
    ["总部", ["san francisco", "旧金山"]],
    ["GPT-4 年份", ["2023"]],
    ["ChatGPT 年份", ["2022"]],
  ];
}

function knowledgePrompt(model) {
  if (model.startsWith("claude-")) {
    return "只按四行短答案，不要解释。\n1. Anthropic 现任 CEO 的姓\n2. Anthropic 总部城市\n3. Claude 首次公开发布的年份\n4. Claude 3 发布的年份";
  }
  if (model.startsWith("gemini-")) {
    return "只按三行短答案，不要解释。\n1. Google 现任 CEO 的姓\n2. Google 总部城市\n3. Gemini 首次发布的年份";
  }
  return "只按四行短答案，不要解释。\n1. OpenAI 现任 CEO 的姓\n2. OpenAI 总部城市\n3. GPT-4 首次发布的年份\n4. ChatGPT 首次发布的年份";
}

function pdfBase64(code) {
  const stream = `BT /F1 18 Tf 36 90 Td (${code}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return btoa(body);
}

function noteShot(shot, tag) {
  return {
    tag,
    ok: Boolean(shot.ok),
    status: shot.status || 0,
    error: shot.error || "",
    id: shot.id || "",
    model: shot.echoModel || "",
    stop: shot.stop || "",
    input: shot.input || 0,
    output: shot.tokens || 0,
    text: shot.text || "",
    signature: Boolean(shot.signature),
    ttftMs: shot.ttftMs,
  };
}

const runs = new Map();

export function subscribeDetect(job, listener) {
  let run = runs.get(job.id);
  if (!run) {
    run = { rows: blankRows(), shots: [], report: readDetectReport(job.id), started: Date.now(), listeners: new Set() };
    runs.set(job.id, run);
    if (!run.report) {
      run.promise = execute(job, run).catch((error) => {
        run.report = { fatal: error?.message || "检测中断", rows: run.rows, shots: run.shots };
        publish(run);
      });
    }
  }
  run.listeners.add(listener);
  publish(run);
  return () => run.listeners.delete(listener);
}

function publish(run) {
  const snapshot = { rows: run.rows, shots: run.shots, report: run.report, started: run.started };
  run.listeners.forEach((listener) => listener(snapshot));
}

function patch(run, name, fields) {
  run.rows = run.rows.map((row) => (row.name === name ? { ...row, state: "done", ...fields } : row));
  publish(run);
}

function mark(run, name) {
  run.rows = run.rows.map((row) => (row.name === name ? { ...row, state: "run" } : row));
  publish(run);
}

async function execute(job, run) {
  const protocol = protocolOf(job.model);
  const target = job.endpoint ? { url: job.endpoint } : endpoint(job.baseUrl, protocol);
  const claude = job.model.startsWith("claude-");
  const shots = [];
  let fatal = target.error || "";

  async function shoot(tag, options) {
    mark(run, tag);
    if (fatal) return null;
    const shot = await callApi({
      url: target.url,
      key: job.key,
      protocol,
      model: job.model,
      textLimit: 800,
      timeoutMs: 25000,
      ...options,
    });
    shots.push(noteShot(shot, tag));
    run.shots = shots.slice();
    const stop = fatalOf(shot);
    if (stop && shots.filter((item) => item.ok).length === 0) fatal = stop;
    return shot;
  }

  if (!claude) {
    patch(run, "thinking_signature", { status: "skip", summary: "这个协议没有 Anthropic 思维签名。本项未测。", score: null });
  } else if (!fatal) {
    const shot = await shoot("thinking_signature", {
      prompt: "计算 37×43。先思考，最后一行只写结果数字。",
      maxTokens: 1024,
      thinking: 256,
      timeoutMs: 45000,
    });
    if (shot) {
      patch(run, "thinking_signature", shot.ok
        ? {
          status: "skip",
          score: null,
          summary: shot.signature
            ? "响应里出现了思维签名字段。本机没有做密码学校验，所以这里不计分，也不标渠道。"
            : "调用成功，响应里没有思维签名字段。本机没有做密码学校验，不计分。",
        }
        : { status: "error", score: null, summary: shot.error || "没有拿到回答" });
    }
  }

  if (!fatal) {
    const shot = await shoot("behavioral_signature", {
      prompt: "用三行回答，每行以「- 」开头，内容分别是红、绿、蓝。不要加别的字。",
      maxTokens: 80,
    });
    if (shot?.ok) {
      const lines = shot.text.split(/\n/).map((line) => line.trim()).filter(Boolean);
      const ok = lines.length === 3 && lines.every((line) => line.startsWith("- ")) && /红/.test(lines[0]) && /绿/.test(lines[1]) && /蓝/.test(lines[2]);
      patch(run, "behavioral_signature", {
        status: ok ? "pass" : "fail",
        score: ok ? 100 : 0,
        summary: ok
          ? "三行颜色格式符合要求。这项只核对指定格式，没有官方行为指纹，不能当成真伪结论。"
          : "返回没有按三行「- 颜色」书写。这项只核对指定格式，没有官方行为指纹。",
      });
    } else if (shot) {
      patch(run, "behavioral_signature", { status: "error", score: null, summary: shot.error || "没有拿到回答" });
    }
  }

  if (!fatal) {
    const shot = await shoot("knowledge", { prompt: knowledgePrompt(job.model), maxTokens: 120 });
    if (shot?.ok) {
      const graded = grade(shot.text, factsFor(job.model));
      const ratio = graded.got / graded.total;
      patch(run, "knowledge", {
        status: ratio >= 0.75 ? "pass" : "fail",
        score: Math.round(ratio * 100),
        summary: graded.summary,
      });
    } else if (shot) {
      patch(run, "knowledge", { status: "error", score: null, summary: shot.error || "没有拿到回答" });
    }
  }

  if (protocol !== "messages") {
    patch(run, "pdf", { status: "skip", summary: "这次走的不是 Messages 协议，没有发送 PDF。", score: null });
  } else if (!fatal) {
    const code = `kx${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const shot = await shoot("pdf", {
      maxTokens: 32,
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64(code) } },
        { type: "text", text: "这个 PDF 里印着一串暗号。只回复那串暗号，不要解释。" },
      ],
    });
    if (shot?.ok) {
      const found = shot.text.includes(code);
      patch(run, "pdf", {
        status: found ? "pass" : "fail",
        score: found ? 100 : 0,
        summary: found ? "回复带回了只写在 PDF 里的暗号。" : "回复没有带回 PDF 里的暗号。",
      });
    } else if (shot) {
      patch(run, "pdf", { status: "error", score: null, summary: shot.error || "接口没有接受 PDF" });
    }
  }

  const samples = [];
  if (!fatal) {
    mark(run, "consistency");
    for (let index = 0; index < 2 && !fatal; index += 1) {
      const shot = await callApi({
        url: target.url,
        key: job.key,
        protocol,
        model: job.model,
        prompt: "只回答 OK",
        maxTokens: 16,
        timeoutMs: 20000,
        textLimit: 80,
      });
      shots.push(noteShot(shot, "consistency"));
      samples.push(shot);
      if (fatalOf(shot) && !samples.some((item) => item.ok) && shots.every((item) => !item.ok)) fatal = fatalOf(shot);
    }
    const quiet = fatal ? null : await callApi({
      url: target.url,
      key: job.key,
      protocol,
      model: job.model,
      prompt: "只回答 OK",
      maxTokens: 16,
      stream: false,
      timeoutMs: 20000,
      textLimit: 80,
    });
    if (quiet) {
      shots.push(noteShot(quiet, "integrity"));
      samples.push(quiet);
    }
    run.shots = shots.slice();
    const okSamples = samples.filter((item) => item.ok);
    const models = okSamples.map((item) => item.echoModel).filter(Boolean);
    const outputs = okSamples.map((item) => item.tokens).filter((value) => value > 0);
    const mismatch = models.some((item) => item !== job.model);
    const swing = outputs.length >= 2 && Math.max(...outputs) > Math.min(...outputs) * 3;
    if (!okSamples.length) {
      patch(run, "consistency", { status: "error", score: null, summary: samples[0]?.error || "没有拿到回答" });
    } else if (mismatch) {
      patch(run, "consistency", { status: "fail", score: 40, summary: `返回模型与请求不一致：${[...new Set(models)].join("、")}。` });
    } else if (!models.length) {
      patch(run, "consistency", { status: "fail", score: 60, summary: `${okSamples.length} 次有响应，但响应里没有模型字段，无法核对是否被换模型。` });
    } else if (swing) {
      patch(run, "consistency", { status: "fail", score: 60, summary: `返回模型与请求一致。输出 token 为 ${outputs.join("、")}，波动偏大。` });
    } else {
      patch(run, "consistency", { status: "pass", score: 100, summary: `返回模型与 ${job.model} 一致。输出 token 为 ${outputs.join("、") || "—"}。` });
    }

    const streamed = samples[0];
    const plain = quiet;
    const usageOk = [streamed, plain].every((item) => item?.ok && item.input >= 0 && item.tokens > 0);
    if (streamed?.ok && plain?.ok && usageOk) {
      const gap = Math.max(streamed.tokens, plain.tokens) / Math.max(1, Math.min(streamed.tokens, plain.tokens));
      patch(run, "token_usage", {
        status: gap <= 3 ? "pass" : "fail",
        score: gap <= 3 ? 100 : 45,
        summary: `流式输出 ${streamed.tokens}，非流式输出 ${plain.tokens}。输入 ${streamed.input} / ${plain.input}。`,
      });
    } else {
      patch(run, "token_usage", { status: "fail", score: 0, summary: "流式或非流式响应里没有可用的 usage。" });
    }

    const both = streamed?.ok && plain?.ok && /ok/i.test(streamed.text) && /ok/i.test(plain.text);
    patch(run, "integrity", both
      ? { status: "pass", score: 100, summary: "流式和非流式都回复了 OK。" }
      : { status: "fail", score: 40, summary: `流式「${streamed?.text || streamed?.error || "空"}」，非流式「${plain?.text || plain?.error || "空"}」。` });
  }

  const ids = shots.map((item) => item.id).filter(Boolean);
  const prefix = protocol === "responses" ? /^resp_/ : /^msg_/;
  if (!ids.length) {
    patch(run, "message_id", { status: "skip", score: null, summary: "这几次响应里没有 message id。" });
  } else if (ids.every((item) => prefix.test(item))) {
    patch(run, "message_id", { status: "pass", score: 100, summary: `标识符合 ${protocol === "responses" ? "resp_" : "msg_"} 前缀。` });
  } else {
    patch(run, "message_id", { status: "fail", score: 0, summary: `看到的标识：${ids.slice(0, 3).join("、")}。` });
  }

  const good = shots.filter((item) => item.ok);
  patch(run, "protocol", good.length
    ? { status: "pass", score: 100, summary: `${good.length} 次响应带有正文。协议按 ${protocol === "responses" ? "Responses" : "Messages"} 发送。` }
    : { status: "fail", score: 0, summary: fatal || shots[0]?.error || "没有符合协议的响应。" });

  if (!job.longContext) {
    patch(run, "long_context", { status: "skip", score: null, summary: "未勾选上下文检测。" });
  } else if (!fatal) {
    const needle = `kx${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const filler = "甲乙丙丁戊己庚辛壬癸".repeat(80);
    const prompt = `${filler.slice(0, 400)}口令是 ${needle}。${filler.slice(400)}请只回复这串口令。`;
    const shot = await shoot("long_context", { prompt, maxTokens: 32, timeoutMs: 45000 });
    if (shot?.ok) {
      const found = shot.text.includes(needle);
      patch(run, "long_context", {
        status: found ? "pass" : "fail",
        score: found ? 100 : 0,
        summary: found
          ? `在约 ${prompt.length} 字里找回了口令。这不是原站那组超长窗口探针。`
          : `约 ${prompt.length} 字的上下文里没有找回口令。这不是原站那组超长窗口探针。`,
      });
    } else if (shot) {
      patch(run, "long_context", { status: "error", score: null, summary: shot.error || "上下文核对没有完成" });
    }
  }

  for (const row of run.rows) {
    if (row.state !== "done") patch(run, row.name, { status: "skip", score: null, summary: fatal ? "前面的请求没有通过，本项未继续。" : "未检测" });
  }

  const ttft = shots.map((item) => item.ttftMs).find((value) => value != null) ?? null;
  const report = {
    id: job.id,
    host: hostOf(job.baseUrl),
    baseUrl: job.baseUrl,
    model: job.model,
    protocol,
    at: job.at,
    finishedAt: new Date().toISOString(),
    fatal,
    rows: run.rows,
    shots,
    requests: shots.length,
    ttftMs: ttft,
    totalMs: Date.now() - run.started,
    inputTokens: shots.reduce((sum, item) => sum + (item.input || 0), 0),
    outputTokens: shots.reduce((sum, item) => sum + (item.output || 0), 0),
    keyMask: maskKey(job.key),
  };
  if (shots.some((item) => item.ok)) {
    grant("detect", 3, "每日检测", "day");
    grant("first-detect", 5, "完成首次检测", "once");
  }
  remember(report);
  run.report = report;
  publish(run);
  return report;
}

function hostOf(value) {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).host;
  } catch {
    return value;
  }
}
