<template>
  <div class="ads-workspace" :aria-busy="loading">
    <header class="ads-heading"><div><span class="ads-eyebrow">广告经营</span><h1>投放管理</h1><p>查看档期、安排广告位，跟进每一条投放。</p></div><a-space><a-button @click="router.push('/ad-calendar')">排期日历</a-button><a-button type="primary" @click="router.push('/ads/new')">＋ 新建广告</a-button></a-space></header>
    <div v-if="error" class="ads-error" role="alert"><span>{{ error }}</span><a-button size="small" @click="load">重新加载</a-button></div>
    <template v-if="overview">
      <section class="ad-status-strip" aria-label="全部广告状态">
        <button v-for="state in states" :key="state.key" type="button" :class="{ selected: status === state.key }" :aria-pressed="status === state.key" @click="selectStatus(state.key)"><span><i :class="state.key" />{{ state.label }}</span><strong>{{ overview.summary[state.key] }}</strong><small>{{ state.note }}</small></button>
      </section>
      <section aria-label="今日广告位余量">
        <div class="ads-section-heading"><h2>广告位余量</h2><span>{{ overview.day }} · 北京时间 · 含套餐占位</span></div>
        <div class="ad-placement-grid"><button v-for="item in overview.placements" :key="item.slot" type="button" :aria-pressed="slot === item.slot" :class="{ selected: slot === item.slot }" @click="selectSlot(item.slot)"><div><strong>{{ item.label }}</strong><span :class="{ full: item.remaining === 0 }">{{ item.capacity == null ? '不限名额' : item.remaining ? `剩余 ${item.remaining} 位` : '今日已满' }}</span></div><p><b>{{ item.used }}</b><span>{{ item.capacity == null ? '条在投' : `/ ${item.capacity} 位在投` }}</span></p><div class="ad-capacity-track"><i :style="{ width: item.capacity == null ? '0%' : `${Math.min(100, item.used / item.capacity * 100)}%` }" /></div><small>{{ placementNotes[item.slot] }}</small></button></div>
      </section>
      <aside v-if="overview.expiring.length" class="ads-expiry"><div><strong>近期到期</strong><span>{{ overview.summary.expiring }} 条在投广告将在 7 天内撤下</span></div><div class="expiry-ad-list"><button v-for="item in overview.expiring.slice(0, 3)" :key="item.id" type="button" @click="router.push('/ads/' + item.id)">{{ item.name }}<span>{{ item.end_date }} 撤下 ↗</span></button></div><button class="expiry-all" type="button" @click="selectStatus('expiring', true)">查看全部 →</button></aside>
    </template>
    <section class="ads-list-panel" aria-label="广告列表">
      <div class="ads-section-heading"><div><h2>广告列表 <span v-if="overview" class="ads-total">共 {{ overview.summary.total }} 条</span></h2><p>累计曝光、点击为广告位原始计数；分页面、位置与过滤后的效果请点击「数据」。</p></div><a-button :loading="loading" @click="load">刷新</a-button></div>
      <form class="ads-filters" @submit.prevent="search">
        <div class="ads-filter ads-search"><span id="ad-search-label">广告名称或链接</span><a-input v-model="keyword" aria-labelledby="ad-search-label" allow-clear placeholder="搜索名称、域名或跳转地址" /></div>
        <div class="ads-filter"><span id="ad-slot-label">投放位置</span><a-select v-model="slot" aria-labelledby="ad-slot-label" placeholder="全部位置" allow-clear @change="search"><a-option v-for="(label, key) in SLOT" :key="key" :value="key">{{ label }}</a-option></a-select></div>
        <div class="ads-filter"><span id="ad-state-label">投放状态</span><a-select v-model="status" aria-labelledby="ad-state-label" placeholder="全部状态" allow-clear @change="search"><a-option v-for="state in states" :key="state.key" :value="state.key">{{ state.label }}</a-option></a-select></div>
        <a-button html-type="submit" type="primary">查询</a-button><a-button @click="reset">重置</a-button>
      </form>
      <div v-if="slot" class="ads-filter-note">{{ SLOT[slot] }}{{ ['sponsor', 'list_top', 'footer'].includes(slot) ? ' · 包含投放到此位置的套餐广告' : '' }}</div>
      <div class="ads-scroll-hint">左右滑动表格，查看档期、状态和数据 →</div>
      <div class="ads-table-scroll"><table class="ads-table"><thead><tr><th>广告</th><th>投放位置</th><th>投放档期</th><th>状态</th><th class="number">累计曝光 / 点击</th><th>操作</th></tr></thead><tbody>
        <tr v-for="record in rows" :key="record.id">
          <td><div class="ad-identity"><div class="ad-avatar"><img v-if="record.image_url && !failedImages[record.id]" :src="record.image_url" alt="" @error="failedImages[record.id] = true" /><span v-else>{{ record.name.slice(0, 1) }}</span></div><div><button class="ad-name" type="button" @click="router.push('/ads/' + record.id)">{{ record.name }}</button><small>#{{ record.id }} · {{ hostOf(record.target_url) }}</small></div></div></td>
          <td><span class="ad-placement-label">{{ SLOT[record.slot] || record.slot }}</span><small class="ad-cell-note">{{ positionCounts[record.slot] }} 个展示位置</small></td>
          <td class="ad-schedule"><span>{{ record.start_date }}</span><small>至 {{ record.end_date }} 00:00 撤下</small></td>
          <td><span class="ad-state" :class="record.status"><i />{{ stateLabel(record.status) }}</span><small v-if="record.expiring" class="ad-expiring-note">{{ record.days_remaining }} 天后撤下</small></td>
          <td class="number"><div class="ad-metrics"><b>{{ format(record.impressions) }}</b><span>/</span><b>{{ format(record.clicks) }}</b></div><small class="ad-cell-note">点击率 {{ record.impressions ? (record.clicks / record.impressions * 100).toFixed(2) + '%' : '—' }}</small></td>
          <td><div class="ad-actions"><button type="button" @click="viewAnalytics(record)">数据</button><button type="button" @click="router.push('/ads/' + record.id)">编辑</button><button type="button" @click="router.push({ path: '/ad-orders', query: { ad_id: record.id } })">订单</button><button type="button" :disabled="busy[record.id]" @click="pause(record)">{{ busy[record.id] ? '处理中…' : record.paused ? '恢复' : '暂停' }}</button></div></td>
        </tr>
        <tr v-if="!rows.length"><td colspan="6" class="ads-empty">{{ loading ? '正在加载广告…' : error ? '广告暂时无法加载，请重试' : '没有符合条件的广告' }}<small v-if="!loading && !error">试试其他名称、位置或投放状态。</small></td></tr>
      </tbody></table></div>
      <div class="ads-list-footer"><span>到期日不计入投放，届时自动撤下。</span><a-pagination :total="pager.total" :current="pager.current" :page-size="20" show-total size="small" @change="onPage" /></div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { SLOT, api } from "../api";
const router = useRouter();
const rows = ref([]), overview = ref(null), error = ref(""), loading = ref(false);
const slot = ref(""), status = ref(""), keyword = ref("");
const pager = reactive({ total: 0, current: 1 }), busy = reactive({}), failedImages = reactive({});
const states = [{ key: "live", label: "在投", note: "当前正在展示" }, { key: "scheduled", label: "待开始", note: "已安排后续档期" }, { key: "expiring", label: "即将到期", note: "7 天内到期的在投广告" }, { key: "paused", label: "已暂停", note: "暂停期间不展示" }, { key: "expired", label: "已到期", note: "档期结束自动撤下" }];
const placementNotes = { sponsor: "电脑左右下角 · 手机导航下方；列表及详情页除外", list_top: "仅站点列表页 · 标题和筛选之间", footer: "所有页面 · 正文结束后的赞助区" };
const positionCounts = { sponsor: 1, list_top: 1, footer: 1, list_footer: 2, full: 3 };
let request = 0;
const format = value => Number(value || 0).toLocaleString("zh-CN");
function hostOf(url) { try { return new URL(url).host; } catch { return "跳转地址待检查"; } }
function stateLabel(value) { return states.find(item => item.key === value)?.label || "状态未知"; }
function viewAnalytics(record) { router.push({ path: "/traffic", query: { ad_id: String(record.id) } }); }
async function load() {
  const current = ++request;
  loading.value = true; error.value = "";
  try {
    const query = new URLSearchParams({ page: pager.current, size: 20 });
    if (slot.value) query.set("slot", slot.value);
    if (status.value) query.set("status", status.value);
    if (keyword.value.trim()) query.set("q", keyword.value.trim());
    const data = await api("/api/ads?" + query);
    if (current !== request) return;
    rows.value = data.items; pager.total = data.total; overview.value = data.overview;
    if (!rows.value.length && pager.current > 1 && pager.total) { pager.current = Math.ceil(pager.total / 20); return load(); }
  } catch (err) { if (current === request) { error.value = err.message; rows.value = []; overview.value = null; pager.total = 0; } }
  finally { if (current === request) loading.value = false; }
}
function search() { pager.current = 1; load(); }
function reset() { slot.value = ""; status.value = ""; keyword.value = ""; search(); }
function onPage(page) { pager.current = page; load(); }
function selectStatus(value, force = false) { status.value = force || status.value !== value ? value : ""; if (force) { slot.value = ""; keyword.value = ""; } search(); }
function selectSlot(value) { slot.value = slot.value === value ? "" : value; search(); }
async function pause(record) {
  if (busy[record.id]) return;
  busy[record.id] = true;
  try { await api("/api/ads/" + record.id + "/state", { method: "POST", body: JSON.stringify({ paused: !record.paused }) }); Message.success(record.paused ? "已恢复，按档期展示" : "已暂停"); await load(); }
  catch (err) { Message.error(err.message); }
  finally { busy[record.id] = false; }
}
onMounted(load);
</script>

<style scoped>
.ads-scroll-hint{display:none}.ads-table th{box-sizing:border-box}.ads-table th:last-child{width:18%}
.ads-workspace{max-width:1380px;margin:0 auto;padding:20px 24px 36px;color:#182230;font-size:13px}
.ads-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.ads-eyebrow{font-size:11px;letter-spacing:2px;color:#7c8798}.ads-heading h1{font-size:28px;letter-spacing:-.7px;margin:8px 0}.ads-heading p{color:#748091;margin:0;line-height:1.7}
.ad-status-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid #e2e7ee;border-radius:12px;background:#fff;overflow:hidden;margin-bottom:26px}.ad-status-strip button{border:0;border-right:1px solid #edf0f4;background:transparent;text-align:left;padding:20px 22px;cursor:pointer;color:inherit}.ad-status-strip button:last-child{border-right:0}.ad-status-strip button.selected{background:#f0f5ff;box-shadow:inset 0 -3px #3969db}.ad-status-strip button>span{display:flex;align-items:center;gap:8px;color:#5a6678}.ad-status-strip strong{display:block;font-size:30px;font-weight:650;margin:10px 0 5px;font-variant-numeric:tabular-nums}.ad-status-strip small{color:#909aab;font-size:11px}.ad-status-strip i,.ad-state i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#a3acbb}.ad-status-strip i.live,.ad-state.live i{background:#269777}.ad-status-strip i.scheduled,.ad-state.scheduled i{background:#5682db}.ad-status-strip i.expiring{background:#d89a36}
.ads-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.ads-section-heading h2{margin:0;font-size:15px;font-weight:650}.ads-section-heading>span{font-size:11px;color:#8a95a5}.ads-section-heading p{font-size:12px;line-height:1.7;color:#8390a2;margin:8px 0 0}
.ad-placement-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:24px}.ad-placement-grid button{font:inherit;color:inherit;padding:18px 20px;border:1px solid #e2e7ee;background:#fff;border-radius:10px;text-align:left;cursor:pointer}.ad-placement-grid button.selected{border-color:#7398ed;box-shadow:0 0 0 1px #7398ed}.ad-placement-grid button>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:8px}.ad-placement-grid strong{font-weight:600}.ad-placement-grid button>div>span{font-size:11px;color:#30866f;background:#eff8f4;padding:3px 7px;border-radius:4px}.ad-placement-grid button>div>span.full{color:#a5762d;background:#fff6e7}.ad-placement-grid p{display:flex;align-items:baseline;gap:6px;margin:17px 0 13px}.ad-placement-grid b{font-size:25px;font-weight:650}.ad-placement-grid p>span{color:#8a95a5;font-size:12px}.ad-capacity-track{height:4px;border-radius:4px;background:#edf0f5;overflow:hidden;margin-bottom:12px}.ad-capacity-track i{display:block;height:100%;background:#6689cd;border-radius:inherit}.ad-placement-grid small{font-size:11px;color:#8a95a5;line-height:1.7}
.ads-expiry{display:flex;align-items:center;gap:22px;border:1px solid #eedfc4;background:#fffcf6;border-radius:10px;padding:15px 18px;margin-bottom:24px}.ads-expiry>div:first-child{display:grid;gap:5px;flex-shrink:0}.ads-expiry strong{font-size:12px;color:#9d711f}.ads-expiry>div:first-child>span{font-size:11px;color:#a08e72}.expiry-ad-list{display:flex;flex:1;gap:20px;min-width:0}.expiry-ad-list button{border:0;background:transparent;font:inherit;cursor:pointer;color:#655840;text-align:left;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.expiry-ad-list span{display:block;font-size:11px;color:#a08e72;margin-top:5px}.expiry-all{white-space:nowrap;border:0;background:transparent;font:inherit;color:#9d711f;cursor:pointer}
.ads-list-panel{border:1px solid #e2e7ee;border-radius:12px;background:#fff;overflow:hidden}.ads-list-panel>.ads-section-heading{padding:22px 22px 0}.ads-total{font-size:11px;font-weight:400;color:#909bad;margin-left:8px}.ads-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:3px 22px 20px}.ads-filter{display:grid;gap:7px;min-width:150px;flex:0 1 180px}.ads-filter>span{font-size:11px;color:#68768a}.ads-search{flex:1 1 240px;max-width:360px}.ads-filter-note{padding:0 22px 14px;color:#6f809b;font-size:11px}.ads-table-scroll{overflow:auto}.ads-table{width:100%;min-width:1050px;border-collapse:collapse;table-layout:fixed}.ads-table th{font-size:11px;font-weight:500;color:#8290a4;background:#f8fafc;padding:13px 16px;text-align:left;border-block:1px solid #edf0f4}.ads-table th:first-child{width:25%;padding-left:22px}.ads-table th:nth-child(2){width:13%}.ads-table th:nth-child(3){width:18%}.ads-table th:nth-child(4){width:11%}.ads-table th:nth-child(5){width:15%}.ads-table td{padding:20px 16px;border-bottom:1px solid #edf0f4;vertical-align:middle;font-size:12px}.ads-table td:first-child{padding-left:22px}.ads-table .number{text-align:right}
.ad-identity{display:flex;align-items:center;gap:11px;min-width:0}.ad-avatar{width:38px;height:38px;flex-shrink:0;display:grid;place-items:center;border-radius:9px;background:#f1f4fa;font-weight:600;color:#6a80a3;overflow:hidden}.ad-avatar img{width:100%;height:100%;object-fit:contain}.ad-identity>div:last-child{min-width:0}.ad-name{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:transparent;font:inherit;font-weight:600;color:#24324a;cursor:pointer}.ad-identity small{display:block;margin-top:6px;font-size:10px;color:#929caf;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ad-cell-note,.ad-schedule small{display:block;margin-top:7px;color:#929caf;font-size:10px;font-variant-numeric:tabular-nums}.ad-placement-label{color:#586b85}.ad-schedule>span{font-variant-numeric:tabular-nums}.ad-state{display:inline-flex;align-items:center;gap:6px;background:#f4f5f7;padding:4px 8px;border-radius:5px;color:#8590a0;white-space:nowrap;font-size:11px}.ad-state.live{background:#eef8f3;color:#328369}.ad-state.scheduled{background:#eff4fd;color:#5878b6}.ad-expiring-note{display:block;font-size:10px;color:#b88c3d;margin-top:7px}.ad-metrics{display:flex;justify-content:flex-end;align-items:center;gap:8px;font-variant-numeric:tabular-nums}.ad-metrics b{font-weight:550}.ad-metrics>span{color:#ced4df}.ad-actions{display:flex;gap:11px;white-space:nowrap}.ad-actions button{padding:0;background:none;border:0;color:#4776cb;font:inherit;cursor:pointer}.ad-actions button:disabled{color:#a0aaba;cursor:wait}.ads-empty{text-align:center!important;color:#8390a2;height:125px}.ads-empty small{display:block;color:#a4aebb;font-size:11px;margin-top:10px}.ads-list-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:16px 22px}.ads-list-footer>span{color:#929caf;font-size:11px}.ads-error{display:flex;align-items:center;justify-content:space-between;border:1px solid #efd6d6;border-radius:8px;padding:12px 16px;margin-bottom:18px;color:#b45050;background:#fff8f8}button:focus-visible{outline:2px solid #4c7cde;outline-offset:-2px}
@media(max-width:1100px){.ads-workspace{padding:16px 8px}.ad-status-strip button{padding:17px 14px}.ad-status-strip small{font-size:10px}.ad-placement-grid button{padding:15px}.ads-expiry{flex-wrap:wrap;gap:12px}.expiry-ad-list{flex-basis:60%}}
@media(max-width:1100px){.ads-scroll-hint{display:block;padding:0 16px 12px;font-size:10px;color:#8b98aa}}
@media(max-width:700px){.ads-heading h1{font-size:24px}.ads-heading{align-items:flex-start}.ad-status-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.ad-status-strip button{border-bottom:1px solid #edf0f4}.ad-status-strip button:nth-child(3){border-right:0}.ad-status-strip strong{font-size:26px}.ad-status-strip small{display:none}.ad-placement-grid{grid-template-columns:1fr;gap:9px}.ads-section-heading>span{max-width:150px;text-align:right;line-height:1.6}.ads-expiry{display:block}.expiry-ad-list{margin:12px 0;flex-wrap:wrap}.ads-filters{padding:0 16px 16px}.ads-filter{flex:1 1 110px;min-width:0}.ads-search{flex-basis:100%;max-width:none}.ads-list-panel>.ads-section-heading{padding:18px 16px 0}.ads-list-footer{flex-direction:column;align-items:flex-start;padding:14px 16px}.ad-placement-grid p{margin-top:12px}}
</style>
