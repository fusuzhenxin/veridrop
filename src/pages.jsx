import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import activityData from "./activity.json";
import availabilityData from "./availability.json";
import modelRows from "./model-rows.json";
import {
  findReport,
  latestCodex,
  compareStations,
  findStation,
  iq,
  latestTests,
  modelTotal,
  perks,
  reviews,
  stationTotal,
  stationHeading,
  stations,
  headlineModels,
  stationPath,
} from "./data.js";
import { startCheckJob } from "./basic-run.jsx";
import { refreshOfficialStatus, useOfficialStatus } from "./official-store.js";
import {
  CATS,
  CAT_SEO,
  CHARITY_FAQ,
  CHARITY_SECTIONS,
  FAMILY_MODEL_IDS,
  MODEL_FAMILIES as VERD_MODELS,
  MODEL_SEO,
  matchesCategory,
} from "./verd-meta.js";
import { ModelBoard, ModIcon } from "./model-board.jsx";

import { applyRemoteAccount, fitAvatar, readAvatar, readFavs, readSession, readSubmissions, writeAvatar, writeFavs, writeSession } from "./account.js";
import { authToken, changePassword, fetchAccount, fetchComments, fetchVotes, saveAvatar, saveFavorite, sendCheckin, sendComment, sendVote, setAuthToken, stationVoteId, updateProfile } from "./community.js";
import { grant, isDone, readPoints, replacePoints, saveNick } from "./points.js";
import {
  Logo,
  Pays,
  ReviewCard,
  SponsorStrip,
  Stars,
  FAMILY_VENDOR,
  VENDOR_ICON,
  Vendor,
  VendorIcon,
  vendorOfModel,
  listSponsors,
  useTitle,
} from "./ui.jsx";

function showUptime(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${value}%`;
}

function showLatency(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}s`;
}

function toggleFav(slug) {
  const current = readFavs();
  if (!authToken()) {
    window.dispatchEvent(new Event("okk-open-auth"));
    return current;
  }
  const on = !current[slug];
  const next = { ...current };
  if (on) next[slug] = true;
  else delete next[slug];
  writeFavs(next);
  saveFavorite(slug, on).then((data) => applyRemoteAccount(data)).catch(() => {});
  return next;
}

function moneyOf(min) {
  const text = String(min || "");
  if (!text || text === "—") return { kind: "none", amount: null, label: "—" };
  const dollar = text.includes("$");
  const digits = text.replace(/[^\d.]/g, "");
  const amount = Number(digits);
  const label = dollar ? (digits ? `$${digits}` : text) : text.replaceAll("￥", "¥");
  return { kind: dollar ? "usd" : "cny", amount: Number.isFinite(amount) ? amount : null, label };
}

function latencyTone(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n < 2) return "lat-f";
  if (n < 5) return "lat-m";
  return "lat-s";
}

function uptimeTone(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n >= 99) return "up-good";
  if (n >= 95) return "up-mid";
  return "up-low";
}

const TAG_TONE = {
  "公益站": "t-charity",
  "站长在用": "t-owner",
  "稳定企业向": "t-stable",
  "便宜个人向": "t-cheap",
  "小有特色": "t-special",
  "新站上榜": "t-new",
  "当前在线": "t-online",
  "签到送余额": "t-checkin",
  "新用户赠额": "t-gift",
  "低倍率": "t-rate",
  "低延迟": "t-fast",
  "国内支付": "t-pay",
  "邀请返利": "t-invite",
  "加密充值": "t-crypto",
  "可开发票": "t-invoice",
  "高可用": "t-up",
  "低价": "t-cheap",
  "模型丰富": "t-models",
  "价格透明": "t-clear",
  "纯度高": "t-pure",
};

function tagTone(tag) {
  const known = TAG_TONE[tag];
  if (known) return `slb-tag ${known}`;
  const n = [...String(tag)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  return `slb-tag t-misc${n}`;
}

function ListMark({ value }) {
  const text = String(value || "—");
  if (text === "—" || text === "") return <span className="slb-dim">—</span>;
  if (text === "✓" || text === "是" || text === "支持") return <span className="slb-ok">✓</span>;
  if (text === "✗" || text === "否" || text === "不支持") return <span className="slb-no">✗</span>;
  const match = text.match(/^(?:其他|有条件)\s*[:：]\s*(.*)$/);
  return <span className="slb-cond">{match ? match[1] || text : text}</span>;
}

const VENDOR_FACE = {
  claude: ["/icons/vendor/claude.svg", "Claude"],
  openai: ["/icons/vendor/openai.svg", "GPT / Codex"],
  gemini: ["/icons/vendor/gemini.svg", "Gemini"],
  grok: ["/icons/vendor/grok.svg", "Grok"],
  zhipu: ["/icons/vendor/zhipu.svg", "GLM"],
  deepseek: ["/icons/vendor/deepseek.svg", "DeepSeek"],
  kimi: ["/icons/vendor/moonshot.svg", "Kimi"],
  qwen: ["/icons/vendor/qwen.svg", "千问"],
  minimax: ["/icons/vendor/minimax.svg", "MiniMax"],
  doubao: ["/icons/vendor/doubao.svg", "豆包"],
  meta: ["/icons/vendor/meta.svg", "Meta"],
  hunyuan: ["/icons/vendor/hunyuan.svg", "混元"],
  mimo: ["/icons/vendor/xiaomi-mimo.svg", "MiMo"],
};

const COV_ORDER = ["claude", "openai", "gemini", "deepseek", "qwen", "kimi", "zhipu", "minimax", "mimo", "grok", "doubao", "meta", "hunyuan", "typesafe"];

function orderedVendors(list) {
  const seen = new Set();
  const names = [];
  for (const name of list || []) {
    const key = name === "moonshot" ? "kimi" : name;
    if (!VENDOR_ICON[key] || seen.has(key)) continue;
    seen.add(key);
    names.push(key);
  }
  names.sort((a, b) => {
    const left = COV_ORDER.indexOf(a);
    const right = COV_ORDER.indexOf(b);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
  });
  return names;
}

function CovTip({ label, icons, children }) {
  const [place, setPlace] = useState(null);
  const open = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const above = rect.top > 72;
    setPlace({ x: rect.left + rect.width / 2, y: above ? rect.top : rect.bottom, above });
  };
  return (
    <span className="cov-h" onMouseEnter={open} onMouseLeave={() => setPlace(null)}>
      {children}
      {place ? (
        <span className={place.above ? "cov-tip" : "cov-tip below"} style={{ left: place.x, top: place.y }}>
          {icons ? (
            <span className="cov-tip-row">
              {icons.map((name) => (
                <img key={name} src={VENDOR_ICON[name][0]} alt={VENDOR_ICON[name][1]} />
              ))}
            </span>
          ) : label}
        </span>
      ) : null}
    </span>
  );
}

function Coverage({ count, vendors }) {
  const icons = orderedVendors(vendors);
  const shown = icons.slice(0, 3);
  const rest = icons.slice(3);
  return (
    <span className="cov">
      <span className="cov-n">{count}</span>
      <span className="cov-u">个</span>
      {shown.length ? (
        <span className="cov-stack">
          {shown.map((name) => (
            <CovTip key={name} label={VENDOR_ICON[name][1]}>
              <span className="cov-mic"><img src={VENDOR_ICON[name][0]} alt="" /></span>
            </CovTip>
          ))}
          {rest.length ? (
            <CovTip icons={rest}>
              <span className="cov-mic cov-more">+{rest.length}</span>
            </CovTip>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function ModelStack({ vendors }) {
  const shown = vendors.slice(0, 4);
  const extra = vendors.length - shown.length;
  if (!shown.length) return null;
  return (
    <span className="slb-stack">
      {shown.map((name) => {
        const face = VENDOR_FACE[name];
        return (
          <span key={name} className="slb-mic" title={face ? face[1] : name}>
            {face ? <VendorIcon name={name} size={13} /> : name.slice(0, 1).toUpperCase()}
          </span>
        );
      })}
      {extra > 0 ? <span className="slb-mic slb-more">+{extra}</span> : null}
    </span>
  );
}

function StarButton({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`slb-fav${on ? " on" : ""}`}
      title="收藏"
      aria-label="收藏"
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9z" />
      </svg>
    </button>
  );
}

function FilterPill({ label, options, current, open, onOpen, onPick }) {
  const shown = options.find((item) => item[0] === current)?.[1] || "全部";
  const expanded = open === label;
  return (
    <div className={`fpill-wrap${expanded ? " open" : ""}`}>
      <button type="button" className="fpill" aria-expanded={expanded} onClick={() => onOpen(expanded ? "" : label)}>
        <span className="flab">{label}</span>
        <span className="fval">{shown}</span>
        <svg className={`chev${expanded ? " open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded ? (
        <>
          <div className="fback" onClick={() => onOpen("")} />
          <div className="fpop" role="listbox">
            {options.map(([key, text]) => (
              <button type="button" key={key} role="option" aria-selected={key === current} className={key === current ? "on" : ""} onClick={() => { onPick(key); onOpen(""); }}>
                {text}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const PAY_FILTERS = [["all", "全部"], ["alipay", "支付宝"], ["wechat", "微信"], ["bank", "银行卡"], ["corp", "对公转账"], ["usdt", "USDT"], ["paypal", "PayPal"]];
const MIN_FILTERS = [["all", "全部"], ["le10", "¥10 及以下"], ["gt10", "¥10 以上"], ["usd", "美元计价"]];
const INV_FILTERS = [["all", "全部"], ["yes", "支持"], ["cond", "有条件"], ["no", "不支持"]];
const SORT_FILTERS = [["overall", "综合"], ["uptime", "在线率"], ["latency", "平均延迟"]];

function Trophy() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6 3h12v2h3v3.2a4.8 4.8 0 0 1-3.7 4.7 6 6 0 0 1-3.3 2.8V18h3v2H7v-2h3v-2.3a6 6 0 0 1-3.3-2.8A4.8 4.8 0 0 1 3 8.2V5h3V3zm0 4H5v1.2a2.8 2.8 0 0 0 2.2 2.7c.3-1.3.6-2.6.8-3.9zm12 0c.2 1.3.5 2.6.8 3.9A2.8 2.8 0 0 0 19 8.2V7h-1z" />
    </svg>
  );
}

function Thumb({ up = false }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d={up
        ? "M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L13.17 1 6.59 7.59A2 2 0 0 0 6 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"
        : "M22 3h-4v12h4V3zM2 14a2 2 0 0 0 2 2h6.3l-.95 4.57-.03.32a1.5 1.5 0 0 0 .44 1.06L10.83 23l6.59-6.59A2 2 0 0 0 18 15V5a2 2 0 0 0-2-2H7a2 2 0 0 0-1.84 1.22L2.14 11.27A2 2 0 0 0 2 12v2z"} />
    </svg>
  );
}

function when(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replaceAll("-", "/");
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const OFFICIAL_ORDER = ["openai", "anthropic", "gemini", "deepseek", "moonshot", "xai"];

function officialRate(board) {
  const values = (board.components || []).map((part) => Number(part.uptime)).filter((value) => Number.isFinite(value));
  if (!values.length) return "—";
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const rounded = Math.round(avg * 100) / 100;
  if (rounded >= 99.995) return "100%";
  return `${rounded.toFixed(2)}%`;
}

function officialDown(board) {
  return board.online === false || /降级|异常|中断|故障/.test(String(board.status || ""));
}

function officialWhen(iso) {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())} ${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())} UTC`;
}

function OfficialMark({ id }) {
  if (id === "openai") {
    return (
      <svg className="omark" viewBox="0 0 24 24" fillRule="evenodd" aria-hidden="true">
        <path fill="currentColor" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0 0 10.205 0a5.947 5.947 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713z" />
      </svg>
    );
  }
  if (id === "anthropic") {
    return (
      <svg className="omark" viewBox="0 0 24 24" fillRule="evenodd" aria-hidden="true">
        <path fill="currentColor" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
      </svg>
    );
  }
  if (id === "gemini") {
    const star = "M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z";
    return (
      <svg className="omark" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#3186FF" d={star} />
        <path fill="url(#og-gem-g)" d={star} />
        <path fill="url(#og-gem-r)" d={star} />
        <path fill="url(#og-gem-y)" d={star} />
        <defs>
          <linearGradient id="og-gem-g" x1="7" y1="15.5" x2="11" y2="12" gradientUnits="userSpaceOnUse">
            <stop stopColor="#08B962" />
            <stop offset="1" stopColor="#08B962" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="og-gem-r" x1="8" y1="5.5" x2="11.5" y2="11" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F94543" />
            <stop offset="1" stopColor="#F94543" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="og-gem-y" x1="3.5" y1="13.5" x2="17.5" y2="12" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FABC12" />
            <stop offset=".46" stopColor="#FABC12" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    );
  }
  if (id === "deepseek") {
    return (
      <svg className="omark" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4D6BFE" d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 0 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z" />
      </svg>
    );
  }
  if (id === "moonshot") {
    return (
      <svg className="omark" viewBox="0 0 24 24" fillRule="evenodd" aria-hidden="true">
        <path fill="currentColor" d="M21.846 0a1.923 1.923 0 1 1 0 3.846H20.15a.226.226 0 0 1-.227-.226V1.923C19.923.861 20.784 0 21.846 0z" />
        <path fill="currentColor" d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 0 0-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 0 1 .205-.023l6.484 4.772a7.677 7.677 0 0 0 3.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 0 1-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z" />
      </svg>
    );
  }
  return (
    <svg className="omark" viewBox="0 0 24 24" fillRule="evenodd" aria-hidden="true">
      <path fill="currentColor" d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 0 0-1.829-1A8.975 8.975 0 0 0 5.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
    </svg>
  );
}

function OfficialStrip() {
  const snap = useOfficialStatus();
  const boards = OFFICIAL_ORDER.map((id) => snap.boards.find((item) => item.provider === id)).filter(Boolean);
  if (!boards.length) return null;
  const when = snap.note || officialWhen(snap.updatedAt);
  return (
    <div className="ostrip">
      <div className="ostrip-in">
        <b>官方模型实况</b>
        <i className="osplit" />
        <div className="opills">
          {boards.map((board) => {
            const down = officialDown(board);
            const label = `${board.label} ${officialRate(board)} ${down ? "降级" : "正常"}`;
            return (
              <Link key={board.provider} className={down ? "opill bad" : "opill"} to={`/official/${board.provider}`} title={label} aria-label={label}>
                <i className={down ? "dot bad" : "dot"} />
                <OfficialMark id={board.provider} />
                <span className="orate">{officialRate(board)}</span>
                <span className={down ? "os" : "os ok"}>{down ? "降级" : "正常"}</span>
              </Link>
            );
          })}
        </div>
        <div className="ostrip-side">
          {when ? (
            <span className={snap.note && !snap.busy ? "when err" : "when"} aria-live="polite">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v5l3 2" />
              </svg>
              {when}
            </span>
          ) : null}
          <button type="button" onClick={() => refreshOfficialStatus()} disabled={snap.busy}>刷新</button>
        </div>
      </div>
    </div>
  );
}

const CHECK_STORE = "veridrop.check.v1";

function readCheckStore() {
  try {
    return JSON.parse(localStorage.getItem(CHECK_STORE) || "{}") || {};
  } catch {
    return {};
  }
}

function modelListUrls(raw) {
  const parsed = basicBase(raw);
  if (parsed.error) return parsed;
  const url = new URL(parsed.base);
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(chat\/completions|responses|messages|models)$/i, "");
  url.pathname = path || "/";
  url.search = "";
  url.hash = "";
  const base = url.toString().replace(/\/$/, "");
  const root = /\/v1$/i.test(base) ? base : `${base}/v1`;
  const bare = base.replace(/\/v1$/i, "");
  const models = `${root}/models`;
  const alt = `${bare}/models`;
  return { urls: alt === models ? [models] : [models, alt] };
}

function parseModelIds(payload) {
  const rows = [];
  const push = (id) => {
    const text = String(id || "").trim();
    if (text && !rows.includes(text)) rows.push(text);
  };
  const data = payload && (Array.isArray(payload.data) ? payload.data : payload.models || payload);
  const list = Array.isArray(data) ? data : [];
  list.forEach((item) => {
    if (typeof item === "string") push(item);
    else if (item && typeof item === "object") push(item.id || item.name || item.model);
  });
  rows.sort((a, b) => a.localeCompare(b));
  return rows;
}

function shortModelError(err, secret) {
  let text = String(err?.message || "");
  if (secret) text = text.split(secret).join("");
  if (!text || /failed to fetch|networkerror|load failed|network error/i.test(text)) {
    return "没有读到模型列表，先用页面里的常用模型";
  }
  const line = text.split(/[。\n]/)[0].trim().slice(0, 36);
  return line ? `没有读到模型列表：${line}` : "没有读到模型列表，先用页面里的常用模型";
}

async function requestModelIds(raw, secret, signal) {
  const target = modelListUrls(raw);
  if (target.error) throw new Error(target.error);
  let last = null;
  for (const href of target.urls) {
    try {
      const res = await fetch(href, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const message = (json && (json.error?.message || json.message)) || text || `HTTP ${res.status}`;
        last = new Error(String(message));
        continue;
      }
      return parseModelIds(json);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      last = err;
    }
  }
  throw last || new Error("没有读到模型列表");
}

function basicBase(raw) {
  let text = String(raw || "").trim();
  if (!text) return { error: "请填写 API 接口地址" };
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { error: "接口地址无法解析" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "只支持 http 或 https" };
  if (parsed.username || parsed.password) return { error: "地址里不要写密钥，请填到 Key 输入框" };
  if (parsed.searchParams.has("key") || parsed.searchParams.has("api_key") || parsed.searchParams.has("token")) {
    return { error: "地址里不要放 Key，请填到单独的输入框" };
  }
  if (!parsed.hostname) return { error: "接口地址缺少域名" };
  return { base: text };
}

export function Tester({ extended = false }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("claude-opus-5");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(false);
  const [ready, setReady] = useState(!extended);
  const [fetchedModels, setFetchedModels] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const menuRef = useRef(null);
  const modelRef = useRef(model);
  const fetchedToken = useRef("");
  const loadingRef = useRef(false);
  const timerRef = useRef(0);
  modelRef.current = model;
  const known = headlineModels.find((item) => item.id === model);
  const picked = known || (extended ? { id: model, label: model } : headlineModels[2]);
  const choices = fetchedModels?.length
    ? fetchedModels.map((id) => headlineModels.find((item) => item.id === id) || { id, label: id })
    : headlineModels;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!extended) return undefined;
    const data = readCheckStore();
    if (data.base) setUrl(String(data.base));
    if (data.model) setModel(String(data.model));
    if (data.remember && data.key) {
      setRemember(true);
      setKey(String(data.key));
    }
    setReady(true);
    return undefined;
  }, [extended]);

  useEffect(() => {
    if (!extended || !ready) return undefined;
    const data = { base: url.trim(), model, remember };
    if (remember) data.key = key;
    localStorage.setItem(CHECK_STORE, JSON.stringify(data));
    return undefined;
  }, [extended, ready, url, model, remember, key]);

  useEffect(() => {
    if (!extended || !ready) return undefined;
    const base = url.trim();
    const secret = key.trim();
    if (!base || secret.length < 8) {
      if (!base || !secret) setStatus("");
      return undefined;
    }
    const token = `${base}\n${secret}`;
    if (token === fetchedToken.current || loadingRef.current) return undefined;
    setStatus("正在读取模型…");
    timerRef.current = window.setTimeout(() => {
      loadModels(token);
    }, 600);
    return () => window.clearTimeout(timerRef.current);
  }, [extended, ready, url, key]);

  async function loadModels(token) {
    if (loadingRef.current) return;
    const secret = key.trim();
    loadingRef.current = true;
    setLoading(true);
    setStatus("正在读取模型…");
    const ctrl = new AbortController();
    try {
      const listed = await requestModelIds(url, secret, ctrl.signal);
      if (!listed.length) {
        setStatus("接口有响应，但没有模型 id");
        return;
      }
      setFetchedModels(listed);
      const previous = modelRef.current;
      setModel(listed.includes(previous) ? previous : listed[0]);
      fetchedToken.current = token;
      setStatus(`已读取 ${listed.length} 个模型`);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setStatus(shortModelError(err, secret));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function fetchModelsNow() {
    window.clearTimeout(timerRef.current);
    const base = url.trim();
    const secret = key.trim();
    if (!base || secret.length < 8) {
      setStatus("先填写地址和 Key");
      return;
    }
    fetchedToken.current = "";
    loadModels(`${base}\n${secret}`);
  }

  function begin(suite) {
    const parsed = basicBase(url);
    if (parsed.error) {
      setResult({ error: parsed.error });
      return;
    }
    if (!key.trim()) {
      setResult({ error: "请填写 API KEY" });
      return;
    }
    const started = startCheckJob({
      suite,
      base: parsed.base,
      key: key.trim(),
      modelId: picked.id,
      model: picked.label,
      candyCount: 10,
    });
    if (!started.ok) {
      setResult({ error: started.error || "上一轮还在进行中" });
      return;
    }
    setResult(null);
    navigate(suite === "all" ? `/check/detect?run=${encodeURIComponent(started.id)}` : `/b/${started.id}`);
  }

  return (
    <div className="dz">
      <div className="hdcard">
        <div className={extended ? "hdrow3 extra" : "hdrow3"}>
          <div className="hdf">
            <label>API 接口地址</label>
            <div className="ipt">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input placeholder="https://api.anthropic.com" value={url} onChange={(event) => setUrl(event.target.value)} />
            </div>
          </div>
          <div className="hdf">
            <label>API KEY</label>
            <div className="ipt">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="8" cy="15" r="4" />
                <path d="m10.8 12.2 8.2-8.2M16 6l3 3M14 8l2 2" />
              </svg>
              <input type={extended && showKey ? "text" : "password"} placeholder="sk-..." value={key} onChange={(event) => setKey(event.target.value)} />
              {extended ? (
                <button type="button" className="keysee" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button>
              ) : null}
            </div>
          </div>
          <div className="hdf" ref={menuRef}>
            <label>目标模型</label>
            <div className="hdmodel">
              <div className="hdselect">
                <button type="button" className="hddd" onClick={() => setOpen((value) => !value)}>
                  <span className="hddd-lab">
                    <VendorIcon name={vendorOfModel(picked.id)} />
                    <span>{picked.label}</span>
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {open ? (
                  <div className={extended ? "model-menu tall" : "model-menu"}>
                    {choices.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={item.id === picked.id ? "on" : ""}
                        onClick={() => {
                          setModel(item.id);
                          setOpen(false);
                        }}
                      >
                        <span className="mlab"><VendorIcon name={vendorOfModel(item.id)} /><span>{item.label}</span></span>
                        {item.fresh ? <span className="pnew">NEW</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {extended ? (
                <button type="button" className="hfetch" onClick={fetchModelsNow} disabled={loading}>获取模型列表</button>
              ) : null}
            </div>
            {extended && status ? <p className="hdstatus">{status}</p> : null}
            {extended && picked.id ? <p className="hdstatus">{/claude|anthropic/i.test(picked.id) ? "Claude Messages" : "OpenAI 兼容"}</p> : null}
          </div>
        </div>
        {extended ? (
          <div className="hdfoot">
            <label className="hdremember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              把 Key 记在这台浏览器
            </label>
            <span>{remember ? "Key 记在这台浏览器" : "Key 只留在这次打开的页面里"}</span>
          </div>
        ) : null}
        <div className="hdrow2">
          {extended ? <button type="button" className="go-side" onClick={() => begin("all")}>三项一起测</button> : null}
          <button type="button" className="go" onClick={() => begin("basic")}>开始基础测试</button>
        </div>
        {result?.error ? <div className="hderr">{result.error}</div> : null}
      </div>
      <div className="hdcap">
        <span>为保障账户安全，建议优先使用测试专用 KEY。结果会打开单独的检测报告。</span>
        <Link to="/history">
          检测历史
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

function stationSite(item) {
  const url = String(item?.site || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function StationJump({ item }) {
  const href = stationSite(item);
  const label = stationHeading(item);
  if (!href) return <div className="site-name" title={label}>{label}</div>;
  return (
    <a className="rank-jump" href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      <span title={label}>{label}</span>
      <svg className="st-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17 17 7M8 7h9v9" />
      </svg>
    </a>
  );
}

function commentScore(item, remote) {
  const keys = new Set([item.slug, item.siteToken, ...(item.aliases || [])].filter(Boolean));
  const rows = [...(item.reviews || [])];
  for (const row of remote || []) {
    if (keys.has(row.slug)) rows.push(row);
  }
  const rated = rows.filter((row) => Number(row.rating) > 0);
  if (!rated.length) return null;
  const sum = rated.reduce((total, row) => total + Number(row.rating), 0);
  return { rating: sum / rated.length, count: rated.length };
}

function RankTable({ rows, mode }) {
  const navigate = useNavigate();
  const [favs, setFavs] = useState(readFavs);
  const [remoteComments, setRemoteComments] = useState([]);
  useEffect(() => {
    const sync = () => setFavs(readFavs());
    window.addEventListener("okk-account", sync);
    return () => window.removeEventListener("okk-account", sync);
  }, []);
  useEffect(() => {
    if (mode === "list") return undefined;
    let stop = false;
    fetchComments("").then((data) => {
      if (!stop) setRemoteComments(Array.isArray(data.comments) ? data.comments : []);
    }).catch(() => {});
    return () => { stop = true; };
  }, [mode]);
  const list = mode === "list";
  return (
    <div className="table-wrap">
      <table className={list ? "rank list" : "rank home"}>
        {list ? (
          <colgroup>
            <col className="c-fav" />
            <col className="c-site" />
            <col className="c-up" />
            <col className="c-lat" />
            <col className="c-min" />
            <col className="c-pay" />
            <col className="c-inv" />
            <col className="c-ref" />
            <col className="c-mod" />
          </colgroup>
        ) : (
          <colgroup>
            <col className="c-fav" />
            <col className="c-site" />
            <col className="c-up" />
            <col className="c-pay" />
            <col className="c-tag" />
            <col className="c-rate" />
            <col className="c-mod" />
          </colgroup>
        )}
        <thead>
          {mode === "home" ? (
            <tr>
              <th />
              <th>站点</th>
              <th>运行质量</th>
              <th>支付方式</th>
              <th>分类</th>
              <th>用户口碑</th>
              <th>模型覆盖</th>
            </tr>
          ) : (
            <tr>
              <th />
              <th>站点</th>
              <th>在线率</th>
              <th>平均延迟</th>
              <th>最低充值</th>
              <th>支付方式</th>
              <th>发票</th>
              <th>退款</th>
              <th>支持模型</th>
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.slug} className="click" onClick={() => navigate(stationPath(item))}>
              <td><StarButton on={Boolean(favs[item.slug])} onToggle={() => setFavs(toggleFav(item.slug))} /></td>
              <td>
                <div className={list ? "slb-st" : "site-cell"}>
                  <Logo station={item} />
                  <div className={list ? "slb-stn" : "site-id"}>
                    <StationJump item={item} />
                    {mode === "home" ? (
                      <div className="site-meta">
                        {item.listed ? <>收录于 {item.listed}</> : null}
                        {item.issue ? <span className="issue">访问异常</span> : null}
                      </div>
                    ) : (
                      <div className="slb-tags">
                        {item.issue ? <span className="issue">访问异常</span> : null}
                        {item.tags.map((tag) => (
                          <span key={tag} className={tagTone(tag)}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              {mode === "home" ? (
                <>
                  <td>
                    <div className="mini">在线率 <b className={uptimeTone(item.uptime)}>{showUptime(item.uptime)}</b></div>
                    <div className="mini">平均延迟 {showLatency(item.latency)}</div>
                  </td>
                  <td>
                    <Pays list={item.pay.length ? item.pay : ["wechat", "alipay"]} />
                  </td>
                  <td>
                    {item.tags.length ? (
                      <div className="home-tags">
                        {item.tags.map((tag) => (
                          <span key={tag} className={tagTone(tag)}>{tag}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="mini">—</span>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const score = commentScore(item, remoteComments);
                      return score ? (
                        <span className="rate">
                          {score.rating.toFixed(1)} <span className="star">★</span> <small>（{score.count}）</small>
                        </span>
                      ) : (
                        <span className="mini">暂无评分</span>
                      );
                    })()}
                  </td>
                  <td>
                    <Coverage count={item.modelsHome} vendors={item.vendors} />
                  </td>
                </>
              ) : (
                <>
                  <td><span className={`slb-v ${uptimeTone(item.uptime)}`}>{showUptime(item.uptime)}</span></td>
                  <td><span className={`slb-v ${latencyTone(item.latency)}`}>{showLatency(item.latency)}</span></td>
                  <td><span className="slb-v">{moneyOf(item.min).label}</span></td>
                  <td><Pays list={item.pay.length ? item.pay : ["wechat", "alipay"]} /></td>
                  <td><ListMark value={item.invoice} /></td>
                  <td><ListMark value={item.refund} /></td>
                  <td className="r">
                    <span className="slb-v">{item.modelsList}</span>
                    <span className="slb-unit">个</span>
                    <ModelStack vendors={item.vendors} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REC_PICKS = [
  ["3-aicodemirror-ai", "aicodemirror.png", "企业", "biz"],
  ["5-foxcode-rjj-cc", "foxcode.png", "低延迟", "fast"],
  ["800003-newapi-gogogogoapp-mom", "gogateway.png", "站长在用", "mine"],
  ["1461-bmapi-020212-xyz", "bm.png", "公益", "ok"],
  ["1466-api-968api-com", "968.svg", "低倍率", "hot"],
  ["800001-ezapi-site", "ezapi.jpg", "赠额", "gift"],
  ["1367-wawazz-xyz", "wawa.png", "发票", "bill"],
  ["1510-ergouapi-com", "ergou.jpg", "低倍率", "hot"],
  ["2825-api-hubway-cc", "hubway.png", "站长在用", "mine"],
  ["1399-mcgrox-top", "mcgrox.png", "公益", "ok"],
  ["50-anyrouter-top", "anyrouter.png", "公益", "ok"],
  ["205-deepkey-top", "deepkey.png", "低倍率", "hot"],
  ["1264-code28-ccwu-cc", "kele.png", "低倍率", "hot"],
  ["1432-tokenrhythm-studio", "jiyuan.png", "公益", "ok"],
];

function recLatency(station) {
  const text = String(station.meanLatency || "");
  const matched = text.match(/(\d+(?:\.\d+)?)/);
  if (matched && /ms/i.test(text)) {
    const ms = Number(matched[1]);
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const seconds = Number(station.latency);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
}

const REC_ROWS = REC_PICKS.map(([slug, file, tag, tone]) => {
  const station = findStation(slug);
  if (!station) return null;
  return {
    slug,
    name: station.name,
    path: station.path,
    img: `/media/recs/${file}`,
    tag,
    tone,
    latency: recLatency(station),
  };
}).filter(Boolean);

function recAverage() {
  const values = stations
    .map((station) => (station.uptime == null ? null : Number(station.uptime)))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return "—";
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${avg.toFixed(1)}%`;
}

const REC_UPTIME = recAverage();

function RecMark({ src, name }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="logo-sq fallback">{name.slice(0, 1)}</span>;
  return <img className="logo-sq" src={src} alt="" onError={() => setFailed(true)} />;
}

function RecRow({ item, loop = false }) {
  return (
    <Link className="rec-row" to={item.path} aria-hidden={loop || undefined} tabIndex={loop ? -1 : undefined}>
      <RecMark src={item.img} name={item.name} />
      <span className="grow">{item.name}</span>
      <span className={`rec-tag ${item.tone}`}>{item.tag}</span>
      <span className="rec-ms">{item.latency}</span>
      <span className="chev" aria-hidden="true">›</span>
    </Link>
  );
}

function RecommendCard() {
  return (
    <div className="rec-panel">
      <div className="tally-row">
        <Link to="/list">
          <i className="tico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
            </svg>
          </i>
          <span>
            <b>{stationTotal}</b>
            <span className="cap">中转站</span>
          </span>
        </Link>
        <Link to="/availability">
          <i className="tico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4.2l2.2-5.5 4.2 11 2.2-5.5H21" />
            </svg>
          </i>
          <span>
            <b>{REC_UPTIME}</b>
            <span className="cap">平均在线率</span>
          </span>
        </Link>
      </div>
      <div className="rec-h">推荐站点</div>
      <div className="rec-view">
        <div className="rec-track">
          {REC_ROWS.map((item) => (
            <RecRow key={item.slug} item={item} />
          ))}
          {REC_ROWS.map((item) => (
            <RecRow key={`${item.slug}-loop`} item={item} loop />
          ))}
        </div>
      </div>
    </div>
  );
}

const HOME_CAT_ROWS = [
  {
    label: "类型",
    items: [
      ["all", "全部", "#65A30D"],
      ["charity", "公益站", "#1f9d57"],
      ["stable", "企业", "#3b82f6"],
      ["owner", "站长在用", "#8b5cf6"],
      ["gift", "赠额", "#e39b12"],
      ["new", "新站上榜", "#2563eb"],
      ["online", "当前在线", "#16a34a"],
    ],
  },
  {
    label: "能力",
    items: [
      ["cheaprate", "低倍率", "#8b919a"],
      ["fast", "低延迟", "#f0a202"],
      ["invoice", "发票", "#0f9f90"],
      ["highup", "高可用", "#14b8a6"],
      ["pay", "国内支付", "#1f9d57"],
    ],
  },
];

function homeCatHit(station, id) {
  if (id === "all") return true;
  if (id === "online") return station.online === true;
  const cats = station.categories || [];
  if (id === "owner") return Boolean(station.ownerPick) || cats.includes("owner");
  return cats.includes(id);
}

const HOME_CAT_COUNTS = {
  all: stations.length,
  charity: 0,
  stable: 0,
  owner: 0,
  gift: 0,
  new: 0,
  online: 0,
  cheaprate: 0,
  fast: 0,
  invoice: 0,
  highup: 0,
  pay: 0,
};
for (const station of stations) {
  const cats = new Set(station.categories || []);
  for (const id of Object.keys(HOME_CAT_COUNTS)) {
    if (id === "all" || id === "owner" || id === "online") continue;
    if (cats.has(id)) HOME_CAT_COUNTS[id] += 1;
  }
  if (station.ownerPick || cats.has("owner")) HOME_CAT_COUNTS.owner += 1;
  if (station.online === true) HOME_CAT_COUNTS.online += 1;
}

function CatGlyph({ id }) {
  if (id === "all") {
    return (
      <>
        <path d="m12.8 2.4 8.2 4.1a1 1 0 0 1 0 1.8l-8.2 4.1a2 2 0 0 1-1.6 0L3 8.3a1 1 0 0 1 0-1.8l8.2-4.1a2 2 0 0 1 1.6 0Z" />
        <path d="m21.2 13.2-8.4 4.2a2 2 0 0 1-1.6 0L2.8 13.2" />
        <path d="m21.2 17.4-8.4 4.2a2 2 0 0 1-1.6 0L2.8 17.4" />
      </>
    );
  }
  if (id === "charity") {
    return (
      <>
        <path d="m11 17 2 2a1 1 0 1 0 3-3" />
        <path d="m14 14 2.5 2.5a2.1 2.1 0 1 0 3-3L15 9" />
        <path d="m8 8 2.5 2.5" />
        <path d="M2 12 6.5 7.5a2.1 2.1 0 0 1 3 0l5 5" />
        <path d="m7 17-1.5 1.5a2.1 2.1 0 0 1-3-3L7 11" />
        <path d="m17 8 1.5-1.5a2.1 2.1 0 0 1 3 3L17 14" />
      </>
    );
  }
  if (id === "stable") {
    return (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
        <path d="M3 12h18" />
      </>
    );
  }
  if (id === "owner") {
    return (
      <>
        <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
        <path className="f" d="m12 7.5 1.05 2.15 2.35.32-1.7 1.62.42 2.35L12 12.8l-2.12 1.14.42-2.35-1.7-1.62 2.35-.32L12 7.5z" />
      </>
    );
  }
  if (id === "new") {
    return (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 8.2v7.6M8.2 12h7.6" />
      </>
    );
  }
  if (id === "online") {
    return (
      <>
        <path d="M5 12a7 7 0 0 1 14 0" />
        <path d="M8.2 12a3.8 3.8 0 0 1 7.6 0" />
        <circle className="f" cx="12" cy="16.4" r="1.3" />
      </>
    );
  }
  if (id === "gift") {
    return (
      <>
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v11" />
        <path d="M19 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5V12" />
        <path d="M7.6 8a2.4 2.4 0 0 1 0-4.6C10.6 3.4 12 8 12 8s1.4-4.6 4.4-4.6A2.4 2.4 0 0 1 16.4 8" />
      </>
    );
  }
  if (id === "cheaprate") {
    return (
      <>
        <path d="M4.8 16.2a8.2 8.2 0 1 1 14.4 0" />
        <path d="M12 15.2 16.6 9.2" />
        <path d="M7.2 19h9.6" />
        <circle className="f" cx="12" cy="15.2" r="1.25" />
      </>
    );
  }
  if (id === "fast") {
    return (
      <>
        <path d="M4.8 12.2a9.2 9.2 0 0 1 14.4 0" />
        <path d="M7.6 15a5.4 5.4 0 0 1 8.8 0" />
        <circle className="f" cx="12" cy="17.8" r="1.15" />
      </>
    );
  }
  if (id === "invoice") {
    return (
      <>
        <path d="M7 3.5h7.2L19 8.2V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
        <path d="M14 3.5V8.5h5" />
        <path d="M9 13h6M9 16.5h4" />
      </>
    );
  }
  if (id === "pay") {
    return (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <text className="f" x="12" y="16.1" textAnchor="middle" fontSize="11" fontFamily="sans-serif">¥</text>
      </>
    );
  }
  return (
    <>
      <rect x="3.5" y="4" width="17" height="6" rx="1.6" />
      <rect x="3.5" y="14" width="17" height="6" rx="1.6" />
      <circle className="f" cx="7" cy="7" r="1" />
      <circle className="f" cx="7" cy="17" r="1" />
    </>
  );
}

function RankCats({ current, onPick }) {
  return (
    <div className="rank-cats" id="rank-cats">
      {HOME_CAT_ROWS.map((row) => (
        <div className="rc-line" key={row.label}>
          <span className="rc-lab">{row.label}</span>
          <div className="rc-set" role="group" aria-label={row.label}>
            {row.items.map(([id, name, color]) => {
              const on = current === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={on ? "chip on" : "chip"}
                  style={{ "--ico": color }}
                  aria-pressed={on}
                  onClick={() => onPick(id)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <CatGlyph id={id} />
                  </svg>
                  <span>{name}</span>
                  <b>{HOME_CAT_COUNTS[id]}</b>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const STAR_D = "M0-12C1.15-3.2 3.2-1.15 12 0 3.2 1.15 1.15 3.2 0 12-1.15 3.2-3.2 1.15-12 0-3.2-1.15-1.15-3.2 0-12Z";
const CORE_D = "M0-4.2C.45-1.15 1.15-.45 4.2 0 1.15.45.45 1.15 0 4.2-.45 1.15-1.15.45-4.2 0-1.15-.45-.45-1.15 0-4.2Z";

// Centers are relative to the title block. Negative left sits in the left gutter.
const HERO_STARS = [
  ["-40px", "18px", 22, 0.9],
  ["-120px", "-48px", 12, 0.46, "star-far"],
  ["-86px", "86px", 8, 0.34, "star-far"],
  ["-200px", "-8px", 14, 0.42, "star-far"],
  ["-260px", "48px", 9, 0.3, "star-far"],
  ["-168px", "-78px", 10, 0.32, "star-far"],
  ["-156px", "138px", 11, 0.38, "star-far"],
  ["-64px", "176px", 15, 0.48],
  ["-230px", "188px", 17, 0.44, "star-far"],
  ["-24px", "220px", 7, 0.28],
  ["-128px", "236px", 8, 0.26, "star-far"],
  ["-300px", "16px", 7, 0.24, "star-far"],
  ["-320px", "112px", 6, 0.22, "star-far"],
  ["14%", "-84px", 9, 0.38],
  ["32%", "-86px", 15, 0.46],
  ["56%", "-74px", 7, 0.28],
  ["76%", "-80px", 12, 0.38],
  ["46%", "-40px", 5, 0.22],
  ["8%", "-28px", 5, 0.22],
  ["470px", "-18px", 12, 0.4, "star-wide"],
  ["560px", "-62px", 8, 0.3, "star-wide"],
  ["650px", "24px", 6, 0.24, "star-wide"],
  ["530px", "112px", 11, 0.34, "star-wide"],
  ["660px", "164px", 14, 0.38, "star-wide"],
  ["590px", "214px", 7, 0.24, "star-wide"],
  ["500px", "148px", 10, 0.32, "star-wide"],
  ["430px", "210px", 8, 0.28, "star-wide"],
];

function HeroStars() {
  return (
    <div className="hero-stars" aria-hidden="true">
      {HERO_STARS.map(([left, top, size, opacity, kind]) => (
        <svg key={`${left}-${top}`} className={kind || undefined} viewBox="-16 -16 32 32" style={{ left, top, width: size, height: size, opacity }}>
          <path d={STAR_D} />
          <path className="core" d={CORE_D} />
        </svg>
      ))}
    </div>
  );
}

export function HomePage() {
  useTitle("");
  const [page, setPage] = useState(1);
  const [cat, setCat] = useState("all");
  const pageSize = 20;
  const filtered = useMemo(
    () => (cat === "all" ? stations : stations.filter((station) => homeCatHit(station, cat))),
    [cat],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  function pickCat(id) {
    setCat(id);
    setPage(1);
  }
  return (
    <>
    <OfficialStrip />
    <div className="wrap">
      <header className="hero">
        <div className="hero-top">
          <div className="hero-copy">
            <HeroStars />
            <h1>
              发现<span className="g">好用</span>的 AI 中转站
            </h1>
            <div className="hero-actions">
              <Link to="/list" className="hero-cta">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 7h14M5 12h14M5 17h14" />
                </svg>
                查看站点排行
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link to="/check" className="hero-cta hero-cta-line">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3.2 13.4 8.4 18.8 10 13.4 11.6 12 16.8 10.6 11.6 5.2 10 10.6 8.4 12 3.2Z" />
                </svg>
                开始检测
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
            <div className="hero-notes">
              <a href="#rank-cats">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                  <circle cx="9" cy="7" r="1.7" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none" />
                  <circle cx="8" cy="17" r="1.7" fill="currentColor" stroke="none" />
                </svg>
                按分类看
              </a>
              <span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="8" cy="15" r="3.2" />
                  <path d="M10.8 12.4 19 5.2M15.4 7.4l2.4 2.4M13.4 9.4l2 2" />
                </svg>
                Key 留在浏览器
              </span>
              <Link to="/reputation">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M6 19V11M12 19V6M18 19v-6" />
                </svg>
                投票可对照
              </Link>
            </div>
          </div>
          <RecommendCard />
        </div>
        <Tester />
      </header>

      <section className="stat-grid">
        <article className="card">
          <div className="card-hd">
            模型智商榜 <Link className="more" to="/tools/iq">查看更多 ›</Link>
          </div>
          {iq.slice(0, 3).map((item, index) => (
            <Link key={item.name} to="/tools/iq" className="rank-row">
              <span className="n">{index + 1}</span>
              <Vendor name={item.vendor} />
              <span>{item.name}</span>
              <span className="sc">{item.score}</span>
            </Link>
          ))}
        </article>
        <article className="card">
          <div className="card-hd">
            Codex 额度重置 <Link className="more" to="/tools/codex-resets">查看更多 ›</Link>
          </div>
          <div className="kv"><span>距上次重置</span><b>{latestCodex().label}</b></div>
          <div className="kv"><span>最近一次重置</span><b>{latestCodex().day}</b></div>
          <div className="kv">
            <span>近 7 天</span>
            <span className="bars">
              {[1, 1, 1, 0, 1, 0, 1].map((on, index) => (
                <i key={index} className={on ? "on" : "mid"} />
              ))}
            </span>
          </div>
        </article>
        <article className="card">
          <div className="card-hd">
            最新实测 <Link className="more" to="/list">查看更多 ›</Link>
          </div>
          {latestTests.slice(0, 3).map((item) => (
            <Link key={item.model + item.slug} to={stationPath({ slug: item.slug, path: item.path })} className="test-row">
              <Vendor name={item.vendor} />
              <span>{item.model}</span>
              <span className="channel">{item.channel}</span>
              <span className="date">{item.date}</span>
            </Link>
          ))}
        </article>
      </section>

      <section className="section">
        <div className="section-hd">
          <h2>站点排行</h2>
          <Link className="more" to="/list">查看更多 ›</Link>
        </div>
        <RankCats current={cat} onPick={pickCat} />
        {rows.length ? <RankTable rows={rows} mode="home" /> : <div className="empty">这个分类下还没有站点</div>}
        <Pager page={safePage} pages={pages} onPage={setPage} />
      </section>

      <section className="section">
        <div className="section-hd">
          <h2>投票精选</h2>
          <Link className="more" to="/reputation">查看更多 ›</Link>
        </div>
        <div className="review-grid">
          {reviews.slice(0, 6).map((item) => (
            <ReviewCard key={item.id || item.user + item.station} item={item} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-hd">
          <h2>福利羊毛</h2>
          <Link className="more" to="/activity">查看更多 ›</Link>
        </div>
        <SlideRow className="perk-grid">
          {perks.map((item) => (
            <article key={item.name} className="perk">
              <span className={`kind ${item.kind === "中转站福利" ? "warn" : ""}`}>{item.kind}</span>
              <h3>{item.name}</h3>
              <div className="host">{item.host}</div>
              <p>{item.desc}</p>
              <div className="tags">
                {item.tags.map((tag) => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
              <a className="go-line" href={item.href} target="_blank" rel="noreferrer">立即前往</a>
            </article>
          ))}
        </SlideRow>
      </section>
    </div>
    </>
  );
}

const CAT_FILTERS = [["all", "全部"], ...CATS, ["fav", "我的收藏"]];
const MODEL_FILTERS = [["all", "全部"], ...VERD_MODELS];

function SlideRow({ className, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame = 0;
    let paused = false;
    let last = 0;
    const tick = (now) => {
      frame = window.requestAnimationFrame(tick);
      if (paused || document.hidden) {
        last = now;
        return;
      }
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const half = el.scrollWidth / 2;
      const step = last ? Math.min(48, now - last) : 16;
      last = now;
      el.scrollLeft += step * 0.045;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
    };
    const pause = () => { paused = true; };
    const play = () => { paused = false; last = 0; };
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", play);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerleave", play);
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      <div className="slide-set">{children}</div>
      <div className="slide-set" aria-hidden="true">{children}</div>
    </div>
  );
}

function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  const items = [1];
  const start = Math.max(2, page - 2);
  const end = Math.min(pages - 1, page + 2);
  if (start > 2) items.push("left");
  for (let n = start; n <= end; n += 1) items.push(n);
  if (end < pages - 1) items.push("right");
  if (pages > 1) items.push(pages);
  return (
    <div className="pager">
      <button type="button" className="step" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      {items.map((item) => (
        typeof item === "string"
          ? <span key={item} className="gap">…</span>
          : <button key={item} type="button" className={page === item ? "on" : ""} onClick={() => onPage(item)}>{item}</button>
      ))}
      <button type="button" className="step" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  );
}

export function ListPage({ modelId = "" }) {
  const route = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const cat = route.cat || searchParams.get("cat") || "all";
  const model = modelId || "";
  const catMeta = CAT_SEO[cat];
  const modelMeta = MODEL_SEO[model];
  const heading = modelMeta?.h1 || catMeta?.h1 || "AI 中转站排行榜";
  useTitle(modelMeta?.title || catMeta?.title || "AI 中转站排行榜｜在线率、延迟、最低充值、支付和发票");
  const [q, setQ] = useState("");
  const [pay, setPay] = useState("all");
  const [min, setMin] = useState("all");
  const [invoice, setInvoice] = useState("all");
  const [sort, setSort] = useState("overall");
  const [menu, setMenu] = useState("");
  const [spin, setSpin] = useState(false);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const favs = cat === "fav" ? readFavs() : null;
    let list = stations.filter((item) => {
      if (!matchesCategory(item, cat, favs)) return false;
      if (model && !(item.modelIds || []).includes(model)) return false;
      if (q && !`${item.name} ${item.host || ""} ${item.blurb} ${item.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (pay !== "all" && !item.pay.includes(pay)) return false;
      const money = moneyOf(item.min);
      if (min === "le10" && !(money.kind === "cny" && money.amount != null && money.amount <= 10)) return false;
      if (min === "gt10" && !(money.kind === "cny" && money.amount != null && money.amount > 10)) return false;
      if (min === "usd" && money.kind !== "usd") return false;
      if (invoice === "yes" && item.invoice !== "✓") return false;
      if (invoice === "no" && item.invoice !== "✗") return false;
      if (invoice === "cond" && !/其他|有条件/.test(String(item.invoice))) return false;
      return true;
    });
    return [...list].sort((a, b) => compareStations(a, b, sort === "latency" || sort === "uptime" ? sort : "overall"));
  }, [q, pay, min, invoice, sort, cat, model]);
  useEffect(() => setPage(1), [q, pay, min, invoice, sort, cat, model]);

  function goCat(key) {
    if (model) {
      navigate(key === "all" ? `/model/${model}` : `/model/${model}?cat=${key}`);
      return;
    }
    navigate(key === "all" ? "/list" : `/cat/${key}`);
  }

  function goModel(key) {
    if (key === "all") {
      navigate(cat !== "all" ? `/cat/${cat}` : "/list");
      return;
    }
    navigate(cat !== "all" && cat !== "fav" ? `/model/${key}?cat=${cat}` : `/model/${key}`);
  }
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setMenu("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const view = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="wrap">
      <div className={cat === "charity" ? "page-hd charity-hd" : "page-hd"}>
        <div>
          <h1>{heading}</h1>
          <p className="sub">
            {modelMeta?.desc || catMeta?.desc || `收录 ${stationTotal} 站，${modelTotal} 个模型 | 按在线率排序，充值门槛、支付方式、发票退款、延迟横向对比`}
            {cat !== "all" || model ? ` 当前 ${rows.length} 家。` : ""}
          </p>
        </div>
        <Link to="/apply" className="outline">申请收录</Link>
      </div>
      {cat === "charity" ? (
        <section className="charity-notes">
          {CHARITY_SECTIONS.map((section) => (
            <article key={section.h}>
              <h2>{section.h}</h2>
              <p>{section.p}</p>
            </article>
          ))}
          <div className="charity-faq">
            {CHARITY_FAQ.map((item) => (
              <p key={item[0]}><b>{item[0]}</b> {item[1]}</p>
            ))}
          </div>
        </section>
      ) : null}
      <SponsorStrip items={listSponsors} />
      <div className="slb-pcfilter">
        <label className="slb-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input placeholder="搜索站点 / 简介" value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <div className="slb-controls">
          <FilterPill label="分类" options={CAT_FILTERS} current={cat} open={menu} onOpen={setMenu} onPick={goCat} />
          <FilterPill label="模型" options={MODEL_FILTERS} current={model || "all"} open={menu} onOpen={setMenu} onPick={goModel} />
          <FilterPill label="支付方式" options={PAY_FILTERS} current={pay} open={menu} onOpen={setMenu} onPick={setPay} />
          <FilterPill label="最低充值" options={MIN_FILTERS} current={min} open={menu} onOpen={setMenu} onPick={setMin} />
          <FilterPill label="发票" options={INV_FILTERS} current={invoice} open={menu} onOpen={setMenu} onPick={setInvoice} />
          <FilterPill label="排序" options={SORT_FILTERS} current={sort} open={menu} onOpen={setMenu} onPick={setSort} />
          <button
            type="button"
            className={`slb-refresh${spin ? " spin" : ""}`}
            aria-label="刷新"
            onClick={() => {
              setSpin(true);
              window.setTimeout(() => setSpin(false), 600);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.6-6.4" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>
      {view.length ? <RankTable rows={view} mode="list" /> : <div className="empty">没有符合条件的站点</div>}
      <Pager page={page} pages={pageCount} onPage={setPage} />
    </div>
  );
}

function Delta({ value }) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const up = Number(value) >= 0;
  return <span className={up ? "up" : "down"}>{up ? "▲" : "▼"} {Math.abs(Number(value)).toFixed(2)}% (7D)</span>;
}

function splitStat(value) {
  const text = String(value || "—");
  if (text === "—" || text === "") return { kind: "empty", text: "—" };
  if (text === "✓" || text === "是") return { kind: "ok", label: "是", sub: "" };
  if (text === "✗" || text === "否") return { kind: "no", label: "否", sub: "" };
  const match = text.match(/^(其他|有条件|是|否)[:：]\s*(.*)$/);
  if (!match) return { kind: "text", text };
  const kind = match[1] === "是" ? "ok" : match[1] === "否" ? "no" : "cond";
  return { kind, label: match[1], sub: match[2] };
}

function StatValue({ value }) {
  const stat = splitStat(value);
  if (stat.kind === "empty" || stat.kind === "text") return stat.text;
  return (
    <span className="statline">
      <span className={`pstat ${stat.kind}`}>– {stat.label}</span>
      {stat.sub ? <span className="psub">{stat.sub}</span> : null}
    </span>
  );
}

function Meter({ value }) {
  const count = 30;
  const on = value == null ? 0 : Math.max(0, Math.min(count, Math.round((Number(value) / 100) * count)));
  return (
    <div className="meter">
      {Array.from({ length: count }, (_, index) => <i key={index} className={index < on ? "on" : ""} />)}
    </div>
  );
}

function radarScale(name, raw) {
  const value = Number(raw);
  const missing = raw == null || raw === "" || !Number.isFinite(value);
  if (name === "纯度") return missing || value <= 0 ? 1 : Math.max(0, Math.min(100, value)) / 100;
  if (missing) return 1;
  return Math.max(0, Math.min(100, value)) / 100;
}

function RadarChart({ dims }) {
  const order = ["纯度", "稳定", "速度", "价格", "模型"];
  const cx = 120;
  const cy = 118;
  const radius = 74;
  const point = (index, scale) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / order.length;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  };
  const ring = (scale) => order.map((_, index) => point(index, scale).join(",")).join(" ");
  const data = order
    .map((name, index) => point(index, radarScale(name, dims?.[name])).join(","))
    .join(" ");
  return (
    <svg className="radar-svg" viewBox="0 0 240 236" role="img" aria-label="综合对比">
      {[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={ring(scale)} fill="none" stroke="#ececee" />)}
      {order.map((_, index) => {
        const [x, y] = point(index, 1);
        return <line key={index} x1={cx} y1={cy} x2={x} y2={y} stroke="#ececee" />;
      })}
      <polygon points={data} fill="rgba(101,163,13,0.16)" stroke="#65A30D" strokeWidth="1.6" />
      {order.map((name, index) => {
        const [x, y] = point(index, 1.32);
        return <text key={name} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#8d8f95">{name}</text>;
      })}
    </svg>
  );
}

function NavGlyph({ id }) {
  const paths = {
    score: "M4 19V9M10 19V4M16 19v-7M21 19H3",
    base: "M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    models: "M4 7h16M4 12h16M4 17h10",
    api: "M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1",
    compare: "M4 19h16M7 16l4-8 3 4 4-6",
    news: "M4 13h5l2-7 3 12 2-5h4",
    notice: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0",
    reviews: "M5 6h14v8H8l-3 3z",
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[id]} />
    </svg>
  );
}

const SIDE_NAV = [
  ["score", "测评表现"],
  ["base", "基本信息"],
  ["models", "模型与价格"],
  ["api", "接口链接"],
  ["compare", "综合对比"],
  ["news", "动态"],
  ["notice", "站点公告"],
  ["reviews", "评论"],
];

const FAMILY_ICON = Object.fromEntries(
  Object.entries(FAMILY_VENDOR).map(([label, vendor]) => [label, VENDOR_ICON[vendor]?.[0] || ""]),
);

const PROBE_COPY = {
  "基础请求": "最小探针:发一句话看中转站能否正常回包、finish_reason 是否正常,确认通路可用。",
  "模型响应形状": "核对响应里的模型字段是否与请求一致、响应结构是否规范,并连发多次看输出稳定性(防偷换路由)。",
  "函数调用": "强制 tool_choice 调一个函数,检查响应是否返回合规 tool_calls(call_ 前缀、函数名、JSON 参数齐全)。",
  "结构化输出": "用 response_format=json_schema strict 要求严格 JSON 输出,验证中转站是否真的透传并实现了结构化输出参数。",
  "流式一致性": "对比流式 vs 非流式两种输出是否一致、有无截断或丢内容。",
  "Token 用量": "校验 usage 字段是否自洽、流式与非流式是否一致,防止中转站虚标 token、多收计费。",
  "协议规范性": "检查响应结构是否符合对应 API 的协议规范(必备字段、id 前缀、finish_reason 等)。",
};

function familyOf(row) {
  const text = `${row.id || ""} ${row.name || ""}`.toLowerCase();
  if (/claude/.test(text)) return "Claude";
  if (/gemini/.test(text)) return "Gemini";
  if (/grok/.test(text)) return "Grok";
  if (/deepseek/.test(text)) return "DeepSeek";
  if (/glm|chatglm|zhipu/.test(text)) return "GLM";
  if (/typesafe/.test(text)) return "TypeSafe";
  if (/gpt|codex|openai|chatgpt|\bo\d/.test(text)) return "ChatGPT";
  return "其他";
}

function money(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toFixed(4).replace(/\.?0+$/, "");
}

function heatColor(value) {
  if (value < 0) return "rgb(148, 163, 184)";
  const mix = (from, to, t) => Math.round(from + (to - from) * t);
  const red = [239, 68, 68];
  const amber = [234, 179, 8];
  const green = [34, 165, 89];
  const [from, to, t] = value <= 60 ? [red, amber, value / 60] : [amber, green, (value - 60) / 40];
  return `rgb(${mix(from[0], to[0], t)}, ${mix(from[1], to[1], t)}, ${mix(from[2], to[2], t)})`;
}

function sparkTip(point) {
  const avail = `${Number(point[1]).toFixed(1)}%`;
  if (!point[0] || point[0] < 1e9) return `可用率 ${avail}`;
  const stamp = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(point[0] * 1000));
  return `${stamp} 可用率 ${avail}`;
}

function Spark({ points, height = 20, width = 120 }) {
  if (!points?.length) return <span className="dash">—</span>;
  return (
    <span className="spark" style={{ height, width, gap: points.length > 36 ? 1 : 2 }}>
      {points.map((point, index) => (
        <i key={`${point[0]}-${index}`} title={sparkTip(point)} style={{ background: heatColor(point[1]), opacity: point[1] < 0 ? 0.5 : 0.85 }} />
      ))}
    </span>
  );
}

function Purity({ score, service }) {
  if (service === "basic" || score == null || score === "" || Number.isNaN(Number(score))) return <span className="purity-miss">未测</span>;
  if (service && service !== "cc") return <span className="purity-miss">未测</span>;
  return <span className="purity">{Number(score) >= 80 ? "签名通过" : "签名未通过"}</span>;
}

function agoLabel(ms) {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}小时前`;
  return `${Math.round(hour / 24)}天前`;
}

function uptimeNumber(uptime) {
  const number = parseFloat(uptime);
  return Number.isFinite(number) ? number : null;
}

function uptimeText(uptime) {
  const number = uptimeNumber(uptime);
  if (number == null) return "";
  return Number.isInteger(number) ? `${number}%` : `${number.toFixed(0)}%`;
}

function UpRate({ uptime }) {
  const text = uptimeText(uptime);
  if (!text) return <span className="dash">—</span>;
  return <b className="up-rate">{text}</b>;
}

function UpTrend({ uptime, points }) {
  const number = uptimeNumber(uptime);
  if (number == null) return <span className="dash">—</span>;
  const latest = Array.isArray(points) && points.length ? points[points.length - 1] : null;
  const when = latest && latest[0] >= 1e9 ? agoLabel(latest[0] * 1000) : "";
  const color = heatColor(number);
  return (
    <div className="up-trend">
      <div className="up-trend-top">{when ? <span>{when}</span> : <span />}</div>
      <div className="up-bars" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => <i key={index} style={{ background: color }} />)}
      </div>
    </div>
  );
}

function blank(value) {
  return value == null || value === "";
}

function overlayRow(row, group) {
  if (!group) return row;
  const priced = (group.models || []).find((model) => model.id === row.id);
  return {
    ...row,
    input: blank(row.input) ? priced?.in ?? row.input : row.input,
    output: blank(row.output) ? priced?.out ?? row.output : row.output,
    cache: blank(row.cache) ? priced?.cache ?? row.cache : row.cache,
    score: group.score,
    service: group.service,
    latency: group.latencyMs == null ? "—" : `${(group.latencyMs / 1000).toFixed(1)}s`,
    uptime: group.avail == null ? "—" : `${Number(group.avail).toFixed(0)}%`,
    points: group.points,
  };
}

function prettifyId(id) {
  return String(id || "").replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function synthRows(groups, family, labels) {
  const rows = [];
  for (const group of groups || []) {
    for (const model of group.models || []) {
      const name = labels?.[model.id] || prettifyId(model.id);
      if (familyOf({ id: model.id, name }) !== family) continue;
      rows.push(overlayRow({
        id: model.id,
        name,
        group: group.name,
        ratio: model.ratio ?? group.ratio,
        input: model.in,
        output: model.out,
        cache: model.cache,
      }, group));
    }
  }
  return rows;
}

function derivedGroups(models) {
  const buckets = new Map();
  for (const row of models || []) {
    const name = row.group || "default";
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push(row);
  }
  return [...buckets.entries()].map(([name, rows]) => {
    const prices = rows.map((row) => Number(row.input)).filter((value) => Number.isFinite(value));
    const ratios = [...new Set(rows.map((row) => row.ratio).filter((value) => value != null))];
    const scored = rows.find((row) => row.score != null);
    const avail = parseFloat(rows.find((row) => row.uptime && row.uptime !== "—")?.uptime);
    return {
      name,
      ratio: ratios.length === 1 ? ratios[0] : null,
      startPrice: prices.length ? Math.min(...prices) : null,
      score: scored?.score ?? null,
      service: scored?.service ?? null,
      latencyMs: null,
      latencyText: rows.find((row) => row.latency && row.latency !== "—")?.latency || "—",
      avail: Number.isFinite(avail) ? avail : null,
      points: rows.find((row) => Array.isArray(row.points) && row.points.length)?.points
        || (Number.isFinite(avail) ? Array.from({ length: 24 }, (_, index) => [index, avail]) : null),
      currency: rows.find((row) => row.currency)?.currency || "",
      models: rows.map((row) => ({ id: row.id, name: row.name, in: row.input, out: row.output, cache: row.cache, currency: row.currency })),
    };
  });
}

function derivedMenu(models) {
  const counts = new Map();
  const seen = new Map();
  for (const row of models || []) {
    const family = familyOf(row);
    if (!seen.has(family)) seen.set(family, new Set());
    seen.get(family).add(row.id || row.name);
  }
  for (const [family, ids] of seen) counts.set(family, ids.size);
  return [...counts.entries()].map(([key, count]) => ({
    key,
    label: key,
    count,
    icon: FAMILY_ICON[key] || "",
  }));
}

function unitOf(row) {
  return row?.currency === "USD" ? "$" : "¥";
}

function ioText(row) {
  if (row.input == null || row.input === "" || row.output == null || row.output === "") return "—";
  const unit = unitOf(row);
  return `${unit}${money(row.input)} / ${unit}${money(row.output)}`;
}

function cacheText(row) {
  if (row.cache == null || row.cache === "") return "—";
  return `${unitOf(row)}${money(row.cache)}`;
}

function historyClock(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function shanghaiClock(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function tierOf(score) {
  if (score >= 80) return { label: "官方渠道", tone: "ok" };
  if (score >= 30) return { label: "混合渠道", tone: "mid" };
  return { label: "来源存疑", tone: "bad" };
}

function seconds(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function SortMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M8 9l4-4 4 4" />
    </svg>
  );
}

function staticComments(station) {
  const data = globalThis.__VERD_COMMUNITY__;
  if (!station || !data) return [];
  return (data.comments || []).filter((item) => item && item.slug === station.slug);
}

function staticVote(station) {
  const data = globalThis.__VERD_COMMUNITY__;
  if (!station || !data) return null;
  const row = data.votes?.stations?.[stationVoteId(station)];
  if (!row) return null;
  return { up: Number(row.up) || 0, down: Number(row.down) || 0, mine: "" };
}

export function StationPage() {
  const routeParams = useParams();
  const slug = routeParams.slug || routeParams.token || "";
  const station = findStation(slug);
  useTitle(station ? `${stationHeading(station)} 中转站详情｜在线率、延迟、公开价格和评价` : "没有找到这个中转站｜回到排行榜按名称搜索");
  const [part, setPart] = useState("score");
  const [modelOpen, setModelOpen] = useState(() => Boolean(globalThis.__VERD_STATIC__));
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [eventPage, setEventPage] = useState(1);
  const [openNotes, setOpenNotes] = useState({});
  const [starred, setStarred] = useState(() => Boolean(readFavs()[slug]));
  useEffect(() => {
    const sync = () => setStarred(Boolean(readFavs()[slug]));
    window.addEventListener("okk-account", sync);
    return () => window.removeEventListener("okk-account", sync);
  }, [slug]);
  const [histOpen, setHistOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(() => new Set());
  const [writing, setWriting] = useState(false);
  const [remoteComments, setRemoteComments] = useState(() => staticComments(station));
  const [liveVote, setLiveVote] = useState(() => staticVote(station));
  const voting = useRef(false);
  const voteBoard = useRef(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    setPart("score");
    setModelOpen(false);
    setSummaryOpen(true);
    setEventPage(1);
    setOpenNotes({});
    setStarred(Boolean(readFavs()[slug]));
    setHistOpen(false);
    setFamilyOpen(false);
    setGroupOpen(new Set());
    setWriting(false);
  }, [slug]);
  useEffect(() => {
    if (!familyOpen) return undefined;
    const close = () => setFamilyOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [familyOpen]);
  useEffect(() => {
    if (!station) return undefined;
    const ids = ["score", "base", "models", "api", "compare", "news", "notice", "reviews"];
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setPart(hit.target.id);
      },
      { rootMargin: "-76px 0px -62% 0px", threshold: 0 },
    );
    nodes.forEach((node) => obs.observe(node));
    return () => obs.disconnect();
  }, [station]);
  useEffect(() => {
    let stop = false;
    setLiveVote(null);
    setRemoteComments([]);
    if (!station) return undefined;
    const id = stationVoteId(station);
    fetchVotes().then((data) => {
      if (stop) return;
      const row = data.stations?.[id];
      voteBoard.current = data;
      setLiveVote({
        up: row ? Number(row.up) || 0 : station.voteUp || 0,
        down: row ? Number(row.down) || 0 : station.voteDown || 0,
        mine: data.mine?.[id] === "up" || data.mine?.[id] === "down" ? data.mine[id] : "",
        place: votePlaceFrom(station, data),
      });
    }).catch(() => {});
    fetchComments(station.slug).then((data) => {
      if (!stop) setRemoteComments(Array.isArray(data.comments) ? data.comments : []);
    }).catch(() => {});
    return () => { stop = true; };
  }, [slug, station]);
  const mineVote = liveVote?.mine || "";
  const shownUp = liveVote ? liveVote.up : (station?.voteUp || 0);
  const shownDown = liveVote ? liveVote.down : (station?.voteDown || 0);
  const shownVotePlace = liveVote?.place || station?.votePlace;
  const castVote = async (side) => {
    if (!station || voting.current) return;
    if (!authToken()) {
      window.dispatchEvent(new Event("okk-open-auth"));
      return;
    }
    voting.current = true;
    try {
      const result = await sendVote(stationVoteId(station), side);
      const board = {
        ...(voteBoard.current || {}),
        stations: { ...(voteBoard.current?.stations || {}), [result.id]: { up: result.up, down: result.down } },
      };
      voteBoard.current = board;
      setLiveVote({
        up: Number(result.up) || 0,
        down: Number(result.down) || 0,
        mine: result.mine === "up" || result.mine === "down" ? result.mine : "",
        place: votePlaceFrom(station, board),
      });
      if (result.points) replacePoints(result.points);
    } catch (err) {
      if (err.status === 401) {
        setAuthToken("");
        window.dispatchEvent(new Event("okk-open-auth"));
      }
    } finally {
      voting.current = false;
    }
  };
  if (!station) {
    return (
      <div className="wrap form-page">
        <h1>没有找到这个站点</h1>
        <p>榜单里没有这个地址。可以回排行榜再选一个。</p>
        <Link to="/list" className="more">返回榜单</Link>
      </div>
    );
  }
  const rows = station.models || [];
  const windowKey = params.get("w") === "7d" || params.get("w") === "30d" ? params.get("w") : "24h";
  const view = params.get("view") === "group" ? "group" : "model";
  const sortKey = params.get("sort") === "score" || params.get("sort") === "up" ? params.get("sort") : "price";
  const menu = station.familiesMenu?.length ? station.familiesMenu : derivedMenu(rows);
  const family = menu.some((item) => item.key === params.get("f")) ? params.get("f") : (menu[0]?.key || "ChatGPT");
  const windowGroups = station.windows?.[windowKey] || station.windows?.["24h"] || null;
  const groupMap = new Map((windowGroups || []).map((group) => [group.name, group]));
  const catalogFamily = globalThis.__VERD_STATIC__ ? rows : rows.filter((row) => familyOf(row) === family);
  const priceRows = catalogFamily.length
    ? catalogFamily.map((row) => overlayRow(row, groupMap.get(row.group)))
    : synthRows(windowGroups, family, station.labels);
  const sorted = sortKey === "price" && catalogFamily.length
    ? priceRows
    : [...priceRows].sort((a, b) => {
      const num = (value) => {
        if (value == null || value === "") return null;
        const parsed = Number(String(value).replace("%", ""));
        return Number.isFinite(parsed) ? parsed : null;
      };
      if (sortKey === "score") return (num(b.score) ?? -1) - (num(a.score) ?? -1);
      if (sortKey === "up") return (num(b.uptime) ?? -1) - (num(a.uptime) ?? -1);
      const left = num(a.input);
      const right = num(b.input);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right;
    });
  const groupRows = windowGroups || derivedGroups(rows);
  const shown = modelOpen ? sorted : sorted.slice(0, 10);
  const shownGroups = modelOpen ? groupRows : groupRows.slice(0, 10);
  const hiddenCount = view === "group" ? Math.max(0, groupRows.length - 10) : Math.max(0, sorted.length - 10);
  const setQuery = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) next.set(key, value);
    setParams(next, { replace: true });
    setModelOpen(false);
  };
  const tests = station.tests || [];
  const events = station.events || [];
  const eventSize = 8;
  const eventPages = Math.max(1, Math.ceil(events.length / eventSize));
  const eventRows = events.slice((eventPage - 1) * eventSize, eventPage * eventSize);
  const eventGroups = [];
  for (const item of eventRows) {
    const last = eventGroups[eventGroups.length - 1];
    if (last && last.day === item.day) last.items.push(item);
    else eventGroups.push({ day: item.day, items: [item] });
  }
  const notes = station.announcements || [];
  const comments = [...remoteComments].reverse().concat(station.reviews || []);
  const rated = comments.filter((item) => item.rating);
  const average = rated.length ? rated.reduce((sum, item) => sum + Number(item.rating), 0) / rated.length : null;
  const socials = station.socials?.length ? station.socials : [{ name: "官网", url: station.site }];
  const official = socials.find((item) => item.name === "官网")?.url || station.site;
  const familyText = station.familiesText || station.lineup.replace(/^支持\s*/, "");
  const refundStat = splitStat(station.refund);
  const invoiceStat = splitStat(station.invoice);
  const refundBrief = refundStat.kind === "cond" ? `退款${refundStat.label}（${refundStat.sub}）` : `退款 ${station.refund}`;
  const invoiceBrief = invoiceStat.sub || station.invoice;
  const jump = (id) => {
    setPart(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="wrap">
      <div className="crumb station-crumb">榜单 › {stationHeading(station)}</div>
      <div className="layout station-layout">
        <aside className="side station-side">
          <div className="station-logo">
            <Logo station={station} />
            <div className="nm">{stationHeading(station)}</div>
          </div>
          {SIDE_NAV.map(([id, label]) => (
            <button key={id} className={part === id ? "on" : ""} onClick={() => jump(id)}><NavGlyph id={id} />{label}</button>
          ))}
        </aside>
        <div>
          <div className="station-head">
            <div className="station-main">
              <div className="st-title">
                <h1>{stationHeading(station)}</h1>
                {average != null ? (
                  <span className="score-pill"><span className="star">★</span> {average.toFixed(1)} {rated.length}条评价</span>
                ) : <span className="score-pill">暂无评分</span>}
                <span className="head-votes">
                  <b><Trophy />第{shownVotePlace}名</b>
                  <button type="button" className={mineVote === "up" ? "up on" : "up"} aria-pressed={mineVote === "up"} onClick={() => castVote("up")}><Thumb up /> {shownUp}</button>
                  <button type="button" className={mineVote === "down" ? "down on" : "down"} aria-pressed={mineVote === "down"} onClick={() => castVote("down")}><Thumb /> {shownDown}</button>
                </span>
              </div>
              <div className="links">
                {socials.map((item) => (
                  <a key={item.name} href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
                ))}
              </div>
              <p className="blurb">{station.blurb}</p>
            </div>
            <div className="station-actions">
              <span className="icon-row">
                <button className="sq" type="button" aria-label="反馈" onClick={() => jump("reviews")}>✎</button>
                <button className={`sq ${starred ? "on" : ""}`} type="button" aria-label="收藏" onClick={() => setStarred(Boolean(toggleFav(station.slug)[station.slug]))}>☆</button>
                <button className="sq" type="button" aria-label="分享" onClick={() => navigator.clipboard?.writeText(window.location.href)}>⤴</button>
              </span>
              <a className="visit" href={official} target="_blank" rel="noreferrer">前往官网 ↗</a>
            </div>
          </div>

          <div className="h-block" id="score">
            <h2>测评表现</h2>
            <div className="metrics">
              <div>
                <div className="mini">可用指数</div>
                <div className="idx"><span className="big">{station.upShown == null ? "—" : station.upShown}</span><Delta value={station.upDelta} /></div>
                <Meter value={station.upShown} />
                <div className="meter-label"><span>0%</span><span>在线率</span><span>100%</span></div>
              </div>
              <div>
                <div className="mini">速度指数</div>
                <div className="idx"><span className="big">{station.speedShown == null ? "—" : station.speedShown}</span><Delta value={station.speedDelta} /></div>
                <Meter value={station.speedShown} />
                <div className="meter-label"><span>0 ≥8s</span><span>延迟</span><span>100 ≤1s</span></div>
              </div>
            </div>
            <div className="summary">
              <div className="summary-hd">
                <h3>测评摘要</h3>
                <button type="button" onClick={() => setSummaryOpen((open) => !open)}>{summaryOpen ? "收起 ∧" : "展开全文"}</button>
              </div>
              {summaryOpen ? (
                <p>
                  {station.name}支持 {familyText || "尚未列明的模型"}{station.cover ? <> 等 <span className="hl">{station.cover} 个模型</span></> : null}。
                  {station.upShown == null ? "公开页面还没有在线率数字。" : <>在线率记为 <span className="hl">{station.upShown}%</span>{station.uptimeNote ? `（${station.uptimeNote}）` : ""}。</>}
                  {station.speedShown == null ? "" : <>速度指数 <span className="hl">{station.speedShown}</span>。</>}
                  {station.latency == null ? "" : <>{station.latencyNote ? `${station.latencyNote}，` : "目录里的"}延迟是 <span className="hl">{station.latency} 秒</span>。</>}
                  {station.min && station.min !== "—" ? <>最低充值 <span className="hl">{String(station.min).replace(/[￥¥]/g, "").trim()} 元</span>。</> : null}
                  {station.pay.length ? <>支付方式：{station.paymentText}。</> : null}
                  {station.refund && station.refund !== "—" ? <>{refundBrief}。</> : null}
                  {station.invoice && station.invoice !== "—" ? <>发票：{invoiceBrief}。</> : null}
                  {station.promo ? <>优惠：{station.promo}。</> : null}
                </p>
              ) : null}
            </div>
          </div>

          <div className="h-block" id="base">
            <h2>基本信息</h2>
            <div className="info-grid">
              <div className="info"><div className="k">网站名</div><div className="v">{station.name}</div></div>
              <div className="info"><div className="k">最低充值</div><div className="v">{String(station.min).replace("￥", "¥")}</div></div>
              <div className="info"><div className="k">支付方式</div><div className="v">{station.pay.length ? <Pays list={station.pay} /> : station.paymentText}</div></div>
              <div className="info"><div className="k">发票</div><div className="v"><StatValue value={station.invoice} /></div></div>
              <div className="info"><div className="k">退款政策</div><div className="v"><StatValue value={station.refund} /></div></div>
              <div className="info"><div className="k">优惠</div><div className="v">{station.promo || "—"}</div></div>
            </div>
          </div>

          <div className="h-block" id="models">
            <div className="sec-h">
              <h2>模型与价格</h2>
              <button className="th-btn" type="button" disabled={!tests.length} onClick={() => setHistOpen(true)}>
                测试历史 <span>↗</span>
              </button>
            </div>
            <div className="det-segrow">
              <div className="seg">
                <button type="button" className={view === "model" ? "on" : ""} onClick={() => setQuery({ view: "model" })}>按模型</button>
                <button type="button" className={view === "group" ? "on" : ""} onClick={() => setQuery({ view: "group" })}>按分组</button>
              </div>
              {view === "model" ? (
                <div className="fam" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="fam-btn" onClick={() => setFamilyOpen((open) => !open)}>
                    <span>选模型</span>
                    <VendorIcon name={FAMILY_VENDOR[family]} />
                    <b>{menu.find((item) => item.key === family)?.label || family}</b>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {familyOpen ? (
                    <div className="fam-menu">
                      {menu.map((item) => (
                        <button key={item.key} type="button" className={item.key === family ? "on" : ""} onClick={() => { setQuery({ f: item.key, view: "model" }); setFamilyOpen(false); }}>
                          {item.icon ? <img className={VENDOR_ICON[FAMILY_VENDOR[item.key]]?.[2] ? "vmark mono" : "vmark"} src={item.icon} alt="" width="16" height="16" /> : <VendorIcon name={FAMILY_VENDOR[item.key] || vendorOfModel(item.label)} />}
                          <span>{item.label}</span>
                          <em>{item.count}</em>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="seg seg-time">
                {[["24h", "24小时"], ["7d", "7天"], ["30d", "30天"]].map(([key, label]) => (
                  <button key={key} type="button" className={windowKey === key ? "on" : ""} onClick={() => setQuery({ w: key })}>{label}</button>
                ))}
              </div>
            </div>
            {view === "model" ? (
              sorted.length ? (
                <div className="table-wrap">
                  <table className="price">
                    <thead>
                      <tr>
                        <th>模型</th>
                        <th>分组</th>
                        <th>倍率</th>
                        <th>
                          <button type="button" className={sortKey === "price" ? "sort on" : "sort"} onClick={() => setQuery({ sort: "price" })}>输入/输出 <SortMark /></button>
                        </th>
                        <th>缓存</th>
                        <th>
                          <button type="button" className={sortKey === "score" ? "sort on" : "sort"} onClick={() => setQuery({ sort: "score" })}>纯度 <SortMark /></button>
                        </th>
                        <th>延迟</th>
                        <th>
                          <button type="button" className={sortKey === "up" ? "sort on" : "sort"} onClick={() => setQuery({ sort: "up" })}>在线率 <SortMark /></button>
                        </th>
                        <th className="tr">趋势</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => (
                        <tr key={`${row.group}|${row.id}`}>
                          <td>
                            <div className="model-name">
                              <VendorIcon name={FAMILY_VENDOR[familyOf(row)] || vendorOfModel(row.name)} />
                              <span>{row.name}</span>
                            </div>
                          </td>
                          <td>{row.group || "—"}</td>
                          <td>{row.ratio == null ? "—" : `${row.ratio}x`}</td>
                          <td>{ioText(row)}</td>
                          <td>{cacheText(row)}</td>
                          <td><Purity score={row.score} service={row.service} /></td>
                          <td>{row.latency || "—"}</td>
                          <td className="up-rate-cell"><UpRate uptime={row.uptime} /></td>
                          <td className="up-cell"><UpTrend uptime={row.uptime} points={row.points} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mini">这个厂商下没有公开的模型标价。</p>
            ) : (
              groupRows.length ? (
                <div className="table-wrap">
                  <table className="price gm">
                    <thead>
                      <tr>
                        <th>分组</th><th>倍率</th><th>输入/输出</th><th>纯度</th><th>延迟</th><th>在线率</th><th className="tr">趋势</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownGroups.map((group) => {
                        const open = groupOpen.has(group.name);
                        const latency = group.latencyMs == null ? (group.latencyText || "—") : `${(group.latencyMs / 1000).toFixed(1)}s`;
                        const avail = group.avail == null ? "—" : `${Number(group.avail).toFixed(0)}%`;
                        const half = Math.ceil((group.models || []).length / 2);
                        const columns = [(group.models || []).slice(0, half), (group.models || []).slice(half)];
                        return (
                          <Fragment key={group.name}>
                            <tr className={open ? "gm-head open" : "gm-head"} onClick={() => setGroupOpen((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.name)) next.delete(group.name);
                              else next.add(group.name);
                              return next;
                            })}>
                              <td>
                                <div className="gm-name">
                                  <span className="chev">{open ? "⌄" : "›"}</span>
                                  <div>
                                    <b>{group.name}</b>
                                    <div className="mini">{group.models.length} 模型</div>
                                  </div>
                                </div>
                              </td>
                              <td>{group.ratio == null ? "—" : `${group.ratio}x`}</td>
                              <td>{group.startPrice == null ? "—" : `${unitOf(group)}${money(group.startPrice)} 起`}</td>
                              <td><Purity score={group.score} service={group.service} /></td>
                              <td>{latency}</td>
                              <td className="up-rate-cell" onClick={(event) => event.stopPropagation()}><UpRate uptime={group.avail == null ? "" : `${group.avail}%`} /></td>
                              <td className="up-cell" onClick={(event) => event.stopPropagation()}><UpTrend uptime={group.avail == null ? "" : `${group.avail}%`} points={group.points} /></td>
                            </tr>
                            {open ? (
                              <tr key={`${group.name}-open`} className="gm-exp">
                                <td colSpan={7}>
                                  <div className="gm-box">
                                    {columns.map((column, index) => (
                                      <div key={index}>
                                        <div className="gm-sub"><span>模型</span><span>输入 / 输出</span><span>缓存</span></div>
                                        {column.map((model) => {
                                          const name = model.name || station.labels?.[model.id] || prettifyId(model.id);
                                          return (
                                            <div key={model.id} className="gm-mrow">
                                              <span>{name}</span>
                                              <span>{model.in == null || model.out == null ? "—" : `${unitOf(model)}${money(model.in)} / ${unitOf(model)}${money(model.out)}`}</span>
                                              <span>{model.cache == null ? "—" : `${unitOf(model)}${money(model.cache)}`}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mini">这一页没有公开的分组。</p>
            )}
            {hiddenCount > 0 && modelOpen ? (
              <button className="more-line" type="button" onClick={() => setModelOpen(false)}>收起</button>
            ) : null}
          </div>
          {hiddenCount > 0 && !modelOpen ? (
            <button className="expand-float" type="button" onClick={() => { setModelOpen(true); jump("models"); }}>
              展开剩余 {hiddenCount} {view === "group" ? "个分组" : "行"}
            </button>
          ) : null}
          {histOpen ? (
            <div className="th-overlay" onClick={() => setHistOpen(false)}>
              <div className="th-modal" onClick={(event) => event.stopPropagation()}>
                <div className="th-head">
                  <span>测试历史</span>
                  <button type="button" className="th-x" aria-label="关闭" onClick={() => setHistOpen(false)}>✕</button>
                </div>
                <div className="th-body">
                  <table className="th-table">
                    <thead>
                      <tr>
                        <td>时间</td><td>分组</td><td>请求模型</td><td>接口</td><td className="tr">评分</td><td />
                      </tr>
                    </thead>
                    <tbody>
                      {tests.map((test) => (
                        <tr key={test.id}>
                          <td className="th-c-time">{historyClock(test.at)}</td>
                          <td><b>{test.channel}</b></td>
                          <td className="th-c-model">{test.model}</td>
                          <td className="th-c-ep">{hostOf(station.baseUrl) || station.host}</td>
                          <td className="tr"><b>{Number(test.score).toFixed(0)}</b></td>
                          <td className="th-c-rp">{/^https?:/.test(test.report || "") ? null : test.id ? <Link to={test.suite === "basic" ? `/b/${test.id}` : `/r/d/${test.id}`} target="_blank" rel="noreferrer">报告 ↗</Link> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          <div className="h-block" id="api">
            <h2>接口链接</h2>
            {(station.links || []).length ? station.links.map((link) => (
              <div key={link.url} className="link-card">
                <div className="link-top">
                  <b>{link.name}</b>
                  <a href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
                </div>
                <div className="link-sub">
                  <span>{link.desc || station.host}</span>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(link.url)}>复制</button>
                </div>
              </div>
            )) : <p>官网：<a href={official} target="_blank" rel="noreferrer">{official}</a></p>}
          </div>

          <div className="h-block" id="compare">
            <h2>综合对比</h2>
            <div className="cmp-grid">
              <RadarChart dims={station.radar} />
              <div>
                <div className="cmp-stat"><span>平均延迟</span><b>{station.meanLatency || showLatency(station.latency)}</b></div>
                <div className="mini">各分组当前延迟均值</div>
                <div className="obar"><i style={{ width: `${station.speedShown ?? 0}%` }} /></div>
                <div className="cmp-stat"><span>{station.monthLabel || "30 天可用率"}</span><b>{station.month == null ? "—" : `${station.month}%`}</b></div>
                <div className="mini">{station.monthNote || "近 30 天各分组平均在线率"}</div>
                <div className="obar"><i style={{ width: `${station.month ?? 0}%` }} /></div>
                <div className="cmp-stat"><span>模型覆盖</span><b>{station.cover}</b></div>
                <div className="mini">{station.coverText || `覆盖 ${station.vendors.length} 家厂商,共 ${station.cover} 个模型`}</div>
                <div className="obar"><i style={{ width: "100%" }} /></div>
              </div>
            </div>
          </div>

          <div className="h-block" id="news">
            <h2>动态</h2>
            {eventGroups.length ? (
              <div className="events">
                <div className="ev-head"><span>事件</span><span>类型</span><span>时间</span></div>
                {eventGroups.map((group) => (
                  <div key={group.day}>
                    <div className="ev-daybar">{group.day}</div>
                    {group.items.map((item, index) => (
                      <div key={`${item.time}-${index}`} className="ev-line">
                        <span>{item.text}</span>
                        <span className="ev-pill">{item.type}</span>
                        <span className="ev-tm">{item.time}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="events">
                <div className="ev-head"><span>事件</span><span>类型</span><span>时间</span></div>
                <div className="ev-line"><span>公开页面上没有动态记录。</span><span /><span /></div>
              </div>
            )}
            {eventPages > 1 ? (
              <div className="pager">
                {Array.from({ length: eventPages }, (_, index) => (
                  <button key={index} className={eventPage === index + 1 ? "on" : ""} onClick={() => setEventPage(index + 1)}>{index + 1}</button>
                ))}
              </div>
            ) : null}
          </div>

<div className="h-block" id="notice">
          <h2>站点公告 <span className="mini">共 {notes.length} 条</span></h2>
          {notes.length ? notes.map((item) => {
            const long = (item.content || "").length > 180;
            const open = Boolean(globalThis.__VERD_STATIC__) || Boolean(openNotes[item.id]);
            const text = !long || open ? item.content : `${item.content.slice(0, 180)}…`;
            return (
              <article key={item.id} className="notice">
                {item.title ? <b>{item.title}</b> : null}
                <p>{text || "这条公告没有正文。"}</p>
                <div className="mini">
                  {when(item.date)}
                  {long ? (
                    <button onClick={() => setOpenNotes((prev) => ({ ...prev, [item.id]: !open }))}>{open ? "收起" : "展开阅读全文"}</button>
                  ) : null}
                </div>
              </article>
            );
          }) : <p className="mini">公开页面上没有站点公告。</p>}
        </div>

        <div className="h-block" id="reviews">
          <div className="sec-h">
            <h2>评论 <span className="mini">{comments.length} 条</span></h2>
            <button type="button" className="ghost-btn" onClick={() => setWriting(true)}>写点评</button>
          </div>
          {average != null ? (
            <div className="rv-head">
              <div className="rv-score">
                <div className="big">{average.toFixed(1)}</div>
                <Stars count={Math.round(average)} />
                <div className="mini">{comments.length} 条评论</div>
              </div>
              <div className="rv-bars">
                {[5, 4, 3, 2, 1].map((star) => (
                  <div key={star}><span>{star}★</span><b>{comments.filter((item) => Number(item.rating) === star).length}</b></div>
                ))}
              </div>
            </div>
          ) : null}
          {comments.length ? comments.map((item) => (
            <article key={item.id || item.user} className="comment">
              <div className="who">
                <span className="avatar">{(item.user || "用").trim().slice(0, 1).toLowerCase()}</span>
                <div>
                  <div className="nm">{item.user}</div>
                  <div className="mini">{when(item.date) || item.date}</div>
                </div>
                <Stars count={item.rating || 0} />
              </div>
              {item.body ? <p>{item.body}</p> : null}
              {(item.pros || []).length || (item.cons || []).length ? (
                <div className="pills">
                  {(item.pros || []).map((tag) => <span key={tag} className="pill-g">👍 {tag}</span>)}
                  {(item.cons || []).map((tag) => <span key={tag} className="pill-b">👎 {tag}</span>)}
                </div>
              ) : null}
              {(item.replies || []).map((reply, index) => (
                <div key={index} className="reply">
                  <b>{reply.user}</b>
                  <span className="mini">{when(reply.date) || reply.date}</span>
                  <p>{reply.body}</p>
                </div>
              ))}
            </article>
          )) : <p className="mini">还没有评论。登录后可以写点评。</p>}
          {writing ? (
            <ReviewDialog
              initialSlug={station.slug}
              onClose={() => setWriting(false)}
              onSaved={(review) => {
                setRemoteComments((current) => [...current, review]);
                setWriting(false);
              }}
            />
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}


function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function StarRow({ score }) {
  const filled = Math.max(0, Math.min(5, Math.round(Number(score) || 0)));
  return (
    <span className="star-row" aria-label={`${filled} 星`}>
      {"★".repeat(filled)}
      <span className="off">{"★".repeat(5 - filled)}</span>
    </span>
  );
}

const PRO_TAGS = ["速度快", "稳定", "不掺水", "纯度高", "价格实惠", "客服好", "文档全", "模型全", "充值方便"];
const CON_TAGS = ["偶发限流", "不稳定", "疑似掺水", "疑似降智", "价格贵", "客服慢", "限制多"];

const REMARK_KEY = "veridrop-remarks";
const PICK_PAGE = 40;
function votePlaceFrom(target, board) {
  const rows = stations.map((item) => {
    const id = stationVoteId(item);
    const live = board?.stations?.[id];
    const up = live ? Number(live.up) || 0 : (item.voteUp || 0);
    const down = live ? Number(live.down) || 0 : (item.voteDown || 0);
    return { slug: item.slug, net: up - down, name: item.name || "" };
  });
  rows.sort((a, b) => (b.net - a.net) || a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }) || a.slug.localeCompare(b.slug));
  const index = rows.findIndex((row) => row.slug === target.slug);
  return index < 0 ? target.votePlace : index + 1;
}

const voteRows = stations.map((station) => ({
  station,
  hay: `${station.name} ${station.host} ${station.blurb || ""}`.toLowerCase(),
}));
voteRows.sort((a, b) => a.station.name.localeCompare(b.station.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }) || a.station.slug.localeCompare(b.station.slug));
voteRows.forEach((row, index) => { row.order = index; });

function readObjectStore(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ThumbIcon({ down = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {down ? (
        <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
      ) : (
        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
      )}
    </svg>
  );
}

function voteTags(station, locals, key, remarks) {
  const counts = new Map();
  const order = [];
  const add = (label, count) => {
    if (!label) return;
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) || 0) + count);
  };
  for (const review of station.reviews || []) {
    for (const tag of review[key] || []) add(tag, 1);
  }
  for (const review of locals) {
    for (const tag of review[key] || []) add(tag, 1);
  }
  return order.map((label) => {
    const marked = remarks[`${station.slug}|${key}|${label}`] ? 1 : 0;
    return [label, (counts.get(label) || 0) + marked, marked];
  }).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
}

function StarPick({ value, onChange }) {
  return (
    <div className="star-pick" role="radiogroup" aria-label="评分">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button" className={star <= value ? "on" : ""} aria-label={`${star} 星`} onClick={() => onChange(star)}>★</button>
      ))}
    </div>
  );
}

function TagPicker({ label, tags, extras, selected, onToggle, adding, draft, onDraft, onStart, onCommit }) {
  return (
    <div className="review-field">
      <div className="review-label">{label}</div>
      <div className="tag-pick">
        {[...tags, ...extras].map((tag) => (
          <button key={tag} type="button" className={selected.has(tag) ? "on" : ""} onClick={() => onToggle(tag)}>{tag}</button>
        ))}
        {adding ? (
          <input
            className="tag-draft"
            value={draft}
            autoFocus
            placeholder="自定义"
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCommit();
              }
            }}
            onBlur={onCommit}
          />
        ) : (
          <button type="button" className="add" onClick={onStart}>+ 自定义</button>
        )}
      </div>
    </div>
  );
}

function ReviewDialog({ onClose, onSaved, initialSlug = "" }) {
  const [slug, setSlug] = useState(initialSlug);
  const [find, setFind] = useState("");
  const [limit, setLimit] = useState(PICK_PAGE);
  const query = find.trim().toLowerCase();
  const matches = useMemo(() => (query ? voteRows.filter((row) => row.hay.includes(query)) : voteRows), [query]);
  const shown = matches.slice(0, limit);
  const selected = slug ? voteRows.find((row) => row.station.slug === slug) : null;
  const pin = selected && !shown.some((row) => row.station.slug === slug) ? selected : null;
  const [stars, setStars] = useState(5);
  const [text, setText] = useState("");
  const [pros, setPros] = useState(() => new Set());
  const [cons, setCons] = useState(() => new Set());
  const [extraPros, setExtraPros] = useState([]);
  const [extraCons, setExtraCons] = useState([]);
  const [adding, setAdding] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (setter, tag) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };
  const commitCustom = () => {
    const name = draft.trim();
    setAdding("");
    setDraft("");
    if (!name) return;
    if (adding === "pro") {
      setExtraPros((list) => (list.includes(name) || PRO_TAGS.includes(name) ? list : [...list, name]));
      setPros((current) => new Set(current).add(name));
    }
    if (adding === "con") {
      setExtraCons((list) => (list.includes(name) || CON_TAGS.includes(name) ? list : [...list, name]));
      setCons((current) => new Set(current).add(name));
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!slug) {
      setError("先选择一个站点");
      return;
    }
    if (!authToken()) {
      setError("请先登录");
      window.dispatchEvent(new Event("okk-open-auth"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const review = await sendComment({
        slug,
        rating: stars,
        body: text.trim().slice(0, 2000),
        pros: [...pros],
        cons: [...cons],
      });
      if (review.points) replacePoints(review.points);
      onSaved(review);
    } catch (err) {
      if (err.status === 401) {
        setAuthToken("");
        window.dispatchEvent(new Event("okk-open-auth"));
      }
      setError(err.message || "没有记下");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="th-overlay" onClick={onClose}>
      <div className="review-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="review-title">
        <div className="review-hd">
          <h3 id="review-title">写点评</h3>
          <button type="button" className="review-x" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <form className="review-bd" onSubmit={submit}>
          <div className="review-field">
            <div className="review-label">选择站点</div>
            <div className="pick-list">
              <input className="pick-find" value={find} placeholder="搜索站点名称或域名" onChange={(event) => { setFind(event.target.value); setLimit(PICK_PAGE); }} />
              <div className="pick-scroll">
                {[pin, ...shown].filter(Boolean).map((row) => (
                  <button key={row.station.slug} type="button" className={slug === row.station.slug ? "pick-row on" : "pick-row"} onClick={() => setSlug(row.station.slug)}>
                    <Logo station={row.station} className="logo-img pick-logo" />
                    <span>{row.station.name}</span>
                  </button>
                ))}
                {matches.length ? null : <p className="pick-empty">没有匹配的站点</p>}
              </div>
              {limit < matches.length ? (
                <button className="pick-more" type="button" onClick={() => setLimit((count) => count + PICK_PAGE)}>
                  还有 {matches.length - limit} 家，继续加载
                </button>
              ) : null}
            </div>
          </div>
          <div className="review-field">
            <div className="review-label">评分</div>
            <StarPick value={stars} onChange={setStars} />
          </div>
          <div className="review-field">
            <div className="review-label">内容</div>
            <textarea maxLength={2000} rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="说说真实体验:速度 / 稳定 / 有没有降智偷换 / 客服 / 价格..." />
            <p className="review-hint">真实评价帮到其他用户;最多 2000 字。</p>
          </div>
          <TagPicker
            label="优点"
            tags={PRO_TAGS}
            extras={extraPros}
            selected={pros}
            onToggle={(tag) => toggle(setPros, tag)}
            adding={adding === "pro"}
            draft={draft}
            onDraft={setDraft}
            onStart={() => { setAdding("pro"); setDraft(""); }}
            onCommit={commitCustom}
          />
          <TagPicker
            label="缺点"
            tags={CON_TAGS}
            extras={extraCons}
            selected={cons}
            onToggle={(tag) => toggle(setCons, tag)}
            adding={adding === "con"}
            draft={draft}
            onDraft={setDraft}
            onStart={() => { setAdding("con"); setDraft(""); }}
            onCommit={commitCustom}
          />
          {error ? <p className="review-error">{error}</p> : null}
          <div className="review-actions">
            <button className="review-submit" type="submit" disabled={saving}>{saving ? "正在提交" : "提交评论"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ReputationPage() {
  useTitle("中转站投票排行｜赞成、反对与净票");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("net");
  const [menu, setMenu] = useState("");
  const [shown, setShown] = useState(20);
  const [board, setBoard] = useState(null);
  const [shared, setShared] = useState([]);
  const [remarks, setRemarks] = useState(() => readObjectStore(REMARK_KEY));
  const [mine, setMine] = useState(false);
  const [note, setNote] = useState("");
  const voting = useRef(false);
  useEffect(() => {
    let stop = false;
    fetchVotes().then((data) => { if (!stop) setBoard(data); }).catch(() => {});
    fetchComments("").then((data) => { if (!stop) setShared(Array.isArray(data.comments) ? data.comments : []); }).catch(() => {});
    return () => { stop = true; };
  }, []);
  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(""), 1600);
    return () => clearTimeout(timer);
  }, [note]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim().toLowerCase()), 150);
    return () => clearTimeout(timer);
  }, [q]);
  const localBySlug = useMemo(() => {
    const grouped = new Map();
    for (const review of shared) {
      const list = grouped.get(review.slug) || [];
      list.push(review);
      grouped.set(review.slug, list);
    }
    return grouped;
  }, [shared]);
  const ranked = useMemo(() => {
    const rows = [];
    for (const row of voteRows) {
      if (query && !row.hay.includes(query)) continue;
      const id = stationVoteId(row.station);
      const live = board?.stations?.[id];
      const mineVote = board?.mine?.[id] === "up" || board?.mine?.[id] === "down" ? board.mine[id] : "";
      const up = live ? Number(live.up) || 0 : (row.station.voteUp || 0);
      const down = live ? Number(live.down) || 0 : (row.station.voteDown || 0);
      rows.push({ station: row.station, up, down, net: up - down, mine: mineVote, order: row.order });
    }
    const key = sort === "up" || sort === "down" ? sort : "net";
    rows.sort((a, b) => (b[key] - a[key]) || (b.net - a.net) || (a.order - b.order));
    return rows;
  }, [query, sort, board]);
  const visible = ranked.slice(0, shown);
  const cast = async (station, side) => {
    if (voting.current) return;
    if (!authToken()) {
      setNote("请先登录再投票");
      window.dispatchEvent(new Event("okk-open-auth"));
      return;
    }
    voting.current = true;
    try {
      const result = await sendVote(stationVoteId(station), side);
      setBoard((current) => {
        const next = current || { stations: {}, mine: {} };
        const mineMap = { ...(next.mine || {}) };
        if (result.mine === "up" || result.mine === "down") mineMap[result.id] = result.mine;
        else delete mineMap[result.id];
        return {
          ...next,
          stations: { ...(next.stations || {}), [result.id]: { up: result.up, down: result.down } },
          mine: mineMap,
        };
      });
      if (!result.mine) {
        setNote("已取消");
        return;
      }
      if (result.points) replacePoints(result.points);
      const granted = { added: result.points?.added ? Number(result.points.amount) || 2 : 0 };
      const base = result.mine === "up" ? "已投赞成" : "已投反对";
      setNote(granted.added ? `${base}，+${granted.added}` : base);
    } catch (err) {
      if (err.status === 401) {
        setAuthToken("");
        window.dispatchEvent(new Event("okk-open-auth"));
      }
      setNote(err.message || "没有记下");
    } finally {
      voting.current = false;
    }
  };
  const remark = (slug, key, label) => {
    const id = `${slug}|${key}|${label}`;
    setRemarks((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = 1;
      localStorage.setItem(REMARK_KEY, JSON.stringify(next));
      return next;
    });
    setNote(remarks[`${slug}|${key}|${label}`] ? "已取消这条" : "已加上");
  };
  const pills = (station, key) => {
    const items = voteTags(station, localBySlug.get(station.slug) || [], key, remarks);
    if (!items.length) return <div className="vnone">暂无</div>;
    return (
      <div className="vpills">
        {items.map(([label, count, marked]) => (
          <button key={label} type="button" className={marked ? `vpill ${key} on` : `vpill ${key}`} onClick={() => remark(station.slug, key, label)}>
            <ThumbIcon down={key === "cons"} />
            {label} ({count})
          </button>
        ))}
      </div>
    );
  };
  return (
    <div className="wrap vote-page" style={{ paddingBottom: 40 }}>
      <div className="page-hd">
        <div>
          <h1>投票</h1>
          <p className="sub">赞成减反对，净票高的排前面。每人每站一票，记在接口里，其他人也能看到。</p>
        </div>
      </div>
      <div className="vote-bar">
        <input value={q} placeholder="搜索站点" onChange={(event) => { setQ(event.target.value); setShown(20); }} />
        <FilterPill
          label="排序"
          options={[["net", "净票"], ["up", "赞成"], ["down", "反对"]]}
          current={sort}
          open={menu}
          onOpen={setMenu}
          onPick={(value) => { setSort(value); setShown(20); }}
        />
        <span className="vote-hit">{ranked.length} 家</span>
        <button className="go pill vote-write" type="button" onClick={() => { setNote(""); setMine(true); }}>写点评</button>
      </div>
      {visible.length ? (
        <div className="vlist">
          {visible.map((row, index) => {
            const { station } = row;
            const locals = localBySlug.get(station.slug) || [];
            const latest = locals[locals.length - 1];
            const blurb = String(station.blurb || "").replace(/\s+/g, " ").trim();
            const netClass = row.net > 0 ? "pos" : row.net < 0 ? "neg" : "";
            return (
              <article key={station.slug} className="vcard">
                <div className="vrank">{index + 1}</div>
                <div className="vbody">
                  <Link className="vid" to={station.path}>
                    <Logo station={station} />
                    <span>
                      <div className="nm">{station.name}</div>
                      <div className="sub">{station.host}</div>
                    </span>
                  </Link>
                  <div className="vk">产品描述</div>
                  <p>{blurb || "暂无"}</p>
                  {latest?.body ? <p className="vquote"><i>★ {latest.rating}</i> {latest.body}</p> : null}
                </div>
                <div className="vcol">
                  <h4>优点</h4>
                  {pills(station, "pros")}
                </div>
                <div className="vcol">
                  <h4>缺点</h4>
                  {pills(station, "cons")}
                </div>
                <div className="vvote">
                  <div className="vnet">净票 <b className={netClass}>{row.net > 0 ? `+${row.net}` : row.net}</b></div>
                  <div className="vbtns">
                    <button type="button" className={row.mine === "up" ? "vbtn up on" : "vbtn up"} onClick={() => cast(station, "up")}>
                      <ThumbIcon />
                      <b>{row.up}</b>
                      <span>赞成</span>
                    </button>
                    <button type="button" className={row.mine === "down" ? "vbtn down on" : "vbtn down"} onClick={() => cast(station, "down")}>
                      <ThumbIcon down />
                      <b>{row.down}</b>
                      <span>反对</span>
                    </button>
                  </div>
                  <Link className="vmore" to={station.path}>了解更多 ›</Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="mini">没有匹配的站点。</p>}
      {shown < ranked.length ? <button className="step more-rows" type="button" onClick={() => setShown((count) => count + 20)}>加载更多</button> : null}
      {note ? <p className="toast">{note}</p> : null}
      {mine ? (
        <ReviewDialog
          onClose={() => setMine(false)}
          onSaved={(review) => {
            setShared((current) => [...current, review]);
            setMine(false);
            setNote("点评已发布，其他人也能看到");
          }}
        />
      ) : null}
    </div>
  );
}

function contextRank(text) {
  const match = String(text || "").replace(/,/g, "").match(/([\d.]+)\s*([kmg])?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = (match[2] || "").toLowerCase();
  if (unit === "m") return value * 1e6;
  if (unit === "k") return value * 1e3;
  if (unit === "g") return value * 1e9;
  return value;
}

const ACT_MODS = {
  文本: { className: "t", path: "M4 7V5h16v2M12 5v14M9 19h6" },
  图像: { className: "g", path: "M3 5h18v14H3zM8.5 10.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8M21 16l-5-5-8 8" },
  视频: { className: "v", path: "M4 6h11v12H4zM15 10l5-3v10l-5-3z" },
  pdf: { className: "f", path: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" },
  推理: { className: "r", path: "M9 18h6M10 21h4M8.2 14.2A5 5 0 1 1 15.8 14L14 16H10z" },
  代码: { className: "c", path: "M8 8 4 12l4 4M16 8l4 4-4 4" },
};

function ActMod({ name }) {
  const mod = ACT_MODS[name];
  if (!mod) return <span>{name}</span>;
  return (
    <span className="ract-w">
      <em className={mod.className} aria-label={name}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={mod.path} />
        </svg>
      </em>
      <span className="ract-tip">{name}</span>
    </span>
  );
}

function untilLabel(item) {
  if (item.dead) return "已失效";
  if (!item.endsAt) return "长期";
  return String(item.endsAt).slice(0, 10);
}

export function ActivityPage() {
  useTitle("福利羊毛｜中转站优惠活动和官方免费 API");
  const free = activityData.free;
  const promos = activityData.promos;
  const providers = useMemo(() => [...new Set(free.map((item) => item.provider))], [free]);
  const modes = useMemo(() => [...new Set(free.flatMap((item) => item.modality || []))], [free]);
  const [tab, setTab] = useState("free");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [gate, setGate] = useState("all");
  const [mode, setMode] = useState("all");
  const [sort, setSort] = useState("context");
  const [menu, setMenu] = useState("");
  const query = q.trim().toLowerCase();
  const freeList = free.filter((item) => {
    const blob = `${item.model} ${item.provider}`.toLowerCase();
    if (query && !blob.includes(query)) return false;
    if (provider !== "all" && item.provider !== provider) return false;
    if (status === "live" && item.dead) return false;
    if (status === "dead" && !item.dead) return false;
    if (gate === "card-free" && item.bindCard !== "免绑卡") return false;
    if (gate === "card" && item.bindCard === "免绑卡") return false;
    if (gate === "oversea" && item.network !== "需海外网络") return false;
    if (gate === "cn" && item.network !== "国内直连") return false;
    if (mode !== "all" && !(item.modality || []).includes(mode)) return false;
    return true;
  }).map((item, index) => ({ item, index }));
  freeList.sort((a, b) => {
    if (sort === "name") return a.item.model.localeCompare(b.item.model, "zh");
    if (sort === "context-asc") return contextRank(a.item.context) - contextRank(b.item.context) || a.index - b.index;
    return contextRank(b.item.context) - contextRank(a.item.context) || a.index - b.index;
  });
  const promoList = promos.filter((item) => {
    const blob = `${item.station} ${item.host} ${item.activity}`.toLowerCase();
    return !query || blob.includes(query);
  });
  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="page-hd">
        <div>
          <h1>福利羊毛</h1>
          <p className="sub">中转站限时福利，加上各家官方免费 API 资源，汇总一处。人工核实，失效即下。</p>
        </div>
      </div>
      <div className="act-tabs">
        <button className={tab === "free" ? "on" : ""} type="button" onClick={() => { setTab("free"); setMenu(""); }}>免费 API <em>{free.length}</em></button>
        <button className={tab === "perk" ? "on" : ""} type="button" onClick={() => { setTab("perk"); setMenu(""); }}>优惠活动 <em>{promos.length}</em></button>
      </div>
      <div className="filters">
        <label className="filter-search">
          <SearchGlyph />
          <input placeholder={tab === "free" ? "搜模型 / 提供者..." : "搜活动 / 站点..."} value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        {tab === "free" ? (
          <>
            <FilterPill label="服务" options={[["all", "全部"], ...providers.map((name) => [name, name])]} current={provider} open={menu} onOpen={setMenu} onPick={setProvider} />
            <FilterPill label="状态" options={[["all", "全部"], ["live", "有效"], ["dead", "已失效"]]} current={status} open={menu} onOpen={setMenu} onPick={setStatus} />
            <FilterPill label="门槛" options={[["all", "全部"], ["card-free", "免绑卡"], ["card", "需绑卡"], ["oversea", "需海外网络"], ["cn", "国内直连"]]} current={gate} open={menu} onOpen={setMenu} onPick={setGate} />
            <FilterPill label="模态" options={[["all", "全部"], ...modes.map((name) => [name, name])]} current={mode} open={menu} onOpen={setMenu} onPick={setMode} />
            <FilterPill label="排序" options={[["context", "语境最大"], ["context-asc", "语境最小"], ["name", "名称"]]} current={sort} open={menu} onOpen={setMenu} onPick={setSort} />
          </>
        ) : null}
      </div>
      {tab === "free" ? (
        freeList.length ? freeList.map(({ item }) => (
          <article key={item.claimUrl} className="act">
            <div className="act-top">
              <div className="act-id">
                <Logo station={{ img: item.logoUrl, name: item.model }} />
                <div>
                  <b>{item.model}</b>
                  <div className="mini">{item.provider}</div>
                </div>
              </div>
              <div><div className="mini">上下文</div><b>{item.context}</b></div>
              <div><div className="mini">最大输出</div><b>{item.maxOutput}</b></div>
              <div>
                <div className="mini">门槛</div>
                <div className="gate">
                  {item.bindCard ? <span className="gate-ok">{item.bindCard}</span> : null}
                  {item.network ? <span className={String(item.network).includes("海外") ? "gate-net" : "gate-ok"}>{item.network}</span> : null}
                </div>
              </div>
              <a className="ghost-btn" href={item.claimUrl} target="_blank" rel="noreferrer">立即前往 ↗</a>
            </div>
            <div className="act-foot">
              <span className="mini">{item.quota}</span>
              <div className="modes">{(item.modality || []).map((name) => <ActMod key={name} name={name} />)}</div>
              <span className="mini">截止 {untilLabel(item)}</span>
            </div>
          </article>
        )) : <p className="mini">没有符合条件的免费 API。</p>
      ) : (
        promoList.length ? promoList.map((item) => (
          <article key={item.claimUrl} className="act">
            <div className="act-top promo">
              <div className="act-id">
                <Logo station={{ img: item.logoUrl, name: item.station }} />
                <div>
                  <b>{item.station}</b>
                  <div className="mini">{item.host}</div>
                </div>
              </div>
              <a className="ghost-btn" href={item.claimUrl} target="_blank" rel="noreferrer">立即前往 ↗</a>
            </div>
            <p className="promo-copy">{item.activity}</p>
            <div className="mini">参与条件</div>
            <p>{item.eligibility}</p>
            <div className="mini">参与步骤</div>
            <p className="promo-steps">{item.steps}</p>
            {item.terms ? <details className="promo-terms"><summary>活动规则</summary><p>{item.terms}</p></details> : null}
            <div className="act-foot"><span className="mini">截止 {untilLabel(item)}</span></div>
          </article>
        )) : <p className="mini">没有符合条件的优惠活动。</p>
      )}
    </div>
  );
}

const SERVICE_META = {
  cx: { label: "Codex", icon: "/icons/vendor/openai.svg" },
  cc: { label: "Claude", icon: "/icons/vendor/claude.svg" },
  gm: { label: "Gemini", icon: "/icons/vendor/gemini.svg" },
};

function channelDot(status) {
  if (status === "异常") return "#ef4444";
  if (status === "正常") return "#1f9d55";
  return "#eab308";
}

function Chevron({ up }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ transform: up ? "rotate(180deg)" : "none" }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function AvailabilityPage() {
  useTitle("全站可用性监测｜Codex、Claude、Gemini 分组在线状态");
  const [params, setParams] = useSearchParams();
  const period = params.get("p") === "7d" || params.get("p") === "30d" ? params.get("p") : "24h";
  const board = availabilityData[period];
  const [q, setQ] = useState("");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("up");
  const [open, setOpen] = useState(() => new Set(board.cards.filter((card) => card.defaultOpen).map((card) => card.slug)));
  useEffect(() => {
    setOpen(new Set(availabilityData[period].cards.filter((card) => card.defaultOpen).map((card) => card.slug)));
  }, [period]);
  const query = q.trim().toLowerCase();
  const cards = useMemo(() => {
    const rows = board.cards.map((card) => {
      const nameHit = !query || card.name.toLowerCase().includes(query) || card.slug.toLowerCase().includes(query);
      const channels = card.channels.filter((channel) => {
        if (service !== "all" && channel.service !== service) return false;
        if (!nameHit && query) {
          const blob = `${channel.group} ${channel.model}`.toLowerCase();
          if (!blob.includes(query)) return false;
        }
        return true;
      });
      if (status !== "all" && card.statusText !== status) return null;
      if (!channels.length) return null;
      return { ...card, channels };
    }).filter(Boolean);
    rows.sort((a, b) => {
      if (sort === "latency") return (a.avgLatencyNum ?? 1e12) - (b.avgLatencyNum ?? 1e12);
      if (sort === "name") return a.name.localeCompare(b.name, "zh");
      return (b.avgUptimeNum ?? -1) - (a.avgUptimeNum ?? -1);
    });
    return rows;
  }, [board, query, service, status, sort]);
  const statuses = useMemo(() => [...new Set(board.cards.map((card) => card.statusText))], [board]);
  const allOpen = cards.length > 0 && cards.every((card) => open.has(card.slug));
  const metrics = board.metrics;
  const setPeriod = (next) => {
    const copy = new URLSearchParams(params);
    if (next === "24h") copy.delete("p");
    else copy.set("p", next);
    setParams(copy);
  };
  const toggle = (slug) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };
  const toggleAll = () => {
    setOpen(allOpen ? new Set(board.cards.filter((card) => card.defaultOpen).map((card) => card.slug)) : new Set(cards.map((card) => card.slug)));
  };
  return (
    <div className="wrap avail-page">
      <div className="avail-head">
        <div>
          <h1>全站可用性</h1>
          <p>实时监控各站每个服务、每个模型的可用性、延迟与响应趋势</p>
        </div>
        <div className="seg">
          {[["24h", "24h"], ["7d", "7d"], ["30d", "30d"]].map(([key, label]) => (
            <button key={key} type="button" className={period === key ? "on" : ""} onClick={() => setPeriod(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="avail-metrics">
        <div className="metric">
          <div className="l">整体状态</div>
          <div className="v bad">{metrics.status}</div>
          <div className="x">{metrics.status === "正常" ? "各服务运行正常" : "有服务需要关注"}</div>
        </div>
        <div className="metric">
          <div className="l">平均可用率</div>
          <div className="v">{metrics.uptime}<small>%</small></div>
          <div className="x">{period} 内全站均值</div>
        </div>
        <div className="metric">
          <div className="l">平均延迟</div>
          <div className="v">{metrics.latency}<small>s</small></div>
          <div className="x">{metrics.models} 个监测均值</div>
        </div>
        <div className="metric">
          <div className="l">异常告警</div>
          <div className="v bad">{metrics.alerts} <small>个</small></div>
          <div className="x">{metrics.services} 个服务 · {metrics.models} 个模型</div>
        </div>
      </div>
      <div className="filters">
        <label className="filter-search">
          <SearchGlyph />
          <input placeholder="搜站名 / 分组 / 模型" value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <select value={service} onChange={(event) => setService(event.target.value)}>
          <option value="all">服务 全部</option>
          <option value="cx">服务 Codex</option>
          <option value="cc">服务 Claude</option>
          <option value="gm">服务 Gemini</option>
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">状态 全部</option>
          {statuses.map((name) => <option key={name} value={name}>状态 {name}</option>)}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="up">排序 可用率</option>
          <option value="latency">排序 延迟</option>
          <option value="name">排序 名称</option>
        </select>
        <button className="ghost-btn" type="button" onClick={toggleAll}>{allOpen ? "收起全部" : "展开全部"}</button>
      </div>
      {cards.map((card) => {
        const opened = Boolean(query) || service !== "all" || open.has(card.slug);
        const families = [];
        for (const channel of card.channels) {
          if (!families.some((item) => item.service === channel.service)) families.push(channel);
        }
        return (
          <article key={card.slug} className="av-card">
            <div className="av-head" onClick={() => toggle(card.slug)}>
              <Logo station={{ img: card.logoUrl, name: card.name }} className="logo-img av-logo" />
              <div className="av-id">
                <div className="av-name">
                  <b>{card.name}</b>
                  <span className="av-status"><i style={{ background: card.statusColor }} />{card.statusText}</span>
                </div>
                <div className="mini">{card.channels.length} 个监测</div>
              </div>
              <div className="av-stat"><div className="l">平均可用率</div><div className="n">{card.avgUptime}</div></div>
              <div className="av-stat"><div className="l">平均延迟</div><div className="n">{card.avgLatency}</div></div>
              <span className="av-chev"><Chevron up={opened} /></span>
            </div>
            {opened ? (
              <table className="av-table">
                <thead>
                  <tr><th>分组</th><th>服务</th><th>监测模型</th><th>状态</th><th>平均延迟</th><th>可用率</th><th>响应趋势</th></tr>
                </thead>
                <tbody>
                  {card.channels.map((channel) => {
                    const meta = SERVICE_META[channel.service];
                    return (
                      <tr key={`${channel.group}-${channel.model}-${channel.service}`}>
                        <td>{channel.group}</td>
                        <td>{meta ? <img className="av-svc" src={meta.icon} alt={meta.label} /> : channel.service}</td>
                        <td>{channel.model}</td>
                        <td><span className="av-status"><i style={{ background: channelDot(channel.statusText) }} />{channel.statusText}</span></td>
                        <td>{channel.latency}</td>
                        <td>{Number(channel.avg).toFixed(1)}%</td>
                        <td><Spark points={channel.points} width={210} height={22} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="av-preview">
                {families.map((channel) => {
                  const meta = SERVICE_META[channel.service];
                  return (
                    <span key={channel.service} className="av-prev">
                      {meta ? <img src={meta.icon} alt="" /> : null}
                      <span>{meta?.label || channel.model}</span>
                      <i style={{ background: channelDot(channel.statusText) }} />
                    </span>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
      {cards.length ? null : <p className="mini">没有符合条件的监测。</p>}
    </div>
  );
}

const MODEL_FAMILIES = ["ChatGPT", "Claude", "Gemini", "Grok", "GLM", "DeepSeek", "Kimi", "千问", "MiniMax", "MiMo", "混元", "TypeSafe", "Meta", "豆包"];

function yuan(value) {
  return `¥${Number(value).toFixed(2)}`;
}

function contextText(value) {
  if (!value) return "—";
  const wan = Math.round((value / 10000) * 10) / 10;
  return `${Number.isInteger(wan) ? wan : wan.toFixed(1)}万`;
}

function cleanHref(url) {
  try {
    const next = new URL(url);
    next.search = "";
    next.hash = "";
    return next.toString();
  } catch {
    return "";
  }
}

export function ModelListPage() {
  useTitle("AI 模型中转站排行｜价格、上下文和智商");
  const [family, setFamily] = useState("全部");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("hot");
  const [menu, setMenu] = useState("");
  const [shown, setShown] = useState(20);
  const families = MODEL_FAMILIES.filter((item) => modelRows.some((row) => row.family === item));
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const rows = modelRows.map((row, index) => ({ ...row, order: index })).filter((row) => {
      if (family !== "全部" && row.family !== family) return false;
      if (text && !`${row.title} ${row.slug}`.toLowerCase().includes(text)) return false;
      return true;
    });
    if (sort === "price") {
      return [...rows].sort((a, b) => (a.cheapest?.in ?? 1e9) - (b.cheapest?.in ?? 1e9) || a.order - b.order);
    }
    if (sort === "iq") {
      return [...rows].sort((a, b) => (b.iq ?? -1) - (a.iq ?? -1) || a.order - b.order);
    }
    if (sort === "new") {
      return [...rows].sort((a, b) => String(b.released || "").localeCompare(String(a.released || "")) || a.order - b.order);
    }
    return rows;
  }, [family, query, sort]);
  const visible = filtered.slice(0, shown);
  return (
    <div className="wrap model-page">
      <div className="page-hd">
        <div>
          <h1>AI模型中转站排行榜</h1>
          <p className="sub">对照主流模型的最低中转价、上下文、提供站点数和智商分。价格来自各站公开分组，会变动；智商分来自同步的公开评测，不代表官方渠道。</p>
        </div>
      </div>
      <div className="model-tools">
        <div className="model-fams">
          {["全部", ...families].map((item) => (
            <button key={item} type="button" className={family === item ? "on" : ""} onClick={() => { setFamily(item); setShown(20); }}>
              <VendorIcon name={FAMILY_VENDOR[item]} />
              {item}
            </button>
          ))}
        </div>
        <input value={query} placeholder="搜索模型" onChange={(event) => { setQuery(event.target.value); setShown(20); }} />
        <FilterPill
          label="排序"
          options={[["hot", "热门优先"], ["price", "价格优先"], ["iq", "智商优先"], ["new", "最新发布"]]}
          current={sort}
          open={menu}
          onOpen={setMenu}
          onPick={(value) => { setSort(value); setShown(20); }}
        />
      </div>
      <div className="table-wrap">
        <table className="rank model-table">
          <thead>
            <tr>
              <th>模型</th><th>模态</th><th>最低中转价</th><th>上下文</th><th>提供站点</th><th>智商</th><th>发布时间</th><th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const href = cleanHref(row.cheapest?.url);
              return (
                <tr key={row.slug}>
                  <td>
                    <Link to={`/model/${row.slug}`} className="model-name">
                      <img src={row.icon} alt="" width="18" height="18" />
                      {row.title}
                    </Link>
                  </td>
                  <td><span className="mods">{(row.mods || []).map((item) => <ModIcon key={item} kind={item} />)}</span></td>
                  <td>
                    {row.cheapest ? (
                      <>
                        <div>{yuan(row.cheapest.in)} / {yuan(row.cheapest.out)}</div>
                        {href ? <a className="mini" href={href} target="_blank" rel="noreferrer">{row.cheapest.station}</a> : <span className="mini">{row.cheapest.station}</span>}
                      </>
                    ) : "暂无"}
                  </td>
                  <td>{contextText(row.context)}</td>
                  <td>{row.stations ?? "—"} 家</td>
                  <td>{row.iq ?? "—"}</td>
                  <td>{row.released || "—"}</td>
                  <td><Link to={`/model/${row.slug}`}>›</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length < filtered.length ? (
        <div className="pager"><button type="button" className="step" onClick={() => setShown((value) => value + 20)}>加载更多</button></div>
      ) : null}
      {filtered.length ? null : <p className="mini">没有符合条件的模型。</p>}
    </div>
  );
}

export function ModelPage() {
  const { slug } = useParams();
  if (FAMILY_MODEL_IDS.includes(slug)) return <ListPage modelId={slug} />;
  return <ModelBoard slug={slug} />;
}

export function HelpPage() {
  useTitle("评测方法｜目录探测、公开价格、投票和评价");
  return (
    <div className="wrap help">
      <aside className="side">
        <div className="mini">平台说明</div>
        <a className="on" href="#method">评测方法</a>
        <a href="#scoring">评分说明</a>
        <a href="#blank">留空的字段</a>
      </aside>
      <article className="prose">
        <h1 id="method">评测方法</h1>
        <p>维渡 AI 是第三方 AI 中转站目录。本站不代收充值，也不证明某家站是官方原厂。收录和名次不收费。</p>
        <p>页面上的数字只来自下面几类已经拿到的记录。没有记录的格子留空，不估一个分数。</p>
        <table className="doc">
          <thead><tr><th>内容</th><th>来源</th><th>页面上怎么用</th></tr></thead>
          <tbody>
            <tr><td>站点在线率、延迟</td><td>目录探测</td><td>写在站点资料里。这是站点级记录，不是每个模型各测一次。</td></tr>
            <tr><td>输入价、输出价、缓存价</td><td>该站公开的价格接口</td><td>按对方公布的倍率公式换算。没有公开价格，或不是按 token 计价的，价格留空。</td></tr>
            <tr><td>公告</td><td>该站公开的公告接口</td><td>有公告才显示。没有就写公开页面上没有公告。</td></tr>
            <tr><td>最低充值、支付、发票、退款</td><td>目录里已经记下的字段</td><td>目录没有的不补。</td></tr>
            <tr><td>赞成、反对、点评</td><td>登录账户提交</td><td>记在接口里，其他人打开同一页能看到。</td></tr>
          </tbody>
        </table>
        <h2 id="blank">留空的字段</h2>
        <p>纯度、单个模型的延迟和单个模型的在线率，本站没有做这套探测，详情页对应格子是空的。浏览器里的基础测试、糖果测试和鹈鹕骑车，用的是你自己的接口地址和 Key，结果只留在这台浏览器，不会写成站内的纯度分。</p>
        <h2 id="scoring">评分说明</h2>
        <p>有人投票时，星级等于赞成除以赞成加反对，再乘以 5。评价条数等于赞成加反对。没有投票、但目录里原来有评价时，沿用那些评价的星级。投票和评价都没有，就显示暂无评分。</p>
        <p>站点排行把原来的站和后收录的站放在一起。访问异常的排在最后。评论平均分达到 4 星、并且至少 2 条评论的站，最多提拔 8 家排到最前面，按星级和评论条数排列。没有评论的仍按原来的规则：没有在线率数字的排在有数字的后面、异常站前面。在线率按档排：99%–100% 一档，95%–98% 一档，90%–94% 一档，90% 以下一档。同一档里延迟也按档排：1 秒内、1–3 秒、3 秒以上，没有延迟数字的靠后。再往下，公开了模型的排在没有模型的前面；有评论但没达到提拔线的，按评论星级，高的在前。投票不参与这个名次。点「在线率」或「平均延迟」时，按该数字本身排。赞成和反对每人每站一票，再点一次同一边就是取消。</p>
      </article>
    </div>
  );
}

export function AboutPage() {
  useTitle("商务合作｜广告投放、站点收录与内容引用");
  const [copied, setCopied] = useState("");
  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <section className="about-hero">
        <div className="about-copy">
          <div className="kicker">合作与联系</div>
          <h1>商务合作</h1>
          <p>广告投放、内容合作、中转站收录，以及其他与大模型服务相关的合作。请通过以下任一方式联系我们，并附上品牌或站点名称、合作方向和相关链接。</p>
        </div>
        <div className="contact">
          <div className="row" style={{ border: 0 }}><b>联系方式</b><span /><span className="mini">任选一种即可</span></div>
          <div className="row">
            <span className="sq">✉</span>
            <div><div className="em">邮箱</div><div className="id">2201219073@qq.com</div></div>
            <a className="mini-btn" href="mailto:2201219073@qq.com">发邮件 ↗</a>
          </div>
          <div className="row">
            <span className="sq">Q</span>
            <div><div className="em">QQ</div><div className="id">2201219073</div></div>
            <button className="mini-btn ghost" onClick={() => { navigator.clipboard?.writeText("2201219073"); setCopied("qq"); }}>复制</button>
          </div>
          <div className="row">
            <span className="sq">✈</span>
            <div><div className="em">Telegram</div><div className="id">@alexnsss</div></div>
            <a className="mini-btn" href="https://t.me/alexnsss" target="_blank" rel="noreferrer">打开 ↗</a>
          </div>
          {copied ? <div className="toast">已复制</div> : null}
        </div>
      </section>
      <div className="coop">
        <div />
        <h2>可以怎么合作</h2>
        <div className="lab">合作方式</div>
        <div>
          {[
            ["01 / 03", "广告投放", "面向正在比较中转站、模型和 API 服务的用户进行品牌展示。广告内容会标明赞助。"],
            ["02 / 03", "站点收录", "提交你的中转站，补充模型、价格和支付方式。收录不收取影响排名的费用。"],
            ["03 / 03", "数据与内容", "方法说明、榜单摘录和模型监测，适合写进文档或社区帖。请保留出处。"],
          ].map((item) => (
            <div key={item[0]} className="coop-item">
              <span className="mini">{item[0]}</span>
              <b>{item[1]}</b>
              <span>{item[2]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Article({ title, seoTitle, children }) {
  useTitle(seoTitle || title);
  return (
    <div className="wrap help">
      <aside className="side">
        <Link to="/help">评测方法</Link>
        <Link to="/disclaimer">免责声明</Link>
        <Link to="/privacy">隐私政策</Link>
        <Link to="/terms">服务条款</Link>
      </aside>
      <article className="prose">
        <h1>{title}</h1>
        {children}
      </article>
    </div>
  );
}

export function DisclaimerPage() {
  return (
    <Article title="免责声明" seoTitle="免责声明｜检测数据仅供参考，不构成充值建议">
      <p>最后更新：2026 年 7 月 3 日</p>
      <p>维渡 AI（下称「本站」）是一个独立的第三方 AI 中转站测评平台。为帮助你理解本站信息的性质与边界，请阅读以下声明。</p>
      <h2>一、检测结果仅供参考</h2>
      <p>站点在线率、延迟来自目录探测，价格来自各站公开页面。本站没有做纯度探测，单个模型的延迟和在线率也没有测。这些记录可能滞后或有误，请以你自己的使用为准。</p>
      <h2>二、不构成推荐或背书</h2>
      <p>本站对中转站的检测、评分与排名，仅是基于既定方法的客观呈现，不代表本站对任何中转站的推荐、担保或背书。是否使用某个中转站，应由你自行判断与决定。</p>
      <h2>三、数据来源</h2>
      <p>本站展示的模型列表、分组、价格等信息，部分来自中转站的公开页面或其自行申报，部分来自本站的实测。第三方来源的信息本站无法保证其真实与时效，价格与可用性尤其可能随时变动，请以中转站官方为准。</p>
      <h2>四、非投资或消费建议</h2>
      <p>本站内容不构成任何投资、消费或商业决策建议。你因参考本站信息而做出的任何决定及其后果，由你自行承担。</p>
      <h2>五、第三方链接与服务</h2>
      <p>本站可能包含指向第三方中转站或服务的链接。那些网站的内容、安全和交易由对方负责。</p>
    </Article>
  );
}

export function PrivacyPage() {
  return (
    <Article title="隐私政策" seoTitle="隐私政策｜Cookie、检测 Key 和评价内容如何留存">
      <p>本站只使用维持登录和语言偏好所必需的 cookie，以及匿名的访问量统计，不用于广告追踪。</p>
      <p>你在检测框里填写的 API Key 留在浏览器里，这份本地复刻不会把它发往任何服务器。</p>
      <p>公开评价和商务联系方式由用户主动提交。不要在评价里写下密钥或订单号。</p>
    </Article>
  );
}

export function TermsPage() {
  return (
    <Article title="服务条款" seoTitle="服务条款｜榜单边界、充值退款和禁止行为">
      <p>使用本站即表示你理解榜单是第三方实测的展示，不是购买建议。你和中转站之间的充值、退款、发票，以该站自己的规则为准。</p>
      <p>禁止利用本站页面批量撞库、盗用他人密钥，或把探测结果包装成官方担保。</p>
    </Article>
  );
}

const DAILY = [
  ["checkin", "每日签到", "登录后每天签到一次，记在账户里", "3~5", "去完成"],
  ["detect", "每日检测", "在首页发起一次基础测试", "3", "去完成"],
];
const ADVANCED = [
  ["like", "投票", "在投票页给一家中转站投赞成或反对", "2", "去完成"],
  ["review", "发表点评", "对用过的中转站写一条真实点评", "8", "去完成"],
  ["invite", "邀请好友", "好友用你的链接注册后，你得 20 积分", "20", "去完成"],
];
const BASIC = [
  ["community", "加入官方社群", "加入官方 Telegram / 微信群", "5", "敬请期待"],
  ["profile", "完善资料", "设置头像和昵称", "5", "去完成"],
  ["first-detect", "完成首次检测", "第一次从首页跑基础测试", "5", "去完成"],
  ["favorite", "首次收藏", "收藏第一个中转站", "3", "去完成"],
];
const TRACKED = [
  ["checkin", "day"],
  ["detect", "day"],
  ["like", "day"],
  ["review", "day"],
  ["profile", "once"],
  ["first-detect", "once"],
  ["favorite", "once"],
];

function Coin({ children }) {
  return (
    <span className="pt-pts">
      <span className="pt-gem" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M9.6 9.6c.5-.8 1.3-1.2 2.4-1.2 1.3 0 2.2.6 2.2 1.6S13.2 11.6 12 11.6 9.8 12.2 9.8 13.4 11 15.2 12.4 15.2c1 0 1.8-.4 2.3-1.1" />
        </svg>
      </span>
      {children}
    </span>
  );
}

function TaskIcon({ id }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  if (id === "checkin") {
    return (
      <svg {...props}>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3.5v3M16 3.5v3M4 10h16" />
      </svg>
    );
  }
  if (id === "detect" || id === "first-detect") {
    return (
      <svg {...props}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    );
  }
  if (id === "like") {
    return (
      <svg {...props}>
        <path d="M8 11.2V19h7.6a1.8 1.8 0 0 0 1.8-1.5l.9-3.8a1.8 1.8 0 0 0-1.8-2.2H13l.5-2.4a1.7 1.7 0 0 0-3.2-1L8 11.2z" />
        <path d="M8 11.2H5.6a1 1 0 0 0-1 1V18a1 1 0 0 0 1 1H8" />
      </svg>
    );
  }
  if (id === "review") {
    return (
      <svg {...props}>
        <path d="M5 6.5h14v8.5H8.5L5 18z" />
      </svg>
    );
  }
  if (id === "invite") {
    return (
      <svg {...props}>
        <path d="M10 13a5 5 0 0 0 7.1.4l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1-.4l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
      </svg>
    );
  }
  if (id === "community") {
    return (
      <svg {...props}>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 19.2c.8-3 3.2-4.7 6.5-4.7s5.7 1.7 6.5 4.7" />
      </svg>
    );
  }
  if (id === "favorite") {
    return (
      <svg {...props}>
        <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1z" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M14 3.5V8h4.5M8 13h8M8 17h5" />
    </svg>
  );
}

function faceLetter(name) {
  const text = String(name || "").trim();
  if (!text) return "?";
  const ch = [...text][0];
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

function AvatarField({ name, value, onChange, onError }) {
  const inputRef = useRef(null);
  return (
    <div className="av-field">
      <span className="k">头像</span>
      <button type="button" className="av-pick" aria-label="更换头像" onClick={() => inputRef.current?.click()}>
        <span className="av-face">
          {value ? <img src={value} alt="" /> : faceLetter(name)}
        </span>
        <span className="av-cam" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8.5h3l1.5-2h7L17 8.5h3v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
            <circle cx="12" cy="13.2" r="3.2" />
          </svg>
        </span>
      </button>
      <input
        ref={inputRef}
        className="av-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          fitAvatar(file).then(onChange).catch((error) => onError(error.message || "这张图片打不开"));
        }}
      />
      {value ? <button type="button" className="av-clear" onClick={() => onChange("")}>去掉头像</button> : null}
    </div>
  );
}

function InviteDialog({ copied, onCopy, onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!authToken()) {
      setError("请先登录，邀请链接才会记到账户");
      return undefined;
    }
    let stop = false;
    fetchAccount().then((data) => {
      if (!stop) setInfo(data.invite || null);
    }).catch((err) => {
      if (!stop) setError(err.message || "没有读到邀请码");
    });
    return () => { stop = true; };
  }, []);
  const code = info?.code || "";
  const link = code ? `${window.location.origin}/?invite=${code}` : "";
  return (
    <div className="invite-mask" onClick={onClose}>
      <div className="invite-box" role="dialog" aria-labelledby="invite-title" onClick={(event) => event.stopPropagation()}>
        <button className="invite-x" type="button" aria-label="关闭" onClick={onClose}>×</button>
        <div className="invite-hero" aria-hidden="true">
          <svg width="78" height="64" viewBox="0 0 78 64" fill="none">
            <path d="M18 28h42v22a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V28z" fill="#65A30D" />
            <path d="M16 20h46v10H16z" fill="#4d7c0f" />
            <path d="M36 20h6v34h-6z" fill="#f7fee7" />
            <path d="M28 20c0-6 4-10 11-10s11 4 11 10" stroke="#d97706" strokeWidth="3" />
            <circle cx="16" cy="18" r="7" fill="#f59e0b" />
            <circle cx="62" cy="16" r="6" fill="#fbbf24" />
          </svg>
        </div>
        <h2 id="invite-title">邀请好友</h2>
        <p className="invite-lead">好友用这个链接注册后，你获得 20 积分。同一个好友只算一次。</p>
        {error ? <p className="review-error">{error}</p> : null}
        {code ? (
          <>
            <div className="invite-k">邀请码</div>
            <div className="invite-code">
              <b>{code}</b>
              <button type="button" aria-label="复制邀请码" onClick={() => onCopy(code, "code")}>{copied === "code" ? "已复制" : "复制"}</button>
            </div>
            <div className="invite-k">邀请链接</div>
            <div className="invite-link">
              <input readOnly value={link} />
              <button type="button" onClick={() => onCopy(link, "link")}>{copied === "link" ? "已复制" : "复制"}</button>
            </div>
            <div className="invite-k">邀请历史</div>
            <div className="invite-stats">
              <div><b>{info.count || 0}</b><span>已邀请(人)</span></div>
              <div><b>{info.points || 0}</b><span>累计积分</span></div>
            </div>
          </>
        ) : error ? (
          <button type="button" className="go" onClick={() => window.dispatchEvent(new Event("okk-open-auth"))}>登录</button>
        ) : <p className="mini">正在读取邀请码</p>}
      </div>
    </div>
  );
}

export function PointsPage() {
  useTitle("赚积分｜签到、投票和点评记在账户，检测只留在这台浏览器");
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState(() => readPoints());
  const [tab, setTab] = useState("tasks");
  const [redeem, setRedeem] = useState("open");
  const [ledgerTab, setLedgerTab] = useState("flow");
  const [name, setName] = useState(() => localStorage.getItem("okk-user") || "");
  const [nickDraft, setNickDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const sync = () => {
      setState(readPoints());
      setName(localStorage.getItem("okk-user") || "");
    };
    window.addEventListener("okk-points", sync);
    window.addEventListener("okk-auth", sync);
    return () => {
      window.removeEventListener("okk-points", sync);
      window.removeEventListener("okk-auth", sync);
    };
  }, []);

  useEffect(() => {
    if (location.hash === "#invite") setInviteOpen(true);
  }, [location.hash]);

  useEffect(() => {
    const sync = () => setState(readPoints());
    window.addEventListener("okk-account", sync);
    return () => window.removeEventListener("okk-account", sync);
  }, []);

  useEffect(() => {
    if (!inviteOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setInviteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inviteOpen]);

  useEffect(() => {
    if (!editing) return undefined;
    const node = document.getElementById("profile");
    node?.scrollIntoView({ block: "center" });
    node?.querySelector("input")?.focus();
    return undefined;
  }, [editing]);

  const doneCount = TRACKED.filter(([id, scope]) => isDone(id, scope)).length;

  function go(id) {
    if (id === "checkin") {
      if (!authToken()) {
        setNote("请先登录再签到");
        window.dispatchEvent(new Event("okk-open-auth"));
        return;
      }
      sendCheckin().then(async (result) => {
        const account = await fetchAccount();
        applyRemoteAccount(account);
        setState(readPoints());
        setNote(result.added ? `签到成功，+${result.amount}` : "今天已经签过到了");
      }).catch((err) => {
        if (err.status === 401) {
          setAuthToken("");
          window.dispatchEvent(new Event("okk-open-auth"));
        }
        setNote(err.message || "没有记下");
      });
      return;
    }
    if (id === "detect" || id === "first-detect") {
      navigate("/");
      return;
    }
    if (id === "like" || id === "review") {
      navigate("/reputation");
      return;
    }
    if (id === "invite") {
      setCopied("");
      setInviteOpen(true);
      return;
    }
    if (id === "profile") {
      if (!name) {
        setNote("先登录，再设置头像和昵称");
        window.dispatchEvent(new Event("okk-open-auth"));
        return;
      }
      if (editing) {
        setEditing(false);
        return;
      }
      setNickDraft(state.nick || name);
      setAvatarDraft(readAvatar());
      setEditing(true);
      setNote("");
      return;
    }
    if (id === "favorite") {
      grant("favorite", 3, "首次收藏", "once");
      navigate("/list");
    }
  }

  function TaskGrid({ items }) {
    return (
      <div className="pgrid">
        {items.map(([id, title, desc, pts, action]) => {
          const daily = id === "checkin" || id === "detect" || id === "like" || id === "review";
          const finished = id !== "community" && id !== "invite" && id !== "profile" && isDone(id, daily ? "day" : "once");
          const quiet = id === "community" || finished;
          const open = id === "profile" && editing;
          return (
            <article key={id} id={id === "invite" || id === "profile" ? id : undefined} className={open ? "ptask open" : "ptask"}>
              <div className={quiet ? "pt-row" : "pt-row live"} onClick={() => { if (!quiet) go(id); }}>
                <span className="pt-ico"><TaskIcon id={id} /></span>
                <div className="pt-main">
                  <div className="pt-t">{title}</div>
                  <div className="pt-d">{desc}</div>
                </div>
                <div className="pt-side">
                  <Coin>+{pts}</Coin>
                  <button
                    className={`pt-go${quiet ? " done" : ""}`}
                    type="button"
                    disabled={quiet}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!quiet) go(id);
                    }}
                  >
                    {id === "community" ? "敬请期待" : finished ? "已完成" : open ? "收起" : action}
                  </button>
                </div>
              </div>
              {open ? (
                <form
                  className="pts-edit"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const value = nickDraft.trim();
                    if (!value) {
                      setNote("先写一个昵称");
                      return;
                    }
                    saveNick(value);
                    const session = readSession();
                    writeAvatar(avatarDraft);
                    if (authToken()) {
                      try {
                        const profile = await updateProfile({ nick: value });
                        writeSession(profile.name || value, session.email);
                        applyRemoteAccount(await saveAvatar(avatarDraft));
                      } catch (err) {
                        setNote(err.message || "昵称没有写到接口");
                        return;
                      }
                    } else if (session.name) {
                      writeSession(value, session.email);
                    }
                    const result = grant("profile", 5, "完善资料", "once");
                    setState(result.state);
                    setEditing(false);
                    setNote(result.added ? `资料已保存，+${result.added}` : "资料已保存");
                    window.dispatchEvent(new Event("okk-auth"));
                    requestAnimationFrame(() => {
                      document.querySelector(".pts-note")?.scrollIntoView({ block: "center" });
                    });
                  }}
                >
                  {note ? <p className="pts-note">{note}</p> : null}
                  <AvatarField name={nickDraft || name} value={avatarDraft} onChange={setAvatarDraft} onError={setNote} />
                  <label>
                    昵称
                    <input value={nickDraft} onChange={(event) => setNickDraft(event.target.value)} />
                  </label>
                  <button className="go" type="submit">保存</button>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="pts-root">
      <div className="wrap" style={{ paddingBottom: 80 }}>
      <header className="pts-head">
        <div>
          <h1>积分中心</h1>
          <p>做任务赚积分。兑换页目前没有奖品。</p>
        </div>
        <div className="pts-stats">
          <div className="pts-stat">
            <div className="k">当前积分</div>
            <div className="v olive">{state.balance}</div>
          </div>
          <i className="pts-split" aria-hidden="true" />
          <div className="pts-stat">
            <div className="k">今日已完成</div>
            <div className="v">{doneCount} / {TRACKED.length}</div>
          </div>
          <button className="pts-redeem" type="button" onClick={() => { setTab("redeem"); setNote(""); }}>兑换权益</button>
        </div>
      </header>

      <div className="ptabs">
        {[
          ["tasks", "任务列表"],
          ["redeem", "积分兑换"],
          ["ledger", "积分明细"],
        ].map(([id, label]) => (
          <button key={id} className={`ptab ${tab === id ? "on" : ""}`} onClick={() => { setTab(id); setNote(""); }}>
            {label}
          </button>
        ))}
      </div>

      {note ? <p className="pts-note">{note}</p> : null}

      {tab === "tasks" ? (
        <>
          <div className="pts-cols">
            <section className="psec">
              <div className="psec-h"><div className="psec-t">日常任务</div></div>
              <TaskGrid items={DAILY} />
            </section>
            <section className="psec">
              <div className="psec-h"><div className="psec-t">进阶任务</div></div>
              <TaskGrid items={ADVANCED} />
            </section>
          </div>
          <section className="psec">
            <div className="psec-h"><div className="psec-t">基础任务</div></div>
            <TaskGrid items={BASIC} />
          </section>
        </>
      ) : null}

      {tab === "redeem" ? (
        <>
          <div className="shop-filters">
            {[
              ["open", "开放中"],
              ["soon", "待开放"],
              ["done", "已结束"],
            ].map(([id, label]) => (
              <button key={id} className={`shop-fch${redeem === id ? " on" : ""}`} onClick={() => setRedeem(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="shop-grid">
            <div className="shop-empty">这里还空着,奖品正在路上。</div>
          </div>
        </>
      ) : null}

      {tab === "ledger" ? (
        <div>
          <div className="shop-filters">
            <button className={`shop-fch${ledgerTab === "flow" ? " on" : ""}`} onClick={() => setLedgerTab("flow")}>积分流水</button>
            <button className={`shop-fch${ledgerTab === "mine" ? " on" : ""}`} onClick={() => setLedgerTab("mine")}>我的兑换</button>
          </div>
          {ledgerTab === "flow" && state.ledger.length ? (
            state.ledger.map((item, index) => (
              <div key={item.at + index} className="plog">
                <div className="pl-date">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.at)).replace(/\//g, "-")}</div>
                <div className="pl-reason">{item.reason}</div>
                <div className="pl-pts">+{item.amount}</div>
              </div>
            ))
          ) : (
            <div className="plist-empty">{ledgerTab === "flow" ? "还没有积分记录，去做任务赚分吧。" : "还没有兑换记录，去「积分兑换」逛逛吧。"}</div>
          )}
        </div>
      ) : null}
      </div>
      {inviteOpen ? (
        <InviteDialog
          copied={copied}
          onCopy={async (text, which) => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(which);
            } catch {
              setCopied("");
              setNote("这台浏览器没有允许复制");
            }
          }}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function AccountPage() {
  useTitle("账户设置｜头像、积分、收藏和提交记在账户");
  const [session, setSession] = useState(readSession);
  const [nick, setNick] = useState(session.name);
  const [avatar, setAvatar] = useState(readAvatar);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => {
      const nextSession = readSession();
      setSession(nextSession);
      setNick(nextSession.name);
      setAvatar(readAvatar());
    };
    window.addEventListener("okk-auth", sync);
    return () => window.removeEventListener("okk-auth", sync);
  }, []);

  if (!session.name) {
    return (
      <div className="wrap form-page">
        <h1>账户设置</h1>
        <p className="sub">先登录。头像、积分、收藏和提交记在这个账户里。</p>
        <button className="go" type="button" onClick={() => window.dispatchEvent(new Event("okk-open-auth"))}>登录</button>
      </div>
    );
  }

  async function saveName(event) {
    event.preventDefault();
    const value = nick.trim();
    if (!value) {
      setError("昵称不能为空");
      setNote("");
      return;
    }
    if (!authToken()) {
      setError("请退出后重新登录，昵称才会记到点评里");
      setNote("");
      return;
    }
    try {
      const profile = await updateProfile({ nick: value });
      saveNick(profile.name || value);
      writeSession(profile.name || value, session.email);
      applyRemoteAccount(await saveAvatar(avatar));
      setSession({ name: profile.name || value, email: session.email });
      setNick(profile.name || value);
      setError("");
      setNote("头像和昵称已记到账户");
      window.dispatchEvent(new Event("okk-auth"));
    } catch (err) {
      if (err.status === 401) {
        setAuthToken("");
        window.dispatchEvent(new Event("okk-open-auth"));
      }
      setError(err.message || "没有记下");
      setNote("");
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (!authToken()) {
      setError("请退出后重新登录，再改密码");
      setNote("");
      return;
    }
    if (next.length < 6) {
      setError("新密码至少 6 位");
      setNote("");
      return;
    }
    try {
      await changePassword({ current, password: next });
      setCurrent("");
      setNext("");
      setError("");
      setNote("密码已更新");
    } catch (err) {
      if (err.status === 401) {
        setAuthToken("");
        window.dispatchEvent(new Event("okk-open-auth"));
      }
      setError(err.message || "没有记下");
      setNote("");
    }
  }

  return (
    <div className="wrap form-page">
      <h1>账户设置</h1>
      <p className="sub">头像、昵称、积分、收藏和提交都记在这个账户里。检测记录只留在这台浏览器。</p>
      <form onSubmit={saveName}>
        <AvatarField name={nick} value={avatar} onChange={(next) => { setAvatar(next); setError(""); }} onError={(message) => { setError(message); setNote(""); }} />
        <div className="field">
          <label>邮箱</label>
          <input value={session.email || "这台浏览器没有记下邮箱"} readOnly />
        </div>
        <div className="field">
          <label>昵称</label>
          <input value={nick} onChange={(event) => setNick(event.target.value)} />
        </div>
        <button className="go" type="submit">保存</button>
      </form>
      {session.email ? (
        <form onSubmit={savePassword} style={{ marginTop: 28 }}>
          <div className="field">
            <label>当前密码</label>
            <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>新密码</label>
            <input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" />
          </div>
          <button className="go" type="submit">保存新密码</button>
        </form>
      ) : null}
      {error ? <div className="toast" style={{ color: "var(--red)" }}>{error}</div> : null}
      {note ? <div className="toast">{note}</div> : null}
    </div>
  );
}

export function SubmissionsPage() {
  useTitle("我的提交｜记在登录账户里，没有审核状态");
  const [rows, setRows] = useState(readSubmissions);
  useEffect(() => {
    const sync = () => setRows(readSubmissions());
    window.addEventListener("okk-account", sync);
    return () => window.removeEventListener("okk-account", sync);
  }, []);
  return (
    <div className="wrap form-page">
      <h1>我的提交</h1>
      <p className="sub">这里列出这个账户提交过的站点，没有审核状态。</p>
      {rows.length === 0 ? (
        <p>还没有提交。<Link to="/apply">去申请收录</Link></p>
      ) : (
        <ul className="mine">
          {rows.map((row) => (
            <li key={row.id}>
              <b>{row.name}</b>
              <a href={row.url} target="_blank" rel="noreferrer">{row.url}</a>
              {row.note ? <p>{row.note}</p> : null}
              <time>{row.at ? row.at.replace("T", " ").slice(0, 16) : ""}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


export function AgentsPage() {
  return (
    <Article title="给 Agent 的站点说明" seoTitle="给 Agent 的站点说明｜路径、字段和没有探测的项目">
      <p>维渡 AI 是 AI 中转站目录。下面三份文件按现在的页面写，不是探测后端的说明书。</p>
      <p><a href="/llms.txt">llms.txt</a> 是给模型看的站点简介和主要路径。</p>
      <p><a href="/stations.md">stations.md</a> 写每个中转站页面有哪些字段，哪些格子是空的。</p>
      <p><a href="/methodology.md">methodology.md</a> 写价格、在线率、投票和评分的实际来源。</p>
      <p>登录、投票、点评、收藏、积分和提交收录记在账户接口里。检测记录和 Key 只留在浏览器。本站没有纯度分，也不证明官方原厂。</p>
    </Article>
  );
}

function ScoreRing({ score, color }) {
  const radius = 54;
  const length = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(100, Number(score) || 0)) / 100;
  return (
    <div className="score-ring">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={radius} fill="none" stroke="#d9f99d" strokeWidth="8" />
        <circle cx="66" cy="66" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${length * ratio} ${length}`} transform="rotate(-90 66 66)" />
      </svg>
      <div className="score-ring-num">
        <b>{Number(score).toFixed(0)}</b>
        <span>/ 100</span>
      </div>
    </div>
  );
}

function ProbeMark({ label }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (label === "函数调用") return <svg {...common}><path d="M8 8l-4 4 4 4" /><path d="M16 8l4 4-4 4" /></svg>;
  if (label === "结构化输出") return <svg {...common}><path d="M8 4H5v16h3" /><path d="M16 4h3v16h-3" /></svg>;
  if (label === "流式一致性") return <svg {...common}><path d="M5 12l4 4 10-10" /></svg>;
  if (label === "Token 用量") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 010 3h-3" /></svg>;
  if (label === "协议规范性") return <svg {...common}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></svg>;
  if (label === "模型响应形状") return <svg {...common}><path d="M20 12a8 8 0 11-2.3-5.6" /><path d="M20 5v5h-5" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2 2" /></svg>;
}

function ShareGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="M20 15l-4.5-4.5L8 18" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 14a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" />
      <path d="M14 10a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" />
    </svg>
  );
}

export function ReportPage() {
  const { id } = useParams();
  const stored = findReport(id);
  const fallback = stations.flatMap((station) => (station.tests || []).map((test) => ({
    ...test,
    slug: station.slug,
    station: station.name,
    url: station.baseUrl || station.site,
  }))).find((test) => test.id === id);
  const report = stored || (fallback ? { ...fallback, results: [] } : null);
  const [tab, setTab] = useState("report");
  const [copied, setCopied] = useState(false);
  const [poster, setPoster] = useState(false);
  useTitle(report ? `${report.station} ${report.model} 检测报告 ${shanghaiClock(report.at)}｜分数不能当成官方原厂鉴定` : "检测报告未找到｜这份快照不在本地目录");
  if (!report) {
    return (
      <div className="wrap form-page">
        <h1>报告未找到</h1>
        <p>这份检测报告不在本地快照里。</p>
        <Link to="/list" className="more">返回榜单</Link>
      </div>
    );
  }
  const tier = tierOf(Number(report.score) || 0);
  const ring = tier.tone === "ok" ? "#65A30D" : tier.tone === "mid" ? "#d97706" : "#e23d3d";
  const station = findStation(report.slug);
  const when = shanghaiClock(report.at);
  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
  };
  return (
    <div className="wrap report-page">
      <div className="report-top">
        <div className="crumb">
          <Link to="/list">站点</Link>
          <span> › </span>
          {report.slug ? <Link to={stationPath(findStation(report.slug) || { slug: report.slug })}>{report.station}</Link> : <span>{report.station}</span>}
          <span> › 检测报告</span>
        </div>
        <div className="report-actions">
          <button type="button" className="ghost-btn" onClick={() => setPoster(true)}><ShareGlyph />分享海报</button>
          <button type="button" className="ghost-btn" onClick={copyLink}><LinkGlyph />{copied ? "已复制" : "分享链接"}</button>
        </div>
      </div>
      <div className="report-hero-card">
        <ScoreRing score={report.score} color={ring} />
        <div>
          <div className="tier-line" style={{ color: ring }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /></svg>
            {tier.label}
          </div>
          <div className="report-who">
            <Logo station={{ img: station?.img || "", name: report.station }} className="logo-img report-logo" />
            <div>
              <b>{report.station}</b>
              {report.url ? <a href={report.url} target="_blank" rel="noreferrer">{report.url}</a> : null}
            </div>
          </div>
        </div>
        <div className="report-meta-side">
          <div><span>检测时间</span><b>{when}</b></div>
          <div><span>检测模型</span><b>{report.model}</b></div>
          <div><span>API Key</span><b>—</b></div>
        </div>
      </div>
      <div className="report-kpis">
        <div><span>首字延迟</span><b>{seconds(report.ttftMs)}</b></div>
        <div><span>总耗时</span><b>{seconds(report.totalMs)}</b></div>
        <div><span>输入 tokens</span><b>{report.inputTokens == null ? "—" : report.inputTokens.toLocaleString("en-US")}</b></div>
        <div><span>输出 tokens</span><b>{report.outputTokens == null ? "—" : report.outputTokens.toLocaleString("en-US")}</b></div>
        <div><span>检测请求数</span><b>{report.requests ?? "—"}</b></div>
      </div>
      <div className="tabs report-tabs">
        <button type="button" className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>检测报告</button>
        <button type="button" className={tab === "raw" ? "on" : ""} onClick={() => setTab("raw")}>原始服务器响应</button>
      </div>
      {tab === "raw" ? (
        <p className="raw-note">本地副本没有保存这份检测的原始服务器响应。</p>
      ) : report.results?.length ? (
        <table className="price report-table">
          <thead>
            <tr><th>检测维度</th><th>检测内容</th><th>得分</th></tr>
          </thead>
          <tbody>
            {report.results.map((item) => {
              const passed = item.status === "pass";
              const skipped = item.status === "skip";
              const warned = item.status === "warn";
              return (
                <tr key={item.name}>
                  <td>
                    <span className="dim" title={PROBE_COPY[item.label] || "这项探针核对中转站是否按公开协议返回。"}>
                      <ProbeMark label={item.label} />
                      <span className="dim-link">{item.label}</span>
                    </span>
                  </td>
                  <td className={passed ? "probe-pass" : skipped || warned ? "" : "probe-fail"}>{skipped ? "未测" : warned ? "留意" : passed ? "通过" : "未通过"}</td>
                  <td><span className={passed ? "score-pill" : "score-pill fail"}>{item.score}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="mini">这份记录保存在本站，目前只有总分、时间和模型，没有逐项探针，也没有原始响应。</p>}
      <div className="report-archive">
        <div>
          <b>该站已被维渡 AI 收录</b>
          <span> —— 站点在线率、公开价格和评价以详情页为准</span>
        </div>
        {report.slug ? <Link to={stationPath(findStation(report.slug) || { slug: report.slug })}>查看完整档案 →</Link> : null}
      </div>
      <p className="report-note">{report.slug ? "这是记在本站的一条基础测试记录。" : "这次检测用的是你填写的地址和 Key，结果只留在这台浏览器。"}它不是纯度鉴定，也不代表对任何中转站的推荐。请以你自己的使用为准。</p>
      {poster ? (
        <div className="th-overlay" onClick={() => setPoster(false)}>
          <div className="poster-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="poster" id="poster">
              <div className="poster-hd">
                <div>
                  <div className="poster-mark">Veri<span>Drop</span></div>
                  <div className="mini">模型检测</div>
                </div>
                <button type="button" className="poster-x" onClick={() => setPoster(false)} aria-label="关闭">×</button>
              </div>
              <ScoreRing score={report.score} color={ring} />
              <div className="tier-line" style={{ color: ring }}>{tier.label}</div>
              <h2>{report.station}</h2>
              {report.url ? <div className="mini">{report.url}</div> : null}
              <div className="poster-kpis">
                <div><span>首字延迟</span><b>{seconds(report.ttftMs)}</b></div>
                <div><span>总耗时</span><b>{seconds(report.totalMs)}</b></div>
                <div><span>输入 tokens</span><b>{report.inputTokens == null ? "—" : report.inputTokens.toLocaleString("en-US")}</b></div>
                <div><span>输出 tokens</span><b>{report.outputTokens == null ? "—" : report.outputTokens.toLocaleString("en-US")}</b></div>
              </div>
              {report.results?.length ? (
                <div className="poster-probes">
                  {report.results.map((item) => (
                    <div key={item.name}><span>{item.label}</span><b>{item.score}</b></div>
                  ))}
                </div>
              ) : null}
              <div className="mini">检测模型 {report.model}</div>
              <div className="mini">检测时间 {when}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
