<template>
  <main class="ledger-page" :aria-busy="loading">
    <header class="ledger-heading"><div><span class="ledger-eyebrow">广告经营 · 台账</span><h1>广告订单</h1><p>每一笔合作，都有清楚的档期和收款记录。</p></div><a-button type="primary" @click="create">＋ 新建订单</a-button></header>
    <div v-if="error" class="ledger-error" role="alert">{{ error }}<a-button size="small" @click="load">重新加载</a-button></div>
    <section v-if="summary" class="ledger-stats" aria-label="广告台账总览"><article><span>有效合同金额</span><strong>{{ amountText(summary.contract_cents) }}</strong><small>全部未取消订单 · 人民币</small></article><article><span>累计净实收</span><strong>{{ amountText(summary.net_cents) }}</strong><small>收款减退款，含已取消订单</small></article><article><span>待收款</span><strong class="ledger-amber">{{ amountText(summary.outstanding_cents) }}</strong><small>未取消订单的未收余额</small></article><article><span>取消订单待退</span><strong>{{ amountText(summary.refund_due_cents) }}</strong><small>{{ summary.orders }} 笔订单 · {{ summary.expiring }} 笔档期 7 天内结束</small></article></section>
    <section class="ledger-panel">
      <div class="ledger-section-heading"><div><h2>合作与收款</h2><p>订单用于记账，实际广告投放状态请在投放管理中查看。</p></div><a-button :loading="loading" @click="load">刷新</a-button></div>
      <form class="ledger-filters" @submit.prevent="search"><div class="ledger-field grow"><span id="order-search-label">订单 / 广告主</span><a-input v-model="query.q" aria-labelledby="order-search-label" placeholder="搜索单号、名称、广告主或联系方式" allow-clear /></div><div class="ledger-field"><span id="order-payment-label">付款情况</span><a-select v-model="query.payment_status" aria-labelledby="order-payment-label" allow-clear placeholder="全部付款状态" @change="search"><a-option v-for="(label, value) in PAYMENT_STATUS" :key="value" :value="value">{{ label }}</a-option></a-select></div><div class="ledger-field"><span id="order-status-label">订单档期</span><a-select v-model="query.status" aria-labelledby="order-status-label" allow-clear placeholder="全部档期状态" @change="search"><a-option v-for="(label, value) in ORDER_STATUS" :key="value" :value="value">{{ label }}</a-option></a-select></div><a-button type="primary" html-type="submit">查询</a-button><a-button @click="reset">重置</a-button></form>
      <div v-if="adId" class="ledger-scope">当前只看广告 #{{ adId }} 的订单 <button type="button" @click="router.push('/ad-orders')">查看全部 ×</button></div>
      <div class="ledger-table-scroll"><table class="ledger-table"><thead><tr><th>订单 / 广告主</th><th>购买位置 / 档期</th><th>订单金额</th><th>净实收 / 待收</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td><button class="ledger-name" :title="row.title" @click="open(row)">{{ row.title }}</button><small>{{ row.order_no }}</small><span class="ledger-advertiser">{{ row.advertiser }}</span><small>{{ row.contact || '未填写联系方式' }}</small></td><td><span>{{ SLOT[row.slot] }}</span><small>{{ row.start_date }} 至 {{ row.end_date }}</small><small>{{ row.ad ? `关联：${row.ad.name}` : '未关联投放广告' }}{{ row.renewal_of ? ' · 续费订单' : '' }}</small></td><td class="ledger-money">{{ amountText(row.amount_cents) }}</td><td class="ledger-money">{{ amountText(row.net_cents) }}<small :class="{ 'ledger-amber': !row.cancelled && row.outstanding_cents }">{{ row.cancelled ? `待退 ${amountText(row.net_cents)}` : `待收 ${amountText(row.outstanding_cents)}` }}</small></td><td><span class="ledger-badge" :class="row.payment_status">{{ PAYMENT_STATUS[row.payment_status] }}</span><small>{{ ORDER_STATUS[row.status] }}</small></td><td><div class="ledger-actions"><button @click="open(row)">详情</button><button v-if="row.ad_id" @click="router.push('/ad-orders/'+row.id+'/report')">报告</button><button v-if="!row.cancelled" @click="open(row, 'payment')">记收款</button><button v-if="!row.cancelled" @click="router.push({path:'/ad-orders/new',query:{renewal_of:row.id}})">续费</button></div></td></tr><tr v-if="!rows.length"><td class="ledger-empty" colspan="6">{{ loading ? '正在加载订单…' : error ? '暂时无法加载，请重试' : '暂无符合条件的广告订单' }}<small v-if="!loading && !error">从「新建订单」开始登记一笔合作。</small></td></tr></tbody></table></div>
      <footer class="ledger-footer"><span>到期日 00:00 不计入档期 · 总览统计全部订单</span><a-pagination :current="page" :total="total" :page-size="20" show-total size="small" @change="changePage" /></footer>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SLOT, api } from "../api";
import { ORDER_STATUS, PAYMENT_STATUS, amountText } from "../ad-order";
import "../ad-orders.css";
const route = useRoute(), router = useRouter();
const adId = computed(() => /^\d+$/.test(String(route.query.ad_id || "")) ? String(route.query.ad_id) : "");
const query = reactive({ q: "", status: "", payment_status: "" });
const rows = ref([]), summary = ref(null), total = ref(0), page = ref(1), loading = ref(false), error = ref("");
let request = 0;
async function load() {
  const current = ++request; loading.value = true; error.value = "";
  try {
    const params = new URLSearchParams({ page: page.value, size: 20 });
    for (const [key, value] of Object.entries(query)) if (value?.trim()) params.set(key, value.trim());
    if (adId.value) params.set("ad_id", adId.value);
    const data = await api("/api/ad-orders?" + params);
    if (current !== request) return;
    rows.value = data.items; summary.value = data.summary; total.value = data.total;
    if (!rows.value.length && page.value > 1 && total.value) { page.value = Math.ceil(total.value / 20); return load(); }
  } catch (err) { if (current === request) { error.value = err.message; rows.value = []; summary.value = null; total.value = 0; } }
  finally { if (current === request) loading.value = false; }
}
function search() { page.value = 1; load(); }
function reset() { Object.assign(query, {q:"",status:"",payment_status:""}); search(); }
function changePage(value) { page.value = value; load(); }
function open(row, action) { router.push({path:"/ad-orders/" + row.id, query:action ? {action} : {}}); }
function create() { router.push({path:"/ad-orders/new",query:adId.value ? {ad_id:adId.value} : {}}); }
watch(adId, search); onMounted(load);
</script>
