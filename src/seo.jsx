import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { findReport, findStation, modelTotal, stationTotal } from "./data.js";
import { getOfficialSnapshot } from "./official-store.js";
import modelRows from "./model-rows.json";
import { CAT_SEO, CHECK_PAGES, MODEL_SEO, OFFICIAL_SEO } from "./verd-meta.js";

const ORIGIN = String(import.meta.env.VITE_SITE_ORIGIN || "https://www.veridrop.cn").replace(/\/$/, "");

const PAGES = {
  "/": `发现好用的 AI 中转站。现收录 ${stationTotal} 家站点、${modelTotal} 个模型，对照纯度、在线率、延迟、支付和价格。数据来自目录探测和公开信息，不代收充值，也不证明官方原厂。`,
  "/list": "AI 中转站排行榜。可按在线率、延迟、最低充值、支付方式、发票和原有分类筛选。展示的是目录探测结果，不构成充值建议。",
  "/reputation": "中转站投票排行。按赞成减反对的净票排序，每人每站一票，记在这台浏览器。赞成和反对来自目录计数加上本地这一票。",
  "/activity": "福利羊毛汇总中转站优惠活动和官方免费 API。截止时间、额度和规则以对方页面为准，本站不代领、不代充。",
  "/availability": "查看各中转站 Codex、Claude、Gemini 分组的在线状态、在线率和延迟，可切换 24 小时、7 天和 30 天。状态会变动。",
  "/model": "AI 模型中转站排行。对照 Claude、GPT、Gemini、DeepSeek 等模型的最低中转价、上下文、提供站点数、智商分和发布时间。价格来自公开分组，以对方控制台为准。",
  "/help": "说明页面上的纯度分档、在线率、延迟和综合分怎么解释。OpenAI 与 Gemini 只能做协议级对照，不能据此判断官方原厂。",
  "/about": "商务合作。广告投放、站点收录和内容引用，请通过邮箱、QQ 或 Telegram 联系，并写上品牌、合作方向和链接。收录不收取影响排名的费用。",
  "/disclaimer": "免责声明。纯度、可用性、速度和价格由程序采集，可能滞后或有误，只供参考，不构成对任何中转站的推荐、担保或充值建议。",
  "/privacy": "隐私政策。登录和语言偏好使用必要 cookie。检测框里的 API Key 留在这台浏览器，不会发到维渡 AI。评价里不要写密钥或订单号。",
  "/terms": "服务条款。榜单是第三方信息展示，不是购买建议。充值、退款和发票以中转站自己的规则为准。禁止撞库、盗用密钥，或把结果说成官方担保。",
  "/points": "积分记在这台浏览器。签到、检测、投票、点评、完善资料和收藏可以记分。邀请链接可以复制，注册后的积分还没接上。兑换页目前没有奖品。",
  "/account": "账户设置。头像、昵称和密码只保存在这台浏览器，不会发到维渡 AI。",
  "/submit": "申请收录中转站。需要名称、网址、至少一个分类、介绍和联系方式。探测账号选填。不要填写 API Key。",
  "/submissions": "查看这台浏览器提交过的收录。列表没有审核状态，也不会同步到其他设备。",
  "/apply": "申请收录中转站。需要名称、网址、至少一个分类、介绍和联系方式。探测账号选填。不要填写 API Key。",
  "/history": "这台浏览器保存的检测历史，包括基础测试、糖果测试、鹈鹕骑车和测速。记录不上传，清除后不会恢复。",
  "/agents": "给 Agent 的说明。维渡 AI 是中转站目录，提供在线率、延迟、支付、发票和模型页。页面写明本地快照不连接探测后端，不能当成官方担保。",
  "/tools/iq": "模型智商榜对照代码、推理和工具调用分数。分数来自公开评测同步，单日波动大，只适合看相对变化，不能证明官方渠道。",
  "/tools/codex-resets": "收录已公布的 Codex 用量重置时间和间隔，并链到原始公告。这个页面不能替你重置额度。",
  "/tools/api-speed": "在浏览器里测你自己的 AI API，包括延迟、并发和缓存。请求只发到你填写的接口，Key 不经过维渡 AI。",
  "/check": CHECK_PAGES[""].desc,
};

function clip(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

function describe(pathname) {
  if (PAGES[pathname]) return PAGES[pathname];
  if (pathname.startsWith("/station/") || pathname.startsWith("/site/")) {
    const key = decodeURIComponent(pathname.split("/")[2] || "");
    const station = findStation(key);
    if (!station) return "没有找到这个中转站。地址可能已变更，可回到排行榜按名称搜索。";
    const lead = `${station.name} 中转站详情。对照纯度、在线率、延迟、价格和评价。目录在线率 ${station.uptime ?? "—"}%，平均延迟 ${station.latency ?? "—"} 秒。探测会变动，不构成充值建议。`;
    const blurb = String(station.blurb || "").replace(/\s+/g, " ").trim();
    const withBlurb = blurb ? `${lead}${blurb}` : lead;
    return withBlurb.length <= 150 ? withBlurb : clip(lead);
  }
  if (pathname.startsWith("/cat/")) {
    const id = decodeURIComponent(pathname.split("/")[2] || "");
    return CAT_SEO[id]?.desc || `${id} 分类下的 API 中转站。`;
  }
  if (pathname.startsWith("/official/")) {
    const id = decodeURIComponent(pathname.split("/")[2] || "");
    const board = getOfficialSnapshot().boards.find((item) => item.provider === id);
    return OFFICIAL_SEO[id]?.desc || (board ? `${board.label} 官方状态：${board.status || ""}` : "官方状态对照。");
  }
  if (pathname.startsWith("/check/")) {
    const id = decodeURIComponent(pathname.split("/")[2] || "");
    return CHECK_PAGES[id]?.desc || CHECK_PAGES[""].desc;
  }
  if (pathname.startsWith("/model/")) {
    const slug = decodeURIComponent(pathname.split("/")[2] || "");
    if (MODEL_SEO[slug]) return MODEL_SEO[slug].desc;
    const row = modelRows.find((item) => item.slug === slug);
    if (!row) return `${slug} 的中转价格页暂无这份模型记录。可从模型排行按名称查找。`;
    return clip(`${row.title} 中转站排行。按分组对照输入价、输出价、缓存价、在线率和延迟。数字来自各站公开分组，会变动，充值前以对方控制台为准。`);
  }
  if (pathname.startsWith("/b/")) return "基础测试、糖果测试或鹈鹕骑车的报告。密钥不在链接里，另一台浏览器打不开这份记录。";
  if (pathname.startsWith("/r/d/")) {
    const report = findReport(decodeURIComponent(pathname.split("/")[3] || ""));
    if (!report) return "没有找到这份检测报告快照。它不在本地目录里。";
    return clip(`${report.station || ""} ${report.model || ""} 的检测报告快照。分数不能当成官方原厂鉴定，密钥不在链接里。`);
  }
  if (pathname.startsWith("/r/")) return "模型检测报告。展示这一次调用的基础分和耗时。密钥不在链接里，不能当成官方原厂鉴定。";
  return PAGES["/"];
}

function ensureMeta(name, content) {
  let node = document.querySelector(`meta[name="${name}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute("name", name);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

function ensureProperty(property, content) {
  let node = document.querySelector(`meta[property="${property}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute("property", property);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

export function Seo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const apply = () => {
      const description = describe(pathname);
      ensureMeta("description", description);
      ensureMeta("robots", "index,follow");
      ensureProperty("og:title", document.title);
      ensureProperty("og:description", description);
      ensureProperty("og:type", "website");
      ensureProperty("og:locale", "zh_CN");
      ensureProperty("og:site_name", "维渡 AI");
      let canonical = document.querySelector('link[rel="canonical"]');
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      const href = `${ORIGIN}${pathname === "/" ? "/" : pathname}`;
      canonical.href = href;
      ensureProperty("og:url", href);
    };
    apply();
    const timer = window.setTimeout(apply, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}
