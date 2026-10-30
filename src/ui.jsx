import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { activities, findStation, logoUrl, models, perks, reviews, stationHeading, stationTotal, stations } from "./data.js";
import { clearSession, readAccounts, readAvatar, readSession, writeAvatar, writeSession } from "./account.js";
import { authToken, loginAccount, pullAccount, registerAccount, requestCode, resetAccount, sendPoints, setAuthToken } from "./community.js";
import { replacePoints, saveNick } from "./points.js";

const VENDOR_COLOR = {
  nvidia: "#76b900",
  agnes: "#5b5bd6",
  cat: "#f59e0b",
};

export const VENDOR_ICON = {
  claude: ["/icons/vendor/claude.svg", "Claude"],
  openai: ["/icons/vendor/openai.svg", "GPT / Codex", true],
  gemini: ["/icons/vendor/gemini.svg", "Gemini"],
  grok: ["/icons/vendor/grok.svg", "Grok", true],
  zhipu: ["/icons/vendor/zhipu.svg", "GLM"],
  deepseek: ["/icons/vendor/deepseek.svg", "DeepSeek"],
  kimi: ["/icons/vendor/moonshot.svg", "Kimi", true],
  moonshot: ["/icons/vendor/moonshot.svg", "Kimi", true],
  qwen: ["/icons/vendor/qwen.svg", "千问"],
  minimax: ["/icons/vendor/minimax.svg", "MiniMax"],
  doubao: ["/icons/vendor/doubao.svg", "豆包"],
  meta: ["/icons/vendor/meta.svg", "Meta"],
  hunyuan: ["/icons/vendor/hunyuan.svg", "混元"],
  mimo: ["/icons/vendor/xiaomi-mimo.svg", "MiMo", true],
  typesafe: ["/icons/vendor/typesafe.png", "TypeSafe"],
};

export const FAMILY_VENDOR = {
  ChatGPT: "openai",
  Claude: "claude",
  Gemini: "gemini",
  Grok: "grok",
  GLM: "zhipu",
  DeepSeek: "deepseek",
  Kimi: "kimi",
  千问: "qwen",
  MiniMax: "minimax",
  MiMo: "mimo",
  混元: "hunyuan",
  TypeSafe: "typesafe",
  Meta: "meta",
  豆包: "doubao",
};

export function vendorOfModel(id) {
  const text = String(id || "").toLowerCase();
  if (/gpt|codex|openai|chatgpt/.test(text)) return "openai";
  if (/claude|fable|opus|sonnet/.test(text)) return "claude";
  if (text.includes("gemini")) return "gemini";
  if (text.includes("grok")) return "grok";
  if (text.includes("deepseek")) return "deepseek";
  if (/glm|zhipu|chatglm/.test(text)) return "zhipu";
  if (/kimi|moonshot/.test(text)) return "kimi";
  if (/qwen|千问/.test(text)) return "qwen";
  if (text.includes("minimax")) return "minimax";
  if (/mimo|xiaomi/.test(text)) return "mimo";
  if (/hunyuan|混元/.test(text)) return "hunyuan";
  if (/meta|llama/.test(text)) return "meta";
  if (/doubao|豆包/.test(text)) return "doubao";
  if (text.includes("typesafe")) return "typesafe";
  return "";
}

export function VendorIcon({ name, size = 16 }) {
  const icon = VENDOR_ICON[name];
  if (!icon) return null;
  return <img className={icon[2] ? "vmark mono" : "vmark"} src={icon[0]} alt="" title={icon[1]} width={size} height={size} />;
}

export function Vendor({ name }) {
  if (VENDOR_ICON[name]) return <VendorIcon name={name} />;
  const color = VENDOR_COLOR[name] || "#888";
  return (
    <svg className="vmark" width="16" height="16" viewBox="0 0 16 16" aria-label={name}>
      <circle cx="8" cy="8" r="7" fill={color} />
      <text x="8" y="11" textAnchor="middle" fontSize="8" fill="#fff" fontFamily="sans-serif">
        {name.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  );
}

const ASK_PROMPT = "维渡 AI（https://www.veridrop.cn）是什么？它能告诉我哪些 AI 中转站的在线率、延迟、价格和支付方式？请说明榜单怎么排，以及现在排在前面的是哪些站。请先阅读 https://www.veridrop.cn/llms.txt 、https://www.veridrop.cn/stations.md 和 https://www.veridrop.cn/methodology.md ，再顺着里面的链接打开具体页面。引用时带上页面里的数据时间。能核对的去原站核对。没有记录的项不要当成已经测到，尤其不要编造纯度、单个模型的延迟和单个模型的在线率。";
const ASK_AI = [
  ["openai", "ChatGPT", `https://chatgpt.com/?q=${encodeURIComponent(ASK_PROMPT)}`],
  ["claude", "Claude", `https://claude.ai/new?q=${encodeURIComponent(ASK_PROMPT)}`],
  ["gemini", "Gemini", `https://www.google.com/search?udm=50&q=${encodeURIComponent(ASK_PROMPT)}`],
  ["perplexity", "Perplexity", `https://www.perplexity.ai/search?q=${encodeURIComponent(ASK_PROMPT)}`],
  ["grok", "Grok", `https://grok.com/?q=${encodeURIComponent(ASK_PROMPT)}`],
].map(([name, label, href]) => ({ name, label: `用 ${label} 了解维渡 AI`, href }));

const PAY_ICON = {
  alipay: ["/icons/payment/alipay.svg", "支付宝"],
  wechat: ["/icons/payment/wechatpay.svg", "微信"],
  usdt: ["/icons/payment/usdt.svg", "USDT"],
  paypal: ["/icons/payment/paypal.svg", "PayPal"],
  bank: ["/icons/payment/bankcard.svg", "银行卡"],
  corp: ["/icons/payment/corporate.svg", "对公转账"],
};

export function Pays({ list }) {
  if (!list.length) return "—";
  return (
    <span className="slb-pay">
      {list.map((item) => {
        const icon = PAY_ICON[item];
        if (!icon) return <span key={item} className="slb-paytx">{item === "taobao" ? "淘宝" : item}</span>;
        return <img key={item} className="slb-payic" src={icon[0]} alt={icon[1]} title={icon[1]} />;
      })}
    </span>
  );
}

export function Mark({ value }) {
  const bad = value === "✗" || value === "—";
  const good = value === "✓";
  return <span className={good ? "mark ok" : bad ? "mark no" : ""}>{value}</span>;
}

const STATION_LOGO = "/img/station-default.png";

export function Logo({ station, className = "logo-img" }) {
  const [src, setSrc] = useState(() => logoUrl(station?.img) || STATION_LOGO);
  useEffect(() => { setSrc(logoUrl(station?.img) || STATION_LOGO); }, [station?.img]);
  return <img className={className} src={src} alt="" onError={() => { if (src !== STATION_LOGO) setSrc(STATION_LOGO); }} />;
}

export function Stars({ count = 5 }) {
  return <span className="st">{"★".repeat(count)}</span>;
}

export function useTitle(title, options) {
  const exact = options?.exact === true;
  useEffect(() => {
    if (exact && title) document.title = title;
    else document.title = title ? `维渡 AI - ${title}` : `维渡 AI - AI 中转站排行与推荐｜收录 ${stationTotal} 家中转站实测与价格对比`;
  }, [title, exact]);
}

function purityOf(station) {
  const raw = station.radar ? station.radar["纯度"] : null;
  const value = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(value) || value <= 0) return "未测";
  return Math.round(value);
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

const NAV = [
  { to: "/", label: "首页", end: true },
  { to: "/list", label: "站点" },
  {
    label: "模型",
    to: "/model",
    children: [
      ...models.map((item) => ({
        to: `/model/${item.slug}`,
        label: item.name,
        icon: VENDOR_ICON[item.vendor]?.[0],
        mono: Boolean(VENDOR_ICON[item.vendor]?.[2]),
      })),
      { to: "/model", label: "更多", more: true },
    ],
  },
  { to: "/reputation", label: "投票" },
  {
    label: "模型检测",
    to: "/check",
    children: [
      { to: "/check", label: "检测首页" },
      { to: "/check/detect", label: "检测结果" },
      { to: "/check/basic", label: "基础测试" },
      { to: "/check/candy", label: "糖果测试" },
      { to: "/check/pelican", label: "鹈鹕骑车" },
    ],
  },
  { to: "/activity", label: "福利羊毛" },
  { to: "/points", label: "赚积分", badge: "兑额度" },
];

export function Shell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState("");
  const hideMenu = useRef(0);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [login, setLogin] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState(0);
  const [cookie, setCookie] = useState(() => localStorage.getItem("okk-cookie") !== "1");
  const [theme, setTheme] = useState(() => localStorage.getItem("okk-theme") || "light");
  const [user, setUser] = useState(() => readSession().name);
  const [email, setEmail] = useState(() => readSession().email);
  const [avatar, setAvatar] = useState(() => readAvatar());
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 981px)").matches : true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("okk-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(min-width: 981px)");
    const sync = () => setWide(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const syncPoints = (event) => {
      const id = event.detail?.id;
      if (!authToken() || !id || id === "checkin") return;
      sendPoints(id).then((points) => replacePoints(points)).catch(() => {});
    };
    window.addEventListener("okk-points-sync", syncPoints);
    if (authToken()) pullAccount().catch(() => {});
    return () => window.removeEventListener("okk-points-sync", syncPoints);
  }, []);

  useEffect(() => {
    const openAuth = () => setLogin(true);
    const syncAuth = () => {
      const session = readSession();
      setUser(session.name);
      setEmail(session.email);
      setAvatar(readAvatar());
    };
    window.addEventListener("okk-open-auth", openAuth);
    window.addEventListener("okk-auth", syncAuth);
    return () => {
      window.removeEventListener("okk-open-auth", openAuth);
      window.removeEventListener("okk-auth", syncAuth);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("invite");
    if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) localStorage.setItem("veridrop-invite-pending", code.trim().toUpperCase());
    const reset = params.get("reset");
    if (reset) setLogin(true);
  }, [location.search]);

  useEffect(() => {
    setOpen("");
    setMobile(false);
    setSearch(false);
    setAccountOpen(false);
    const id = location.hash.replace("#", "");
    const node = id ? document.getElementById(id) : null;
    if (node) node.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  useEffect(() => () => window.clearTimeout(hideMenu.current), []);

  function showDrop(label) {
    window.clearTimeout(hideMenu.current);
    setOpen(label);
  }

  function scheduleHide() {
    window.clearTimeout(hideMenu.current);
    hideMenu.current = window.setTimeout(() => setOpen(""), 320);
  }

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const modelHits = (q ? models.filter((item) => `${item.name} ${item.slug}`.toLowerCase().includes(q)) : models).slice(0, 6);
    const stationHits = (q ? stations.filter((item) => `${item.name} ${item.slug} ${item.host || ""}`.toLowerCase().includes(q)) : stations).slice(0, 8);
    return [
      ...modelHits.map((item) => ({ kind: "model", key: `m:${item.slug}`, item, to: `/model/${item.slug}` })),
      ...stationHits.map((item) => ({ kind: "station", key: `s:${item.slug}`, item, to: item.path || `/site/${item.slug}` })),
    ];
  }, [query]);

  useEffect(() => setPick(0), [query, search]);

  useEffect(() => {
    if (!search) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setSearch(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  useEffect(() => {
    if (!search) return;
    document.querySelector(".cmd-hit.on")?.scrollIntoView({ block: "nearest" });
  }, [search, pick]);

  function movePick(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPick((index) => (hits.length ? Math.min(hits.length - 1, index + 1) : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPick((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && hits[pick]) {
      event.preventDefault();
      navigate(hits[pick].to);
      setSearch(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <Link to="/" className="logo" aria-label="VeriDrop">
            Veri<i>Drop</i>
          </Link>
          <nav className="nav">
            {NAV.map((item) =>
              item.children ? (
                <div
                  key={item.label}
                  className={`drop ${open === item.label ? "open" : ""}`}
                  onMouseEnter={() => showDrop(item.label)}
                  onMouseLeave={scheduleHide}
                >
                  <button className="trigger" onClick={() => navigate(item.to)}>
                    {item.label}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <div className="menu">
                    <div className="menu-in">
                      {item.children.map((child) => (
                        <Link key={child.label} to={child.to} className={child.more ? "more" : ""}>
                          {child.icon ? <img className={child.mono ? "vmark mono" : "vmark"} src={child.icon} alt="" /> : null}
                          <span>{child.label}</span>
                          <svg className="menu-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M7 17 17 7" />
                            <path d="M8 7h9v9" />
                          </svg>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
                  {item.label}
                  {item.badge ? <em className="nav-badge">{item.badge}</em> : null}
                </NavLink>
              ),
            )}
          </nav>
          <div className="actions">
            <a className="tool-go" href="https://www.modeltool.cn" target="_blank" rel="noreferrer">
              <svg className="pulse" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" />
              </svg>
              <span>降智检测</span>
              <svg className="out" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
            </a>
            <button className="search-btn" onClick={() => setSearch(true)}>
              <IconSearch /> 搜索站点 / 模型
            </button>
            <button className="icon-btn" aria-label="主题" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
              {theme === "light" ? "☀" : "☾"}
            </button>
            {user ? (
              <AccountMenu
                open={accountOpen}
                setOpen={setAccountOpen}
                boxRef={accountRef}
                name={user}
                email={email}
                avatar={avatar}
                onLogout={() => {
                  clearSession();
                  setAuthToken("");
                  setUser("");
                  setEmail("");
                  setAvatar("");
                  setAccountOpen(false);
                  window.dispatchEvent(new Event("okk-auth"));
                }}
              />
            ) : (
              <button className="login" onClick={() => setLogin(true)}>
                登录
              </button>
            )}
            <button className="burger" aria-label="菜单" onClick={() => setMobile((v) => !v)}>
              ☰
            </button>
          </div>
        </div>
        <div className={`mobile-nav ${mobile ? "open" : ""}`}>
          {NAV.flatMap((item) => [{ to: item.to, label: item.label }, ...(item.children || [])]).map((item) => (
            <Link key={item.label + item.to} to={item.to}>
              {item.label}
            </Link>
          ))}
          <a href="https://www.modeltool.cn" target="_blank" rel="noreferrer">降智检测</a>
        </div>
      </header>
      <main>{children}</main>
      <div className="side-dock">
        <button
          type="button"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m6 11 6-6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="主题"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? "☾" : "☀"}
        </button>
      </div>
      <div className="wrap">
        <SponsorStrip items={homeSponsors} />
      </div>
      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div>
              <Link to="/" className="logo">
                Veri<i>Drop</i>
              </Link>
              <div className="foot-socials">
                <a href="https://github.com/fusuzhenxin" target="_blank" rel="noreferrer" aria-label="GitHub">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .26.18.58.69.48A10 10 0 0 0 12 2Z" /></svg>
                </a>
                <a href="https://t.me/alexnsss" target="_blank" rel="noreferrer" aria-label="Telegram">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.5 4.4 2.7 11.7c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.9 5.7c.2.7.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.2-.5-1.7-1.4-1.3Zm-3.2 3.1-8.7 7.9-.3 3.5-1.6-4.9 10.6-6.5Z" /></svg>
                </a>
                <a href="/feed.xml" aria-label="站点动态 RSS">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.2 17.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM3.4 10.2v3.2a7.2 7.2 0 0 1 7.2 7.2h3.2a10.4 10.4 0 0 0-10.4-10.4Zm0-6.2v3.2A13.4 13.4 0 0 1 16.8 20.6H20A16.6 16.6 0 0 0 3.4 4Z" /></svg>
                </a>
              </div>
              <p className="copy">2026 维渡 AI · www.veridrop.cn</p>
            </div>
            <div className="footer-folds">
              <FootFold title="导航" startOpen={wide}>
                <Link to="/">首页</Link>
                <Link to="/list">站点排行</Link>
                <Link to="/cat/charity">公益站</Link>
                <Link to="/cat/cheap">便宜个人向</Link>
                <Link to="/cat/pay">国内支付</Link>
                <Link to="/cat/checkin">签到送余额</Link>
                <Link to="/model/gpt">GPT 中转</Link>
                <Link to="/model/claude">Claude 中转</Link>
                <Link to="/model/deepseek">DeepSeek 中转</Link>
                <Link to="/check">模型检测</Link>
                <Link to="/apply">申请收录</Link>
                <Link to="/reputation">投票</Link>
                <Link to="/tools/iq">模型智商</Link>
                <Link to="/tools/codex-resets">Codex 额度重置</Link>
                <Link to="/tools/api-speed">AI API 测试工具</Link>
                <Link to="/activity">福利羊毛</Link>
              </FootFold>
              <FootFold title="热门模型" startOpen={wide}>
                <Link to="/check/pelican">鹈鹕骑车</Link>
                <Link to="/check/candy">糖果测试</Link>
                <Link to="/check/basic">基础测试</Link>
                <Link to="/check">降智检测</Link>
                <Link to="/history">检测历史</Link>
                {models.map((item) => (
                  <Link key={item.slug} to={`/model/${item.slug}`}>{item.name}</Link>
                ))}
              </FootFold>
              <FootFold title="参与" startOpen={wide}>
                <Link to="/history">检测历史</Link>
                <Link to="/points">赚积分</Link>
                <Link to="/help">评测方法</Link>
                <Link to="/help#scoring">评分说明</Link>
              </FootFold>
              <FootFold title="联系我们" startOpen={wide}>
                <Link to="/about">联系我们</Link>
                <Link to="/about">商务合作</Link>
              </FootFold>
              <FootFold title="法律" startOpen={wide}>
                <Link to="/privacy">隐私政策</Link>
                <Link to="/terms">服务条款</Link>
                <Link to="/disclaimer">免责声明</Link>
              </FootFold>
            </div>
          </div>
          <div className="foot-docs">
            <span>Agents</span>
            <a href="/llms.txt">llms.txt</a>
            <a href="/stations.md">stations.md</a>
            <a href="/methodology.md">methodology.md</a>
          </div>
          <div className="foot-models">
            {ASK_AI.map((item) => (
              <a key={item.name} href={item.href} target="_blank" rel="noreferrer" aria-label={item.label} title={item.label}>
                {item.name === "perplexity" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3v18M5 8h14M5 16h14M8 3l8 18M16 3 8 21" stroke="#20808d" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                ) : (
                  <VendorIcon name={item.name} size={18} />
                )}
              </a>
            ))}
          </div>
        </div>
      </footer>
      {cookie ? (
        <div className="cookie">
          <span className="badge" style={{ background: "transparent", color: "var(--orange)", border: "1px solid var(--orange)", width: 28, height: 28 }}>
            !
          </span>
          <p>
            我们仅使用保障登录、语言偏好等必要 cookie，以及匿名的访问量统计，不用于广告追踪。继续浏览即视为同意，详见
            <Link to="/privacy">隐私政策</Link>。
          </p>
          <button
            className="know"
            onClick={() => {
              localStorage.setItem("okk-cookie", "1");
              setCookie(false);
            }}
          >
            知道了
          </button>
        </div>
      ) : null}
      {search ? (
        <div className="mask cmd-mask" onClick={() => setSearch(false)}>
          <div className="cmd" role="dialog" aria-label="搜索" onClick={(event) => event.stopPropagation()}>
            <div className="cmd-bar">
              <IconSearch />
              <input autoFocus placeholder="输入站点或模型名称..." value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={movePick} />
              <kbd>esc</kbd>
            </div>
            <div className="cmd-list">
              {hits.some((row) => row.kind === "model") ? <h4>模型</h4> : null}
              {hits.map((row, index) => row.kind === "model" ? (
                <Link key={row.key} to={row.to} className={index === pick ? "cmd-hit on" : "cmd-hit"} onMouseEnter={() => setPick(index)} onClick={() => setSearch(false)}>
                  <span className="cmd-ico"><VendorIcon name={row.item.vendor} size={20} /></span>
                  <span className="cmd-main"><b>{row.item.name}</b><small>{row.item.slug}</small></span>
                  <span className="cmd-meta"><span>智商 <b>{row.item.score}</b></span></span>
                </Link>
              ) : null)}
              {hits.some((row) => row.kind === "station") ? <h4>站点</h4> : null}
              {hits.map((row, index) => row.kind === "station" ? (
                <Link key={row.key} to={row.to} className={index === pick ? "cmd-hit on" : "cmd-hit"} onMouseEnter={() => setPick(index)} onClick={() => setSearch(false)}>
                  <span className="cmd-ico"><Logo station={row.item} className="cmd-logo" /></span>
                  <span className="cmd-main"><b>{stationHeading(row.item)}</b>{row.item.host && stationHeading(row.item) !== row.item.host ? <small>{row.item.host}</small> : null}</span>
                  <span className="cmd-meta"><span>模型 <b>{row.item.cover ?? row.item.modelsHome ?? "—"}</b></span><span>纯度 <b>{purityOf(row.item)}</b></span></span>
                </Link>
              ) : null)}
              {hits.length === 0 ? <div className="empty">没有匹配结果</div> : null}
            </div>
            <div className="cmd-foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
              <span><kbd>↵</kbd> 打开</span>
              <span><kbd>esc</kbd> 关闭</span>
            </div>
          </div>
        </div>
      ) : null}
      {login ? (
        <Login
          onClose={() => setLogin(false)}
          onOk={(name, mail) => {
            writeSession(name, mail);
            const found = mail ? readAccounts().find((item) => item.email === mail) : null;
            writeAvatar(found?.avatar || "");
            setUser(name);
            setEmail(mail || "");
            setAvatar(found?.avatar || "");
            setLogin(false);
            window.dispatchEvent(new Event("okk-auth"));
          }}
        />
      ) : null}
    </>
  );
}

function initial(name) {
  const text = String(name || "").trim();
  if (!text) return "?";
  const ch = [...text][0];
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

function MenuIcon({ name }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (name === "gear") return <svg {...common}><path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7V20a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19.2c1.2-2.6 3.4-3.9 6.5-3.9s5.3 1.3 6.5 3.9" /></svg>;
  if (name === "gift") return <svg {...common}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v12" /><path d="M5 12v7h14v-7" /><path d="M12 8c-2.5 0-4-1.4-4-3.1S10.2 3 12 5.2C13.8 3 16 3.6 16 4.9S14.5 8 12 8z" /></svg>;
  if (name === "star") return <svg {...common}><path d="m12 3.6 2.2 4.6 5 .7-3.6 3.5.9 5.1L12 15.2 7.5 17.5l.9-5.1L4.8 8.9l5-.7z" /></svg>;
  if (name === "plus") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8.5v7M8.5 12h7" /></svg>;
  if (name === "mail") return <svg {...common}><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
  return <svg {...common}><path d="M9 7V5H5v14h4v-2" /><path d="M10 12h9" /><path d="m16 9 3 3-3 3" /></svg>;
}

const ACCOUNT_LINKS = [
  { to: "/account", label: "账户设置", icon: "gear" },
  { to: "/points", label: "我的积分", icon: "user" },
  { to: "/points#invite", label: "邀请好友", icon: "gift", badge: "送积分" },
  { to: "/cat/fav", label: "我的收藏", icon: "star" },
  { to: "/apply", label: "申请收录", icon: "plus" },
  { to: "/submissions", label: "我的提交", icon: "mail" },
];

function AccountMenu({ open, setOpen, boxRef, name, email, avatar, onLogout }) {
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, boxRef]);

  return (
    <div className={`acct${open ? " open" : ""}`} ref={boxRef}>
      <button
        type="button"
        className="acct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="acct-av" aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : initial(name)}</span>
        <span className="acct-name">{name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="acct-pop" role="menu">
          <div className="acct-who">
            <span className="acct-av lg" aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : initial(name)}</span>
            <div>
              <b>{name}</b>
              {email ? <small>{email}</small> : null}
            </div>
          </div>
          {ACCOUNT_LINKS.map((item) => (
            <Link key={item.label} to={item.to} role="menuitem" onClick={() => setOpen(false)}>
              <MenuIcon name={item.icon} />
              <span>{item.label}</span>
              {item.badge ? <em>{item.badge}</em> : null}
            </Link>
          ))}
          <button type="button" className="acct-out" role="menuitem" onClick={onLogout}>
            <MenuIcon name="out" />
            <span>退出登录</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="g" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function EyeIcon({ off }) {
  if (off) {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
        <path d="M9.9 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.2" />
        <path d="M6.1 6.1C3.8 7.6 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.1-.8" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Login({ onClose, onOk }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [nick, setNick] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (!wait) return undefined;
    const timer = window.setTimeout(() => setWait((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const title = mode === "register" ? "创建账户" : mode === "login" ? "欢迎回来" : "找回密码";
  const subtitle =
    mode === "register"
      ? "先收取邮箱验证码，再注册。注册后可打分、评论、投票"
      : mode === "login"
        ? "登录后可打分、评论、投票，其他人也能看到"
        : "验证码会发到注册邮箱，10 分钟内有效。";

  function finish(name, nextNick, mail) {
    if (nextNick) saveNick(nextNick);
    onOk(name, mail);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setNotice("");
    const mail = email.trim().toLowerCase();
    if (!mail.includes("@")) {
      setError("请输入有效邮箱");
      return;
    }
    if ((mode === "register" || mode === "forgot") && password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if ((mode === "register" || mode === "forgot") && !/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位验证码");
      return;
    }
    setSaving(true);
    try {
      if (mode === "forgot") {
        await resetAccount({ email: mail, password, code: code.trim() });
        setPassword("");
        setCode("");
        setNotice("密码已更新，请登录");
        setMode("login");
        return;
      }
      if (mode === "register") {
        const invite = localStorage.getItem("veridrop-invite-pending") || "";
        const data = await registerAccount({ email: mail, password, nick: nick.trim(), invite, code: code.trim() });
        localStorage.removeItem("veridrop-invite-pending");
        setAuthToken(data.token);
        finish(data.name, data.nick, data.email);
        pullAccount().catch(() => {});
        return;
      }
      const data = await loginAccount({ email: mail, password });
      setAuthToken(data.token);
      finish(data.name, data.nick, data.email);
      pullAccount().catch(() => {});
    } catch (err) {
      setError(err.message || "没有记下");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-ov" onClick={onClose}>
      <div className="auth-card" onClick={(event) => event.stopPropagation()}>
        <div className="auth-top">
          <button className="auth-close" type="button" aria-label="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="auth-logo">
            Veri<span className="x">Drop</span>
          </div>
          <div className="auth-head">
            <div className="t">{title}</div>
            <div className="s">{subtitle}</div>
          </div>
        </div>
        <div className="auth-body">
          {mode === "login" || mode === "register" ? (
            <div className="auth-tabs">
              <button type="button" className={`auth-tab${mode === "login" ? " on" : ""}`} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>
                登录
              </button>
              <button type="button" className={`auth-tab${mode === "register" ? " on" : ""}`} onClick={() => { setMode("register"); setError(""); setNotice(""); }}>
                注册
              </button>
            </div>
          ) : null}
          <form onSubmit={submit}>
            <div className="auth-panel">
              {mode === "register" ? (
                <label className="auth-fld">
                  <span className="lb">
                    昵称<span className="opt">(可选)</span>
                  </span>
                  <div className="auth-inp">
                    <input placeholder="请输入昵称" value={nick} onChange={(event) => setNick(event.target.value)} />
                  </div>
                </label>
              ) : null}
              <label className="auth-fld">
                <span className="lb">邮箱</span>
                <div className="auth-inp">
                  <input
                    placeholder="you@example.com"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </label>
              {mode === "register" || mode === "forgot" ? (
                <label className="auth-fld">
                  <span className="lb">验证码</span>
                  <div className="auth-inp code">
                    <input placeholder="6 位验证码" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                    <button
                      type="button"
                      className="auth-code"
                      disabled={wait > 0}
                      onClick={async () => {
                        const mail = email.trim().toLowerCase();
                        if (!mail.includes("@")) {
                          setError("请输入有效邮箱");
                          return;
                        }
                        setError("");
                        setNotice("");
                        try {
                          await requestCode({ email: mail, purpose: mode === "register" ? "register" : "reset" });
                          setNotice("验证码已发到邮箱，10 分钟内有效");
                          setWait(60);
                        } catch (err) {
                          setError(err.message || "没有发出去");
                        }
                      }}
                    >
                      {wait > 0 ? `${wait} 秒` : "获取验证码"}
                    </button>
                  </div>
                </label>
              ) : null}
              {mode !== "none" ? (
                <label className="auth-fld">
                  <span className="lb">
                    密码
                    {mode === "login" ? (
                      <button
                        type="button"
                        className="auth-link"
                        onClick={() => {
                          setMode("forgot");
                          setError("");
                          setNotice("");
                          setPassword("");
                        }}
                      >
                        忘记密码?
                      </button>
                    ) : null}
                  </span>
                  <div className="auth-inp pw">
                    <input
                      placeholder={mode === "register" || mode === "reset" ? "设置密码(至少 6 位)" : "请输入密码"}
                      required
                      minLength={6}
                      type={show ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button type="button" className="auth-eye" aria-label={show ? "隐藏密码" : "显示密码"} onClick={() => setShow((value) => !value)}>
                      <EyeIcon off={show} />
                    </button>
                  </div>
                </label>
              ) : null}
              {error ? <div className="auth-err">{error}</div> : null}
              {notice ? <div className="auth-ok">{notice}</div> : null}
              <button type="submit" className="auth-submit" disabled={saving}>
                {saving ? "正在提交" : mode === "register" ? "注册" : mode === "forgot" ? "保存新密码" : "登录"}
              </button>
              {mode === "forgot" || mode === "reset" ? (
                <div style={{ textAlign: "center", marginTop: 2 }}>
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => {
                      setMode("login");
                      setError("");
                      setNotice("");
                    }}
                  >
                    返回登录
                  </button>
                </div>
              ) : null}
            </div>
          </form>
          {mode === "login" || mode === "register" ? (
            <>
              <div className="auth-or">
                <span />
                <span className="txt">或</span>
                <span />
              </div>
              <button
                type="button"
                className="auth-google"
                onClick={() => {
                  setNotice("");
                  setError("Google 登录未接入，请使用邮箱。");
                }}
              >
                <GoogleMark />
                {mode === "register" ? "使用 Google 注册" : "使用 Google 登录"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FootFold({ title, startOpen, children }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => { setOpen(startOpen); }, [startOpen]);
  return (
    <details className="foot-fold" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{title}</span>
        <i aria-hidden="true" />
      </summary>
      <div className="foot-fold-body">{children}</div>
    </details>
  );
}

export function SponsorStrip({ items = [] }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const cards = items.filter(Boolean).slice(0, 4);
  return (
    <section className="sponsor-box">
      <div className="sponsor-hd">
        赞助商 <Link to="/about">成为赞助商</Link>
      </div>
      <button className="sponsor-x" onClick={() => setHidden(true)} aria-label="关闭">
        ×
      </button>
      {cards.length ? (
        <div className={`sponsor-grid${cards.length > 2 ? " four" : ""}`}>
          {cards.map((item) => (
            <a key={item.title} className="sp-card" href={item.href} target="_blank" rel="noreferrer">
              <div className="sp-art" style={item.img ? undefined : { background: item.bg, color: item.color || "#1d1d1f" }}>
                {item.img ? <img src={item.img} alt="" /> : item.art}
              </div>
              <div className="bd">
                <b>
                  {item.title}
                  <span className="sp-flag">赞助</span>
                </b>
                {item.desc}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="sponsor-grid four">
          <Link className="sp-card sp-empty" to="/about">
            <b>广告位招商</b>
            <span>这个位置空着，欢迎合作</span>
          </Link>
        </div>
      )}
    </section>
  );
}

export const homeSponsors = [];

export const listSponsors = [];

export function ReviewCard({ item }) {
  const station = findStation(item.slug);
  return (
    <article className="review">
      <div className="quote">“</div>
      <p>{item.text}</p>
      <div className="pills">
        {item.tags.map((tag) => (
          <span key={tag} className="pill-g">
            👍 {tag}
          </span>
        ))}
      </div>
      <div className="who">
        <span className="avatar">{item.user.slice(0, 1)}</span>
        <div>
          <div className="nm">{item.user}</div>
          <Stars count={item.stars} />
        </div>
        <Link to={station ? station.path : "/reputation"} className="right">
          {station ? <Logo station={station} className="logo-img" /> : <span className="logo-fallback">站</span>}
          <span className="stn">{item.station}</span>
        </Link>
      </div>
    </article>
  );
}

export function emptyUser() {
  return localStorage.getItem("okk-user") || "";
}

export { activities, perks, reviews };
