import { Link } from "react-router-dom";

export function ReportLoading({ error = "", title = "正在加载检测结果", description = "正在读取历史记录和报告内容，请稍候。" }) {
  return (
    <section className="wrap report-loading" role="status" aria-live="polite" aria-busy={!error}>
      <span className="report-loading-label">检测报告</span>
      <div className="report-loading-heading">
        <span className={error ? "report-loading-icon error" : "report-loading-icon"} aria-hidden="true">
          {error ? "!" : <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
        </span>
        <div><h1>{error ? "检测结果暂时没有加载成功" : title}</h1><p>{error || description}</p></div>
      </div>
      {error ? <div className="report-loading-actions"><button type="button" onClick={() => window.location.reload()}>重新加载</button><Link to="/history">返回检测历史</Link></div> : <div className="report-loading-skeleton" aria-hidden="true">
        <div className="report-loading-kpis">{[0, 1, 2, 3].map((item) => <div key={item}><i /><b /></div>)}</div>
        <div className="report-loading-lines"><i /><i /><i /></div>
      </div>}
    </section>
  );
}
