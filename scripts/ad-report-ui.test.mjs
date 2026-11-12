// Report presentation QA uses intercepted fixtures only; no real orders or metrics are written.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const output=process.env.REPORT_QA_OUTPUT || 'previews/ad-report';
const base=process.env.AD_ORDERS_ADMIN_URL || 'http://127.0.0.1:5180';
const ctr=(impressions,clicks)=>impressions?Number((clicks/impressions*100).toFixed(2)):null;
const values=[860,1052,940,1320,1020,1650,1480,1830,1590,2010],clicks=[19,24,18,35,26,48,37,51,41,60];
const daily=values.map((impressions,index)=>({day:'2026-11-'+String(index<4?index+1:index+2).padStart(2,'0'),impressions,clicks:clicks[index],ctr:ctr(impressions,clicks[index])}));
const summary={impressions:values.reduce((a,b)=>a+b,0),clicks:clicks.reduce((a,b)=>a+b,0)};summary.ctr=ctr(summary.impressions,summary.clicks);
const pages=[{page:'home',page_label:'首页',impressions:7150,clicks:196},{page:'stations',page_label:'站点列表',impressions:4480,clicks:111},{page:'vote',page_label:'投票',impressions:summary.impressions-11630,clicks:summary.clicks-307}].map(row=>({...row,ctr:ctr(row.impressions,row.clicks)}));
const banner={summary,pages,daily,locations:pages.map((row,index)=>({...row,placement:['sides','list','footer'][index],region:['赞助角标','顶部广告','页脚广告'][index],paths:[['/','/list','/reputation'][index]],detail_clicks:0,outbound_clicks:row.clicks,unclassified_clicks:0}))};
const directory={summary:{impressions:420,clicks:26,ctr:ctr(420,26)},pages:[{page:'stations',page_label:'站点列表',impressions:420,clicks:26,ctr:ctr(420,26)}],daily:[{day:'2026-11-10',impressions:420,clicks:26,ctr:ctr(420,26)}],locations:[{page:'stations',page_label:'站点列表',region:'站点榜单',paths:['/list'],placement:'directory-visit',impressions:420,clicks:26,ctr:ctr(420,26),detail_clicks:12,outbound_clicks:14,unclassified_clicks:0}]};
const report={order:{id:91,order_no:'AD20261111-DEMO91',advertiser:'示例广告主',title:'示例：十一月广告合作',slot:'full',start_date:'2026-11-01',end_date:'2026-12-01',ad_id:3},ad_name:'示例投放',mode:'human',generated_at:'2026-11-11T09:00:00+00:00',range:{start:'2026-11-01',end_exclusive:'2026-12-01',through:'2026-11-11'},banner,directory,unattributed:{impressions:182,clicks:3,ctr:1.65},overlapping_orders:[],notes:['按订单购买位置和北京时间档期统计，开始日包含，到期日不包含。','广告位交付与站内收录入口单独展示。曝光、点击为事件次数，不代表独立访客或成交。','过滤后流量排除已识别的 AI、自动化及未知事件，不保证全部为真人。']};
function blank(data){return {...data,summary:{impressions:0,clicks:0,ctr:null},pages:pages.map(row=>({...row,impressions:0,clicks:0,ctr:null})),locations:[],daily:[]};}
let fail=false,empty=false;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100},timezoneId:'Asia/Shanghai'});
page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await mkdir(output,{recursive:true});
 await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/me')return route.fulfill({json:{username:'admin'}});
   if(url.pathname.endsWith('/report')){
     if(fail)return route.fulfill({status:500,json:{error:'测试：报告读取失败，请重试'}});
     const mode=url.searchParams.get('mode') || 'human';
     return route.fulfill({json:{...report,mode,banner:empty || mode==='ai'?blank(banner):banner,directory:empty || mode==='ai'?blank(directory):directory}});
   }
   return route.fulfill({json:{}});
 });
 const settled=()=>page.waitForFunction(()=>document.querySelector('.ad-report-page')?.getAttribute('aria-busy')==='false');
 const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Report fits viewport');
 await page.goto(base+'/ad-orders/91/report');await settled();
 assert.equal(await page.locator('.report-chart-plot circle').count(),10);
 assert.equal(await page.locator('.report-chart-plot path[fill="none"]').count(),2,'No line interpolates across an unrecorded date');
 await page.getByRole('button',{name:'2026-11-01，曝光860次',exact:true}).focus();
 await page.getByRole('status').getByText('曝光 860 次',{exact:true}).waitFor();
 await page.getByRole('button',{name:'点击',exact:true}).click();
 assert.equal(await page.locator('.report-metric-switch button[aria-pressed=true]').textContent(),'点击');
 assert.equal(await page.locator('.report-source-label b').first().textContent(),'19654.6%');
 await page.getByRole('button',{name:'2026-11-01，点击19次',exact:true}).focus();
 await page.getByRole('status').getByText('点击 19 次',{exact:true}).waitFor();
 await page.getByRole('tab',{name:/站内收录入口/}).click();
 assert(await page.locator('#report-panel-directory').isVisible());assert(!(await page.locator('#report-panel-banner').isVisible()));
 assert(await page.locator('#report-panel-directory').getByText('12 / 14 / 0',{exact:true}).isVisible());
 await page.getByRole('tab',{name:/广告位交付/}).click();
 await page.getByRole('button',{name:'曝光',exact:true}).click();
 await page.locator('.report-heading h1').click();
 await page.screenshot({path:output+'/populated-desktop.png',fullPage:true});
 await page.evaluate(()=>window.print=()=>{window.__printed=[...document.querySelectorAll('.report-section')].every(el=>getComputedStyle(el).display!=='none') && [...document.querySelectorAll('.report-daily')].every(el=>el.open);});
 await page.getByRole('button',{name:'打印 / 存为 PDF',exact:true}).click();assert(await page.evaluate(()=>window.__printed),'Print includes both data types and daily records');
 await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));await page.emulateMedia({media:'print'});await page.screenshot({path:output+'/print.png',fullPage:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
 for(const width of [1100,760,390]){
   await page.setViewportSize({width,height:1000});await noOverflow();
   assert.equal(await page.getByRole('radio').count(),3);
   for(const button of await page.getByRole('radio').all())assert(await button.isVisible(),'All statistics modes remain directly available');
   assert(await page.locator('.report-mode-options').evaluate(el=>el.scrollWidth<=el.clientWidth),'Mode buttons fit inside the selector');
   const menuVisible=page.getByRole('menu',{name:'导出报告格式'});
   await page.getByRole('button',{name:'导出报告',exact:true}).click();await menuVisible.waitFor();
   assert(await menuVisible.evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth;}),'Export menu fits viewport');
   await page.locator('.report-heading h1').click();await menuVisible.waitFor({state:'hidden'});
   await page.screenshot({path:output+`/populated-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1600,height:1100});
 await page.getByRole('radio',{name:'过滤后流量',exact:true}).focus();await page.keyboard.press('ArrowRight');await settled();
 assert.equal(await page.getByRole('radio',{name:'全部流量',exact:true}).getAttribute('aria-checked'),'true');
 for(const name of ['下载报告（HTML）','导出明细（CSV）']){await page.getByRole('button',{name:'导出报告',exact:true}).click();const downloaded=page.waitForEvent('download');await page.getByRole('menuitem').filter({hasText:name}).click();await downloaded;}
 await page.getByRole('button',{name:'导出报告',exact:true}).click();await page.screenshot({path:output+'/export-menu-desktop.png',fullPage:true});await page.locator('.report-heading h1').click();
 await page.getByRole('radio',{name:'已识别 AI',exact:true}).click();await settled();await page.waitForTimeout(300);
 assert.equal(await page.locator('.report-chart-plot circle').count(),0);assert.equal(await page.locator('.report-source-track i').first().getAttribute('style'),'width: 0%;');
 await page.getByText('投放趋势，等待第一笔记录',{exact:true}).waitFor();
 await page.screenshot({path:output+'/empty-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:1000});await noOverflow();await page.screenshot({path:output+'/empty-mobile.png',fullPage:true});
 fail=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await settled();assert(await page.getByRole('alert').isVisible());
 fail=false;empty=true;await page.getByRole('button',{name:'重试',exact:true}).click();await settled();
 assert(await page.locator('.report-location-empty:visible').count());
 assert.deepEqual(errors,[]);
 console.log('PASS: direct statistics modes, keyboard selection, export menu/downloads, responsive controls, graph gaps/tooltips, attribution, print, empty states and retry.');
}finally{await browser.close();}
