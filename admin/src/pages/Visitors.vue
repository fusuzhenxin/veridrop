<template>
  <div>
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6"><a-card><a-statistic title="打开" :value="data.open || 0" /></a-card></a-col>
      <a-col :span="6"><a-card><a-statistic title="有操作" :value="data.acted || 0" /></a-card></a-col>
      <a-col :span="6"><a-card><a-statistic title="广告点击" :value="data.ad || 0" /></a-card></a-col>
      <a-col :span="6"><a-card><a-statistic title="aruhub 点击" :value="data.hub || 0" /></a-card></a-col>
    </a-row>
    <a-card>
      <div class="toolbar">
        <span class="muted">近 30 天，上海时间。同一人、同一位置、同一天只记一次。</span>
        <a-button @click="load">刷新</a-button>
      </div>
      <a-table :columns="columns" :data="rows" :loading="loading" :pagination="false" :scroll="{ x: 1600 }" row-key="date" />
    </a-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const data = ref({});
const rows = ref([]);
const columns = ref([{ title: "日期", dataIndex: "date", width: 120, fixed: "left" }]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const payload = await api("/api/visitors");
    data.value = payload;
    const head = [
      { title: "日期", dataIndex: "date", width: 120, fixed: "left" },
      { title: "打开", dataIndex: "open", width: 80 },
      { title: "有操作", dataIndex: "acted", width: 90 },
      { title: "广告点击", dataIndex: "ad", width: 100 },
    ];
    for (const [key, label] of Object.entries(payload.adPlaces || {})) head.push({ title: label, dataIndex: `ad_${key}`, width: 100 });
    for (const [key, label] of Object.entries(payload.kinds || {})) head.push({ title: label, dataIndex: `k_${key}`, width: 90 });
    for (const [key, label] of Object.entries(payload.hubPlaces || {})) head.push({ title: label, dataIndex: `h_${key}`, width: 120 });
    columns.value = head;
    rows.value = (payload.rows || []).map((row) => {
      const flat = { date: row.date, open: row.open, acted: row.acted, ad: row.ad };
      for (const key of Object.keys(payload.adPlaces || {})) flat[`ad_${key}`] = row.adPlaces?.[key] || 0;
      for (const key of Object.keys(payload.kinds || {})) flat[`k_${key}`] = row.kinds?.[key] || 0;
      for (const key of Object.keys(payload.hubPlaces || {})) flat[`h_${key}`] = row.hub?.[key] || 0;
      return flat;
    });
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
