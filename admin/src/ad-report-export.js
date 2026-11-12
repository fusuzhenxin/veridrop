export const REPORT_MODES = { human: '过滤后流量', all: '全部流量', ai: '已识别 AI' };
const SLOTS = {sponsor:'全站左右角标',list_top:'列表页顶部',footer:'全站页脚',list_footer:'列表页加页脚',full:'全包（三处）'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
export const ctrText = value => value == null ? '—' : Number(value).toFixed(2) + '%';
function table(headers, rows) { return `<table><thead><tr>${headers.map(value=>`<th>${esc(value)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">暂无记录</td></tr>`}</tbody></table>`; }
function section(title, data) {
  return `<section><h2>${esc(title)}</h2><div class="summary"><div><span>曝光次数</span><b>${esc(data.summary.impressions)}</b></div><div><span>点击次数</span><b>${esc(data.summary.clicks)}</b></div><div><span>点击率</span><b>${esc(ctrText(data.summary.ctr))}</b></div></div><h3>页面分布</h3>${table(['页面','曝光','点击','点击率'],data.pages.map(row=>[row.page_label,row.impressions,row.clicks,ctrText(row.ctr)]))}<h3>具体位置</h3>${table(['页面','位置','路径','曝光','点击','点击率','进入详情','跳转官网','未区分点击'],data.locations.map(row=>[row.page_label,row.region,row.paths.join('、'),row.impressions,row.clicks,ctrText(row.ctr),row.detail_clicks,row.outbound_clicks,row.unclassified_clicks]))}<h3>逐日记录</h3>${table(['日期','曝光','点击','点击率'],data.daily.map(row=>[row.day,row.impressions,row.clicks,ctrText(row.ctr)]))}</section>`;
}
export function reportHtml(report) {
  const order=report.order;
  const generated=new Date(report.generated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(order.order_no)} 广告效果报告</title><style>body{font:14px/1.75 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#26354c;background:#f2f5fa;margin:0}main{max-width:1050px;margin:28px auto;padding:40px;background:#fff;border:1px solid #e1e7ef;border-radius:12px}h1{font-size:30px;margin:8px 0}h2{font-size:19px;margin:30px 0 14px}h3{font-size:13px;color:#6f8099;margin:22px 0 10px}.eyebrow,.muted{color:#8290a4;font-size:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:9px 24px;padding:20px 0;border-block:1px solid #e8edf4;margin:22px 0}.summary{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #e2e8f1;border-radius:9px}.summary>div{padding:17px 20px}.summary span{display:block;color:#8290a4;font-size:12px}.summary b{font-size:26px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:10px 9px;border-bottom:1px solid #e5eaf2;overflow-wrap:anywhere}th{color:#75859d;background:#f7f9fc;font-weight:500}ul{padding-left:20px;color:#738198;font-size:12px}button{float:right;border:1px solid #d9e3f2;background:#fff;color:#4c75bd;padding:8px 12px;border-radius:6px;cursor:pointer}.notice{padding:14px;background:#f7f9fd;border:1px solid #e2e8f3;border-radius:8px;color:#6d7f9c;font-size:12px}@media(max-width:650px){main{margin:0;padding:20px;border:0}.meta{grid-template-columns:1fr}.summary>div{padding:12px}.summary b{font-size:22px}table{font-size:10px}th,td{padding:7px 4px}}@media print{@page{size:A4 landscape;margin:12mm}body{background:#fff}main{margin:0;padding:0;border:0;max-width:none}button{display:none}tr{break-inside:avoid}h2,h3{break-after:avoid}thead{display:table-header-group}}</style></head><body><main><button onclick="window.print()">打印 / 另存为 PDF</button><div class="eyebrow">VERIDROP.CN · 广告合作</div><h1>广告效果报告</h1><p>${esc(order.title)}</p><div class="meta"><span>广告主：${esc(order.advertiser)}</span><span>订单号：${esc(order.order_no)}</span><span>广告：${esc(report.ad_name)}</span><span>购买位置：${esc(SLOTS[order.slot])}</span><span>约定档期：${esc(order.start_date)} 至 ${esc(order.end_date)}（不含到期日）</span><span>统计口径：${esc(REPORT_MODES[report.mode])}</span><span>记录截至：${esc(report.range.through || '档期尚未开始')}</span><span>生成时间：${esc(generated)}（北京时间）</span></div><div class="notice">广告位交付与站内收录入口分别列示。历史未分类记录不计入具体位置交付；事件次数不代表独立访客或成交。</div>${section('广告位交付',report.banner)}${section('站内收录入口（补充数据，不计入广告位交付）',report.directory)}<section><h2>历史 / 位置未分类</h2>${table(['曝光','点击','点击率'],[[report.unattributed.impressions,report.unattributed.clicks,ctrText(report.unattributed.ctr)]])}</section><section><h2>统计说明</h2><ul>${report.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></section><footer class="muted">报告由 veridrop.cn 生成 · 数据为截至生成时已记录的事件</footer></main></body></html>`;
}
function csvCell(value) {
  let text=String(value ?? '');
  // Spreadsheet apps must treat user-entered labels as text, never formulas.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function reportCsv(report) {
  const meta=[report.order.order_no,report.order.title,report.order.advertiser,SLOTS[report.order.slot],REPORT_MODES[report.mode],report.order.start_date,report.order.end_date,report.range.through || '尚未开始'];
  const rows=[['订单号','订单名称','广告主','购买位置','口径（北京时间）','开始日','到期日（不含）','记录截至','类别','日期','页面','位置','路径','曝光次数','点击次数','点击率（%）','进入详情','跳转官网','未区分点击','说明']];
  const add=(type,row={},note='')=>rows.push([...meta,type,row.day || '',row.page_label || '',row.region || '',(row.paths || []).join('、'),row.impressions ?? '',row.clicks ?? '',row.ctr ?? '',row.detail_clicks ?? '',row.outbound_clicks ?? '',row.unclassified_clicks ?? '',note]);
  for(const [name,data] of [['广告位交付',report.banner],['站内收录入口（补充）',report.directory]]) {
    add(name+'汇总',data.summary);
    for(const row of data.pages) add(name+'页面',row);
    for(const row of data.locations) add(name+'位置',row);
    for(const row of data.daily) add(name+'逐日',row);
  }
  add('历史 / 位置未分类',report.unattributed);
  for(const note of report.notes) add('统计说明',{},note);
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function downloadReport(content, filename, type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement('a'); anchor.href=url; anchor.download=filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
