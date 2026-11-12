// UI checks use intercepted API fixtures; no real ads or counters are modified.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const output = process.env.ADS_QA_OUTPUT || 'previews/ads';
const errors = [], queries = [], checks = [], saves = [], toggles = [];
let failList = false, conflict = false, slowCheck = false;
const records = Array.from({ length: 25 }, (_, index) => ({
  id: index + 1, name: ['Sidrune AI', 'Sublyx', '示例到期广告', '示例暂停广告'][index] || `示例广告 ${index + 1}`,
  slot: index === 4 ? 'full' : index === 5 ? 'list_footer' : 'footer', target_url: `https://station-${index + 1}.example/register?aff=KEEP&utm_source=veridrop.cn`,
  blurb: '示例广告内容', description: '', image_url: '', paused: index === 3,
  start_date: index === 1 ? '2026-11-20' : '2026-11-01', end_date: index === 2 ? '2026-11-11' : index === 0 ? '2026-11-14' : '2026-12-01',
  impressions: 1200 + index * 10, clicks: 25 + index, daily: [],
}));
const places = { sponsor: ['sponsor'], list_top: ['list_top'], footer: ['footer'], list_footer: ['list_top', 'footer'], full: ['sponsor', 'list_top', 'footer'] };
const labels = { sponsor: '全站左右角标', list_top: '列表页顶部', footer: '全站页脚' };
function statusOf(row) { return row.paused ? 'paused' : row.end_date <= '2026-11-11' ? 'expired' : row.start_date > '2026-11-11' ? 'scheduled' : 'live'; }
function decorate(row) { const status = statusOf(row); return { ...row, status, live: status === 'live', expiring: status === 'live' && row.end_date <= '2026-11-18', days_remaining: Math.round((Date.parse(row.end_date) - Date.parse('2026-11-11')) / 86400000) }; }
function overview() {
  const all = records.map(decorate), summary = { total: all.length };
  for (const state of ['live', 'scheduled', 'paused', 'expired']) summary[state] = all.filter(row => row.status === state).length;
  summary.expiring = all.filter(row => row.expiring).length;
  return { day: '2026-11-11', summary, expiring: all.filter(row => row.expiring), placements: ['sponsor', 'list_top', 'footer'].map(slot => {
    const used = all.filter(row => row.live && places[row.slot].includes(slot)).length, capacity = { sponsor: 2, list_top: 4, footer: null }[slot];
    return { slot, label: labels[slot], used, capacity, remaining: capacity == null ? null : capacity - used };
  }) };
}
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname === '/api/me') return route.fulfill({ json: { username: 'admin' } });
  if (url.pathname === '/api/ads/availability') {
    const query = Object.fromEntries(url.searchParams); checks.push(query);
    const blocked = conflict;
    if (slowCheck && query.slot === 'full') await new Promise(resolve => setTimeout(resolve, 700));
    return route.fulfill({ json: { slot: query.slot, start: query.start, end: query.end, available: !blocked || query.slot === 'footer', placements: places[query.slot].map(slot => ({ slot, label: labels[slot], capacity: { sponsor: 2, list_top: 4, footer: null }[slot], peak: slot === 'sponsor' && blocked ? 2 : 1, remaining: slot === 'footer' ? null : slot === 'sponsor' && blocked ? 0 : 1, available: !(slot === 'sponsor' && blocked), conflict: slot === 'sponsor' && blocked ? { start: query.start, end: query.end, ads: [{ id: 90, name: '示例占位 A' }, { id: 91, name: '示例占位 B' }] } : null })) } });
  }
  if (url.pathname === '/api/ads') {
    queries.push(Object.fromEntries(url.searchParams));
    if (failList) return route.fulfill({ status: 500, json: { error: '示例加载失败' } });
    let items = records.map(decorate);
    if (url.searchParams.get('slot')) items = items.filter(row => places[url.searchParams.get('slot')]?.length === 1 ? places[row.slot].includes(url.searchParams.get('slot')) : row.slot === url.searchParams.get('slot'));
    if (url.searchParams.get('status')) items = items.filter(row => url.searchParams.get('status') === 'expiring' ? row.expiring : row.status === url.searchParams.get('status'));
    if (url.searchParams.get('q')) items = items.filter(row => (row.name + row.target_url).includes(url.searchParams.get('q')));
    const total = items.length, start = (Number(url.searchParams.get('page') || 1) - 1) * 20;
    return route.fulfill({ json: { items: items.slice(start, start + 20), total, overview: overview() } });
  }
  const match = url.pathname.match(/^\/api\/ads\/(\d+)(\/state)?$/);
  if (match) {
    const row = records.find(row => row.id === Number(match[1]));
    if (request.method() === 'POST') { const body = request.postDataJSON(); (match[2] ? toggles : saves).push(body); Object.assign(row, body); }
    return route.fulfill({ json: decorate(row) });
  }
  return route.fulfill({ json: { paths: [] } });
});
async function settled() { await page.waitForFunction(() => document.querySelector('.ads-workspace')?.getAttribute('aria-busy') === 'false'); }
async function noOverflow() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page-wide overflow'); }
try {
  await mkdir(output, { recursive: true });
  const base = process.env.ADS_ADMIN_URL || 'http://127.0.0.1:5180';
  await page.goto(base + '/ads'); await settled();
  assert.equal(await page.locator('.ads-table tbody tr').count(), 20);
  assert(await page.locator('.ads-table-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'All columns visible on desktop');
  await page.screenshot({ path: output + '/management-desktop.png', fullPage: true });
  await page.locator('.ad-status-strip button').filter({ hasText: '待开始' }).click(); await settled();
  assert.equal(queries.at(-1).status, 'scheduled');
  assert.equal(await page.locator('.ads-table tbody tr').count(), 1);
  await page.getByRole('button', { name: '重置', exact: true }).click(); await settled();
  await page.locator('.ads-table tbody tr').first().getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.ads-table tbody tr .ad-state')?.textContent.includes('已暂停'));
  assert.deepEqual(toggles.at(-1), { paused: true });
  await page.locator('.ads-table tbody tr').first().getByRole('button', { name: '恢复', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.ads-table tbody tr .ad-state')?.textContent.includes('在投'));
  const slot = page.locator('.ads-filter').filter({ hasText: '投放位置' }).locator('.arco-select');
  for (let index = 0; index < 2; index++) {
    await slot.click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('.arco-select-option:visible').count(), 5);
    await page.locator('.arco-select-option:visible').filter({ hasText: '列表页顶部' }).click(); await settled();
    assert.equal(queries.at(-1).slot, 'list_top');
  }
  assert.equal(await page.locator('.ads-table tbody tr').count(), 2, 'Packages included in placement filter');
  await page.getByRole('button', { name: '重置', exact: true }).click(); await settled();
  await page.getByPlaceholder('搜索名称、域名或跳转地址').fill('Sublyx');
  await page.getByRole('button', { name: '查询', exact: true }).click(); await settled();
  assert.equal(queries.at(-1).q, 'Sublyx');
  assert.equal(await page.locator('.ad-name').textContent(), 'Sublyx');
  await page.getByPlaceholder('搜索名称、域名或跳转地址').fill('不存在');
  await page.getByRole('button', { name: '查询', exact: true }).click(); await settled();
  assert(await page.getByText('没有符合条件的广告', { exact: false }).count());
  await page.getByRole('button', { name: '重置', exact: true }).click(); await settled();
  await page.locator('.arco-pagination-item').filter({ hasText: /^2$/ }).click(); await settled();
  assert.equal(queries.at(-1).page, '2');
  assert.equal(await page.locator('.ad-name').count(), 5);
  failList = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click(); await settled();
  assert(await page.locator('.ads-error[role="alert"]').isVisible());
  failList = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click(); await settled();
  await page.getByRole('button', { name: '重置', exact: true }).click(); await settled();
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300); await noOverflow();
    await page.screenshot({ path: output + `/management-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto(base + '/ads/1');
  await page.waitForFunction(() => document.querySelector('.ad-availability')?.textContent.includes('所选档期可投放'));
  assert.equal(checks.at(-1).exclude_id, '1');
  conflict = true;
  await page.getByText('全包 · 全站赞助位 + 列表页顶部 + 全站页脚', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.ad-availability')?.textContent.includes('有位置已满'));
  assert.equal(checks.at(-1).slot, 'full');
  assert(await page.getByText('示例占位 A', { exact: false }).count());
  await page.screenshot({ path: output + '/schedule-conflict.png', fullPage: true });
  await page.getByRole('button', { name: '保存广告', exact: true }).click();
  assert.equal(saves.length, 0, 'Known conflicts blocked before save');
  await page.getByRole('switch').click();
  const savedResponse = page.waitForResponse(response => response.url().includes('/api/ads/1') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存广告', exact: true }).click();
  await savedResponse;
  assert.equal(saves.at(-1).paused, true, 'Paused draft may be saved without reserving a slot');
  // A delayed old response must not overwrite a more recent placement selection.
  slowCheck = true;
  await page.getByText('全站页脚 · 仅各页底部赞助区，不限条数', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.ad-availability')?.textContent.includes('全站页脚'));
  await page.getByText('全包 · 全站赞助位 + 列表页顶部 + 全站页脚', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByText('全站页脚 · 仅各页底部赞助区，不限条数', { exact: true }).click();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.ad-availability-row').count(), 1, 'Old response discarded');
  await noOverflow();
  assert.deepEqual(errors, []);
  console.log('Ad management UI passed: filtering, packages, paging, retry, responsive layout, capacity, paused save, and stale responses.');
} finally { await browser.close(); }
