import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { findReport, findStation, modelTotal, stationTotal } from "./data.js";
import { getOfficialSnapshot } from "./official-store.js";
import modelRows from "./model-rows.json";
import skins from "./skins.json";
import { CAT_SEO, CHECK_PAGES, MODEL_SEO, OFFICIAL_SEO } from "./verd-meta.js";

const ORIGIN = String(import.meta.env.VITE_SITE_ORIGIN || "https://www.veridrop.cn").replace(/\/$/, "");

const PAGES = {
  "/": `发现好用的 AI 中转站。收录 ${stationTotal} 家中转站、${modelTotal} 个模型，比较纯度、在线率、延迟和价格。`,
  "/list": "AI 中转站排行榜。按在线率、延迟、最低充值、支付方式和发票筛选，并保留原来的分类。",
  "/reputation": "中转站投票。赞成减反对，净票高的排前面。每人每站一票，记在这台浏览器里。",
  "/activity": "AI 中转站福利活动与免费额度。",
  "/availability": "全站可用性监测。查看各中转站分组的在线状态。",
  "/model": "AI 模型中转站排行。对比 GPT、Claude、Gemini、DeepSeek 的中转价格、上下文和智商。",
  "/help": "评测方法。说明纯度、可用性、延迟和价格怎么测。",
  "/about": "关于本站，AI 中转站测评与排行。",
  "/disclaimer": "免责声明。",
  "/privacy": "隐私政策。",
  "/terms": "服务条款。",
  "/points": "赚积分。登录、签到和完成任务获得积分。",
  "/submit": "提交收录一家 AI 中转站。",
  "/apply": "申请收录。填写站点公开信息，不要填写 API Key。",
  "/history": "本机 API 检测历史。",
  "/agents": "给 Agent 的站点说明。",
  "/tools/iq": "模型智商榜。",
  "/tools/codex-resets": "Codex 额度重置记录。",
  "/tools/skins": "Codex 换肤大师。预览并套用皮肤。",
  "/tools/api-speed": "AI API 测试工具。测速结果只发给你填写的接口。",
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
    if (!station) return "没有找到这个中转站。";
    return clip(`${station.name} 中转站。${station.blurb || station.lineup || ""} 在线率 ${station.uptime ?? "—"}%，平均延迟 ${station.latency ?? "—"} 秒。`);
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
    if (!row) return `${slug} 模型中转价格与表现。`;
    return clip(`${row.title} 中转站列表。对比各站分组的输入、输出、缓存价格、在线率和延迟。`);
  }
  if (pathname.startsWith("/tools/skins/")) {
    const id = decodeURIComponent(pathname.split("/")[3] || "");
    const skin = skins.find((item) => item.id === id);
    return skin ? `${skin.name} Codex 皮肤预览。` : "Codex 皮肤预览。";
  }
  if (pathname.startsWith("/b/")) return "检测报告。密钥不在链接里。";
  if (pathname.startsWith("/r/d/")) {
    const report = findReport(decodeURIComponent(pathname.split("/")[3] || ""));
    if (!report) return "模型真伪检测报告。";
    return clip(`${report.station || ""} ${report.model || ""} 模型真伪检测报告。`);
  }
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
