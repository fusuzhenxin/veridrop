<template>
  <main class="ledger-page ad-report-page" :aria-busy="loading">
    <header class="report-heading">
      <div><div class="report-eyebrow"><span /> AD PERFORMANCE <i>/</i> 广告效果</div><h1>广告效果报告</h1><p>从曝光到点击，清楚呈现每一处投放表现。</p></div>
      <a-button class="ad-report-controls report-back" @click="router.push('/ad-orders/' + route.params.id)"><template #icon><IconArrowLeft /></template>返回订单</a-button>
    </header>
    <div class="report-toolbar ad-report-controls">
      <div class="report-view"><div class="report-view-top"><span id="report-mode-label">统计口径</span><div class="report-mode-options" role="radiogroup" aria-labelledby="report-mode-label"><button v-for="(label,value) in REPORT_MODES" :key="value" role="radio" :aria-checked="mode===value" :tabindex="mode===value ? 0 : -1" @click="chooseMode(value)" @keydown="modeKey($event,value)"><i />{{ label }}</button></div></div><p>{{ modeNotes[mode] }}</p></div>
      <div class="report-tool-actions"><a-button class="report-tool-refresh" :loading="loading" aria-label="刷新" title="刷新报告" @click="load"><template #icon><IconRefresh /></template></a-button><span class="report-tool-divider"/><a-button class="report-tool-print" aria-label="打印 / 存为 PDF" :disabled="!report || loading" @click="print"><template #icon><IconPrinter /></template>打印 / PDF</a-button><a-dropdown v-model:popup-visible="exportOpen" trigger="click" position="br" content-class="report-export-popup"><a-button class="report-tool-export" type="primary" :disabled="!report || loading" :aria-expanded="exportOpen" aria-haspopup="menu"><template #icon><IconDownload /></template>导出报告<IconDown /></a-button><template #content><div role="menu" aria-label="导出报告格式" @keydown.esc="exportOpen=false"><a-doption role="menuitem" tabindex="0" @click="exportHtml" @keydown.enter="exportHtml"><div class="report-export-option"><span class="report-export-icon"><IconFile /></span><div><b>下载报告（HTML）</b><small>完整报告，可直接发给广告主</small></div><span class="report-format">HTML</span></div></a-doption><a-doption role="menuitem" tabindex="0" @click="exportCsv" @keydown.enter="exportCsv"><div class="report-export-option"><span class="report-export-icon csv"><IconStorage /></span><div><b>导出明细（CSV）</b><small>表格数据，方便核对与分析</small></div><span class="report-format">CSV</span></div></a-doption></div></template></a-dropdown></div>
    </div>
    <div v-if="error" class="report-alert" role="alert"><IconInfoCircle /><span>{{ error }}</span><a-button @click="load">重试</a-button></div>
    <template v-if="report">
      <section class="report-campaign" aria-label="订单投放信息">
        <div class="report-advertiser"><div class="report-avatar">{{ report.order.advertiser.slice(0,1).toUpperCase() }}</div><div><div class="report-campaign-title"><h2>{{ report.order.advertiser }}</h2><span class="report-slot">{{ SLOT[report.order.slot] }}</span></div><p>{{ report.order.title }}</p></div></div>
        <div class="report-contract"><div><IconCalendar /><span>约定档期</span><b>{{ report.order.start_date }}<i>至</i>{{ report.order.end_date }}</b><small>不含到期日 · 北京时间</small></div><div><span class="report-contract-id">{{ report.order.order_no }}</span><span class="report-asof"><i />{{ report.range.through ? '记录截至 ' + report.range.through : '档期尚未开始' }}</span></div></div>
      </section>
      <div v-if="report.overlapping_orders.length" class="report-alert report-warning"><IconInfoCircle /><span>同一广告在该档期有其他订单重叠，事件不能唯一拆到单笔订单。</span></div>
      <section class="report-kpis" aria-label="广告位交付总览">
        <article class="report-kpi kpi-impressions"><div class="report-kpi-label"><span>广告曝光</span><span class="report-kpi-icon"><IconEye /></span></div><strong>{{ format(report.banner.summary.impressions) }}<small>次</small></strong><p><i />订单购买位置 · {{ REPORT_MODES[report.mode] }}</p></article>
        <article class="report-kpi kpi-clicks"><div class="report-kpi-label"><span>广告点击</span><span class="report-kpi-icon"><IconThunderbolt /></span></div><strong>{{ format(report.banner.summary.clicks) }}<small>次</small></strong><p>用户从广告位发起的点击次数</p></article>
        <article class="report-kpi kpi-ctr"><div class="report-kpi-label"><span>点击率</span><span class="report-kpi-icon"><IconBarChart /></span></div><strong>{{ ctrText(report.banner.summary.ctr) }}</strong><p>{{ report.banner.summary.impressions ? '总点击 ÷ 总曝光，按档期汇总' : '暂无曝光记录，暂不计算点击率' }}</p></article>
      </section>
      <div class="report-insights">
        <section class="report-card report-trend-card">
          <div class="report-card-heading"><div><h2>投放趋势</h2><p>看看广告在档期内的每日表现</p></div><div class="report-metric-switch ad-report-controls" aria-label="趋势指标"><button v-for="(label,key) in metrics" :key="key" :class="{active:metric===key}" :aria-pressed="metric===key" @click="metric=key">{{ label }}</button></div></div>
          <ReportTrend :rows="report.banner.daily" :metric="metric" :label="metrics[metric]" />
          <div class="report-chart-caption"><span><i :class="metric" />每日{{ metrics[metric] }}</span><span>仅展示有记录日期，空缺日期不补零</span></div>
        </section>
        <section class="report-card report-source-card">
          <div class="report-card-heading"><div><h2>流量来自哪里</h2><p>各页面的{{ metrics[metric] }}贡献</p></div><span class="report-unit">{{ metrics[metric] }} / 次</span></div>
          <div class="report-page-grid"><article v-for="(row,index) in sourcePages" :key="row.page" :style="{'--source-color':sourceColors[index % sourceColors.length]}"><div class="report-source-label"><span><component :is="pageIcon(row.page)" />{{ row.page_label }}</span><b>{{ format(row[metric]) }}<small>{{ share(row[metric]) }}</small></b></div><div class="report-source-track"><i :style="{width:sourceWidth(row[metric])}" /></div><div class="report-source-meta"><span>{{ format(row.impressions) }} 曝光 <i>·</i> {{ format(row.clicks) }} 点击</span><span>CTR {{ ctrText(row.ctr) }}</span></div></article></div>
          <p v-if="!report.banner.summary.impressions && !report.banner.summary.clicks" class="report-source-note">有记录后，将在这里呈现各页面的贡献。</p>
        </section>
      </div>
      <section class="report-card report-detail-card">
        <div class="report-card-heading"><div><h2>页面与位置明细</h2><p>明确每一次曝光与点击发生在哪里</p></div><span class="report-detail-count">{{ selectedSection.data.locations.length }} 处有记录位置</span></div>
        <div class="report-detail-tabs ad-report-controls" role="tablist" aria-label="明细类型"><button v-for="section in sections" :key="section.key" role="tab" :aria-selected="activeSection===section.key" :id="'report-tab-'+section.key" :aria-controls="'report-panel-'+section.key" @click="activeSection=section.key"><span>{{ section.title }}</span><b>{{ format(section.data.summary.clicks) }} 点击</b></button></div>
        <section v-for="section in sections" v-show="printing || activeSection===section.key" :key="section.key" :id="'report-panel-'+section.key" class="report-section" role="tabpanel" :aria-labelledby="'report-tab-'+section.key">
          <h3 class="report-print-title">{{ section.title }}</h3>
          <div class="report-detail-note"><IconInfoCircle /><span>{{ section.note }}</span><span v-if="section.key==='directory'" class="report-directory-totals">{{ format(section.data.summary.impressions) }} 曝光 · {{ format(section.data.summary.clicks) }} 点击 · CTR {{ ctrText(section.data.summary.ctr) }}</span></div>
          <div v-if="section.data.locations.length" class="report-table-wrap"><table class="report-table"><thead><tr><th>页面 / 具体位置</th><th>页面路径</th><th>曝光次数</th><th>点击次数</th><th>点击率</th><th v-if="section.key==='directory'">详情 / 官网 / 未区分</th></tr></thead><tbody><tr v-for="row in section.data.locations" :key="row.page+row.placement"><td><div class="report-location"><span class="report-location-icon"><component :is="pageIcon(row.page)" /></span><div><b>{{ row.page_label }}</b><small>{{ row.region }}</small></div></div></td><td class="report-path">{{ row.paths.join('、') }}</td><td class="report-number">{{ format(row.impressions) }}</td><td class="report-number">{{ format(row.clicks) }}</td><td><span class="report-ctr-badge" :class="{muted:row.ctr==null}">{{ ctrText(row.ctr) }}</span></td><td v-if="section.key==='directory'" class="report-number">{{ row.detail_clicks }} / {{ row.outbound_clicks }} / {{ row.unclassified_clicks }}</td></tr></tbody></table></div>
          <div v-else class="report-location-empty"><span><IconStorage /></span><div><b>所选口径暂无位置明细</b><p>有记录后，这里会列出页面、广告位置和对应效果。</p></div></div>
          <details v-if="section.data.daily.length" class="report-daily" :open="printing"><summary>查看逐日数字 <span>{{ section.data.daily.length }} 个有记录日期</span></summary><div class="report-daily-scroll"><table class="report-table"><thead><tr><th>日期</th><th>曝光次数</th><th>点击次数</th><th>点击率</th></tr></thead><tbody><tr v-for="row in section.data.daily" :key="row.day"><td>{{ row.day }}</td><td>{{ format(row.impressions) }}</td><td>{{ format(row.clicks) }}</td><td>{{ ctrText(row.ctr) }}</td></tr></tbody></table></div></details>
        </section>
      </section>
      <details class="report-methodology" :open="printing"><summary><span><IconInfoCircle />统计口径与历史数据</span><span>{{ report.unattributed.impressions || report.unattributed.clicks ? '含未分类记录' : '查看说明' }}<IconDown /></span></summary><div class="report-methodology-body"><div class="report-history"><b>历史 / 位置未分类</b><span>{{ format(report.unattributed.impressions) }} 曝光 · {{ format(report.unattributed.clicks) }} 点击</span><small>不计入具体位置交付</small></div><ul><li v-for="note in report.notes" :key="note">{{ note }}</li></ul></div></details>
      <footer class="report-footer"><span>VERIDROP.CN <i>·</i> 广告效果报告</span><span>生成于 {{ generated }} · 北京时间</span></footer>
    </template>
    <div v-else-if="loading" class="report-loading"><IconRefresh spin /><span>正在读取投放效果…</span></div>
  </main>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IconArrowLeft,IconRefresh,IconDownload,IconPrinter,IconCalendar,IconEye,IconThunderbolt,IconBarChart,IconHome,IconStorage,IconThumbUp,IconInfoCircle,IconDown,IconFile } from '@arco-design/web-vue/es/icon';
import ReportTrend from '../components/ReportTrend.vue';
import { SLOT, api } from '../api';
import { REPORT_MODES, ctrText, downloadReport, reportCsv, reportHtml } from '../ad-report-export';
import '../ad-orders.css';
import '../ad-report.css';
const route=useRoute(),router=useRouter(),mode=ref('human'),report=ref(null),loading=ref(false),error=ref(''),printing=ref(false);
const metric=ref('impressions'),activeSection=ref('banner'),metrics={impressions:'曝光',clicks:'点击'},sourceColors=['#627bdf','#4a9e93','#d4a45c','#a28ac3'];
const exportOpen=ref(false),modeNotes={human:'排除已识别 AI、自动化与来源未知事件',all:'包含 AI、自动化和来源未知事件',ai:'仅查看已识别的 AI 访问事件'};
let request=0;
const sections=computed(()=>report.value ? [{key:'banner',title:'广告位交付',note:'仅包含本订单购买位置的广告位事件。',data:report.value.banner},{key:'directory',title:'站内收录入口',note:'站内榜单、卡片等入口的补充数据，单独展示，不计入广告位交付。',data:report.value.directory}] : []);
const selectedSection=computed(()=>sections.value.find(section=>section.key===activeSection.value) || sections.value[0]);
const sourcePages=computed(()=>report.value?.banner.pages.filter(row=>['home','stations','vote'].includes(row.page) || row.impressions || row.clicks) || []);
const generated=computed(()=>report.value ? new Date(report.value.generated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '');
const format=value=>Number(value || 0).toLocaleString('zh-CN');
const pageIcon=page=>({home:IconHome,stations:IconStorage,vote:IconThumbUp}[page] || IconFile);
function sourceWidth(value){const total=report.value?.banner.summary[metric.value] || 0;return total ? (value/total*100).toFixed(1)+'%' : '0%';}
function share(value){return report.value?.banner.summary[metric.value] ? sourceWidth(value) : '—';}
function chooseMode(value){if(mode.value!==value){mode.value=value;load();}}
function modeKey(event,value){const keys=Object.keys(REPORT_MODES),index=keys.indexOf(value);let next;if(event.key==='ArrowRight' || event.key==='ArrowDown')next=keys[(index+1)%keys.length];else if(event.key==='ArrowLeft' || event.key==='ArrowUp')next=keys[(index+keys.length-1)%keys.length];else if(event.key==='Home')next=keys[0];else if(event.key==='End')next=keys.at(-1);if(next){event.preventDefault();chooseMode(next);nextTick(()=>event.target.closest('[role=radiogroup]')?.querySelector('[aria-checked=true]')?.focus());}}
async function load() { const current=++request; loading.value=true; error.value=''; exportOpen.value=false; try { const data=await api(`/api/ad-orders/${route.params.id}/report?mode=${mode.value}`); if(current===request) report.value=data; } catch(err) { if(current===request){error.value=err.message;report.value=null;} } finally {if(current===request)loading.value=false;} }
function exportHtml(){exportOpen.value=false;if(report.value && !loading.value)downloadReport(reportHtml(report.value),report.value.order.order_no+'-广告效果报告.html','text/html;charset=utf-8');}
function exportCsv(){exportOpen.value=false;if(report.value && !loading.value)downloadReport(reportCsv(report.value),report.value.order.order_no+'-广告效果明细.csv','text/csv;charset=utf-8');}
async function print(){exportOpen.value=false;printing.value=true;await nextTick();window.print();printing.value=false;}
const beforePrint=()=>printing.value=true,afterPrint=()=>printing.value=false;
onMounted(()=>{load();window.addEventListener('beforeprint',beforePrint);window.addEventListener('afterprint',afterPrint);});
onBeforeUnmount(()=>{request++;window.removeEventListener('beforeprint',beforePrint);window.removeEventListener('afterprint',afterPrint);});
watch(()=>route.params.id,()=>{activeSection.value='banner';load();});
</script>
