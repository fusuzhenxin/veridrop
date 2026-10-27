import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { activities, findStation, logoUrl, models, perks, reviews, stations } from "./data.js";
import { saveNick } from "./points.js";

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

export function Logo({ station, className = "logo-img" }) {
  const [failed, setFailed] = useState(false);
  if (failed || !station.img) {
    return <span className={`logo-fallback ${className}`}>{station.name.slice(0, 1)}</span>;
  }
  return <img className={className} src={logoUrl(station.img)} alt="" onError={() => setFailed(true)} />;
}

export function Stars({ count = 5 }) {
  return <span className="st">{"★".repeat(count)}</span>;
}

export function useTitle(title, options) {
  const exact = options?.exact === true;
  useEffect(() => {
    if (exact && title) document.title = title;
    else document.title = title ? `${title} | 维渡 AI` : "维渡 AI — 发现好用的 AI 中转站:纯度、可用性、价格实测";
  }, [title, exact]);
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
  { to: "/activity", label: "活动" },
];

export function Shell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState("");
  const hideMenu = useRef(0);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [login, setLogin] = useState(false);
  const [query, setQuery] = useState("");
  const [cookie, setCookie] = useState(() => localStorage.getItem("okk-cookie") !== "1");
  const [theme, setTheme] = useState(() => localStorage.getItem("okk-theme") || "light");
  const [user, setUser] = useState(() => localStorage.getItem("okk-user") || "");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("okk-theme", theme);
  }, [theme]);

  useEffect(() => {
    const openAuth = () => setLogin(true);
    const syncAuth = () => setUser(localStorage.getItem("okk-user") || "");
    window.addEventListener("okk-open-auth", openAuth);
    window.addEventListener("okk-auth", syncAuth);
    return () => {
      window.removeEventListener("okk-open-auth", openAuth);
      window.removeEventListener("okk-auth", syncAuth);
    };
  }, []);

  useEffect(() => {
    setOpen("");
    setMobile(false);
    setSearch(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
    if (!q) return { stations: stations.slice(0, 6), models: models.slice(0, 4) };
    return {
      stations: stations.filter((item) => `${item.name} ${item.slug} ${item.host || ""}`.toLowerCase().includes(q)).slice(0, 8),
      models: models.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 6),
    };
  }, [query]);

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
                </NavLink>
              ),
            )}
          </nav>
          <div className="actions">
            <Link to="/points" className="pill">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="8" width="18" height="4" rx="1" />
                <path d="M12 8v13" />
                <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
                <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
              </svg>
              <span>赚积分</span>
            </Link>
            <button className="search-btn" onClick={() => setSearch(true)}>
              <IconSearch /> 搜索站点 / 模型
            </button>
            <button className="icon-btn" aria-label="主题" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
              {theme === "light" ? "☀" : "☾"}
            </button>
            {user ? (
              <button
                className="login"
                onClick={() => {
                  localStorage.removeItem("okk-user");
                  setUser("");
                  window.dispatchEvent(new Event("okk-auth"));
                }}
              >
                {user.slice(0, 1).toUpperCase()}
              </button>
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
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div className="wrap footer-grid">
          <div>
            <Link to="/" className="logo">
              Veri<i>Drop</i>
            </Link>
            <p className="copy">2026 维渡 AI · www.veridrop.cn</p>
          </div>
          <div>
            <h4>导航</h4>
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
            <Link to="/activity">活动</Link>
          </div>
          <div>
            <h4>热门模型</h4>
            {models.map((item) => (
              <Link key={item.slug} to={`/model/${item.slug}`}>
                {item.name}
              </Link>
            ))}
          </div>
          <div>
            <h4>参与</h4>
            <Link to="/submit">提交收录</Link>
            <Link to="/history">检测历史</Link>
            <Link to="/points">赚积分</Link>
            <Link to="/about">联系我们</Link>
            <Link to="/help">评测方法</Link>
            <Link to="/help#scoring">评分说明</Link>
            <Link to="/about">商务合作</Link>
          </div>
          <div>
            <h4>法律</h4>
            <Link to="/privacy">隐私政策</Link>
            <Link to="/terms">服务条款</Link>
            <Link to="/disclaimer">免责声明</Link>
            <h4 style={{ marginTop: 16 }}>Agents</h4>
            <Link to="/agents">llms.txt</Link>
            <Link to="/agents">stations.md</Link>
            <Link to="/help">methodology.md</Link>
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
        <div className="mask" onClick={() => setSearch(false)}>
          <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
            <h3>搜索站点 / 模型</h3>
            <div className="field">
              <input autoFocus placeholder="输入名称" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div>
              {hits.stations.map((item) => (
                <Link key={item.slug} to={item.path || `/station/${item.slug}`} className="hit" onClick={() => setSearch(false)}>
                  {item.name}
                  <small>站点 · 在线率 {item.uptime}%</small>
                </Link>
              ))}
              {hits.models.map((item) => (
                <Link key={item.slug} to={`/model/${item.slug}`} className="hit" onClick={() => setSearch(false)}>
                  {item.name}
                  <small>模型 · 智商 {item.score}</small>
                </Link>
              ))}
              {hits.stations.length + hits.models.length === 0 ? <div className="empty">没有匹配结果</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {login ? (
        <Login
          onClose={() => setLogin(false)}
          onOk={(name) => {
            localStorage.setItem("okk-user", name);
            setUser(name);
            setLogin(false);
            window.dispatchEvent(new Event("okk-auth"));
          }}
        />
      ) : null}
    </>
  );
}

const ACCOUNTS = "okk-accounts";

function readAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAccounts(list) {
  localStorage.setItem(ACCOUNTS, JSON.stringify(list));
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
  const [nick, setNick] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const title = mode === "register" ? "创建账户" : mode === "login" ? "欢迎回来" : "找回密码";
  const subtitle =
    mode === "register"
      ? "注册后可打分、评论、避雷,全程免费"
      : mode === "login"
        ? "登录后可打分、评论、避雷,全程免费"
        : "输入注册邮箱,我们给你发送重置链接";

  function finish(name, nextNick) {
    if (nextNick) saveNick(nextNick);
    onOk(name);
  }

  function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const mail = email.trim().toLowerCase();
    if (!mail.includes("@")) {
      setError("请输入有效邮箱");
      return;
    }
    const accounts = readAccounts();
    const found = accounts.find((item) => item.email === mail);
    if (mode === "register") {
      if (password.length < 6) {
        setError("密码至少 6 位");
        return;
      }
      if (found) {
        setError("该邮箱已注册");
        return;
      }
      const nextNick = nick.trim();
      writeAccounts([...accounts, { email: mail, password, nick: nextNick }]);
      finish(nextNick || mail.split("@")[0], nextNick);
      return;
    }
    if (mode === "forgot") {
      if (!found) {
        setError("没有找到这个邮箱");
        return;
      }
      setMode("reset");
      setPassword("");
      setNotice("邮箱已核对。请设置新密码，只写回这台浏览器。");
      return;
    }
    if (mode === "reset") {
      if (password.length < 6) {
        setError("密码至少 6 位");
        return;
      }
      writeAccounts(accounts.map((item) => (item.email === mail ? { ...item, password } : item)));
      setMode("login");
      setPassword("");
      setNotice("密码已更新，请登录");
      return;
    }
    if (!found || found.password !== password) {
      setError("邮箱或密码不正确");
      return;
    }
    finish(found.nick || mail.split("@")[0], found.nick);
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
                    readOnly={mode === "reset"}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </label>
              {mode !== "forgot" ? (
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
              <button type="submit" className="auth-submit">
                {mode === "register" ? "注册" : mode === "forgot" ? "发送重置链接" : mode === "reset" ? "保存新密码" : "登录"}
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

export function SponsorStrip({ items, columns = "two" }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section className="sponsor-box">
      <div className="sponsor-hd">
        赞助商 <Link to="/about">成为赞助商</Link>
      </div>
      <button className="sponsor-x" onClick={() => setHidden(true)} aria-label="关闭">
        ×
      </button>
      <div className={`sponsor-grid ${columns}`}>
        {items.map((item) => (
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
    </section>
  );
}

export const homeSponsors = [
  {
    title: "PackyAPI ：致力于高可用的中转",
    desc: "PackyAPI 提供可靠高效的 API 中转服务，一句话接入主流大模型，统一域名、统一密钥、智能容灾切换。",
    art: "PackyCode · 可用性 97%",
    img: "/media/sponsors/packy.png",
    bg: "linear-gradient(135deg,#e8fff1,#d9ffe8)",
    href: "https://www.packyapi.ai/",
  },
  {
    title: "Aiaimark ：为开发者与企业打造的高性能 AI API平台",
    desc: "极简接入、极致稳定、真实不掺水、计费透明简单、无套路。",
    art: "Aiaimark",
    img: "/media/sponsors/aiaimark.jpg",
    bg: "#fff",
    href: "https://www.aiaimark.com/",
  },
];

export const listSponsors = [
  {
    title: "OmniaKey：专为开发者打造的全模态 AI API 中转平台",
    desc: "我们是 OmniaKey 团队，专为开发者打造的全模态 AI API 中转平台——不只是文本大模型。",
    art: "OmniaKey",
    img: "/media/sponsors/omnia.png",
    bg: "#f6f1ea",
    href: "https://omniakey.com/",
  },
  {
    title: "Logits Token：订阅套餐一站购齐，日享卡 ¥19.9 起",
    desc: "提供 GPT、Claude Code、Gemini 三类订阅套餐，按使用强度分为多个档位。",
    art: "订阅套餐 · 一站畅用",
    img: "/media/sponsors/logits.jpg",
    bg: "linear-gradient(135deg,#efe7ff,#f7f3ff)",
    href: "https://logitstoken.com/",
  },
  {
    title: "Aiaimark ：为开发者与企业打造的高性能 AI API平台",
    desc: "极简接入、极致稳定、真实不掺水、计费透明简单、无套路。",
    art: "Aiaimark",
    img: "/media/sponsors/aiaimark.jpg",
    bg: "#fff",
    href: "https://www.aiaimark.com/",
  },
  {
    title: "NexoToken｜GPT API 会员 ¥99 起",
    desc: "含 $1,000 平台额度，30 天有效、无周限额。",
    art: "GPT API 会员 $1,000",
    img: "/media/sponsors/nexo.jpg",
    bg: "linear-gradient(135deg,#06281f,#0b3d2e)",
    color: "#fff",
    href: "https://www.nexotoken.net/",
  },
];

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
        <Link to={station ? `/station/${item.slug}` : "/reputation"} className="right">
          {station ? <Logo station={station} className="logo-img" /> : <span className="logo-fallback">站</span>}
          {item.station}
        </Link>
      </div>
    </article>
  );
}

export function emptyUser() {
  return localStorage.getItem("okk-user") || "";
}

export { activities, perks, reviews };
