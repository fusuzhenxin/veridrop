(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CheckGrade = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // 21 and 29 are both published readings of the same candy puzzle.
  const CANDY_HITS = { 21: "21，社区里一种常见对照", 29: "29，按两种交叉组合都避开时的最坏情况" };

  const CANDY_PROMPT = [
    "在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。",
    "数量如下：",
    "苹果味：圆形 7 个，五角星形 7 个。",
    "桃子味：圆形 9 个，五角星形 6 个。",
    "西瓜味：圆形 8 个，五角星形 4 个。",
    "最少取出多少个，才能保证手中同时拥有不同形状的苹果味和桃子味？",
    "下面两种情况都算满足：圆形苹果味配五角星桃子味，或者圆形桃子味配五角星苹果味。",
    "可以先写推理。最后一行只写：答案：数字",
  ].join("\n");

  const PELICAN_PROMPT = "创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试";
  const LETTER_PROMPT = "单词 strawberry 里面有几个字母 r？只回答一个阿拉伯数字，不要解释。";
  const FORMAT_PROMPT = "只输出三行，不要别的字。\n第一行：A: pelican\n第二行：B: bicycle\n第三行：C: 2";
  const JSON_PROMPT =
    "只输出一个 JSON 对象，不要 Markdown。键必须是 animal、wheels、ok。animal 的值是 pelican，wheels 的值是数字 2，ok 的值是 true。";
  const CONNECT_PROMPT = "只回复 OK 两个字母。";
  const STOP_PROMPT = "从 1 数到 8，每行一个阿拉伯数字，不要别的字。";
  const MAX_PROMPT = "用中文连续写，不要分段，不要提前结束，题目是中转站导航。至少写满两百个字。";

  function result(status, summary, extra) {
    return Object.assign({ status: status, summary: summary }, extra || {});
  }

  function normalizeBase(raw) {
    let text = String(raw || "").trim();
    if (!text) throw new Error("先填写接口地址");
    if (!/^https?:\/\//i.test(text)) text = "https://" + text;
    let url;
    try {
      url = new URL(text);
    } catch (err) {
      throw new Error("接口地址无法解析");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只支持 http 或 https");
    if (url.username || url.password) throw new Error("地址里不要写密钥，请填到 Key 输入框");
    if (url.searchParams.has("key") || url.searchParams.has("api_key") || url.searchParams.has("token")) {
      throw new Error("地址里不要放 Key，请填到单独的输入框");
    }
    if (!url.hostname) throw new Error("接口地址缺少域名");
    let path = url.pathname.replace(/\/+$/, "");
    path = path.replace(/\/(chat\/completions|responses|messages|models)$/i, "");
    url.pathname = path || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }

  function claudeMessages(messages) {
    const out = [];
    (messages || []).forEach(function (message) {
      if (!message || message.role === "system") return;
      const role = message.role === "assistant" ? "assistant" : "user";
      let text = "";
      if (typeof message.content === "string") text = message.content;
      else if (Array.isArray(message.content)) {
        text = message.content
          .map(function (part) {
            return (part && (part.text || part.content)) || "";
          })
          .join("");
      }
      const prev = out[out.length - 1];
      if (prev && prev.role === role) {
        prev.content[0].text += "\n\n" + text;
        return;
      }
      out.push({ role: role, content: [{ type: "text", text: text }] });
    });
    if (!out.length || out[0].role !== "user") {
      out.unshift({ role: "user", content: [{ type: "text", text: "请按接下来的要求回答。" }] });
    }
    if (out[out.length - 1].role !== "user") {
      out.push({ role: "user", content: [{ type: "text", text: "请根据上面的内容继续。" }] });
    }
    return out;
  }

  function claudeSystem(messages) {
    return (messages || [])
      .filter(function (message) {
        return message && message.role === "system" && typeof message.content === "string";
      })
      .map(function (message) {
        return message.content;
      })
      .join("\n");
  }

  function gradeStructure(raw) {
    const json = raw || {};
    if (Array.isArray(json.choices) && json.choices[0]) return result("pass", "响应里有 choices、内容和用量这些兼容协议字段。");
    if (json.type === "message" || Array.isArray(json.content)) return result("pass", "响应是 Claude Messages 结构。");
    return result("fail", "响应里没有标准的 choices 或 content。");
  }

  function gradeProtocol(raw) {
    const json = raw || {};
    if (Array.isArray(json.choices)) return result("pass", "识别为 OpenAI 兼容协议。");
    if (json.type === "message" || Array.isArray(json.content)) return result("pass", "识别为 Claude Messages 协议。");
    return result("warn", "能连通，但协议形态不典型。");
  }

  function gradeUsage(reply) {
    const usage = (reply && reply.usage) || {};
    const content = String((reply && reply.content) || "");
    if (usage.prompt == null && usage.completion == null) return result("warn", "响应里没有用量字段。");
    if (usage.completion === 0 && content.length > 20) return result("fail", "有正文，但输出用量是 0。");
    return result("pass", "返回了输入和输出用量。");
  }

  function gradeReplay(idA, idB) {
    if (idA && idB && idA === idB) return result("fail", "两次响应编号相同，像是把同一次结果重放了。");
    if (idA && idB) return result("pass", "两次响应编号不同。");
    return result("warn", "响应里没有编号，看不出是不是重放。");
  }

  function gradeSystem(content, code) {
    const text = String(content || "").trim();
    if (text === code || text === "`" + code + "`") return result("pass", "系统指令里的词被原样执行了。");
    if (code && text.indexOf(code) >= 0 && text.length < code.length + 16) return result("pass", "系统指令生效了。");
    if (code && text.indexOf(code) >= 0) return result("warn", "词还在，但回复里多了别的内容。");
    return result("fail", "系统指令没有被执行，可能被中转拿掉了。");
  }

  function responseId(raw) {
    return (raw && (raw.id || raw.request_id)) || "";
  }

  function endpoints(base, protocol) {
    const root = /\/v1$/i.test(base) ? base : base + "/v1";
    const bare = base.replace(/\/v1$/i, "");
    const models = root + "/models";
    const modelsAlt = bare + "/models";
    return {
      root: root,
      models: models,
      modelsAlt: modelsAlt === models ? "" : modelsAlt,
      chat: protocol === "claude" ? root + "/messages" : root + "/chat/completions",
    };
  }

  function parseModelList(payload) {
    const rows = [];
    const push = function (id) {
      const text = String(id || "").trim();
      if (text && rows.indexOf(text) < 0) rows.push(text);
    };
    const data = payload && (Array.isArray(payload.data) ? payload.data : payload.models || payload);
    const list = Array.isArray(data) ? data : [];
    list.forEach(function (item) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") push(item.id || item.name || item.model);
    });
    rows.sort(function (a, b) {
      return a.localeCompare(b);
    });
    return rows;
  }

  function numberOrNull(value) {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function parseArgs(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : { raw: String(value) };
    } catch (err) {
      return { raw: String(value) };
    }
  }

  function readReply(payload) {
    const json = payload || {};
    const usage = json.usage || {};
    const reasoning = numberOrNull(
      (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ||
        (usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens)
    );
    if (Array.isArray(json.choices) && json.choices[0]) {
      const msg = json.choices[0].message || {};
      let content = "";
      if (typeof msg.content === "string") content = msg.content;
      else if (Array.isArray(msg.content)) {
        content = msg.content
          .map(function (part) {
            return (part && (part.text || part.content)) || "";
          })
          .join("");
      }
      const toolCalls = [];
      (msg.tool_calls || []).forEach(function (call) {
        const fn = (call && call.function) || {};
        toolCalls.push({ name: fn.name || "", arguments: parseArgs(fn.arguments) });
      });
      if (msg.function_call) {
        toolCalls.push({
          name: msg.function_call.name || "",
          arguments: parseArgs(msg.function_call.arguments),
        });
      }
      return {
        content: content || "",
        model: json.model || "",
        usage: {
          prompt: numberOrNull(usage.prompt_tokens),
          completion: numberOrNull(usage.completion_tokens),
          reasoning: reasoning,
        },
        toolCalls: toolCalls,
      };
    }
    if (Array.isArray(json.content)) {
      const texts = [];
      const toolCalls = [];
      json.content.forEach(function (block) {
        if (!block) return;
        if (block.type === "text") texts.push(block.text || "");
        if (block.type === "tool_use") toolCalls.push({ name: block.name || "", arguments: block.input || {} });
      });
      return {
        content: texts.join(""),
        model: json.model || "",
        usage: {
          prompt: numberOrNull(usage.input_tokens),
          completion: numberOrNull(usage.output_tokens),
          reasoning: reasoning,
        },
        toolCalls: toolCalls,
      };
    }
    if (typeof json.output_text === "string") {
      return {
        content: json.output_text,
        model: json.model || "",
        usage: {
          prompt: numberOrNull(usage.input_tokens),
          completion: numberOrNull(usage.output_tokens),
          reasoning: reasoning,
        },
        toolCalls: [],
      };
    }
    return {
      content: "",
      model: json.model || "",
      usage: { prompt: null, completion: null, reasoning: reasoning },
      toolCalls: [],
    };
  }

  function stripWrap(text) {
    return String(text || "")
      .trim()
      .replace(/^["'`「」]+|["'`「」]+$/g, "")
      .trim();
  }

  function gradeEcho(content, nonce) {
    const text = stripWrap(content);
    if (text === nonce) return result("pass", "口令原样回来了。");
    if (nonce && text.indexOf(nonce) >= 0) return result("warn", "口令在回复里，旁边还有别的字。");
    return result("fail", "口令没有原样回来。");
  }

  function gradeCopy(content, digits) {
    const flat = String(content || "").replace(/\s+/g, "");
    if (flat === digits) return result("pass", "数字原样抄回来了。");
    if (digits && flat.indexOf(digits) >= 0) return result("warn", "数字都在，但回复里还有别的字符。");
    return result("fail", "抄写和原文不一致。");
  }

  function gradeHistory(content, code) {
    const text = stripWrap(content);
    if (text === code) return result("pass", "同一条请求里的代号还在。");
    if (code && text.indexOf(code) >= 0) return result("warn", "代号还在，但回复里多了别的内容。");
    return result("fail", "上下文里的代号丢了。");
  }

  function gradeStop(content) {
    const tokens = String(content || "")
      .trim()
      .split(/[\s,，、]+/)
      .filter(Boolean);
    const nums = tokens
      .filter(function (token) {
        return /^\d+$/.test(token);
      })
      .map(Number);
    const has5 = nums.indexOf(5) >= 0;
    const hasEarly = nums.some(function (n) {
      return n >= 1 && n <= 4;
    });
    if (hasEarly && !has5) return result("pass", "数到 5 之前停了。");
    if (has5) return result("fail", "回复里出现了 5，停止词没有挡住。");
    return result("fail", "没有看到按行给出的数字。");
  }

  function gradeTools(reply, account) {
    const calls = (reply && reply.toolCalls) || [];
    const hit = calls.find(function (call) {
      return String(call.name || "").toLowerCase() === "get_balance";
    });
    const content = String((reply && reply.content) || "");
    if (!hit) {
      if (account && content.indexOf(account) >= 0) return result("fail", "没有调用工具，直接用文字回答了。");
      return result("fail", "没有调用 get_balance。");
    }
    const args = hit.arguments || {};
    const raw = typeof args.raw === "string" ? args.raw : JSON.stringify(args);
    if (account && raw.indexOf(account) >= 0) return result("pass", "调用了 get_balance，并且带上了指定账户。");
    return result("warn", "调用了 get_balance，但参数里没有指定账户。");
  }

  function gradeNeedle(content, code) {
    const text = stripWrap(content);
    if (text === code) return result("pass", "暗号原样回来了。");
    if (code && text.indexOf(code) >= 0 && text.length < code.length + 24) return result("pass", "暗号在回复里。");
    if (code && text.indexOf(code) >= 0) return result("warn", "暗号在，但回复里还有不少别的内容。");
    return result("fail", "长文里的暗号没有回来。输入可能被截断，或者模型没看完。");
  }

  function gradeMaxTokens(reply) {
    const text = String((reply && reply.content) || "");
    const usage = (reply && reply.usage) || {};
    if (usage.reasoning && text.trim().length < 24) {
      return result("warn", "思考 token 用掉了上限，正文很短，看不出长度有没有被放宽。推理 token：" + usage.reasoning + "。");
    }
    if (text.trim().length > 180) return result("fail", "正文明显长过设定的 16 token 上限。");
    if (usage.completion != null && usage.completion > 48 && text.trim().length > 80) {
      return result("fail", "用量显示输出很长，上限可能没生效。");
    }
    return result("pass", "回复停在很短的范围内。");
  }

  function gradeFormat(content) {
    const lines = String(content || "")
      .trim()
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim().replace(/：/g, ":");
      })
      .filter(Boolean);
    const ok =
      lines.length === 3 &&
      /^A:\s*pelican$/i.test(lines[0]) &&
      /^B:\s*bicycle$/i.test(lines[1]) &&
      /^C:\s*2$/.test(lines[2]);
    if (ok) return result("pass", "三行格式和内容都对。");
    return result("fail", "不是规定的三行。");
  }

  function extractJsonObject(text) {
    const fence = String(text || "").match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fence ? fence[1] : String(text || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (err) {
      return null;
    }
  }

  function gradeJson(content) {
    const obj = extractJsonObject(content);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return result("fail", "没有解析出 JSON 对象。");
    const animal = String(obj.animal || "").toLowerCase();
    const wheels = Number(obj.wheels);
    if (animal === "pelican" && wheels === 2 && obj.ok === true) return result("pass", "JSON 的三个字段都对。");
    return result("fail", "JSON 能解析，但字段和规定不一致。");
  }

  function gradeLetters(content) {
    const text = String(content || "").trim();
    const nums = text.match(/\d+/g) || [];
    if (text === "三") return result("pass", "回答是三。");
    if (nums.length === 1 && nums[0] === "3") return result("pass", "回答是 3。");
    return result("fail", "没有单独回答 3。strawberry 里有 3 个字母 r。");
  }

  function candyNumber(text) {
    const labeled = String(text || "").match(/答案\s*[:：]\s*(\d+)/);
    if (labeled) return Number(labeled[1]);
    const lines = String(text || "")
      .trim()
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    const last = lines[lines.length - 1] || "";
    if (last.length <= 32) {
      const end = last.match(/(\d+)\s*$/);
      if (end) return Number(end[1]);
    }
    return null;
  }

  function shortPick(text) {
    const lines = String(text || "")
      .trim()
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    const line = lines[lines.length - 1] || "";
    if (!line) return "没有回答";
    return line.length > 48 ? line.slice(0, 48) + "…" : line;
  }

  function exactWordNumber(text, words) {
    const n = candyNumber(text);
    if (n != null) return n;
    const line = shortPick(text)
      .replace(/^答案\s*[:：]\s*/, "")
      .replace(/[。．.\s]/g, "");
    for (let i = 0; i < words.length; i += 1) {
      if (line === words[i][0]) return words[i][1];
    }
    return null;
  }

  const CANDY_QUESTIONS = [
    {
      id: "bag",
      title: "三种口味的袋子",
      dimension: "约束求解",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 2500,
      prompt: "黑袋里有三种口味的糖，形状分圆形和五角星，靠手感可以分辨。数量是：苹果圆形 7、五角星 7；桃子圆形 9、五角星 6；西瓜圆形 8、五角星 4。至少取出多少颗，才能保证同时拥有「圆形苹果配五角星桃子」或「五角星苹果配圆形桃子」？",
      options: [
        { key: "A", text: "15 颗" },
        { key: "B", text: "21 颗" },
        { key: "C", text: "29 颗" },
        { key: "D", text: "33 颗" },
      ],
    },
    {
      id: "pen",
      title: "笔和笔记本",
      dimension: "迷惑辨析",
      level: "中等",
      answer: "D",
      expect: "D",
      max: 800,
      prompt: "一支笔和一个笔记本一共 11 元，笔比笔记本贵 10 元。笔记本多少钱？",
      options: [
        { key: "A", text: "5.5 元" },
        { key: "B", text: "1 元" },
        { key: "C", text: "10 元" },
        { key: "D", text: "0.5 元" },
      ],
    },
    {
      id: "lily",
      title: "睡莲铺湖",
      dimension: "迷惑辨析",
      level: "中等",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "湖面睡莲面积每天翻一倍，第 48 天恰好铺满湖面。铺满一半是哪一天？",
      options: [
        { key: "A", text: "第 24 天" },
        { key: "B", text: "第 47 天" },
        { key: "C", text: "第 48 天" },
        { key: "D", text: "第 46 天" },
      ],
    },
    {
      id: "sheep",
      title: "牧场的羊",
      dimension: "约束求解",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "牧场有一群羊：除了 2 只以外全是白羊，除了 2 只以外全是黑羊，除了 2 只以外全是花羊。一共有几只羊？",
      options: [
        { key: "A", text: "2 只" },
        { key: "B", text: "3 只" },
        { key: "C", text: "4 只" },
        { key: "D", text: "6 只" },
      ],
    },
    {
      id: "snail",
      title: "蜗牛出井",
      dimension: "数量关系",
      level: "中等",
      answer: "A",
      expect: "A",
      max: 800,
      prompt: "井深 30 米。蜗牛白天向上爬 3 米，夜里滑下 2 米。它第几天能爬出井口？",
      options: [
        { key: "A", text: "28 天" },
        { key: "B", text: "30 天" },
        { key: "C", text: "27 天" },
        { key: "D", text: "15 天" },
      ],
    },
    {
      id: "clock",
      title: "指针重合",
      dimension: "数量关系",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "3 点整之后，时针和分针下一次重合，大约过了多久？",
      options: [
        { key: "A", text: "15 分钟" },
        { key: "B", text: "约 16.4 分钟" },
        { key: "C", text: "18 分钟" },
        { key: "D", text: "20 分钟" },
      ],
    },
    {
      id: "rope",
      title: "烧绳子",
      dimension: "演绎",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "两根绳子烧完都刚好 1 小时，但燃烧不均匀。只有火柴，怎样烧出 45 分钟？",
      options: [
        { key: "A", text: "两根一起从一头点燃，烧完就是 45 分钟" },
        { key: "B", text: "第一根两头点、第二根一头点；第一根烧完时，把第二根另一头也点上" },
        { key: "C", text: "先把一根烧到看起来一半，再点第二根" },
        { key: "D", text: "不均匀的绳子没法量出 45 分钟" },
      ],
    },
    {
      id: "knight",
      title: "骑士和无赖",
      dimension: "演绎",
      level: "中等",
      answer: "C",
      expect: "C",
      max: 800,
      prompt: "骑士永远说真话，无赖永远说假话。甲说：「我们两个都是无赖。」甲和乙分别是什么人？",
      options: [
        { key: "A", text: "甲骑士，乙骑士" },
        { key: "B", text: "甲骑士，乙无赖" },
        { key: "C", text: "甲无赖，乙骑士" },
        { key: "D", text: "甲无赖，乙无赖" },
      ],
    },
    {
      id: "speed",
      title: "平均时速",
      dimension: "迷惑辨析",
      level: "中等",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "去程 60 公里，时速 30 公里；回程同一条路，时速 60 公里。全程平均时速是多少？",
      options: [
        { key: "A", text: "45 公里/小时" },
        { key: "B", text: "40 公里/小时" },
        { key: "C", text: "50 公里/小时" },
        { key: "D", text: "36 公里/小时" },
      ],
    },
    {
      id: "clubs",
      title: "兴趣组",
      dimension: "数量关系",
      level: "中等",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "班里 30 人，18 人参加数学兴趣组，15 人参加英语兴趣组，4 人两个都不参加。两个都参加的有几人？",
      options: [
        { key: "A", text: "3 人" },
        { key: "B", text: "7 人" },
        { key: "C", text: "11 人" },
        { key: "D", text: "4 人" },
      ],
    },
    {
      id: "farm",
      title: "鸡兔同笼",
      dimension: "数量关系",
      level: "中等",
      answer: "A",
      expect: "A",
      max: 800,
      prompt: "鸡和兔一共 35 个头、94 只脚。鸡有几只，兔有几只？",
      options: [
        { key: "A", text: "鸡 23 只，兔 12 只" },
        { key: "B", text: "鸡 12 只，兔 23 只" },
        { key: "C", text: "鸡 17 只，兔 18 只" },
        { key: "D", text: "鸡 20 只，兔 15 只" },
      ],
    },
    {
      id: "pool",
      title: "注水放水",
      dimension: "数量关系",
      level: "中等",
      answer: "C",
      expect: "C",
      max: 800,
      prompt: "一根管子 3 小时注满一池水，另一根管子 6 小时放完一池水。两根同时打开，多久注满？",
      options: [
        { key: "A", text: "2 小时" },
        { key: "B", text: "4.5 小时" },
        { key: "C", text: "6 小时" },
        { key: "D", text: "9 小时" },
      ],
    },
    {
      id: "age",
      title: "父子年龄",
      dimension: "数量关系",
      level: "中等",
      answer: "C",
      expect: "C",
      max: 800,
      prompt: "父亲今年 36 岁，儿子 6 岁。再过几年，父亲的年龄是儿子的 2 倍？",
      options: [
        { key: "A", text: "12 年" },
        { key: "B", text: "18 年" },
        { key: "C", text: "24 年" },
        { key: "D", text: "30 年" },
      ],
    },
    {
      id: "bridge",
      title: "四人过桥",
      dimension: "约束求解",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "四人过桥分别需要 1、2、5、10 分钟。桥上同时最多两人，只有一盏灯，过桥必须带灯，灯要有人送回来。最短要多久？",
      options: [
        { key: "A", text: "15 分钟" },
        { key: "B", text: "17 分钟" },
        { key: "C", text: "19 分钟" },
        { key: "D", text: "21 分钟" },
      ],
    },
    {
      id: "nine",
      title: "九个球",
      dimension: "约束求解",
      level: "中等",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "9 个球里有 8 个一样重，另 1 个更重。天平没有砝码。最少称几次，能找出更重的那个？",
      options: [
        { key: "A", text: "1 次" },
        { key: "B", text: "2 次" },
        { key: "C", text: "3 次" },
        { key: "D", text: "4 次" },
      ],
    },
    {
      id: "liar",
      title: "谁说真话",
      dimension: "演绎",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "甲说：「乙在说谎。」乙说：「丙在说谎。」丙说：「甲和乙都在说谎。」三人里只有一人说真话。谁说真话？",
      options: [
        { key: "A", text: "甲" },
        { key: "B", text: "乙" },
        { key: "C", text: "丙" },
        { key: "D", text: "无法确定" },
      ],
    },
    {
      id: "discount",
      title: "先涨后降",
      dimension: "迷惑辨析",
      level: "中等",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "一件商品先涨价 10%，再降价 10%。现价和原价比怎么样？",
      options: [
        { key: "A", text: "和原价一样" },
        { key: "B", text: "比原价便宜 1%" },
        { key: "C", text: "比原价贵 1%" },
        { key: "D", text: "比原价便宜 10%" },
      ],
    },
    {
      id: "mix",
      title: "咖啡和牛奶",
      dimension: "迷惑辨析",
      level: "困难",
      answer: "C",
      expect: "C",
      max: 800,
      prompt: "一杯咖啡和一杯牛奶一样多。舀一勺咖啡倒进牛奶并搅匀，再舀一勺混合液倒回咖啡。哪边混进的另一种液体更多？",
      options: [
        { key: "A", text: "咖啡里的牛奶更多" },
        { key: "B", text: "牛奶里的咖啡更多" },
        { key: "C", text: "一样多" },
        { key: "D", text: "要看勺子大小才能比" },
      ],
    },
    {
      id: "hands",
      title: "握手次数",
      dimension: "约束求解",
      level: "困难",
      answer: "B",
      expect: "B",
      max: 800,
      prompt: "5 对夫妻参加晚会。谁也不和自己握手，也不和自己的配偶握手。甲问了其余 9 个人各握过几次手，答案是 0 到 8 各一次。甲的配偶握了几次？",
      options: [
        { key: "A", text: "0 次" },
        { key: "B", text: "4 次" },
        { key: "C", text: "8 次" },
        { key: "D", text: "5 次" },
      ],
    },
    {
      id: "doors",
      title: "三扇门",
      dimension: "迷惑辨析",
      level: "中等",
      answer: "C",
      expect: "C",
      max: 800,
      prompt: "三扇门后面一扇是车、两扇是羊。你先选了 1 号。主持人打开另一扇有羊的门。如果改选剩下那扇，得到车的概率是多少？",
      options: [
        { key: "A", text: "1/2" },
        { key: "B", text: "1/3" },
        { key: "C", text: "2/3" },
        { key: "D", text: "1/6" },
      ],
    },
  ];

  function matchChoice(text, options) {
    const raw = String(text || "");
    const labeled = raw.match(/答案\s*[:：]\s*([A-D])/i);
    if (labeled) return labeled[1].toUpperCase();
    const lines = raw
      .trim()
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    const last = lines[lines.length - 1] || raw.trim();
    const head = last.match(/^(?:选项\s*)?([A-D])(?:\s*[.．、:：].*)?$/i);
    if (head && last.length <= 48) return head[1].toUpperCase();
    const compact = raw.replace(/\s/g, "");
    const hits = options.filter(function (opt) {
      const body = String(opt.text || "").replace(/\s/g, "");
      return body && compact.indexOf(body) >= 0;
    });
    if (hits.length === 1) return hits[0].key;
    return "";
  }

  function gradeCandyQuestion(question, text) {
    if (!question.options) {
      const judged = question.check(text);
      return {
        title: question.title,
        prompt: question.prompt,
        picked: judged.picked,
        expect: question.expect,
        ok: judged.ok,
      };
    }
    const key = matchChoice(text, question.options);
    const chosen = question.options.filter(function (opt) {
      return opt.key === key;
    })[0];
    return {
      title: question.title,
      prompt: question.prompt,
      dimension: question.dimension,
      level: question.level,
      options: question.options,
      picked: key ? key + " " + (chosen ? chosen.text : "") : shortPick(text),
      pickedKey: key,
      answer: question.answer,
      expect: question.expect,
      ok: key === question.answer,
    };
  }

  function gradeCandy(content, reply) {
    const n = candyNumber(content);
    const reasoning = reply && reply.usage && reply.usage.reasoning;
    const reasonText = reasoning != null ? " 推理 token：" + reasoning + "。" : "";
    if (CANDY_HITS[n]) return result("pass", "最终数字是 " + CANDY_HITS[n] + "。" + reasonText);
    if (n == null) return result("fail", "没有找到单独的最终数字。" + reasonText);
    return result("fail", "最终数字是 " + n + "，常见对照是 21 或 29。" + reasonText);
  }

  function gradeConsistency(models, requested) {
    const seen = (Array.isArray(models) ? models : []).map(function (item) {
      return String(item || "").trim();
    });
    const present = seen.filter(Boolean);
    const unique = [];
    present.forEach(function (name) {
      if (!unique.some(function (item) { return item.toLowerCase() === name.toLowerCase(); })) unique.push(name);
    });
    const asked = String(requested || "").trim();
    if (!present.length) return result("warn", "这几次响应里没有 model 字段，对不上是不是同一个模型。");
    if (unique.length > 1) return result("fail", "几次返回的模型名不一致：" + unique.join("、") + "。");
    const name = unique[0];
    if (present.length < seen.length) return result("warn", "返回过 " + name + "，但有一次响应没有 model 字段。");
    if (asked && name.toLowerCase() === asked.toLowerCase()) return result("pass", "返回模型与所选一致：" + name + "。");
    return result("warn", "几次返回的都是 " + name + "，和所选 " + asked + " 不同。");
  }

  function gradeConnect(reply, requested) {
    const content = String((reply && reply.content) || "").trim();
    const returned = String((reply && reply.model) || "").trim();
    const asked = String(requested || "").trim();
    if (!content && !(reply && reply.toolCalls && reply.toolCalls.length)) {
      return result("warn", "请求有响应，但没有正文。");
    }
    if (!returned) return result("warn", "有回复。响应里没有 model 字段。");
    if (returned.toLowerCase() === asked.toLowerCase()) return result("pass", "有回复。返回的模型名和所选一致。");
    return result("warn", "有回复。返回的模型名是 " + returned + "。");
  }

  function fencedBlocks(raw) {
    const blocks = [];
    const re = /```([a-z0-9-]*)\s*([\s\S]*?)```/gi;
    let match;
    while ((match = re.exec(String(raw || "")))) {
      blocks.push({ lang: (match[1] || "").toLowerCase(), body: match[2] });
    }
    return blocks;
  }

  function svgFrom(text) {
    const raw = String(text || "");
    const start = raw.search(/<svg\b/i);
    const end = raw.toLowerCase().lastIndexOf("</svg>");
    if (start < 0 || end < start) return "";
    return raw.slice(start, end + "</svg>".length).trim();
  }

  function extractSvg(text) {
    const blocks = fencedBlocks(text);
    for (let i = 0; i < blocks.length; i += 1) {
      const svg = svgFrom(blocks[i].body);
      if (svg) return svg;
    }
    return svgFrom(text);
  }

  function documentFrom(body) {
    const text = String(body || "");
    const docStart = text.search(/<!doctype html|<html\b/i);
    if (docStart >= 0) {
      const end = text.toLowerCase().lastIndexOf("</html>");
      if (end >= docStart) return text.slice(docStart, end + "</html>".length).trim();
      return text.slice(docStart).trim();
    }
    const svg = svgFrom(text);
    if (!svg) return "";
    return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0;background:#fff\">" + svg + "</body></html>";
  }

  function extractHtml(text) {
    const raw = String(text || "");
    const ordered = [];
    fencedBlocks(raw).forEach(function (block) {
      if (block.lang === "html" || /<!doctype html|<html\b|<svg\b/i.test(block.body)) ordered.push(block.body);
    });
    ordered.push(raw);
    for (let i = 0; i < ordered.length; i += 1) {
      const doc = documentFrom(ordered[i]);
      if (doc) return doc;
    }
    return "";
  }

  function takeStreamText(json) {
    if (!json || typeof json !== "object") return "";
    if (json.type === "content_block_delta" && json.delta && typeof json.delta.text === "string") return json.delta.text;
    const choice = Array.isArray(json.choices) ? json.choices[0] : null;
    if (!choice) return "";
    const delta = choice.delta || {};
    if (typeof delta.content === "string") return delta.content;
    if (Array.isArray(delta.content)) {
      return delta.content
        .map(function (part) {
          return (part && part.text) || "";
        })
        .join("");
    }
    if (choice.message && typeof choice.message.content === "string") return choice.message.content;
    if (typeof choice.text === "string") return choice.text;
    return "";
  }

  function hasMotion(html) {
    return /<animate\b|<animateTransform\b|<animateMotion\b|@keyframes|animation\s*:|requestAnimationFrame|setInterval\s*\(/i.test(html);
  }

  function hasSpeedControl(html) {
    return /type\s*=\s*["']range["']|速度|变速|playbackRate/i.test(html);
  }

  function gradePelican(content) {
    const html = extractHtml(content);
    if (!html) return result("fail", "回复里没有可打开的 HTML。");
    const extra = { html: html, svg: extractSvg(html) };
    if (!/<svg\b/i.test(html)) return result("warn", "拿到了 HTML，但里面没有 SVG。可以打开或下载，再看是不是鹈鹕骑车。", extra);
    if (hasMotion(html)) {
      const speed = hasSpeedControl(html) ? "模型自己加了速度控制，提示词里没有这一项。" : "";
      return result("pass", "拿到了会动的 HTML。下面可以直接看，也可以下载。像不像、脚有没有踩上踏板，要看画面。" + speed, extra);
    }
    return result("warn", "有 HTML 画面，但没有看到动画。可以打开或下载。", extra);
  }

  function buildNeedlePrompt(code) {
    const sentence = "中转站目录只做对照，充值前请看对方页面。";
    const chunks = [];
    for (let i = 0; i < 220; i += 1) chunks.push(sentence);
    chunks.splice(110, 0, "暗号是 " + code + "。");
    return "阅读下面文字，找出暗号。只输出暗号本身，不要解释。\n\n" + chunks.join("") + "\n\n暗号是什么？";
  }

  function present(text) {
    const body = String(text || "").trim();
    if (body.length >= 240) return body;
    return [
      "这是一次正常的阅读和作答，请看完题目再回答。",
      "背景是对照这个接口会不会原样返回内容、会不会丢掉上下文，以及能不能按要求完成一道明确的小题。",
      "不要因为题目短就拒绝，也不要输出开场白。只完成最后这一项。",
      "",
      body,
    ].join("\n");
  }

  function echoPrompt(nonce) {
    return "把下面这一行原样抄回来。不要加引号，不要解释，不要换行。\n" + nonce;
  }

  function copyPrompt(digits) {
    return "把下面这串数字原样抄回来，不要空格，不要解释。\n" + digits;
  }

  function historyMessages(code) {
    return [
      { role: "user", content: present("请记住这个代号，后面还会再问一次：" + code + "。这一轮只回复：已记下。") },
      { role: "assistant", content: "已记下。代号是 " + code + "。" },
      { role: "user", content: present("请只回答刚才那个代号本身，不要加别的字。") },
    ];
  }

  function looksUnsupported(message, hints) {
    const raw = String(message || "");
    const folded = raw.toLowerCase();
    const list = Array.isArray(hints) ? hints : [hints];
    const mentioned = list.some(function (hint) {
      const word = String(hint || "");
      return word && (folded.indexOf(word.toLowerCase()) >= 0 || raw.indexOf(word) >= 0);
    });
    if (!mentioned) return false;
    return (
      /not support|unsupported|unrecognized|unknown parameter|invalid parameter|extra field|not allowed/.test(folded) ||
      /不支持|暂不支持|未知参数|无法识别/.test(raw)
    );
  }

  function errorText(json, text, status) {
    if (json && json.error) {
      if (typeof json.error === "string") return json.error;
      if (json.error.message) return String(json.error.message);
    }
    if (json && json.message) return String(json.message);
    const slice = String(text || "").replace(/\s+/g, " ").trim().slice(0, 280);
    return slice || "HTTP " + status;
  }

  return {
    CANDY_PROMPT: CANDY_PROMPT,
    CANDY_QUESTIONS: CANDY_QUESTIONS,
    gradeCandyQuestion: gradeCandyQuestion,
    PELICAN_PROMPT: PELICAN_PROMPT,
    LETTER_PROMPT: LETTER_PROMPT,
    FORMAT_PROMPT: FORMAT_PROMPT,
    JSON_PROMPT: JSON_PROMPT,
    CONNECT_PROMPT: CONNECT_PROMPT,
    STOP_PROMPT: STOP_PROMPT,
    MAX_PROMPT: MAX_PROMPT,
    normalizeBase: normalizeBase,
    endpoints: endpoints,
    claudeMessages: claudeMessages,
    claudeSystem: claudeSystem,
    gradeStructure: gradeStructure,
    gradeProtocol: gradeProtocol,
    gradeUsage: gradeUsage,
    gradeReplay: gradeReplay,
    gradeSystem: gradeSystem,
    responseId: responseId,
    parseModelList: parseModelList,
    readReply: readReply,
    gradeEcho: gradeEcho,
    gradeCopy: gradeCopy,
    gradeHistory: gradeHistory,
    gradeStop: gradeStop,
    gradeTools: gradeTools,
    gradeNeedle: gradeNeedle,
    gradeMaxTokens: gradeMaxTokens,
    gradeFormat: gradeFormat,
    gradeJson: gradeJson,
    gradeLetters: gradeLetters,
    gradeCandy: gradeCandy,
    gradeConnect: gradeConnect,
    gradeConsistency: gradeConsistency,
    gradePelican: gradePelican,
    extractSvg: extractSvg,
    takeStreamText: takeStreamText,
    buildNeedlePrompt: buildNeedlePrompt,
    present: present,
    echoPrompt: echoPrompt,
    copyPrompt: copyPrompt,
    historyMessages: historyMessages,
    looksUnsupported: looksUnsupported,
    errorText: errorText,
  };
});
