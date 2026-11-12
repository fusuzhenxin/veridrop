<template>
  <main class="ledger-page" :aria-busy="loading">
    <header class="ledger-heading"><div><span class="ledger-eyebrow">广告经营 · 台账</span><h1>{{ id ? '广告订单详情' : renewalSource ? '登记续费订单' : '新建广告订单' }}</h1><p>{{ detail?.order_no || '记录合作内容与约定档期，保存后可登记收款。' }}</p></div><a-button @click="router.push('/ad-orders')">返回订单</a-button></header>
    <div v-if="error" class="ledger-error" role="alert"><span>{{ error }}</span><a-button :disabled="saving" @click="load">重新加载</a-button></div>
    <div class="ledger-notice">保存订单只登记合作，不自动调整投放。续费后可在右侧检查档期，再确认更新关联广告。</div>
    <div v-if="loading" class="ledger-skeleton">正在读取订单…</div>
    <div v-else-if="!error" class="ledger-form-layout">
      <section class="ledger-panel"><div class="ledger-section-heading"><div><h2>合作信息</h2><p>{{ detail?.cancelled ? '订单已取消，收退款记录仍然保留。' : '金额统一使用人民币；到期日当天不计入投放。' }}</p></div><span v-if="detail" class="ledger-badge" :class="detail.payment_status">{{ PAYMENT_STATUS[detail.payment_status] }}</span></div>
        <a-form :model="form" layout="vertical" class="ledger-form-body" :disabled="!!detail?.cancelled || saving">
          <a-form-item label="关联投放广告" extra="可先记订单，之后再关联广告。关联不会修改现有投放。"><a-select v-model="form.ad_id" placeholder="选择已建广告（可选）" allow-clear allow-search :disabled="!!form.renewal_of" @change="selectedAd"><a-option v-for="ad in ads" :key="ad.id" :value="ad.id">#{{ ad.id }} · {{ ad.name }}</a-option></a-select><a-button v-if="form.ad_id && !id && !form.renewal_of" type="text" size="small" @click="useAdSchedule">带入广告位置和档期</a-button></a-form-item>
          <a-form-item label="订单名称" required><a-input v-model="form.title" :max-length="120" show-word-limit placeholder="例如：Sidrune AI 十二月页脚投放" /></a-form-item>
          <div class="ledger-form-grid"><a-form-item label="广告主" required><a-input v-model="form.advertiser" :max-length="100" placeholder="公司、站点或联系人名称" /></a-form-item><a-form-item label="联系方式"><a-input v-model="form.contact" :max-length="200" placeholder="微信、邮箱、Telegram 等" /></a-form-item></div>
          <a-form-item label="购买位置" required><a-select v-model="form.slot" aria-label="购买位置"><a-option v-for="(label, value) in SLOT" :key="value" :value="value">{{ label }}</a-option></a-select></a-form-item>
          <div class="ledger-form-grid"><a-form-item label="开始日（北京时间）" required><a-date-picker v-model="form.start_date" style="width:100%" /></a-form-item><a-form-item label="到期撤下日" required extra="不包含当天。"><a-date-picker v-model="form.end_date" style="width:100%" /></a-form-item></div>
          <a-form-item label="约定金额（人民币 / 元）" required extra="支持免费合作填 0；收款请在保存订单后单独登记。"><a-input v-model="form.amount" aria-label="约定金额" placeholder="填写订单金额，如 100.00" /></a-form-item>
          <a-form-item label="合作备注"><a-textarea v-model="form.notes" :max-length="2000" show-word-limit :auto-size="{minRows:3,maxRows:7}" placeholder="约定内容、付款要求、续费说明等" /></a-form-item>
          <div v-if="!detail?.cancelled" class="ledger-form-actions"><a-button type="primary" :loading="saving" @click="save">{{ id ? '保存修改' : '保存订单' }}</a-button><a-button v-if="detail" @click="renew">登记续费</a-button><a-button v-if="detail" class="ledger-cancel" @click="cancelOpen = true">取消订单</a-button></div>
        </a-form>
      </section>
      <aside class="ledger-side">
        <section class="ledger-panel"><div class="ledger-section-heading"><h2>收款概览</h2><span v-if="detail" class="ledger-badge">{{ ORDER_STATUS[detail.status] }}</span></div><div class="ledger-side-summary"><div><span>订单金额</span><strong>{{ amountText(detail?.amount_cents || 0) }}</strong></div><div><span>累计收款</span><strong>{{ amountText(detail?.received_cents || 0) }}</strong></div><div><span>累计退款</span><strong>{{ amountText(detail?.refunded_cents || 0) }}</strong></div><div><span>净实收</span><strong>{{ amountText(detail?.net_cents || 0) }}</strong></div><div><span>{{ detail?.cancelled ? '取消后待退' : '尚待收款' }}</span><strong class="ledger-amber">{{ amountText(detail?.cancelled ? detail.net_cents : detail?.outstanding_cents || 0) }}</strong></div><div v-if="detail" class="ledger-form-actions"><a-button type="primary" size="small" :disabled="!!detail.cancelled || detail.outstanding_cents <= 0" @click="openPayment('receipt')">登记收款</a-button><a-button size="small" :disabled="detail.net_cents <= 0" @click="openPayment('refund')">登记退款</a-button></div><p v-else class="ledger-small">先保存订单，再登记实际收到或退回的金额。</p>
          <template v-if="form.ad_id"><p class="ledger-small">关联广告 #{{ form.ad_id }} <button class="ledger-link" @click="router.push('/ads/' + form.ad_id)">查看投放 ↗</button></p><div v-if="detail && !detail.delivery_covered" class="ledger-conflict">订单位置或档期与实际广告不同。请核对投放管理中的安排，保存订单不会自动调整广告。</div></template>
        </div></section>
        <AdDeliveryPanel v-if="detail" :order="detail" :before-preview="requireSaved" @updated="applyDetail" />
        <section v-if="detail?.ad_id" class="ledger-panel"><div class="ledger-section-heading"><div><h2>广告效果报告</h2><p>按本订单档期导出，方便发给广告主。</p></div><a-button @click="router.push('/ad-orders/'+id+'/report')">查看报告</a-button></div></section>
        <section v-if="detail" class="ledger-panel"><div class="ledger-section-heading"><h2>收退款记录 <span class="ledger-small">{{ detail.payments.length }} 笔</span></h2></div><div class="ledger-history"><p v-if="!detail.payments.length" class="ledger-small">还没有登记收退款。</p><article v-for="payment in detail.payments" :key="payment.id" class="ledger-payment"><div><span>{{ payment.kind === 'receipt' ? '收款' : '退款' }} · {{ payment.method }}</span><b>{{ payment.kind === 'receipt' ? '+' : '−' }}{{ amountText(payment.amount_cents) }}</b></div><small>{{ payment.paid_on }}{{ payment.reference ? ' · 流水号 ' + payment.reference : '' }}</small><small v-if="payment.note">{{ payment.note }}</small></article></div></section>
        <section v-if="detail?.parent || detail?.renewals?.length || renewalSource" class="ledger-panel"><div class="ledger-section-heading"><h2>续费记录</h2></div><div class="ledger-relation"><button v-if="detail?.parent || renewalSource" class="ledger-link" @click="router.push('/ad-orders/' + (detail?.parent?.id || renewalSource.id))">原订单：{{ detail?.parent?.order_no || renewalSource.order_no }} ↗</button><button v-for="item in detail?.renewals || []" :key="item.id" class="ledger-link" @click="router.push('/ad-orders/' + item.id)">{{ item.order_no }} · {{ item.cancelled ? '已取消' : item.start_date + ' 至 ' + item.end_date }} ↗</button></div></section>
      </aside>
    </div>
    <a-modal width="min(520px, calc(100vw - 32px))" role="dialog" aria-modal="true" :aria-label="payment.kind === 'receipt' ? '登记实际收款' : '登记实际退款'" v-model:visible="paymentOpen" :title="payment.kind === 'receipt' ? '登记实际收款' : '登记实际退款'" :ok-loading="paying" :cancel-button-props="{disabled:paying}" :closable="!paying" :mask-closable="false" :esc-to-close="!paying" @before-ok="submitPayment">
      <p class="ledger-readonly-note">{{ payment.kind === 'receipt' ? `当前最多可收 ${amountText(detail?.outstanding_cents)}` : `当前最多可退 ${amountText(detail?.net_cents)}` }}。这里只记账，请在实际收款或退款后登记。</p>
      <a-form :model="payment" layout="vertical" :disabled="paying"><a-form-item label="金额（元）" required><a-input v-model="payment.amount" aria-label="收退款金额" /></a-form-item><a-form-item label="实际日期" required><a-date-picker v-model="payment.paid_on" style="width:100%" /></a-form-item><a-form-item label="收款 / 退款方式" required><a-select v-model="payment.method" aria-label="收退款方式"><a-option v-for="method in ['微信','支付宝','银行转账','其他']" :key="method" :value="method">{{ method }}</a-option></a-select></a-form-item><a-form-item label="流水号"><a-input v-model="payment.reference" :max-length="120" /></a-form-item><a-form-item label="备注"><a-textarea v-model="payment.note" :max-length="500" /></a-form-item></a-form><p v-if="paymentError" class="ledger-error" role="alert">{{ paymentError }}</p>
    </a-modal>
    <a-modal width="min(520px, calc(100vw - 32px))" role="dialog" aria-modal="true" aria-label="取消广告订单" v-model:visible="cancelOpen" title="取消这笔广告订单？" :ok-loading="cancelling" :mask-closable="false" :closable="!cancelling" :esc-to-close="!cancelling" :cancel-button-props="{disabled:cancelling}" @before-ok="cancelOrder"><p class="ledger-version-error">已有收退款记录会保留，取消后不能再收款或修改合同。{{ detail?.net_cents ? `目前还有 ${amountText(detail.net_cents)} 净实收，取消后可登记退款。` : '' }}</p><p class="ledger-small">此操作不会暂停或撤下关联广告，需要时请另行调整投放。</p><p v-if="cancelError" class="ledger-error" role="alert">{{ cancelError }}</p></a-modal>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { SLOT, api, dayText, todayText } from "../api";
import { ORDER_STATUS, PAYMENT_STATUS, amountText, newRequestKey } from "../ad-order";
import AdDeliveryPanel from "../components/AdDeliveryPanel.vue";
import "../ad-orders.css";
const route = useRoute(), router = useRouter();
const id = computed(() => route.params.id ? String(route.params.id) : "");
const defaults = () => ({ad_id:undefined,advertiser:"",contact:"",title:"",slot:"footer",start_date:todayText(),end_date:"",amount:"",notes:"",renewal_of:null,version:1});
const form = reactive(defaults()), detail = ref(null), renewalSource = ref(null), ads = ref([]);
const loading = ref(false), saving = ref(false), error = ref("");
const paymentOpen = ref(false), paying = ref(false), paymentError = ref("");
const payment = reactive({kind:"receipt",amount:"",paid_on:todayText(),method:"微信",reference:"",note:"",request_key:""});
const cancelOpen = ref(false), cancelling = ref(false), cancelError = ref("");
const savedContract = ref("");
let createKey = newRequestKey(), request = 0, loadedRoute = "";
function contractSignature() { return JSON.stringify({...form,start_date:dayText(form.start_date),end_date:dayText(form.end_date)}); }
function requireSaved() { if (detail.value && savedContract.value !== contractSignature()) { Message.warning("合作信息有未保存修改，请先保存，再登记收款、退款或续费"); return false; } return true; }
function applyDetail(row) { detail.value = row; for (const name of Object.keys(defaults())) if (name in row) form[name] = row[name]; form.ad_id = row.ad_id || undefined; form.amount = (row.amount_cents / 100).toFixed(2); savedContract.value = contractSignature(); }
function routeKey() { return [id.value,route.query.ad_id || "",route.query.renewal_of || ""].join(":"); }
async function load() {
  const current = ++request; loadedRoute = routeKey(); loading.value = true; error.value = "";
  detail.value = null; renewalSource.value = null; Object.assign(form, defaults()); createKey = newRequestKey();
  paymentOpen.value = false; cancelOpen.value = false; paymentError.value = ""; cancelError.value = "";
  try {
    const adRows = []; let page = 1, total = 1;
    while (adRows.length < total) { const data = await api(`/api/ads?page=${page++}&size=100`); if (current !== request) return; adRows.push(...data.items); total = data.total; if (!data.items.length) break; }
    if (current !== request) return; ads.value = adRows;
    if (id.value) { const row = await api("/api/ad-orders/" + id.value); if (current !== request) return; applyDetail(row); }
    else if (route.query.renewal_of) {
      const source = await api("/api/ad-orders/" + encodeURIComponent(String(route.query.renewal_of)));
      if (current !== request) return;
      if (source.cancelled) throw new Error("已取消订单不能续费，请另建订单");
      renewalSource.value = source;
      const end = new Date(source.end_date + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + Math.max(1, Math.round((Date.parse(source.end_date) - Date.parse(source.start_date)) / 86400000)));
      Object.assign(form, {ad_id:source.ad_id || undefined, advertiser:source.advertiser,contact:source.contact,title:source.title.slice(0, 115) + " · 续费",slot:source.slot,start_date:source.end_date,end_date:end.toISOString().slice(0,10),amount:(source.amount_cents/100).toFixed(2),notes:source.notes,renewal_of:source.id});
    } else if (route.query.ad_id) {
      form.ad_id = Number(route.query.ad_id); selectedAd(form.ad_id); useAdSchedule();
    }
    if (current === request && route.query.action === "payment" && detail.value && !detail.value.cancelled && detail.value.outstanding_cents > 0) { await nextTick(); openPayment("receipt"); }
  } catch (err) { if (current === request) error.value = err.message; }
  finally { if (current === request) loading.value = false; }
}
function selectedAd(value) { const ad = ads.value.find(row => row.id === value); if (ad && !form.title) form.title = ad.name + " · 广告投放"; if (ad && !form.advertiser) form.advertiser = ad.name; }
function useAdSchedule() { const ad = ads.value.find(row => row.id === form.ad_id); if (ad) Object.assign(form,{slot:ad.slot,start_date:ad.start_date,end_date:ad.end_date}); }
async function save() {
  if (saving.value || loading.value) return;
  if (!form.title.trim() || !form.advertiser.trim() || !form.start_date || !form.end_date || form.amount === "") { Message.warning("请填写订单名称、广告主、档期和金额"); return; }
  saving.value = true; const path = id.value ? "/api/ad-orders/" + id.value : "/api/ad-orders";
  try {
    const row = await api(path, {method:"POST",body:JSON.stringify({...form,start_date:dayText(form.start_date),end_date:dayText(form.end_date),request_key:createKey})});
    applyDetail(row); Message.success("订单已保存");
    if (!id.value) { await router.replace("/ad-orders/" + row.id); }
  } catch (err) { Message.error(err.message); }
  finally { saving.value = false; }
}
function renew() { if (requireSaved()) router.push({path:"/ad-orders/new",query:{renewal_of:id.value}}); }
function openPayment(kind) { if (!detail.value || paying.value || !requireSaved()) return; paymentError.value = ""; Object.assign(payment,{kind,amount:((kind === "receipt" ? detail.value.outstanding_cents : detail.value.net_cents)/100).toFixed(2),paid_on:todayText(),method:"微信",reference:"",note:"",request_key:newRequestKey()}); paymentOpen.value = true; }
async function submitPayment() {
  if (paying.value) return false;
  paying.value = true; paymentError.value = "";
  try { const row = await api(`/api/ad-orders/${id.value}/payments`, {method:"POST",body:JSON.stringify({...payment,paid_on:dayText(payment.paid_on)})}); applyDetail(row); Message.success(payment.kind === "receipt" ? "收款已记录" : "退款已记录"); return true; }
  catch (err) { paymentError.value = err.message; return false; }
  finally { paying.value = false; }
}
async function cancelOrder() {
  if (cancelling.value) return false;
  cancelling.value = true; cancelError.value = "";
  try { const row = await api(`/api/ad-orders/${id.value}/cancel`,{method:"POST",body:JSON.stringify({version:detail.value.version})}); applyDetail(row); Message.success("订单已取消，关联广告保持原投放安排"); return true; }
  catch (err) { cancelError.value = err.message; return false; }
  finally { cancelling.value = false; }
}
watch(() => routeKey(), () => { if (routeKey() !== loadedRoute) load(); });
onMounted(load);
</script>
