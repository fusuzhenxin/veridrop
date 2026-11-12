import assert from 'node:assert/strict';
import { ctrText, reportHtml, reportCsv } from '../admin/src/ad-report-export.js';
const data={summary:{impressions:10,clicks:1,ctr:10},pages:[{page_label:'首页',impressions:10,clicks:1,ctr:10}],locations:[{page_label:'首页',region:'页脚广告',paths:['/<script>'],impressions:10,clicks:1,ctr:10,detail_clicks:0,outbound_clicks:1,unclassified_clicks:0}],daily:[{day:'2026-11-10',impressions:10,clicks:1,ctr:10}]};
const report={order:{order_no:'AD-TEST',title:'=HYPERLINK("bad")',advertiser:'<img src=x onerror=alert(1)>',slot:'footer',start_date:'2026-11-01',end_date:'2026-12-01',contact:'DO NOT EXPORT',amount_cents:999},ad_name:'test',mode:'human',generated_at:'2026-11-11T09:00:00+00:00',range:{through:'2026-11-11'},banner:data,directory:data,unattributed:{impressions:0,clicks:0,ctr:null},notes:['<script>alert(1)</script>','+SUM(1,2)']};
assert.equal(ctrText(null),'—'); assert.equal(ctrText(1.65),'1.65%');
const html=reportHtml(report),csv=reportCsv(report);
assert(!html.includes('<img src=x') && !html.includes('<script>alert(1)'));
assert(html.includes('&lt;img') && html.includes('/&lt;script&gt;'));
assert(csv.startsWith('\uFEFF'));assert(csv.includes('"\'=HYPERLINK(""bad"")"'));assert(csv.includes('"\'+SUM(1,2)"'));
for(const result of [html,csv]) {assert(!result.includes('DO NOT EXPORT') && !result.includes('amount_cents')); assert(result.includes('广告位交付') && result.includes('站内收录入口') && result.includes('页脚广告'));}
console.log('PASS: report export escaping, CSV formula safety, weighted CTR formatting and private-field exclusion.');
