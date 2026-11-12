// Run against the local admin dev server. All API responses are isolated fixtures.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation's index.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [], queries = [];
let failReport = false, fixtureMode = 'populated';
const output = process.env.TRAFFIC_QA_OUTPUT || 'previews/traffic';
const stats = (impressions, clicks) => ({ impressions, clicks, ctr: impressions ? clicks / impressions * 100 : null });
function report(query) {
  const empty = fixtureMode === 'empty';
  const definitions = [['home', '首页', 1200, 51], ['stations', '站点列表', 800, 38], ['vote', '投票', 400, 15], ['detail', '站点详情', 0, 0], ['models', '模型', 0, 0], ['search', '搜索', 0, 0], ['other', '其他页面', 0, 0], ['unknown', '历史 / 来源未知', 182, 3]];
  const all = query.get('mode') === 'all';
  const pages = definitions.map(([page, page_label, impressions, clicks]) => ({ page, page_label, ...stats(empty ? all && page === 'unknown' ? 182 : 0 : page === 'unknown' && !all ? 0 : impressions, empty ? all && page === 'unknown' ? 3 : 0 : page === 'unknown' && !all ? 0 : clicks) }));
  const selected = pages.filter(row => !query.get('page') || row.page === query.get('page'));
  const summary = stats(selected.reduce((sum, row) => sum + row.impressions, 0), selected.reduce((sum, row) => sum + row.clicks, 0));
  const locations = selected.filter(row => row.impressions).map(row => ({ ...row, region: { home: '推荐站点', stations: '站点榜单', vote: '口碑榜', unknown: '来源未记录' }[row.page], surface: row.page === 'unknown' ? 'banner' : 'directory', detail_clicks: row.page === 'unknown' ? 0 : row.clicks - 2, outbound_clicks: row.page === 'unknown' ? 0 : 2, unclassified_clicks: row.page === 'unknown' ? row.clicks : 0, paths: [{ home: '/', stations: '/list', vote: '/reputation', unknown: '/' }[row.page]] }));
  const start = query.get('start'), end = query.get('end');
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const daily = Array.from({ length: days }, (_, index) => ({ day: new Date(Date.parse(start) + index * 86400000).toISOString().slice(0, 10), ...stats(index === days - 1 ? summary.impressions : 0, index === days - 1 ? summary.clicks : 0) }));
  return { start, end, summary, pages, locations, daily, unknown: stats(182, 3), excluded: stats(0, 0), audiences: [{ audience: 'human', reason: 'not-identified-as-automation', ...stats(empty ? 0 : 2400, empty ? 0 : 104) }, { audience: 'legacy', reason: 'historical-unclassified', ...stats(182, 3) }] };
}
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/ads/analytics') {
    queries.push(Object.fromEntries(url.searchParams));
    if (failReport) return route.fulfill({ status: 500, json: { error: '测试连接中断' } });
    return route.fulfill({ json: report(url.searchParams) });
  }
  const body = url.pathname === '/api/me' ? { username: 'admin' } : url.pathname === '/api/ads' ? { items: [{ id: 1, name: 'Sidrune AI' }, { id: 2, name: 'Sublyx' }], total: 2 } : { paths: [] };
  await route.fulfill({ json: body });
});
async function settled() { await page.waitForFunction(() => document.querySelector('.traffic-analysis')?.getAttribute('aria-busy') === 'false'); }
async function checkOverflow() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page-wide horizontal overflow'); }
try {
  await mkdir(output, { recursive: true });
  await page.goto((process.env.TRAFFIC_ADMIN_URL || 'http://127.0.0.1:5180') + '/traffic');
  await settled();
  // Regression: wrapping these widgets in a native label sends a second click and closes the popup.
  const surface = page.locator('.filter-field').filter({ hasText: '展示类型' }).locator('.arco-select');
  for (let index = 0; index < 3; index++) {
    await surface.click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.arco-select-option:visible').count(), 3, 'Display dropdown stays open');
    await page.getByText(index % 2 ? '仅站内收录入口' : '仅广告位', { exact: true }).last().click();
    await settled();
    assert.equal(queries.at(-1).surface, index % 2 ? 'directory' : 'banner');
  }
  await surface.click();
  await page.getByText('广告 + 站内收录', { exact: true }).last().click();
  await settled();
  const ad = page.locator('.filter-field').filter({ hasText: '广告中转站' }).locator('.arco-select');
  await ad.click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.arco-select-option:visible').count(), 2, 'Searchable ad dropdown stays open');
  await page.locator('.arco-select-option:visible').filter({ hasText: 'Sidrune AI' }).click();
  await settled();
  assert.equal(queries.at(-1).ad_id, '1');
  assert(new URL(page.url()).searchParams.get('ad_id') === '1');
  const date = page.locator('.filter-field .arco-picker');
  await date.click();
  await page.waitForTimeout(250);
  assert(await page.locator('.arco-picker-range-panel-wrapper:visible').count(), 'Date range popup stays open');
  await page.keyboard.press('Escape');
  await page.locator('h1').click();
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await settled();
  assert.equal(Math.round((Date.parse(queries.at(-1).end) - Date.parse(queries.at(-1).start)) / 86400000), 6);
  await page.getByRole('button', { name: '近 30 天', exact: true }).click();
  await settled();
  await page.locator('.page-tiles button').last().click();
  await settled();
  assert.equal(queries.at(-1).page, 'vote');
  await page.getByRole('button', { name: '查看全部页面 ×' }).click();
  await settled();
  await page.screenshot({ path: output + '/desktop.png', fullPage: true });
  assert(await page.locator('.trend-panel .panel-footer').evaluate(el=>el.getBoundingClientRect().height<65), 'Collapsed daily footer stays compact');
  await page.getByRole('button', { name: '逐日明细' }).click();
  assert.equal(await page.locator('.daily-table tbody tr').first().locator('td').first().textContent(), queries.at(-1).end);
  const dailyHeight = await page.locator('.daily-table-scroll').evaluate(el => el.getBoundingClientRect().height);
  assert(dailyHeight <= 256, 'Daily records scroll inside a bounded panel');
  const rightHeight = await page.locator('.audience-panel').evaluate(el => el.getBoundingClientRect().height);
  assert(rightHeight < 400, 'Audience panel does not stretch with the daily details');
  await page.getByText('仅显示有数据的日期', { exact: true }).click();
  assert.equal(await page.locator('.daily-table tbody tr').count(), 1);
  await page.getByRole('button', { name: '识别规则', exact: true }).click();
  assert(await page.locator('#traffic-rules').isVisible());
  await page.getByRole('button', { name: /统计口径/ }).click();
  assert.equal(await page.locator('.method-grid article').count(), 4);
  await page.screenshot({ path: output + '/details.png', fullPage: true });
  await checkOverflow();
  await page.setViewportSize({ width: 760, height: 1000 });
  await checkOverflow();
  await page.screenshot({ path: output + '/tablet.png', fullPage: true });
  // Collapse admin sidebar using its actual UI control if necessary on narrow layouts.
  await page.setViewportSize({ width: 390, height: 844 });
  await checkOverflow();
  await page.screenshot({ path: output + '/mobile.png', fullPage: true });
  fixtureMode = 'empty';
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.getByRole('button', { name: '刷新数据' }).click();
  await settled();
  assert(await page.getByText('暂无曝光记录', { exact: true }).isVisible());
  await page.screenshot({ path: output + '/empty.png', fullPage: true });
  failReport = true;
  await page.getByRole('button', { name: '刷新数据' }).click();
  await settled();
  assert(await page.getByText('测试连接中断', { exact: false }).isVisible());
  assert.equal(await page.locator('.daily-table .daily-empty').textContent(), '数据未加载，请重试');
  failReport = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await settled();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: repeated dropdown selection, ad/date/page filters, bounded daily details, empty/error/retry and responsive layout.');
  console.log('Screenshots:', output);
} finally { await browser.close(); }
