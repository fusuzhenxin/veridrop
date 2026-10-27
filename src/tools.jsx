import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import codexRows from "./codex.json";
import iqRows from "./iq.json";
import { logoUrl, stations } from "./data.js";
import { grant } from "./points.js";
import { abandonCheckJob, clearBasicHistory, JOB_EVENT, readBasicHistory } from "./basic-run.jsx";
import { clearDetectHistory, readDetectHistory } from "./detect.js";
import { LIMITS, endpoint, listModels, quotaState, readHistory, runBenchmark, takeQuota, writeHistory } from "./probe.js";
import skinRows from "./skins.json";
import { useTitle } from "./ui.jsx";

const ICONS = {
  anthropic: "/icons/vendor/claude.svg",
  openai: "/icons/vendor/openai.svg",
  deepseek: "/icons/vendor/deepseek.svg",
  gemini: "/icons/vendor/gemini.svg",
  google: "/icons/vendor/gemini.svg",
  zhipu: "/icons/vendor/zhipu.svg",
  glm: "/icons/vendor/zhipu.svg",
  grok: "/icons/vendor/grok.svg",
  xai: "/icons/vendor/grok.svg",
  moonshot: "/icons/vendor/moonshot.svg",
  kimi: "/icons/vendor/moonshot.svg",
};
const BARS = {
  anthropic: "#c4622d",
  openai: "#1a1a1a",
  deepseek: "#3b6fd8",
  moonshot: "#6d5efc",
  kimi: "#6d5efc",
  zhipu: "#2aa3c7",
  glm: "#2aa3c7",
  gemini: "#1f9d6a",
  google: "#1f9d6a",
};

function signed(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${number}`;
  if (number === 0) return "+0";
  return String(number);
}

function ciText(ci) {
  if (!ci || ci.length < 2) return "—";
  const half = Math.abs(ci[1] - ci[0]) / 2;
  return `±${Number.isInteger(half) ? half : half.toFixed(1)}`;
}

function ModelIcon({ ven }) {
  const src = ICONS[ven];
  if (!src) return <span className="iq-fallback">{(ven || "?").slice(0, 1).toUpperCase()}</span>;
  return <img src={src} alt="" width="16" height="16" />;
}

function DeltaBar({ value }) {
  const width = Math.min(42, Math.abs(Number(value) || 0) * 4);
  return (
    <span className="iq-mini" aria-hidden="true">
      <i className="axis" />
      <i className={value < 0 ? "bad" : "good"} style={value < 0 ? { right: "50%", width } : { left: "50%", width }} />
    </span>
  );
}

function Trend({ values, base }) {
  return (
    <span className="iq-trend" title="绿=正常，黄=有波动，红=明显低于平时，灰=当天没数据">
      {(values || []).map((value, index) => {
        let color = "#e4e5e9";
        if (value != null) color = value < base - 8 ? "#ef4444" : value < base - 2 ? "#eab308" : "#22a559";
        return <i key={index} style={{ background: color }} />;
      })}
    </span>
  );
}

function Faq({ items }) {
  return (
    <section className="tool-faq" id="faq">
      <h2>常见问题</h2>
      {items.map((item, index) => (
        <details key={item.q} className="faq" open={index === 0}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </section>
  );
}

const IQ_FAQ = [
  ["这些分数是怎么来的？", "来源方 aistupidlevel 持续给主流厂商的一批模型做自动化考试：写代码每小时测一轮，深度推理和调用工具每天各测一轮，另有每 10 分钟一次的健康检查；每项测试内部按 7 个维度打分，再汇成 0–100 的综合分。维渡 AI 每 5 小时同步一份并长期留存，页面顶部会标注同步时间。"],
  ["什么是「降智」？", "同一个模型、没换版本，但表现比自己平时明显变差——比如平时考 72 分，突然只考 42 分。常见原因是服务商在高峰期悄悄降低算力、或把请求路由到了更便宜的通道。来源方用统计学的突变点检测算法（CUSUM 和 Page-Hinkley）盯着这种下滑，几小时内就能发现，不用等好几天。"],
  ["Codex 降智、Claude 降智了，能在这里看吗？", "能，这里就是一个降智雷达：Codex 雷达、CC 雷达盯的是单独一家，这一页同时盯着 Claude、Codex（GPT）、Gemini、DeepSeek、Kimi 等所有主流模型——谁低于自己平时水平、掉了多少、掉了几天，看「较近期」和 30 天趋势就知道。"],
  ["为什么分数每天变动这么大？", "来源方的大部分数据为估算和插值，单日分数会大幅波动，榜单一天内洗牌是常态。看单日排名意义不大，建议看 30 天趋势和「较发布时」的长期变化。"],
  ["这些分数能代表模型的真实水平吗？", "只能作参考。它反映的是「同一套题下的相对表现」，横向对比和盯降智比看绝对分更有意义。选模型还是要结合自己的实际用途实测。"],
  ["数据多久更新一次？", "来源方每小时实测一轮，维渡 AI 每 5 小时同步一次并长期留存——来源方只保留 31 天，我们自己的历史会越攒越长。"],
].map(([q, a]) => ({ q, a }));

function topBy(rows, pick) {
  return [...rows].sort((a, b) => pick(b) - pick(a)).slice(0, 10);
}

export function IqPage() {
  useTitle("模型智商榜");
  const [onlyReasoning, setOnlyReasoning] = useState(false);
  const rows = iqRows.filter((item) => !onlyReasoning || item.re);
  const maxScore = Math.max(...rows.map((item) => item.cur));
  const signals = [
    { tone: "up", title: [...iqRows].sort((a, b) => b.diff - a.diff)[0], text: "和刚发布时相比，它提升得最多。", value: (item) => signed(item.diff) },
    { tone: "score", title: [...iqRows].sort((a, b) => b.cur - a.cur)[0], text: "现在总分最高的模型。", value: (item) => item.cur },
    { tone: "code", title: [...iqRows].sort((a, b) => b.modes.coding - a.modes.coding)[0], text: "写代码的测试里，它得分最高。", value: (item) => item.modes.coding },
    { tone: "down", title: [...iqRows].sort((a, b) => a.bdiff - b.bdiff)[0], text: "比自己平时的水平掉得最狠，疑似降智。", value: (item) => signed(item.bdiff) },
  ];
  const boards = [
    ["推理", "解数学、逻辑这类要动脑的难题，它表现如何", (item) => item.modes.reasoning],
    ["代码", "写代码、改 bug 的水平，每小时都在测", (item) => item.modes.coding],
    ["工具调用", "让它调用工具干活，靠不靠谱", (item) => item.modes.tooling],
    ["稳定性", "同样的题反复做，发挥稳不稳（近 7 天）", (item) => item.stability],
  ];
  const latest = codexAge();
  return (
    <div className="wrap tool-page">
      <div className="tool-hd">
        <div>
          <h1>模型智商榜</h1>
          <p>第三方基准全天候给主流大模型出题打分，盯着谁在悄悄变笨（降智）。24 款监测中，20 款能力滑落，同步于 5 天前</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => navigator.clipboard.writeText(location.href)}>分享</button>
      </div>
      <Link to="/tools/codex-resets" className="note">
        <span>Codex 额度上次重置 <b>{latest.label}前</b></span>
        <span>→</span>
      </Link>
      <section className="chart">
        <div className="chart-top">
          <div>
            <b>维渡 AI 模型能力指数</b>
            <p>持续让各家模型做同一套题：写代码每小时测，推理和工具调用每天各测一轮，汇成 0–100 的综合分——也就是这页说的「智商」，越高越聪明。下面是最新一轮的排名。</p>
          </div>
          <label className="iq-filter">
            {rows.length} / {iqRows.length} 款模型
            <select value={onlyReasoning ? "re" : "all"} onChange={(event) => setOnlyReasoning(event.target.value === "re")}>
              <option value="all">全部</option>
              <option value="re">推理模型</option>
            </select>
          </label>
        </div>
        <div className="iq-plot">
          <div className="iq-axis">{[100, 90, 80, 70, 60].map((tick) => <span key={tick}>{tick}</span>)}</div>
          <div className="bars-chart iq-bars">
            {rows.map((item) => (
              <div key={item.slug} className="col" title={`${item.display} ${item.cur}`}>
                <div className="bar" style={{ height: `${((item.cur - 60) / (maxScore - 58)) * 168}px`, background: BARS[item.ven] || "#888" }}>
                  <span>{item.cur}</span>
                </div>
                <ModelIcon ven={item.ven} />
                <div className="nm">{item.display}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="h-block">
        <h2>完整排行</h2>
        <div className="table-wrap">
          <table className="rank iq-table">
            <thead>
              <tr>
                <th>#</th><th>模型</th><th>综合得分</th><th>较近期</th><th>近期常态</th><th>较发布时</th><th>发布时得分</th><th>置信区间</th><th>30 天趋势</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => (
                <tr key={item.slug}>
                  <td>{index + 1}</td>
                  <td className="iq-name"><ModelIcon ven={item.ven} />{item.display}</td>
                  <td><b>{item.cur}</b> <DeltaBar value={item.bdiff} /></td>
                  <td className={item.bdiff < 0 ? "down" : "up"}>{signed(item.bdiff)}</td>
                  <td>{item.base}</td>
                  <td className={item.diff < 0 ? "down" : "up"}>{signed(item.diff)}</td>
                  <td>{item.gold ?? "—"}</td>
                  <td>{ciText(item.ci)}</td>
                  <td><Trend values={item.vals} base={item.hmed} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="h-block">
        <h2>信号速览</h2>
        <div className="iq-signals">
          {signals.map((item) => (
            <article key={item.text}>
              <ModelIcon ven={item.title.ven} />
              <b>{item.title.display}</b>
              <strong>{item.value(item.title)}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="h-block">
        <h2>分项基准榜</h2>
        <div className="iq-boards">
          {boards.map(([title, desc, pick]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{desc}</p>
              {topBy(iqRows, pick).map((item, index) => (
                <div key={item.slug} className="iq-line">
                  <span>{index + 1}</span>
                  <ModelIcon ven={item.ven} />
                  <span className="nm">{item.display}</span>
                  <b>{pick(item)}</b>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>
      <Faq items={IQ_FAQ} />
    </div>
  );
}

function stamp(value) {
  return new Date(String(value).replace(/^\$D/, "")).getTime();
}

function shanghaiDay(time) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
}

function gapText(ms) {
  const hours = ms / 3600000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

function agoText(time) {
  return gapText(Math.max(0, Date.now() - time)).replace(/\.0 /, " ");
}

export function codexAge() {
  const latest = [...codexRows].sort((a, b) => stamp(b.announcedAt) - stamp(a.announcedAt))[0];
  const time = stamp(latest.announcedAt);
  const days = (Date.now() - time) / 86400000;
  return { time, days, label: days < 1 ? `${Math.max(1, Math.round(days * 24))} 小时` : days.toFixed(1) + " 天" };
}

const CODEX_FAQ = [
  ["Codex 额度多久重置一次？", "没有固定周期。重置由 OpenAI 的 @thsottiaux 个人临时宣布，官方从未承诺任何节奏。按已记录的历史，相邻两次的间隔中位数约 3.0 天、平均约 6.2 天，但平均值被 2025 年 12 月底到 2026 年 3 月初那次长达 67.7 天的空窗带偏了——一半的间隔其实在 3 天以内。看中位数比看平均值贴近真实体感。"],
  ["什么是「存量重置」？", "2026 年 6 月 11 日 OpenAI 上线了 rate-limit reset banking：官方发放的重置不再强制当场生效，而是存进你的账号，30 天内可以自己挑时机在 Codex CLI 的 /usage 里手动兑换。本页把这类公告标为「存量」，与当场生效的「常规重置」区分。"],
  ["重置是额外送额度吗？", "不是。重置的作用是把用量窗口提前补满，不是在原有额度之外多送一份总量。窗口还很空的时候用几乎没有效果，要等快见底或已经撞墙时用才划算。另外重置会重排你的周期起点：新的周用量周期从重置后的第一个请求开始算。"],
  ["除了等官方重置，还有什么办法恢复额度？", "一是等自动重置，Codex 有滚动的 5 小时窗口和每周窗口各自回补；二是兑换账号里存着的重置票；三是符合条件的 Plus、Pro 个人账号可以在设置里付费购买即时重置；四是加购 credits，订阅内额度扣完会自动用 credits 顶上。"],
  ["联系官方客服能帮我重置吗？", "不能。OpenAI Support 不会手动重置 ChatGPT 或 Codex 的用量限额。撞到限额后只能等待自动重置，或使用账号中显示的其他选项。"],
  ["这页的数据从哪来，多久更新？", "数据来自 codex-resets.com 的公开 API，维渡 AI 每小时同步一次并存进自己的库——源站哪天停更或下线，这里的历史仍在。原始公告来自 @thsottiaux 的 X 帖子，公告正文保留英文原文。中位数、最长空窗等统计为维渡 AI 基于原始时间戳自行计算。维渡 AI 与 OpenAI 无任何关联。"],
].map(([q, a]) => ({ q, a }));

function ResetCalendar({ rows }) {
  const byDay = new Map();
  for (const row of rows) {
    const key = shanghaiDay(stamp(row.announcedAt));
    const bucket = byDay.get(key) || [];
    bucket.push(row);
    byDay.set(key, bucket);
  }
  const start = new Date("2025-10-06T00:00:00+08:00");
  const weeks = [];
  for (let cursor = start.getTime(); cursor <= Date.now(); cursor += 7 * 86400000) weeks.push(cursor);
  const days = ["一", "二", "三", "四", "五", "六", "日"];
  return (
    <div className="cal-r">
      <b>重置日历</b>
      <div className="codex-heat">
        <div className="codex-months">
          {weeks.map((week, index) => {
            const label = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }).format(week);
            const prev = index ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }).format(weeks[index - 1]) : "";
            return <span key={week}>{label !== prev ? label : ""}</span>;
          })}
        </div>
        {days.map((day, row) => (
          <div key={day} className="codex-row">
            <span>{row % 2 === 0 ? `周${day}` : ""}</span>
            {weeks.map((week) => {
              const key = shanghaiDay(week + row * 86400000);
              const hits = byDay.get(key) || [];
              const banked = hits.length > 0 && hits.every((item) => item.type === "banked");
              const cls = hits.length > 1 ? "twice" : banked ? "bank" : hits.length ? "hit" : "";
              return <i key={key} className={cls} title={hits.length ? key : "当天无重置"} />;
            })}
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="hit" /> 重置</span>
        <span><i className="twice" /> 当天两次</span>
        <span><i className="bank" /> 存量重置</span>
        <span><i /> 无</span>
      </div>
    </div>
  );
}

export function CodexPage() {
  useTitle("Codex 额度重置");
  const rows = useMemo(() => [...codexRows].sort((a, b) => stamp(b.announcedAt) - stamp(a.announcedAt)), []);
  const latest = rows[0];
  const times = [...rows].map((item) => stamp(item.announcedAt)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  const median = gaps[Math.floor((gaps.length - 1) / 2)];
  const average = gaps.reduce((sum, item) => sum + item, 0) / gaps.length;
  const longest = Math.max(...gaps);
  const older = rows.slice(1).map((item, index, list) => ({
    ...item,
    time: stamp(item.announcedAt),
    gap: index === list.length - 1 ? times[1] - times[0] : stamp(list[index].announcedAt) - stamp(list[index + 1].announcedAt),
  }));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState("");
  const pageSize = 16;
  const pages = Math.ceil(older.length / pageSize);
  const visible = older.slice((page - 1) * pageSize, page * pageSize);
  const when = (time) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(time);
  return (
    <div className="wrap tool-page">
      <div className="tool-hd">
        <div>
          <h1>Codex 额度重置</h1>
          <p>OpenAI 每一次临时宣布的 Codex 用量重置，已收录 {rows.length} 次</p>
        </div>
      </div>
      <div className="cal">
        <div className="cal-l">
          <div className="mini">最新重置</div>
          <div className="huge">{codexAge().label.replace(" 天", "").replace(" 小时", "")} <span>{codexAge().label.includes("小时") ? "小时前" : "天前"}</span></div>
          <div>{when(stamp(latest.announcedAt))} <span className="chip-o">{latest.type === "banked" ? "存量重置" : "常规重置"}</span></div>
          <p className="codex-lead">{latest.textEn}</p>
          <a className="more" href={latest.url} target="_blank" rel="noreferrer">在 X 查看 ↗</a>
        </div>
        <ResetCalendar rows={rows} />
      </div>
      <div className="kpis">
        <div className="kpi"><div className="k">累计重置</div><div className="v">{rows.length} 次</div><div className="s">首次记录于 {shanghaiDay(times[0])}</div></div>
        <div className="kpi"><div className="k">间隔中位数</div><div className="v">{(median / 86400000).toFixed(1)} 天</div><div className="s">平均 {(average / 86400000).toFixed(1)} 天</div></div>
        <div className="kpi"><div className="k">最长空窗</div><div className="v">{(longest / 86400000).toFixed(1)} 天</div><div className="s">2025-12 至 2026-03</div></div>
      </div>
      <section className="h-block">
        <div className="section-hd"><h2>更早的公告</h2><span className="mini">共 {older.length} 条，原文来自 @thsottiaux</span></div>
        <table className="rank">
          <thead><tr><th>日期</th><th>公告内容</th><th>距上次</th><th>原帖</th></tr></thead>
          <tbody>
            {visible.map((item) => {
              const long = item.textEn.length > 180;
              const shown = open === item.id || !long ? item.textEn : `${item.textEn.slice(0, 180)}…`;
              return (
                <tr key={item.id}>
                  <td>{agoText(item.time)}<div className="mini">{when(item.time)}</div></td>
                  <td>
                    {item.type === "banked" ? <span className="chip-o">存量</span> : null} {shown}
                    {long ? <button type="button" className="linkish" onClick={() => setOpen(open === item.id ? "" : item.id)}>{open === item.id ? " 收起" : " 展开全文 ↓"}</button> : null}
                  </td>
                  <td>{gapText(item.gap)}</td>
                  <td><a className="more" href={item.url} target="_blank" rel="noreferrer">X ↗</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pager">
          {Array.from({ length: pages }, (_, index) => (
            <button key={index} type="button" className={page === index + 1 ? "on" : ""} onClick={() => setPage(index + 1)}>{index + 1}</button>
          ))}
        </div>
      </section>
      <Faq items={CODEX_FAQ} />
    </div>
  );
}

const SKIN_COLORS = ["红", "橙", "黄", "绿", "青", "蓝", "紫", "粉", "黑", "白", "灰"];

function skinFavs() {
  try {
    const parsed = JSON.parse(localStorage.getItem("okk-skin-favs") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function SkinsPage() {
  useTitle("Codex 换肤大师");
  const [query, setQuery] = useSearchParams();
  const q = query.get("q") || "";
  const category = query.get("cat") || "全部";
  const color = query.get("color") || "全部";
  const sort = query.get("sort") || "hot";
  const page = Number(query.get("p") || 1);
  const favs = skinFavs();
  const categories = ["全部", ...new Set(skinRows.map((item) => item.category))];
  const set = (patch) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === "全部" || value === "hot" || value === 1 || value === "1") next.delete(key);
      else next.set(key, String(value));
    }
    if (!("p" in patch)) next.delete("p");
    setQuery(next);
  };
  const filtered = skinRows.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (category !== "全部" && item.category !== category) return false;
    if (color !== "全部" && item.colorFamily !== color) return false;
    return true;
  });
  const ordered = [...filtered].sort((a, b) => {
    if (sort === "new") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "pick") return Number(b.featured) - Number(a.featured) || a.sort - b.sort;
    return 0;
  });
  const pages = Math.max(1, Math.ceil(ordered.length / 12));
  const visible = ordered.slice((page - 1) * 12, page * 12);
  return (
    <div className="wrap tool-page">
      <div className="tool-hd">
        <div>
          <h1>Codex 皮肤</h1>
          <p>给 Codex 桌面端换一套皮肤 —— 整套界面配色 + 壁纸。</p>
        </div>
      </div>
      <div className="skin-tools">
        <input value={q} placeholder="搜索主题" onChange={(event) => set({ q: event.target.value })} />
        <label>分类
          <select value={category} onChange={(event) => set({ cat: event.target.value })}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>色系
          <select value={color} onChange={(event) => set({ color: event.target.value })}>
            {["全部", ...SKIN_COLORS].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>排序
          <select value={sort} onChange={(event) => set({ sort: event.target.value })}>
            <option value="hot">最热</option>
            <option value="new">最新</option>
            <option value="pick">推荐</option>
          </select>
        </label>
      </div>
      {visible.length ? (
        <div className="skin-grid">
          {visible.map((item) => (
            <Link key={item.id} to={`/tools/skins/${item.id}`} className="skin-card">
              <img src={`/skins/${item.id}/preview.${item.previewExt || "jpg"}`} alt={item.name} />
              <span className="tag">{item.category}</span>
              <span className="cap"><b>{item.name}</b><em>♡ {item.favCount + (favs[item.id] ? 1 : 0)}</em></span>
            </Link>
          ))}
        </div>
      ) : <p className="mini">该筛选下暂无主题</p>}
      <div className="pager">
        {Array.from({ length: pages }, (_, index) => (
          <button key={index} type="button" className={page === index + 1 ? "on" : ""} onClick={() => set({ p: index + 1 })}>{index + 1}</button>
        ))}
      </div>

    </div>
  );
}

export function SkinPage() {
  const { id } = useParams();
  const skin = skinRows.find((item) => item.id === id);
  useTitle(skin ? skin.name : "Codex 皮肤");
  const [tab, setTab] = useState("");
  const [copied, setCopied] = useState(false);
  const [favs, setFavs] = useState(skinFavs);
  if (!skin) return <div className="wrap tool-page"><h1>页面不存在</h1><Link to="/tools/skins">返回皮肤库</Link></div>;
  const manifest = `https://www.okkmax.com/skins/${skin.id}/manifest.json`;
  const commands = {
    enable: `npx okkskin@0.3.0 enable ${manifest}`,
    apply: `npx okkskin@0.3.0 apply ${manifest}`,
    restore: "npx okkskin@0.3.0 disable",
  };
  const hints = {
    enable: "先退出 Codex，运行 npx okkskin@0.3.0 launch 启动，再运行本命令。以后用 launch 启动都会自动应用。",
    apply: "只对当前这次会话生效，退出 Codex 即失效。启动方式同样是 npx okkskin@0.3.0 launch。",
    restore: "停用常驻换肤并还原。不带 launch 直接重启 Codex，也会回到原版。",
  };
  const colors = skin.colors || {};
  const swatches = [["背景", colors.background], ["面板", colors.panel], ["强调", colors.accent], ["文字", colors.text], ["次要", colors.muted], ["描边", colors.line]];
  const favCount = skin.favCount + (favs[skin.id] ? 1 : 0);
  return (
    <div className="wrap tool-page">
      <div className="skin-head">
        <div>
          <div className="crumb"><Link to="/tools/skins">Codex 皮肤</Link> › {skin.name}</div>
          <h1>{skin.name}</h1>
          <div className="skin-pills">
            <span>{skin.category}</span>
            <span><i />{skin.colorFamily}色系</span>
            <em>{String(skin.createdAt).slice(0, 10)}</em>
          </div>
        </div>
        <div className="skin-actions">
          <button type="button" className="ghost-btn" onClick={() => {
            const next = { ...favs, [skin.id]: !favs[skin.id] };
            if (!next[skin.id]) delete next[skin.id];
            localStorage.setItem("okk-skin-favs", JSON.stringify(next));
            setFavs(next);
          }}>♡ 收藏 {favCount}</button>
          <button type="button" className="ghost-btn" onClick={() => navigator.clipboard.writeText(location.href)}>分享</button>
          <button type="button" className="go" onClick={() => setTab("enable")}>获取命令</button>
        </div>
      </div>
      <div className="skin-rail">
        {skinRows.map((item) => (
          <Link key={item.id} to={`/tools/skins/${item.id}`} className={item.id === skin.id ? "on" : ""}>
            <img src={`/skins/${item.id}/preview.${item.previewExt || "jpg"}`} alt="" />
            <span>{item.name}</span>
          </Link>
        ))}
      </div>
      <img className="skin-hero" src={`/skins/${skin.id}/preview.${skin.previewExt || "jpg"}`} alt={skin.name} />
      <h2>配色</h2>
      <div className="swatches">
        {swatches.map(([label, value]) => (
          <div key={label}><i style={{ background: value || "#ddd" }} /><span>{label}</span><b>{value || "—"}</b></div>
        ))}
      </div>
      {tab ? (
        <div className="modal-back" onClick={() => setTab("")}>
          <div className="skin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sec-h"><h2>套用「{skin.name}」</h2><button type="button" onClick={() => setTab("")}>✕</button></div>
            <div className="ab-seg">
              <button type="button" className={tab === "enable" ? "on" : ""} onClick={() => setTab("enable")}>持久 · 推荐</button>
              <button type="button" className={tab === "apply" ? "on" : ""} onClick={() => setTab("apply")}>单次预览</button>
              <button type="button" className={tab === "restore" ? "on" : ""} onClick={() => setTab("restore")}>恢复原版</button>
            </div>
            <pre>{commands[tab]}</pre>
            <p>{hints[tab]}</p>
            <button type="button" className="go" onClick={() => { navigator.clipboard.writeText(commands[tab]); setCopied(true); }}>复制</button>
            {copied ? <p className="mini">已复制。先退出 Codex，用 okkskin launch 启动后再执行。</p> : null}
            <ol>
              <li>复制上方命令</li>
              <li>打开「终端」</li>
              <li>将命令粘贴进去，按回车执行</li>
              <li>按照提示确认，等待命令运行完成</li>
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const SPEED_FAQ = [
  ["什么是 AI API 测试工具？", "AI API 测试工具会向目标接口发起真实请求，检测首字延迟（TTFT）、生成速度、请求成功率、并发处理能力和缓存命中情况。它既可以测试模型厂商的官方 API，也可以测试兼容相应协议的中转站接口。"],
  ["支持哪些大模型 API 和接口协议？", "目前支持 Anthropic Messages API 和 OpenAI Responses API。工具不限制模型厂商，只要目标服务支持对应协议，就可以测试 Claude、GPT、DeepSeek、Qwen、GLM 等模型或模型别名。"],
  ["可以测试大模型 API 中转站吗？", "可以。填写中转站提供的完整接口地址、API Key 和模型名称，即可测试该线路的响应速度、请求成功率和缓存能力。检测结果只代表本次测试时使用的模型、线路、参数和网络环境，不代表该服务在所有时间和地区的表现。"],
  ["Messages API 和 Responses API 有什么区别？", "Messages API 使用 Anthropic Messages 协议，接口地址通常以 /v1/messages 结尾；Responses API 使用 OpenAI Responses 协议，接口地址通常以 /v1/responses 结尾。协议的选择取决于服务商提供的接口格式，不取决于模型名称。"],
  ["测试会消耗 API 额度或产生费用吗？", "会。测速过程中会向目标接口发送真实请求，因此可能消耗 token、请求次数或账户余额。并发数、请求数、输出长度、缓存采样次数和长对话轮数越高，通常消耗越多。开始测试前应确认服务商的计费规则和账户余额。"],
  ["测试需要多长时间？", "检测时间取决于请求数量、并发数、缓存采样时间、长对话轮数以及目标接口本身的速度。响应较快的接口通常会更早完成；如果接口排队、限流、超时或频繁断开，检测时间会明显增加。"],
  ["并发数和请求数分别是什么意思？", "并发数表示同一时间最多有多少个请求正在进行；请求数表示本轮一共发送多少个请求。例如，并发数为 5、请求数为 10，性能测试会最多同时保持 5 个请求，某个请求结束后再补充下一个，直到完成全部 10 个请求。"],
  ["报告里的 TTFT、生成速度、缓存命中率是什么意思？", "TTFT（Time To First Token）是从发出请求到收到第一个字的时间，越短说明响应越快；生成速度是首字之后每秒输出的 token 数，越高说明输出越流畅；请求成功率是全部请求中正常返回的比例；缓存命中率是重复前缀被服务端缓存复用的比例。"],
  ["这个工具收费吗？", "这个本地复刻不收取检测费用。未登录每天可检测 3 次，登录后每天可检测 30 次，次数只记在这台浏览器里。密钥只发给你填写的接口，不会发给维渡 AI，也不会被保存。"],
].map(([q, a]) => ({ q, a }));

function estimate(form) {
  const requests = Number(form.requests) || 0;
  const concurrency = Math.max(1, Number(form.concurrency) || 1);
  const samples = Number(form.cache_samples) || 0;
  const interval = Number(form.cache_interval) || 0;
  const turns = Number(form.roll_turns) || 0;
  const low = (requests / concurrency) * 8 + samples * interval + turns * 8;
  const high = (requests / concurrency) * 15 + samples * (interval + 2) + turns * 15;
  if (high < 60) return "不到 1 分钟";
  const a = Math.max(1, Math.round(low / 60));
  const b = Math.max(a, Math.round(high / 60));
  return a === b ? `约 ${a} 分钟` : `${a} 到 ${b} 分钟`;
}

function seconds(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

const EMPTY_FORM = {
  url: "",
  key: "",
  model: "",
  protocol: "messages",
  profile: "generic",
  concurrency: "3",
  requests: "10",
  cache_samples: "10",
  cache_interval: "8",
  roll_turns: "8",
  prefix_tokens: "8000",
  max_tokens: "512",
};

export function SpeedPage() {
  useTitle("AI API 测试工具");
  const [params] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [models, setModels] = useState([]);
  const [modelNote, setModelNote] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const stopRef = useRef(null);
  const limits = quotaState().logged ? LIMITS.user : LIMITS.guest;
  const quota = quotaState();
  useEffect(() => {
    let draft = null;
    try {
      const raw = sessionStorage.getItem("okk-speed-draft");
      sessionStorage.removeItem("okk-speed-draft");
      draft = raw ? JSON.parse(raw) : null;
    } catch {
      draft = null;
    }
    const job = params.get("job");
    const saved = job ? readHistory().find((item) => item.id === job) : null;
    let full = null;
    if (saved) {
      try {
        full = JSON.parse(localStorage.getItem(`okk-speed-report:${saved.id}`) || "null");
      } catch {
        full = null;
      }
    }
    setForm((current) => ({
      ...current,
      url: full?.path?.replace(/\/v\d+\/(messages|responses)$/i, "") || draft?.url || current.url || "",
      model: full?.model || draft?.model || "",
      key: draft?.key || "",
    }));
    if (full) setReport(full);
  }, [params]);
  const patch = (key, value) => setForm((current) => {
    const next = { ...current, [key]: value };
    if (key === "protocol" || key === "profile") {
      next.max_tokens = next.protocol === "responses" || next.profile === "claude-code" ? "2048" : "512";
    }
    return next;
  });
  const matches = stations.filter((item) => item.baseUrl && (!form.url || `${item.name} ${item.baseUrl}`.toLowerCase().includes(form.url.toLowerCase()))).slice(0, 6);
  function validate() {
    const target = endpoint(form.url, form.protocol);
    if (target.error) return target.error;
    const key = form.key.trim();
    if (!key) return "请填写密钥。";
    if (key.length < 8) return "密钥太短，请检查是否复制完整。";
    if (/\s/.test(key)) return "密钥里不能有空格或换行，请重新复制。";
    if (!form.model.trim()) return "请选择或输入模型名称。";
    if (!/^[A-Za-z0-9._:/@+-]{1,100}$/.test(form.model.trim())) return "模型名称只能包含字母、数字和 . _ - : / @ +，且不超过 100 个字符。";
    const checks = [
      ["concurrency", 1, limits.concurrency, `未登录最多 ${LIMITS.guest.concurrency} 个，登录后可提高到 ${LIMITS.user.concurrency} 个。`],
      ["requests", 1, limits.requests, `未登录最多填写 ${LIMITS.guest.requests} 次请求，登录后可提高到 ${LIMITS.user.requests} 次。`],
      ["cache_samples", 0, limits.cache_samples, `未登录最多 ${LIMITS.guest.cache_samples} 次，登录后可提高到 ${LIMITS.user.cache_samples} 次。`],
      ["roll_turns", 0, limits.roll_turns, `未登录最多 ${LIMITS.guest.roll_turns} 轮，登录后可提高到 ${LIMITS.user.roll_turns} 轮。`],
    ];
    for (const [key, min, max, message] of checks) {
      const value = Number(form[key]);
      if (!Number.isInteger(value) || value < min || value > max) return message;
    }
    if (Number(form.roll_turns) === 1) return "填 0 跳过，或至少 2 轮。";
    const interval = Number(form.cache_interval);
    if (interval < LIMITS.cache_interval[0] || interval > LIMITS.cache_interval[1]) return `缓存采样间隔要在 ${LIMITS.cache_interval[0]} 到 ${LIMITS.cache_interval[1]} 秒之间。`;
    const prefix = Number(form.prefix_tokens);
    if (prefix < LIMITS.prefix_tokens[0] || prefix > LIMITS.prefix_tokens[1]) return `前缀 token 数要在 ${LIMITS.prefix_tokens[0]} 到 ${LIMITS.prefix_tokens[1]} 之间。`;
    const maxTokens = Number(form.max_tokens);
    if (maxTokens < LIMITS.max_tokens[0] || maxTokens > LIMITS.max_tokens[1]) return `最大输出要在 ${LIMITS.max_tokens[0]} 到 ${LIMITS.max_tokens[1]} 之间。`;
    if (quota.left <= 0) return `今天的 ${quota.cap} 次检测已经用完。次数只记在这台浏览器。`;
    return "";
  }
  async function start() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setReport(null);
    takeQuota();
    const controller = new AbortController();
    stopRef.current = controller;
    setProgress({ phase: "正在检测", done: 0, total: Number(form.requests) });
    const result = await runBenchmark(form, { signal: controller.signal, onProgress: setProgress });
    setProgress(null);
    stopRef.current = null;
    if (result.stopped) {
      setError("检测被手动停止，没有生成报告。已发出的请求无法撤回，额度不退回。");
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    localStorage.setItem(`okk-speed-report:${result.report.id}`, JSON.stringify(result.report));
    setReport(result.report);
    if (result.report.ok > 0) grant("detect", 3, "每日检测", "day");
  }
  return (
    <div className="wrap tool-page">
      <div className="tool-hd">
        <div>
          <h1>AI API 测试工具</h1>
          <p>测试 AI 大模型 API 与中转站的响应速度、并发、生成速度、请求成功率和缓存能力，兼容 Messages 与 Responses 协议的接口，免费使用。</p>
        </div>
      </div>
      <form className="speed-card" onSubmit={(event) => { event.preventDefault(); start(); }}>
        <h2>连接信息</h2>
        <label>API 地址
          <input value={form.url} placeholder="https://api.example.com" onFocus={() => setSuggest(true)} onChange={(event) => { patch("url", event.target.value); setSuggest(true); }} />
        </label>
        {suggest && matches.length ? (
          <div className="speed-suggest">
            {matches.map((item) => (
              <button type="button" key={item.slug} onClick={() => { patch("url", item.baseUrl); setSuggest(false); }}>
                <img src={logoUrl(item.img)} alt="" />
                <span>{item.name}</span>
                <em>{item.baseUrl}</em>
              </button>
            ))}
          </div>
        ) : null}
        <label>API KEY
          <span className="speed-key">
            <input type={showKey ? "text" : "password"} value={form.key} placeholder="sk-..." autoComplete="off" onChange={(event) => patch("key", event.target.value)} />
            <button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button>
          </span>
        </label>
        <label>模型
          <span className="speed-model">
            <input list="speed-models" value={form.model} placeholder="输入要测试的模型名称" onChange={(event) => patch("model", event.target.value)} />
            <button type="button" onClick={async () => {
              setModelNote("正在获取模型列表，最多等待 15 秒。");
              const result = await listModels(form.url, form.key.trim());
              if (result.error) setModelNote(result.error);
              else {
                setModels(result.models);
                setModelNote(`已获取 ${result.models.length} 个模型，点模型框选择。`);
              }
            }}>获取模型列表</button>
          </span>
        </label>
        <datalist id="speed-models">{models.map((item) => <option key={item} value={item} />)}</datalist>
        {modelNote ? <p className="mini">{modelNote}</p> : null}
        <div className="speed-label">协议</div>
        <div className="ab-seg">
          {["messages", "responses"].map((item) => (
            <button type="button" key={item} className={form.protocol === item ? "on" : ""} onClick={() => patch("protocol", item)}>{item === "messages" ? "Messages" : "Responses"}</button>
          ))}
        </div>
        <p className="mini">{form.protocol === "messages" ? "支持所有兼容 Messages API 的模型服务。" : "支持所有兼容 Responses API 的模型服务。"}</p>
        <h2>测试规模</h2>
        <div className="speed-scale">
          <label>并发数 <input value={form.concurrency} onChange={(event) => patch("concurrency", event.target.value)} /></label>
          <label>请求数 <input value={form.requests} onChange={(event) => patch("requests", event.target.value)} /></label>
        </div>
        <p className="mini">未登录最多并发 {LIMITS.guest.concurrency}、请求 {LIMITS.guest.requests}；登录后最多 {LIMITS.user.concurrency} 和 {LIMITS.user.requests}。</p>
        <button type="button" className="linkish" onClick={() => setAdvanced((value) => !value)}>高级设置 {advanced ? "▴" : "▾"}</button>
        {advanced ? (
          <div className="speed-advanced">
            <p>缓存与长对话参数，一般保持默认即可</p>
            <div className="speed-label">请求画像</div>
            <div className="ab-seg">
              <button type="button" className={form.profile === "generic" ? "on" : ""} onClick={() => patch("profile", "generic")}>通用</button>
              <button type="button" className={form.profile === "claude-code" ? "on" : ""} onClick={() => patch("profile", "claude-code")}>Claude Code</button>
            </div>
            <p className="mini">{form.profile === "generic" ? "标准请求，不带客户端特征。" : "加上编码助手系统提示，并把最大输出调到 2048。不会伪造 Claude Code 的私有请求头。"}</p>
            <div className="speed-scale">
              <label>缓存采样次数 <input value={form.cache_samples} onChange={(event) => patch("cache_samples", event.target.value)} /></label>
              <label>缓存采样间隔（秒） <input value={form.cache_interval} onChange={(event) => patch("cache_interval", event.target.value)} /></label>
              <label>长对话轮数 <input value={form.roll_turns} onChange={(event) => patch("roll_turns", event.target.value)} /></label>
              <label>前缀 token 数 <input value={form.prefix_tokens} onChange={(event) => patch("prefix_tokens", event.target.value)} /></label>
              <label>最大输出 <input value={form.max_tokens} onChange={(event) => patch("max_tokens", event.target.value)} /></label>
            </div>
          </div>
        ) : null}
        {error ? <p className="review-error">{error}</p> : null}
        {progress ? <p>正在检测 · {progress.phase} {progress.done}/{progress.total}。进度结束后统一给指标。</p> : null}
        <div className="speed-go">
          <span>预计等待 {estimate(form)}，{quota.logged ? "" : "未登录"}每天可检测 {quota.cap} 次。</span>
          {progress ? <button type="button" className="ghost-btn" onClick={() => stopRef.current?.abort()}>停止检测</button> : <button className="go" type="submit">开始检测</button>}
        </div>
      </form>
      <div className="hdcap">
        <span>为保障账户安全，建议优先使用测试专用 KEY。密钥只发给上面的地址，不保存。</span>
        <Link to="/history">检测历史</Link>
      </div>
      {report ? <SpeedReport report={report} /> : null}
      <Faq items={SPEED_FAQ} />
    </div>
  );
}

function SpeedReport({ report }) {
  const conclusion = report.ok === 0
    ? "没有拿到可用的回答。先检查密钥、模型名和账户余额。"
    : report.rate < 0.7
      ? "失败率过高，不建议直接使用。可以降低并发后重新检测。"
      : report.ttftMs != null && report.ttftMs < 2000
        ? "当前并发下响应及时、请求稳定。可以接入使用，上线前建议按真实并发再测一次。"
        : "有需要留意的地方。对延迟敏感的业务，请预留超时和重试。";
  return (
    <section className="speed-report">
      <div className="sec-h">
        <h2>检测报告</h2>
        <div>
          <button type="button" className="ghost-btn" onClick={() => navigator.clipboard.writeText(`${location.origin}/tools/api-speed?job=${report.id}`)}>复制报告链接</button>
          <button type="button" className="ghost-btn" onClick={() => {
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `${report.id}.json`;
            link.click();
          }}>下载 JSON</button>
        </div>
      </div>
      <p>{conclusion}</p>
      <div className="kpis">
        <div className="kpi"><div className="k">首字等待</div><div className="v">{seconds(report.ttftMs)}</div><div className="s">{report.ttftWord}</div></div>
        <div className="kpi"><div className="k">生成速度</div><div className="v">{report.speed == null ? "—" : `${report.speed}`}</div><div className="s">tok/s</div></div>
        <div className="kpi"><div className="k">请求成功率</div><div className="v">{Math.round(report.rate * 100)}%</div><div className="s">{report.rateWord} · {report.ok}/{report.ok + report.fail}</div></div>
        <div className="kpi"><div className="k">缓存命中率</div><div className="v">{report.cacheHit == null ? "—" : `${Math.round(report.cacheHit * 100)}%`}</div><div className="s">{report.samples.length ? `${report.samples.filter((item) => item.hit).length}/${report.samples.length} 次` : "未测试"}</div></div>
      </div>
      <p className="mini">P50 {seconds(report.ttftMs)} · P90 {seconds(report.p90)} · P99 {seconds(report.p99)} · 最快 {seconds(report.min)} · 最慢 {seconds(report.max)} · 平均 {seconds(report.avg)}</p>
      <div className="speed-bars">
        {report.shots.map((item, index) => <i key={index} title={item.ok ? seconds(item.ttftMs) : item.error} className={item.ok ? "" : "bad"} style={{ height: item.ttftMs ? Math.min(72, item.ttftMs / 80) : 8 }} />)}
      </div>
      {report.errors.length ? <p className="review-error">失败原因：{report.errors.join("、")}</p> : null}
      {report.roll.length ? (
        <table className="rank">
          <thead><tr><th>轮次</th><th>输入</th><th>命中</th></tr></thead>
          <tbody>{report.roll.map((item) => <tr key={item.turn}><td>第 {item.turn} 轮</td><td>{item.input || "—"}</td><td>{item.read || 0}</td></tr>)}</tbody>
        </table>
      ) : null}
    </section>
  );
}

function historyStamp(at) {
  if (typeof at === "number" && Number.isFinite(at)) return at;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function historyRows() {
  const speed = readHistory().map((item) => ({ ...item, kind: "speed" }));
  const detect = readDetectHistory().map((item) => ({ ...item, kind: "detect" }));
  const check = readBasicHistory().map((item) => ({ ...item, kind: "check" }));
  return [...speed, ...detect, ...check].sort((a, b) => historyStamp(b.at) - historyStamp(a.at));
}

function historyResult(item) {
  if (item.kind === "check") {
    if (item.running) return "进行中";
    if (item.interrupted) return "已中断";
    if (item.result) return item.result;
    if (item.suite === "candy" || item.suite === "pelican") return "完成";
    return item.score == null ? "没测成" : `${item.score} 分`;
  }
  if (item.fatal) return "失败";
  if (item.ttftMs == null) return "完成";
  return `${(item.ttftMs / 1000).toFixed(2)}s`;
}

function historyApi(item) {
  if (item.kind === "check") {
    if (item.suite === "candy") return "糖果测试";
    if (item.suite === "pelican") return "鹈鹕骑车";
    if (item.suite === "all") return "基础+糖果+骑车";
    return "基础测试";
  }
  if (item.kind === "detect") return "多维检测";
  return item.protocol === "responses" ? "Responses" : "Messages";
}

function historyHref(item) {
  if (item.kind === "check" && item.replay === "candy") return `/check/candy?replay=${encodeURIComponent(item.id)}`;
  if (item.kind === "check" && item.replay === "pelican") return `/check/pelican?replay=${encodeURIComponent(item.id)}`;
  if (item.kind === "check" && item.suite === "all") return `/check/detect?run=${encodeURIComponent(item.id)}`;
  if (item.kind === "check") return `/b/${item.id}`;
  if (item.kind === "detect") return `/r/${item.id}`;
  return `/tools/api-speed?job=${item.id}`;
}

function historyClock(at) {
  const ms = historyStamp(at);
  if (!ms) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(ms));
}

export function HistoryPage() {
  useTitle("检测历史");
  const [items, setItems] = useState(historyRows);
  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      const next = historyRows();
      setItems(next);
      window.clearInterval(timer);
      timer = 0;
      if (next.some((item) => item.running)) timer = window.setInterval(refresh, 1000);
    };
    refresh();
    window.addEventListener(JOB_EVENT, refresh);
    return () => {
      window.removeEventListener(JOB_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, []);
  return (
    <div className="wrap tool-page">
      <div className="tool-hd">
        <div>
          <h1>最近检测历史</h1>
          <p>检测历史仅保存在此浏览器，不上传服务器；清缓存或换设备会清空。密钥不会写进记录。离开页面后，进行中的检测仍会继续。</p>
        </div>
      </div>
      <section className="history-card">
        <div className="sec-h">
          <b>最近历史</b>
          <button type="button" className="ghost-btn" onClick={() => {
            if (!window.confirm("确定清空本机检测历史？清空后不可恢复。")) return;
            abandonCheckJob();
            writeHistory([]);
            clearDetectHistory();
            clearBasicHistory();
            setItems([]);
          }}>清除缓存</button>
        </div>
        <table className="rank">
          <thead><tr><th>站点</th><th>结果</th><th>模型</th><th>接口</th><th>时间</th><th>详情</th></tr></thead>
          <tbody>
            {items.length ? items.map((item) => (
              <tr key={`${item.kind}-${item.id}`}>
                <td>{item.host}</td>
                <td>{historyResult(item)}</td>
                <td>{item.model}</td>
                <td>{historyApi(item)}</td>
                <td>{historyClock(item.at)}</td>
                <td><Link to={historyHref(item)}>{item.kind === "speed" ? "测速" : "报告"}</Link></td>
              </tr>
            )) : <tr><td colSpan={6}>暂时没有数据</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function quickDraft(url, key) {
  sessionStorage.setItem("okk-speed-draft", JSON.stringify({ url, key, model: "" }));
}
