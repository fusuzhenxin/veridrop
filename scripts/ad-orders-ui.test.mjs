// Run with an isolated temporary ops database, never the real local ledger.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = await mkdtemp(path.join(os.tmpdir(), 'ad-ledger-browser-'));
const boot = path.join(root, 'boot.json'), db = path.join(root, 'ops.sqlite');
const output = process.env.AD_ORDERS_QA_OUTPUT || 'previews/ad-orders';
const base = process.env.AD_ORDERS_ADMIN_URL || 'http://127.0.0.1:5180';
const program = `import json,sys
from pathlib import Path
sys.path.insert(0,'server')
import ops_db,ops_http
ops_db.bootstrap()
server=ops_http.make_server('127.0.0.1',0)
Path(sys.argv[1]).write_text(json.dumps({'port':server.server_address[1]}))
server.serve_forever()
`;
const worker = spawn('python', ['-u', '-c', program, boot], {cwd:process.cwd(),env:{...process.env,OPS_DB:db,OPS_SECRET:'temporary-ad-ledger-secret',OPS_USER:'admin',OPS_PASSWORD:'temporary-ledger-password',OPS_SCHEDULER:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog = '';
worker.stdout.on('data', data => serverLog += data.toString()); worker.stderr.on('data', data => serverLog += data.toString());
let browser;
try {
  let port;
  for (let i=0;i<100;i++) { try { port=JSON.parse(await readFile(boot,'utf8')).port; break; } catch { await new Promise(r=>setTimeout(r,100)); } }
  assert(port, serverLog || 'Temporary backend did not start');
  const endpoint = `http://127.0.0.1:${port}`;
  const login = await fetch(endpoint+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'temporary-ledger-password'})});
  assert.equal(login.status,200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = {'X-Ops':'1','Content-Type':'application/json',Cookie:cookie};
  async function api(route,body) { const response=await fetch(endpoint+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}); const data=await response.json(); assert(response.ok,JSON.stringify(data)); return data; }
  const ad = await api('/api/ads',{name:'浏览器验证广告',slot:'footer',target_url:'https://example.com/register?aff=KEEP',start_date:'2026-11-01',end_date:'2026-12-01'});
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'Asia/Shanghai'});
  page.setDefaultTimeout(10000);
  const pageErrors=[]; page.on('pageerror',error=>pageErrors.push(error.message));
  let failList=false, failPayment=false;
  await page.route('**/api/**', async route => {
    const request=route.request(), url=new URL(request.url());
    if(failList && url.pathname==='/api/ad-orders' && request.method()==='GET') return route.fulfill({status:500,json:{error:'测试：加载失败'}});
    if(failPayment && url.pathname.endsWith('/payments')) return route.fulfill({status:500,json:{error:'测试：暂时无法记录，请重试'}});
    const response=await fetch(endpoint+url.pathname+url.search,{method:request.method(),headers,body:['GET','HEAD'].includes(request.method())?undefined:request.postData()});
    return route.fulfill({status:response.status,contentType:response.headers.get('content-type')||'application/json',body:await response.text()});
  });
  await mkdir(output,{recursive:true});
  async function settled() { await page.waitForFunction(()=>document.querySelector('.ledger-page')?.getAttribute('aria-busy')==='false'); }
  async function noOverflow() { assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No whole-page overflow'); }
  await page.goto(base+'/ad-orders'); await settled();
  assert(await page.getByText('暂无符合条件的广告订单',{exact:false}).count());
  await page.screenshot({path:output+'/empty.png',fullPage:true});
  await page.getByRole('button',{name:'＋ 新建订单',exact:true}).click(); await settled();
  assert(await page.locator('.ledger-form-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Form fields fit inside the panel');
  const fields=page.locator('.ledger-form-body');
  const adSelect=fields.locator('.arco-select').first();
  await adSelect.click(); await page.waitForTimeout(200);
  assert((await page.locator('.arco-select-option:visible').count())>=1);
  await page.locator('.arco-select-option:visible').filter({hasText:'浏览器验证广告'}).click();
  await page.getByRole('button',{name:'带入广告位置和档期',exact:true}).click();
  await page.getByPlaceholder('例如：Sidrune AI 十二月页脚投放').fill('示例：十一月广告合作');
  await page.getByPlaceholder('公司、站点或联系人名称').fill('示例广告主');
  await page.getByPlaceholder('微信、邮箱、Telegram 等').fill('示例联系人');
  await page.getByPlaceholder('填写订单金额，如 100.00').fill('100.10');
  await page.getByRole('button',{name:'保存订单',exact:true}).click();
  await page.waitForURL(/\/ad-orders\/\d+$/); await settled();
  const orderId=Number(new URL(page.url()).pathname.split('/').at(-1));
  let detail=await api('/api/ad-orders/'+orderId);
  assert.equal(detail.ad_id,ad.id); assert.equal(detail.amount_cents,10010);
  await page.getByPlaceholder('约定内容、付款要求、续费说明等').fill('示例：先收定金，再补尾款');
  await page.getByRole('button',{name:'登记收款',exact:true}).click();
  await page.getByText('合作信息有未保存修改，请先保存，再登记收款、退款或续费',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0,'Unsaved contract changes must not be discarded by payment actions');
  const updated=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/ad-orders/'+orderId && response.request().method()==='POST');
  await page.getByRole('button',{name:'保存修改',exact:true}).click(); await updated;
  async function pay(kind, amount) {
    await page.getByRole('button',{name:kind==='receipt'?'登记收款':'登记退款',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.locator('input').first().fill(amount);
    await dialog.getByRole('button',{name:/确 ?定/}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
  }
  failPayment=true;
  await page.getByRole('button',{name:'登记收款',exact:true}).click();
  const paymentDialog=page.getByRole('dialog');
  await paymentDialog.locator('input').first().fill('40.05');
  await paymentDialog.getByRole('button',{name:/确 ?定/}).click();
  await page.getByText('测试：暂时无法记录，请重试',{exact:true}).waitFor();
  assert.equal((await api('/api/ad-orders/'+orderId)).net_cents,0);
  failPayment=false;
  await paymentDialog.getByRole('button',{name:/确 ?定/}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.ledger-payment').length===1);
  await pay('receipt','60.05');
  detail=await api('/api/ad-orders/'+orderId);
  assert.equal(detail.payment_status,'paid'); assert.equal(detail.payments.length,2);
  assert(await page.getByRole('button',{name:'登记收款',exact:true}).isDisabled());
  await page.waitForTimeout(300);
  await page.screenshot({path:output+'/paid-order.png',fullPage:true});
  await page.getByRole('button',{name:'登记续费',exact:true}).click(); await settled();
  assert(new URL(page.url()).searchParams.get('renewal_of'));
  assert.equal(await page.locator('.ledger-form-body .arco-picker input').first().inputValue(),'2026-12-01');
  await page.getByRole('button',{name:'保存订单',exact:true}).click();
  await page.waitForURL(/\/ad-orders\/\d+$/); await settled();
  const renewedId=Number(new URL(page.url()).pathname.split('/').at(-1));
  assert.equal((await api('/api/ad-orders/'+renewedId)).renewal_of,orderId);
  assert.equal((await api('/api/ads/'+ad.id)).end_date,'2026-12-01','Renewal must not change live ad');
  // Calendar exposes unscheduled renewal days without counting them as occupied.
  await page.goto(base+'/ad-calendar'); await settled();
  await page.getByRole('button',{name:'下个月',exact:true}).click(); await settled();
  await page.getByRole('button',{name:'2026-12-01',exact:true}).click();
  await page.locator('.calendar-followup').getByText('示例：十一月广告合作 · 续费',{exact:true}).waitFor();
  assert(!(await api('/api/ads/calendar?month=2026-12')).days[0].placements[2].ad_ids.includes(ad.id));
  await page.screenshot({path:output+'/calendar-pending.png',fullPage:true});
  // Preview is read-only; the final explicit action extends the same ad and preserves content.
  await page.goto(base+'/ad-orders/'+renewedId); await settled();
  await page.getByRole('button',{name:'检查投放安排',exact:true}).click();
  await page.getByRole('button',{name:'确认更新关联广告',exact:true}).waitFor();
  assert.equal((await api('/api/ads/'+ad.id)).end_date,'2026-12-01');
  await page.screenshot({path:output+'/delivery-preview.png',fullPage:true});
  await page.getByRole('button',{name:'确认更新关联广告',exact:true}).click();
  await page.getByText('关联广告已覆盖本订单位置和档期。 保存订单不会自动调整投放。',{exact:true}).waitFor();
  const delivered=await api('/api/ads/'+ad.id);
  assert.equal(delivered.start_date,'2026-11-01'); assert.equal(delivered.end_date,'2026-12-31');
  assert.equal(delivered.target_url,ad.target_url);
  assert.equal((await api('/api/ad-orders/'+renewedId)).payments.length,0);
  assert.equal((await api('/api/ad-orders/'+renewedId)).deliveries.length,1);
  let calendar=await api('/api/ads/calendar?month=2026-12');
  assert(!calendar.days.some(day=>day.pending_order_ids.includes(renewedId)));
  assert(calendar.days.find(day=>day.day==='2026-12-30').placements[2].ad_ids.includes(ad.id));
  assert(!calendar.days.find(day=>day.day==='2026-12-31').placements[2].ad_ids.includes(ad.id));
  // Seed genuine collection events into the isolated database only.
  for(const path of ['/','/list','/reputation']) for(const action of ['impression','click']) {
    const response=await fetch(endpoint+'/api/collect',{method:'POST',headers:{...headers,'User-Agent':'Mozilla/5.0 Chrome/130.0'},body:JSON.stringify({ad_id:ad.id,path,placement:'footer',action,event_id:crypto.randomUUID()})});
    assert(response.ok);
  }
  await fetch(endpoint+'/api/collect',{method:'POST',headers:{...headers,'User-Agent':'Mozilla/5.0 Chrome/130.0'},body:JSON.stringify({kind:'ad',target_url:ad.target_url,path:'/list',surface:'directory',placement:'directory-visit',action:'click',event_id:crypto.randomUUID()})});
  await page.goto(base+'/ad-orders/'+orderId+'/report'); await settled();
  assert.equal((await api('/api/ad-orders/'+orderId+'/report')).banner.summary.impressions,3);
  assert.equal((await api('/api/ad-orders/'+orderId+'/report')).directory.summary.clicks,1);
  assert.equal(await page.locator('.report-page-grid').first().locator('article').count(),3);
  await page.getByText('页脚广告',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('radio').count(),3);
  await page.getByRole('radio',{name:'全部流量',exact:true}).click(); await settled();
  for(const [name,extension] of [['下载报告（HTML）','html'],['导出明细（CSV）','csv']]) {
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出报告',exact:true}).click();
    await page.getByRole('menuitem').filter({hasText:name}).click();
    const download=await downloadPromise;
    assert(download.suggestedFilename().endsWith('.'+extension));
    const content=await readFile(await download.path(),'utf8');
    assert(content.includes('首页') && content.includes('站点列表') && content.includes('投票') && content.includes('页脚广告'));
    assert(!content.includes('示例联系人') && !content.includes('amount_cents'));
  }
  await page.screenshot({path:output+'/report-desktop.png',fullPage:true});
  await page.evaluate(()=>window.print=()=>{ window.__printed=true; });
  await page.getByRole('button',{name:'打印 / 存为 PDF',exact:true}).click();
  assert(await page.evaluate(()=>window.__printed));
  await page.emulateMedia({media:'print'}); await page.screenshot({path:output+'/report-print.png',fullPage:true}); await page.emulateMedia({media:'screen'});
  for(const width of [760,390]) {
    await page.setViewportSize({width,height:1000}); await noOverflow();
    await page.screenshot({path:output+`/report-${width}.png`,fullPage:true});
    await page.goto(base+'/ad-calendar'); await settled(); await noOverflow();
    await page.screenshot({path:output+`/calendar-${width}.png`,fullPage:true});
    await page.goto(base+'/ad-orders/'+orderId+'/report'); await settled();
  }
  await page.setViewportSize({width:1600,height:1050});
  await page.goto(base+'/ad-orders/'+orderId); await settled();
  await page.getByRole('button',{name:'取消订单',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:/确 ?定/}).click();
  await page.waitForFunction(()=>document.querySelector('.ledger-side .ledger-badge')?.textContent==='已取消');
  await pay('refund','100.10');
  detail=await api('/api/ad-orders/'+orderId);
  assert.equal(detail.payment_status,'refunded'); assert.equal(detail.net_cents,0);
  assert.equal((await api('/api/ads/'+ad.id)).paused,0);
  await page.goto(base+'/ad-orders'); await settled();
  await page.getByPlaceholder('搜索单号、名称、广告主或联系方式').fill('续费');
  await page.getByRole('button',{name:'查询',exact:true}).click(); await settled();
  assert.equal(await page.locator('.ledger-table tbody .ledger-name').count(),1);
  await page.getByRole('button',{name:'重置',exact:true}).click(); await settled();
  const filter=page.locator('.ledger-field').filter({hasText:'付款情况'}).locator('.arco-select');
  await filter.click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.arco-select-option:visible').count(),4);
  await page.locator('.arco-select-option:visible').filter({hasText:'未收款'}).click(); await settled();
  assert.equal(await page.locator('.ledger-table tbody .ledger-name').count(),1);
  await page.getByRole('button',{name:'重置',exact:true}).click(); await settled();
  await page.waitForTimeout(300);
  await page.screenshot({path:output+'/ledger-desktop.png',fullPage:true});
  for(const width of [760,390]) { await page.setViewportSize({width,height:1000}); await page.waitForTimeout(200); await noOverflow(); await page.screenshot({path:output+`/ledger-${width}.png`,fullPage:true}); }
  failList=true; await page.getByRole('button',{name:'刷新',exact:true}).click(); await settled();
  assert(await page.locator('.ledger-error').isVisible());
  failList=false; await page.getByRole('button',{name:'重新加载',exact:true}).click(); await settled();
  await page.goto(base+'/ad-orders/'+renewedId); await settled(); await noOverflow();
  assert(await page.locator('.ledger-form-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Mobile fields fit inside the panel');
  await page.screenshot({path:output+'/detail-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'登记收款',exact:true}).click();
  await page.getByRole('dialog').waitFor(); await noOverflow();
  await page.waitForTimeout(300);
  assert(await page.getByRole('dialog').locator('.arco-modal').evaluate(el => { const box=el.getBoundingClientRect(); return box.left>=0 && box.right<=innerWidth; }), 'Payment modal fits phone viewport');
  await page.screenshot({path:output+'/payment-mobile.png'});
  await page.getByRole('dialog').getByRole('button',{name:/取 ?消/}).click();
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: isolated API + browser: ledger, report HTML/CSV/print, page/placement attribution, calendar occupancy and renewal handoff, mobile layouts, dropdowns, retries. Real local data unchanged.');
} catch(error) { if(browser) await browser.contexts()[0]?.pages()[0]?.screenshot({path:output+'/failure.png',fullPage:true}); console.error(serverLog.slice(-1800)); throw error; }
finally { if(browser) await browser.close(); worker.kill(); }
