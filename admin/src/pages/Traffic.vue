<template>
  <div class="traffic-workspace">
    <nav class="traffic-tabs" aria-label="流量视图"><button :class="{active: tab === 'ads'}" @click="tab = 'ads'">广告中转站流量</button><button :class="{active: tab === 'visits'}" @click="tab = 'visits'">全站访问</button></nav>
    <AdAnalytics v-if="tab === 'ads'" />
  <a-card v-else title="全站访问明细">
    <div class="toolbar">
      <a-date-picker v-model="day" />
      <a-button type="primary" @click="load">查询</a-button>
      <span class="muted">人 {{ report.human || 0 }}，爬虫 {{ report.bot || 0 }}</span>
    </div>
    <p class="muted">前台页面会把浏览打到 /api/collect。与广告统计共用 AI / 爬虫识别规则，排除 GPTBot、ChatGPT-User、Claude、Perplexity 等已知代理、通用爬虫和缺失 User-Agent。其余为未识别自动化的访问，不代表真人认证。</p>
    <a-table :columns="columns" :data="report.paths || []" :loading="loading" :pagination="false" row-key="path" />
  </a-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api, dayText, todayText } from "../api";
import AdAnalytics from "../components/AdAnalytics.vue";
const tab = ref("ads");

const day = ref(todayText());
const loading = ref(false);
const report = ref({ paths: [] });
const columns = [
  { title: "路径", dataIndex: "path" },
  { title: "人", dataIndex: "human", width: 100 },
  { title: "爬虫", dataIndex: "bot", width: 100 },
  { title: "合计", dataIndex: "views", width: 100 },
];

async function load() {
  loading.value = true;
  try {
    const text = dayText(day.value) || todayText();
    report.value = await api("/api/traffic?day=" + text);
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.traffic-workspace{max-width:1380px;margin:0 auto;padding:4px 8px 28px}.traffic-tabs{display:flex;gap:26px;border-bottom:1px solid #dfe5ed;margin-bottom:24px}.traffic-tabs button{appearance:none;border:0;border-bottom:2px solid transparent;background:none;padding:12px 0 15px;color:#69778c;font-size:14px;cursor:pointer}.traffic-tabs button.active{color:#3468d4;border-bottom-color:#3468d4;font-weight:600}
</style>
