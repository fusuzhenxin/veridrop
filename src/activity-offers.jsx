import { useRef, useState } from "react";
import { Logo } from "./ui.jsx";
import { DirectoryIcon } from "./directory-ui.jsx";
import { stations } from "./data.js";
import { listedStationHref } from "./outbound-links.js";

const stationSites = stations.map(station => station.site);

function expiry(item) {
  if (item.dead) return "已失效";
  if (!item.endsAt) return "长期";
  return String(item.endsAt).slice(0, 10);
}

function Offer({ item, kind, featured, main, Modality }) {
  const free = kind === "free";
  const name = free ? item.model : item.station;
  return (
    <article className={`wa-offer ${featured ? "wa-featured" : "wa-row"}${main ? " wa-main" : ""}${free ? "" : " wa-promo"}${item.dead ? " wa-expired" : ""}`} aria-label={name}>
      <div className="wa-identity">
        <Logo station={{ img: item.logoUrl, name }} />
        <div><span>{free ? item.provider : item.host}</span><small>{item.dead ? "已失效" : free ? "免费 API" : "优惠活动"}</small></div>
        {main ? <span className="wa-spark" aria-hidden="true">✳</span> : null}
      </div>
      <div className="wa-copy">
        <h2>{name}</h2>
        <p>{free ? item.quota : item.activity}</p>
      </div>
      {free ? <div className="wa-context"><b>{item.context || "—"}</b><span>上下文</span></div> : null}
      <div className="wa-conditions">
        {free ? <>
          <span>最大输出 <b>{item.maxOutput || "—"}</b></span>
          <div className="wa-gates">{item.bindCard ? <span><span aria-hidden="true">✓</span>{item.bindCard}</span> : null}{item.network ? <span><span aria-hidden="true">✓</span>{item.network}</span> : null}</div>
        </> : <><span className="wa-label">参与条件</span><p>{item.eligibility}</p></>}
      </div>
      <div className="wa-bottom">
        <div className="wa-footnotes">
          {free ? <div className="modes" aria-label="支持模态">{(item.modality || []).map((name) => <Modality key={name} name={name} />)}</div> : null}
          <span>截止 {expiry(item)}</span>
        </div>
        <a className="wa-visit" href={listedStationHref(item.claimUrl, stationSites)} target="_blank" rel="noreferrer" aria-label={`立即前往 ${name}`}>立即前往 <DirectoryIcon name={main ? "arrow" : "external"} /></a>
      </div>
      {!free ? <div className="wa-details">
        <details><summary>参与步骤</summary><p>{item.steps}</p></details>
        {item.terms ? <details><summary>活动规则</summary><p>{item.terms}</p></details> : null}
      </div> : null}
    </article>
  );
}

export function ActivityOffers({ items, kind, filtered, Modality }) {
  const [page, setPage] = useState(1);
  const sectionRef = useRef(null);
  const pageSize = 13;
  const pageCount = Math.ceil(items.length / pageSize);
  const currentPage = Math.min(page, Math.max(1, pageCount));
  if (!items.length) return <p className="mini">{kind === "free" ? "没有符合条件的免费 API。" : "没有符合条件的优惠活动。"}</p>;
  const start = (currentPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  // Featured offers count toward the first page's 13 items.
  const featured = !filtered && currentPage === 1 ? pageItems.slice(0, 3) : [];
  const remaining = pageItems.slice(featured.length);
  const changePage = (next) => {
    setPage(next);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const keyOf = (item) => `${item.claimUrl}|${item.model || item.station}|${item.activity || ""}`;
  return <section ref={sectionRef} className="wa-offers" aria-label={kind === "free" ? "免费 API 资源" : "优惠活动列表"}>
    {featured.length ? <div className="wa-feature-grid">{featured.map((item, index) => <Offer key={keyOf(item)} item={item} kind={kind} featured main={index === 0} Modality={Modality} />)}</div> : null}
    {remaining.length ? <>
      <div className="wa-more"><h2>{filtered ? "筛选结果" : "继续发现"}</h2><span aria-live="polite">共 {items.length} 项 · 第 {start + 1}–{start + pageItems.length} 项</span></div>
      <div className="wa-list">{remaining.map((item) => <Offer key={keyOf(item)} item={item} kind={kind} Modality={Modality} />)}</div>
    </> : null}
    {pageCount > 1 ? <nav className="wa-pagination" aria-label="福利分页">
      <span className="wa-page-info" aria-live="polite">每页 13 项 · 第 {currentPage} / {pageCount} 页</span>
      <div className="wa-page-buttons">
        <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一页</button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} type="button" aria-label={`第 ${number} 页`} aria-current={number === currentPage ? "page" : undefined} onClick={() => changePage(number)}>{number}</button>)}
        <button type="button" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>下一页</button>
      </div>
    </nav> : null}
  </section>;
}
