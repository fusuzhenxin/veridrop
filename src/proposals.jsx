import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authToken, commentProposal, createProposal, fetchProposal, fetchProposals, supportProposal } from "./community.js";
import { DirectoryIcon } from "./directory-ui.jsx";
import { useTitle } from "./ui.jsx";

const tests = { basic: "基础测试", candy: "糖果测试", pelican: "鹈鹕骑车" };
const statuses = { open: "征集中", planned: "已排期", testing: "测试中", done: "已完成", closed: "暂不处理" };
const date = (value) => new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" });
const emptyForm = { name: "", url: "", reason: "", tests: ["basic"] };
const login = () => window.dispatchEvent(new Event("okk-open-auth"));

function ProposalCard({ item, onSupport, busy, detail = false }) {
  return <article className={`proposal-card${detail ? " expanded" : ""}`}>
    <button className={`proposal-support${item.mine ? " on" : ""}`} type="button" aria-pressed={item.mine} aria-label={`${item.mine ? "撤回支持" : "支持收录"}${item.name}，已有 ${item.votes} 人支持`} disabled={busy || (!item.mine && ["done", "closed"].includes(item.status))} onClick={() => onSupport(item)}><span aria-hidden="true">↑</span><b>{item.votes}</b><small>{item.mine ? "已支持" : "想收录"}</small></button>
    <div className="proposal-card-content">
      <div className="proposal-card-top"><span className="proposal-monogram" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><div><h2>{detail ? item.name : <Link to={`/proposals?id=${item.id}`}>{item.name}</Link>}</h2><a className="proposal-site-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`访问${item.name}中转站官网（新标签页）`}><span>访问中转站</span><strong>{item.host}</strong><DirectoryIcon name="external" /></a></div><span className={`proposal-status ${item.status}`}>{statuses[item.status]}</span></div>
      <p className="proposal-reason">{item.reason}</p>
      <div className="proposal-test-tags"><span>希望测试</span>{item.tests.map((key) => <span className={`proposal-test-tag ${key}`} key={key}><DirectoryIcon name={key === "basic" ? "pulse" : key === "candy" ? "layers" : "image"} />{tests[key]}</span>)}</div>
      {item.note ? <p className="proposal-update"><DirectoryIcon name="news" /><span><b>运营进展</b>{item.note}</span></p> : null}
      <footer><span>{item.author} · {date(item.created)} 提交</span><Link to={`/proposals?id=${item.id}`}><DirectoryIcon name="message" />{item.commentCount ? `${item.commentCount} 条讨论` : "参与讨论"}</Link>{item.result_url ? <Link className="proposal-result" to={item.result_url}>查看结果<DirectoryIcon name="arrow" /></Link> : null}</footer>
    </div>
  </article>;
}

export function ProposalsPage() {
  useTitle("收录提案｜一起决定下一站与想看的测试");
  const [params, setParams] = useSearchParams();
  const selected = params.get("id") || "";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("hot");
  const [page, setPage] = useState(1);
  const [board, setBoard] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [posting, setPosting] = useState(false);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [busy, setBusy] = useState("");
  const inFlight = useRef(new Set());
  const nameInput = useRef(null);
  const reload = () => setVersion((n) => n + 1);
  useEffect(() => { setComment(""); }, [selected]);
  useEffect(() => {
    const sync = () => reload();
    window.addEventListener("okk-auth", sync);
    return () => window.removeEventListener("okk-auth", sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      Promise.all([fetchProposals({ q: query.trim(), status, sort, page: String(page) }), selected ? fetchProposal(selected) : Promise.resolve(null)])
        .then(([list, row]) => { if (!cancelled) { setBoard(list); setDetail(row); } })
        .catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 180 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, status, sort, page, selected, version]);
  function handleError(err) {
    setError(err.message || "操作没有保存，请稍后重试");
    if (err.status === 401) login();
  }
  function needLogin() {
    if (authToken()) return false;
    login(); return true;
  }
  async function support(item) {
    if (needLogin() || inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id); setBusy(item.id); setError("");
    try {
      const updated = await supportProposal(item.id, !item.mine);
      setBoard((current) => current ? { ...current, items: current.items.map((row) => row.id === item.id ? updated : row) } : current);
      setDetail((current) => current?.id === item.id ? { ...current, ...updated } : current);
      setNotice(updated.mine ? "已记下，你也想收录这一站" : "已撤回支持");
      reload();
    } catch (err) { handleError(err); }
    finally { inFlight.current.delete(item.id); setBusy(""); }
  }
  async function submit(event) {
    event.preventDefault();
    if (needLogin() || posting) return;
    setPosting(true); setError(""); setNotice("");
    try {
      const result = await createProposal(form);
      setNotice(result.duplicate ? "这个站点已有提案，已带你进入讨论；可以支持或补充想测的内容。" : "提案已发布，大家现在可以支持和讨论。 ");
      setForm(emptyForm); setParams({ id: result.item.id }); reload();
    } catch (err) { handleError(err); }
    finally { setPosting(false); }
  }
  async function sendComment(event) {
    event.preventDefault();
    if (needLogin() || commenting || !detail) return;
    setCommenting(true); setError("");
    try { setDetail(await commentProposal(detail.id, comment)); setComment(""); setNotice("评论已发布"); }
    catch (err) { handleError(err); }
    finally { setCommenting(false); }
  }
  function filter(next) { setStatus(next); setPage(1); }
  return <main className="wrap proposal-page">
    <header className="proposal-header"><div><p className="proposal-kicker"><DirectoryIcon name="message" />社区共建 · 下一站，由你提名</p><h1>收录提案</h1><p>想看哪家中转站？提名、支持、聊聊想测的内容，一起把下一站选出来。</p></div><button className="proposal-primary" onClick={() => nameInput.current?.focus()}><DirectoryIcon name="plus" />提交提案</button></header>
    <div className="proposal-overview"><span><DirectoryIcon name="layers" /><b>{board?.stats.total ?? "—"}</b>个站点提案</span><span><DirectoryIcon name="message" /><b>{board?.stats.supporters ?? "—"}</b>人参与支持</span><span><DirectoryIcon name="chart" /><b>{board?.stats.done ?? "—"}</b>项已完成</span><small>热度供排期参考，处理进度公开可见</small></div>
    {error ? <div className="proposal-alert" role="alert">{error}<button onClick={reload}>重试</button></div> : null}
    {notice ? <p className="proposal-notice" role="status">{notice}</p> : null}
    <div className="proposal-layout"><section aria-label={selected ? "提案详情与讨论" : "站点提案列表"}>
      {selected ? <Link className="proposal-back" to="/proposals"><DirectoryIcon name="prev" />全部提案</Link> : <>
        <div className="proposal-filters" aria-label="按进度筛选"><button className={!status ? "active" : ""} onClick={() => filter("")}>全部提案</button>{Object.entries(statuses).map(([key, label]) => <button key={key} className={status === key ? "active" : ""} onClick={() => filter(key)}>{label}</button>)}</div>
        <div className="proposal-toolbar"><label><DirectoryIcon name="search" /><input aria-label="搜索提案" placeholder="搜索站点、域名或测试需求" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label><div aria-label="排序">{[["hot", "最多人想看"], ["new", "最新提交"]].map(([key, label]) => <button key={key} aria-pressed={sort === key} onClick={() => { setSort(key); setPage(1); }}>{label}</button>)}</div></div>
      </>}
      {loading ? <div className="proposal-empty" role="status"><DirectoryIcon name="clock" /><h2>正在读取提案</h2><p>看看大家想收录哪些站点。</p></div> : selected && detail ? <>
        <ProposalCard item={detail} detail onSupport={support} busy={busy === detail.id} />
        <section className="proposal-discussion"><h2><DirectoryIcon name="message" />一起聊聊 <small>{detail.commentCount} 条讨论</small></h2><form onSubmit={sendComment}><label htmlFor="proposal-comment">想测哪个模型？最关心稳定性、推理还是画面表现？</label><textarea id="proposal-comment" value={comment} maxLength={1000} required rows={3} placeholder="补充你的需求或使用体验，帮测试更有针对性。" onChange={(e) => setComment(e.target.value)} /><div><small>评论公开展示，请勿填写 Key 或个人联系方式。</small><button className="proposal-primary" disabled={commenting}>{commenting ? "发布中…" : "发表评论"}</button></div></form><div>{detail.comments.length ? detail.comments.map((row) => <article className="proposal-comment" key={row.id}><span className="proposal-avatar">{row.author.slice(0, 1)}</span><div><b>{row.author}</b><time>{date(row.created)}</time><p>{row.content}</p></div></article>) : <p className="proposal-comment-empty">还没有讨论，来补充第一个测试想法吧。</p>}</div></section>
      </> : !selected && board?.items.length ? <><div className="proposal-list">{board.items.map((item) => <ProposalCard key={item.id} item={item} onSupport={support} busy={busy === item.id} />)}</div>{board.pages > 1 ? <nav className="proposal-pagination" aria-label="提案分页"><button disabled={board.page <= 1} onClick={() => setPage(board.page - 1)}>上一页</button><span>第 {board.page} / {board.pages} 页 · 共 {board.total} 条</span><button disabled={board.page >= board.pages} onClick={() => setPage(board.page + 1)}>下一页</button></nav> : null}</> : <div className="proposal-empty"><DirectoryIcon name="plus" /><h2>{error ? "暂时没能读到提案" : selected ? "没有找到这条提案" : query || status ? "没有符合条件的提案" : "下一站，从你的提名开始"}</h2><p>{query || status ? "换个关键词或筛选条件试试。" : "提交站点和想看的测试，大家的支持会帮助我们安排优先顺序。"}</p><button onClick={() => query || status ? (setQuery(""), filter("")) : nameInput.current?.focus()}>{query || status ? "清除筛选" : "写下第一条提案"}<DirectoryIcon name="arrow" /></button></div>}
    </section><aside>
      <form className="proposal-compose" onSubmit={submit}><div className="proposal-compose-title"><span><DirectoryIcon name="plus" /></span><div><h2>你想看哪一站？</h2><p>也可以为已收录的站点补充测试需求</p></div></div>
        <label>站点名称<input ref={nameInput} required maxLength={60} value={form.name} placeholder="例如：某某 API" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>公开网址<input required maxLength={500} value={form.url} placeholder="https://example.com" onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
        <fieldset><legend>希望做什么测试？</legend>{Object.entries(tests).map(([key, label]) => <label key={key}><input type="checkbox" checked={form.tests.includes(key)} onChange={(e) => setForm({ ...form, tests: e.target.checked ? [...form.tests, key] : form.tests.filter((t) => t !== key) })} /><DirectoryIcon name={key === "basic" ? "pulse" : key === "candy" ? "layers" : "image"} />{label}</label>)}</fieldset>
        <label>为什么想收录 / 想重点测什么？<textarea required minLength={2} maxLength={1000} rows={4} value={form.reason} placeholder="介绍一下这个站点，或者想测的模型、使用场景和具体问题。" onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <p className="proposal-compose-hint">同一站点已有提案时，会直接进入原讨论。仅填写公开信息，请勿提交 API Key。</p><button className="proposal-primary" disabled={posting || !form.tests.length}>{posting ? "提交中…" : "提交并公开讨论"}<DirectoryIcon name="arrow" /></button><small>登录后提交、支持和评论，每个账号每站一票。</small>
      </form><div className="proposal-process"><h3>提案之后，会发生什么？</h3>{[["01", "大家一起支持", "想看的站点集中在一起，需求不再散落。"], ["02", "运营评估与排期", "根据热度、公开资料和可测试条件安排。"], ["03", "结果回到这里", "进度更新后，可以直接查看收录页或测试报告。"]].map(([n, title, desc]) => <div key={n}><span>{n}</span><p><b>{title}</b><small>{desc}</small></p></div>)}<Link to="/apply">我是站长，申请正式收录<DirectoryIcon name="arrow" /></Link></div>
    </aside></div>
  </main>;
}
