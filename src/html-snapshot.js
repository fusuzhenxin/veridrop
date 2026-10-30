import { findStation, modelTotal, stationTotal, stations } from "./data.js";
import modelRows from "./model-rows.json";
import { CAT_SEO, CHECK_PAGES, FAMILY_MODEL_IDS, MODEL_SEO, OFFICIAL_SEO, matchesCategory } from "./verd-meta.js";

function clip(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

function describe(pathname) {
  if (pathname === "/") return `发现好用的 AI 中转站。现收录 ${stationTotal} 家站点、${modelTotal} 个模型，对照在线率、延迟、支付和公开价格。数据来自目录探测和公开信息，不代收充值，也不证明官方原厂。`;
  if (pathname === "/reputation") return "中转站投票排行。赞成和反对记在接口里，每人每站一票，净票高的排前面。点评同样公开，其他人也能看到。";
  if (pathname === "/points") return "签到、投票和点评记在账户里，其他人能看到投票和点评。检测记录只留在这台浏览器。兑换页目前没有奖品。";
  if (pathname === "/help") return "说明目录探测、公开价格、投票和评价各自怎么来。纯度、单模型延迟和单模型在线率没有探测，页面留空。";
  if (pathname === "/agents") return "给 Agent 的说明。列出 llms.txt、stations.md 和 methodology.md。字段以目录探测、公开价格和账户里的投票、点评为准。";
  if (pathname === "/list") return "AI 中转站排行榜。可按在线率、延迟、最低充值、支付方式、发票和原有分类筛选。展示的是目录探测结果，不构成充值建议。";
  if (pathname === "/model") return "AI 模型中转站排行。对照 Claude、GPT、Gemini、DeepSeek 等模型的最低中转价、上下文、提供站点数、智商分和发布时间。价格来自公开分组，以对方控制台为准。";
  if (pathname.startsWith("/site/")) {
    const station = findStation(pathname.split("/")[2] || "");
    if (!station) return "没有找到这个中转站。地址可能已变更，可回到排行榜按名称搜索。";
    const lead = `${station.name} 中转站详情。目录在线率 ${station.uptime ?? "—"}%，平均延迟 ${station.latency ?? "—"} 秒。`;
    const blurb = plain(station.blurb);
    const text = blurb ? `${lead}${blurb}` : lead;
    return text.length <= 150 ? text : clip(lead);
  }
  if (pathname.startsWith("/cat/")) return CAT_SEO[pathname.split("/")[2] || ""]?.desc || "这个分类下的 API 中转站。";
  if (pathname.startsWith("/official/")) return OFFICIAL_SEO[pathname.split("/")[2] || ""]?.desc || "官方状态对照。";
  if (pathname === "/check" || pathname.startsWith("/check/")) {
    const id = pathname === "/check" ? "" : pathname.split("/")[2] || "";
    return CHECK_PAGES[id]?.desc || CHECK_PAGES[""].desc;
  }
  if (pathname.startsWith("/model/")) {
    const slug = pathname.split("/")[2] || "";
    if (MODEL_SEO[slug]) return MODEL_SEO[slug].desc;
    const row = modelRows.find((item) => item.slug === slug);
    if (!row) return `${slug} 的中转价格页暂无这份模型记录。`;
    return clip(`${row.title} 中转站排行。按分组对照输入价、输出价、缓存价。数字来自各站公开分组，会变动。`);
  }
  return "维渡 AI 收录 AI 中转站，对照在线率、延迟和公开价格。";
}

const ORIGIN = "https://www.veridrop.cn";
const HOME_TITLE = `维渡 AI - AI 中转站排行与推荐｜收录 ${stationTotal} 家中转站实测与价格对比`;

const STATIC = {
  "/": { title: "", heading: "AI 中转站排行与推荐" },
  "/list": { title: "AI 中转站排行榜｜在线率、延迟、最低充值、支付和发票", heading: "AI 中转站排行榜" },
  "/model": { title: "AI 模型中转站排行｜价格、上下文和智商", heading: "AI 模型中转站排行" },
  "/reputation": { title: "中转站投票排行｜赞成、反对与净票", heading: "中转站投票排行" },
  "/activity": { title: "福利羊毛｜中转站优惠活动和官方免费 API", heading: "福利羊毛" },
  "/availability": { title: "全站可用性监测｜Codex、Claude、Gemini 分组在线状态", heading: "全站可用性监测" },
  "/help": { title: "评测方法｜目录探测、公开价格、投票和评价", heading: "评测方法" },
  "/about": { title: "商务合作｜广告投放、站点收录与内容引用", heading: "商务合作" },
  "/disclaimer": { title: "免责声明｜检测数据仅供参考，不构成充值建议", heading: "免责声明" },
  "/privacy": { title: "隐私政策｜Cookie、检测 Key 和评价内容如何留存", heading: "隐私政策" },
  "/terms": { title: "服务条款｜榜单边界、充值退款和禁止行为", heading: "服务条款" },
  "/points": { title: "赚积分｜签到、投票和点评记在账户，检测只留在这台浏览器", heading: "赚积分" },
  "/account": { title: "账户设置｜头像、积分、收藏和提交记在账户", heading: "账户设置" },
  "/apply": { title: "申请收录｜提交中转站公开信息，不要填写 API Key", heading: "申请收录" },
  "/submissions": { title: "我的提交｜记在登录账户里，没有审核状态", heading: "我的提交" },
  "/history": { title: "检测历史｜这台浏览器的基础测试、糖果测试和鹈鹕骑车", heading: "检测历史" },
  "/tools/iq": { title: "模型智商榜｜代码、推理和工具调用的公开分数对照", heading: "模型智商榜" },
  "/tools/codex-resets": { title: "Codex 额度重置记录｜已公布的重置时间与间隔", heading: "Codex 额度重置记录" },
  "/tools/api-speed": { title: "AI API 测速工具｜延迟、并发和缓存只发给你填写的接口", heading: "AI API 测速工具" },
  "/agents": { title: "给 Agent 的站点说明｜榜单路径、字段和数据边界", heading: "给 Agent 的站点说明" },
};

const PRIVATE = new Set(["/account", "/history", "/submissions", "/cat/fav"]);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plain(value) {
  return String(value || "").replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function brand(title) {
  if (!title) return HOME_TITLE;
  if (title.startsWith("维渡 AI")) return title;
  return `维渡 AI - ${title}`;
}

function money(value, currency) {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const unit = currency === "USD" ? "$" : "¥";
  return unit + number.toFixed(4).replace(/\.?0+$/, "");
}

function stationItem(station) {
  const up = station.uptime == null ? "" : `在线率 ${station.uptime}%`;
  const delay = station.latency == null ? "" : `延迟 ${station.latency} 秒`;
  return `<li><a href="${esc(station.path)}">${esc(station.name)}</a> ${esc([up, delay].filter(Boolean).join("，"))}</li>`;
}

function modelTable(station) {
  const rows = station.models || [];
  if (!rows.length) return "<p>这个站点还没有公开的模型价格。</p>";
  const shown = rows.map((row) => {
    const price = row.input == null || row.output == null ? "" : `${money(row.input, row.currency)} / ${money(row.output, row.currency)}`;
    const cache = row.cache == null ? "" : money(row.cache, row.currency);
    const purity = row.score == null || row.score === "" ? "" : esc(row.score);
    const delay = row.latency == null || row.latency === "" ? "" : esc(row.latency);
    const online = row.uptime == null || row.uptime === "" ? "" : esc(row.uptime);
    return `<tr><td>${esc(row.name)}</td><td>${esc(row.group || "")}</td><td>${row.ratio == null ? "" : esc(row.ratio)}</td><td>${esc(price)}</td><td>${esc(cache)}</td><td>${purity}</td><td>${delay}</td><td>${online}</td></tr>`;
  }).join("\n");
  return `<table>
<thead><tr><th>模型</th><th>分组</th><th>倍率</th><th>输入 / 输出</th><th>缓存</th><th>纯度</th><th>延迟</th><th>在线率</th></tr></thead>
<tbody>
${shown}
</tbody>
</table>
<p>公开价格共 ${rows.length} 条。纯度和单模型延迟、在线率没有探测记录时留空。</p>`;
}

function voteId(station) {
  if (station?.verdId != null && station.verdId !== "") {
    const text = String(station.verdId).trim();
    if (/^\d+$/.test(text)) return String(Number(text));
  }
  return station?.slug || "";
}

function liveCounts(station, community) {
  const row = community?.votes?.stations?.[voteId(station)];
  if (!row) return { up: station.voteUp || 0, down: station.voteDown || 0 };
  return { up: Number(row.up) || 0, down: Number(row.down) || 0 };
}

function scoreText(station, community) {
  const remote = (community?.comments || []).filter((row) => row.slug === station.slug);
  const baked = Array.isArray(station.reviews) ? station.reviews : [];
  const rated = [...remote, ...baked].filter((row) => Number(row.rating) > 0);
  if (!rated.length) return "暂无评分";
  const sum = rated.reduce((total, row) => total + Number(row.rating), 0);
  return `${(sum / rated.length).toFixed(1)} 分，${rated.length} 条评价`;
}

function commentBlock(station, community) {
  const remote = (community?.comments || []).filter((row) => row.slug === station.slug);
  const baked = Array.isArray(station.reviews) ? station.reviews : [];
  const rows = [...remote, ...baked];
  if (!rows.length) return "<h2>评论</h2>\n<p>还没有评论。</p>";
  const html = rows.map((row) => {
    const pros = (row.pros || []).map((tag) => `<li>优点 ${esc(tag)}</li>`).join("\n");
    const cons = (row.cons || []).map((tag) => `<li>缺点 ${esc(tag)}</li>`).join("\n");
    const tags = [pros, cons].filter(Boolean).join("\n");
    return `<article>
<p>${esc(row.user || "用户")}，${esc(row.rating || "")} 星，${esc(row.date || "")}</p>
<p>${esc(row.body || "")}</p>
${tags ? `<ul>\n${tags}\n</ul>` : ""}
</article>`;
  }).join("\n");
  return `<h2>评论 ${rows.length} 条</h2>\n${html}`;
}

function stationDocument(station, community) {
  const counts = liveCounts(station, community);
  const rank = station.votePlace ? `投票第${station.votePlace}名` : "还没有投票名次";
  const facts = [
    station.uptime == null ? "" : `<li>在线率：${esc(station.uptime)}%</li>`,
    station.latency == null ? "" : `<li>延迟：${esc(station.latency)} 秒</li>`,
    station.host ? `<li>域名：${esc(station.host)}</li>` : "",
    station.site ? `<li>官网：<a href="${esc(station.site)}">${esc(station.site)}</a></li>` : "",
    station.pay?.length ? `<li>支付：${esc(station.pay.join("、"))}</li>` : "",
    station.min && station.min !== "—" ? `<li>最低充值：${esc(station.min)}</li>` : "",
    station.invoice && station.invoice !== "—" ? `<li>发票：${esc(station.invoice)}</li>` : "",
    station.refund && station.refund !== "—" ? `<li>退款：${esc(station.refund)}</li>` : "",
    station.listed ? `<li>收录：${esc(station.listed)}</li>` : "",
  ].filter(Boolean);
  const notes = (station.announcements || []).filter((item) => item?.content).map((item) => `<article>
<h3>${esc(item.title || "公告")}</h3>
<p>${esc(plain(item.content))}</p>
</article>`);
  return `<h1>${esc(station.name)}</h1>
<p>${esc(rank)}，赞 ${counts.up}，踩 ${counts.down}，${esc(scoreText(station, community))}</p>
${station.blurb ? `<p>${esc(plain(station.blurb))}</p>` : ""}
<h2>基本信息</h2>
${facts.length ? `<ul>\n${facts.join("\n")}\n</ul>` : "<p>公开页面上没有最低充值、退款和发票。</p>"}
<h2>模型与价格</h2>
${modelTable(station)}
<h2>站点公告</h2>
${notes.length ? notes.join("\n") : "<p>公开页面上没有站点公告。</p>"}
${commentBlock(station, community)}`;
}

function pageFor(pathname, community) {
  const path = decodeURIComponent(String(pathname || "/").split("?")[0]).replace(/\/+$/, "") || "/";
  if (STATIC[path]) {
    const spec = STATIC[path];
    let body = `<h1>${esc(spec.heading)}</h1><p>${esc(describe(path))}</p>`;
    if (path === "/") {
      const top = stations.filter((item) => item.place).sort((a, b) => a.place - b.place).slice(0, 100);
      body += `\n<h2>中转站</h2>\n<ul>\n${top.map(stationItem).join("\n")}\n</ul>\n<p><a href="/list">查看全部 ${stationTotal} 家中转站</a>，<a href="/model">查看 ${modelTotal} 个模型</a></p>`;
    }
    if (path === "/list") body += `\n<ul>\n${stations.map(stationItem).join("\n")}\n</ul>`;
    if (path === "/model") {
      body += `\n<ul>\n${modelRows.map((row) => `<li><a href="/model/${esc(row.slug)}">${esc(row.title || row.slug)}</a></li>`).join("\n")}\n</ul>`;
    }
    if (path === "/reputation") {
      const comments = [...(community?.comments || [])].reverse().slice(0, 40);
      body += comments.length
        ? `<h2>点评</h2>${comments.map((row) => {
          const station = findStation(row.slug);
          const href = station?.path || `/site/${encodeURIComponent(row.slug)}`;
          return `<article><p><a href="${esc(href)}">${esc(station?.name || row.slug)}</a> ${esc(row.user || "")} ${esc(row.rating || "")} 星</p><p>${esc(row.body || "")}</p></article>`;
        }).join("")}`
        : "<p>还没有新的点评。</p>";
    }
    return { path, title: brand(spec.title), description: describe(path), body, robots: PRIVATE.has(path) ? "noindex,follow" : "index,follow", status: 200 };
  }
  if (path.startsWith("/cat/")) {
    const id = path.split("/")[2] || "";
    const meta = CAT_SEO[id];
    if (!meta) return null;
    const list = stations.filter((item) => matchesCategory(item, id, null));
    return {
      path,
      title: brand(meta.title),
      description: meta.desc,
      body: `<h1>${esc(meta.h1 || meta.title)}</h1>\n<p>${esc(meta.desc)}</p>\n<ul>\n${list.map(stationItem).join("\n")}\n</ul>`,
      robots: id === "fav" ? "noindex,follow" : "index,follow",
      status: 200,
    };
  }
  if (path.startsWith("/site/")) {
    const station = findStation(path.split("/")[2] || "");
    if (!station) return null;
    return {
      path: station.path,
      title: brand(`${station.name} 中转站详情｜在线率、延迟、公开价格和评价`),
      description: describe(station.path),
      body: stationDocument(station, community),
      robots: "index,follow",
      status: 200,
    };
  }
  if (path.startsWith("/model/")) {
    const slug = path.split("/")[2] || "";
    const meta = MODEL_SEO[slug];
    const row = modelRows.find((item) => item.slug === slug);
    if (!meta && !row) return null;
    const title = meta?.title || `${row.title} 中转站排行和推荐｜输入、输出、缓存价格、在线率与延迟`;
    const heading = meta?.h1 || row.title;
    return {
      path,
      title: brand(title),
      description: describe(path),
      body: `<h1>${esc(heading)}</h1><p>${esc(describe(path))}</p>`,
      robots: "index,follow",
      status: 200,
    };
  }
  if (path === "/check" || path.startsWith("/check/")) {
    const id = path === "/check" ? "" : path.split("/")[2] || "";
    const meta = CHECK_PAGES[id];
    if (!meta) return null;
    const links = Object.entries(CHECK_PAGES).map(([key, item]) => `<li><a href="${key ? `/check/${key}` : "/check"}">${esc(item.h1 || item.title)}</a></li>`).join("");
    return {
      path,
      title: meta.title,
      description: meta.desc,
      body: `<h1>${esc(meta.h1 || meta.title)}</h1><p>${esc(meta.desc)}</p><ul>${links}</ul>`,
      robots: "index,follow",
      status: 200,
    };
  }
  if (path.startsWith("/official/")) {
    const id = path.split("/")[2] || "";
    const meta = OFFICIAL_SEO[id];
    if (!meta) return null;
    return {
      path,
      title: brand(meta.title),
      description: meta.desc,
      body: `<h1>${esc(meta.h1 || meta.title)}</h1><p>${esc(meta.desc)}</p>`,
      robots: "index,follow",
      status: 200,
    };
  }
  if (path.startsWith("/r/d/")) {
    const id = decodeURIComponent(path.slice("/r/d/".length).split("/")[0] || "");
    let report = null;
    let station = null;
    for (const item of stations) {
      const test = (item.tests || []).find((row) => row.id === id);
      if (!test) continue;
      report = test;
      station = item;
      break;
    }
    if (!report || !station) return null;
    return {
      path,
      title: brand(`${station.name} ${report.model} 检测报告`),
      description: `${station.name} 的 ${report.model} 检测记录，总分 ${report.score}。只有总分，没有逐项探针。`,
      body: `<h1>${esc(station.name)} ${esc(report.model)} 检测报告</h1><p>总分 ${esc(report.score)}。时间 ${esc(report.at)}。协议 ${esc(report.channel || "")}。</p><p><a href="${esc(station.path || `/site/${station.slug}`)}">返回${esc(station.name)}</a></p>`,
      robots: "noindex,follow",
      status: 200,
    };
  }
  return null;
}

export function renderSnapshot(pathname, community = null) {
  const page = pageFor(pathname, community);
  if (!page) {
    return {
      status: 404,
      title: "维渡 AI - 页面不存在",
      description: "这个地址不在维渡 AI 的页面里。",
      robots: "noindex,follow",
      canonical: ORIGIN,
      body: "<h1>页面不存在</h1><p><a href=\"/\">回到首页</a></p>",
    };
  }
  return { ...page, canonical: `${ORIGIN}${page.path === "/" ? "/" : page.path}` };
}

export function snapshotPaths() {
  const paths = Object.keys(STATIC);
  for (const id of Object.keys(CAT_SEO)) paths.push(`/cat/${id}`);
  for (const id of Object.keys(MODEL_SEO)) paths.push(`/model/${id}`);
  for (const row of modelRows) paths.push(`/model/${row.slug}`);
  for (const id of Object.keys(OFFICIAL_SEO)) paths.push(`/official/${id}`);
  for (const id of Object.keys(CHECK_PAGES)) paths.push(id ? `/check/${id}` : "/check");
  for (const station of stations) paths.push(station.path);
  return [...new Set(paths)];
}

const ICONS = [
  '<link rel="icon" type="image/png" sizes="48x48" href="/img/icon-48.png">',
  '<link rel="icon" type="image/png" sizes="96x96" href="/img/icon-96.png">',
  '<link rel="shortcut icon" href="/favicon.ico">',
  '<link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16 32x32 48x48">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/img/apple-touch-icon.png">',
  '<link rel="manifest" href="/site.webmanifest">',
].join("\n  ");

function absolute(pathname) {
  if (!pathname || pathname === "/") return `${ORIGIN}/`;
  return `${ORIGIN}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function crumbsFor(page) {
  const path = page.path || "/";
  const home = { name: "首页", path: "/" };
  if (path === "/") return [home];
  if (path === "/list") return [home, { name: "站点排行", path }];
  if (path.startsWith("/site/")) {
    const station = findStation(path.split("/")[2] || "");
    return [home, { name: "站点排行", path: "/list" }, { name: station?.name || "中转站", path }];
  }
  if (path.startsWith("/cat/")) {
    const id = path.split("/")[2] || "";
    return [home, { name: "站点排行", path: "/list" }, { name: CAT_SEO[id]?.h1 || "分类", path }];
  }
  if (path === "/model") return [home, { name: "模型", path }];
  if (path.startsWith("/model/")) {
    const slug = path.split("/")[2] || "";
    const row = modelRows.find((item) => item.slug === slug);
    return [home, { name: "模型", path: "/model" }, { name: MODEL_SEO[slug]?.h1 || row?.title || slug, path }];
  }
  if (path === "/check") return [home, { name: CHECK_PAGES[""]?.h1 || "模型检测", path }];
  if (path.startsWith("/check/")) {
    const id = path.split("/")[2] || "";
    return [home, { name: CHECK_PAGES[""]?.h1 || "模型检测", path: "/check" }, { name: CHECK_PAGES[id]?.h1 || "检测", path }];
  }
  if (path.startsWith("/official/")) {
    const id = path.split("/")[2] || "";
    return [home, { name: OFFICIAL_SEO[id]?.h1 || "官方状态", path }];
  }
  if (path === "/reputation") return [home, { name: "投票排行", path }];
  const heading = STATIC[path]?.heading;
  if (heading) return [home, { name: heading, path }];
  return [home];
}

function listedStation(station, position) {
  return {
    "@type": "ListItem",
    position,
    name: station.place ? `第${station.place}名 ${station.name}` : station.name,
    url: absolute(station.path),
  };
}

function firstStations(list) {
  return list.slice(0, 20).map((station, index) => listedStation(station, index + 1));
}

function listFor(path) {
  if (path === "/" || path === "/list") return firstStations(stations);
  if (path.startsWith("/cat/")) {
    const id = path.split("/")[2] || "";
    if (!id || id === "fav" || !CAT_SEO[id]) return [];
    return firstStations(stations.filter((station) => matchesCategory(station, id, null)));
  }
  if (path.startsWith("/model/")) {
    const slug = path.split("/")[2] || "";
    if (!FAMILY_MODEL_IDS.includes(slug)) return [];
    return firstStations(stations.filter((station) => (station.modelIds || []).includes(slug)));
  }
  if (path === "/model") {
    return modelRows.slice(0, 20).map((row, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: row.title || row.slug,
      url: absolute(`/model/${row.slug}`),
    }));
  }
  if (path === "/reputation") {
    const ranked = stations.map((station, order) => ({
      station,
      order,
      net: (station.voteUp || 0) - (station.voteDown || 0),
    }));
    ranked.sort((a, b) => b.net - a.net || a.order - b.order);
    return ranked.slice(0, 20).map((row, index) => listedStation(row.station, index + 1));
  }
  return [];
}

function linkedData(page) {
  const crumbs = crumbsFor(page);
  const items = page.robots === "noindex,follow" ? [] : listFor(page.path);
  const webPage = {
    "@type": "WebPage",
    name: page.title,
    description: page.description,
    url: page.canonical,
  };
  const graph = [webPage];
  if (crumbs.length >= 2) {
    const id = `${page.canonical}#breadcrumb`;
    webPage.breadcrumb = { "@id": id };
    graph.push({
      "@type": "BreadcrumbList",
      "@id": id,
      itemListElement: crumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: absolute(item.path),
      })),
    });
  }
  if (items.length) {
    graph.push({
      "@type": "ItemList",
      name: page.title,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      numberOfItems: items.length,
      itemListElement: items,
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

function pageAssets(template) {
  const raw = String(template || "");
  const styles = [...raw.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((item) => item[0]);
  const refresh = [...raw.matchAll(/<script type="module">[\s\S]*?<\/script>/g)].map((item) => item[0]);
  const scripts = [...raw.matchAll(/<script type="module"[^>]*src="[^"]+"[^>]*>\s*<\/script>/g)].map((item) => item[0]);
  if (!styles.length) styles.push('<link rel="stylesheet" href="/src/styles.css">');
  if (!scripts.length) scripts.push('<script type="module" src="/src/main.jsx"></script>');
  return { styles: styles.join("\n  "), scripts: [...refresh, ...scripts].join("\n  ") };
}

export function injectSnapshot(html, page) {
  const assets = pageAssets(html);
  const linked = linkedData(page);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <meta name="robots" content="${esc(page.robots)}">
  <link rel="canonical" href="${esc(page.canonical)}">
  <link rel="alternate" type="application/rss+xml" title="维渡 AI 站点动态" href="/feed.xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="维渡 AI">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${esc(page.canonical)}">
  ${ICONS}
  ${assets.styles}
  <script type="application/ld+json">${linked}</script>
</head>
<body>
  <div id="root">
${page.markup || `<header class="topbar">
      <a class="logo" href="/">Veri<i>Drop</i></a>
      <nav class="nav">
        <a href="/">首页</a>
        <a href="/list">站点</a>
        <a href="/model">模型</a>
        <a href="/reputation">投票</a>
        <a href="/check">模型检测</a>
        <a href="/activity">福利羊毛</a>
        <a href="/points">赚积分</a>
      </nav>
    </header>
    <main>
${page.body}
    </main>
    <footer class="footer">
      <p>2026 维渡 AI · www.veridrop.cn</p>
      <nav>
        <a href="/">首页</a>
        <a href="/list">站点排行</a>
        <a href="/cat/charity">公益站</a>
        <a href="/model">模型</a>
        <a href="/check">模型检测</a>
        <a href="/reputation">投票</a>
        <a href="/help">评测方法</a>
        <a href="/about">商务合作</a>
        <a href="/privacy">隐私政策</a>
        <a href="/disclaimer">免责声明</a>
      </nav>
    </footer>`}
  </div>
  ${assets.scripts}
</body>
</html>
`;
}
