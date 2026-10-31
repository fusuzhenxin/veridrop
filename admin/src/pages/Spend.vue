<template>
  <a-card>
    <div class="toolbar">
      <a-date-picker v-model="start" />
      <span>到</span>
      <a-date-picker v-model="end" />
      <a-button type="primary" @click="load">查询</a-button>
      <span>合计 {{ total }}</span>
    </div>
    <p class="muted">只记基础测试成功时按设置里的单次花费入账。没有 Key 的站不会产生这笔费用。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="false" row-key="key" />
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api, dayText, todayText } from "../api";

const start = ref(todayText());
const end = ref(todayText());
const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const columns = [
  { title: "日期", dataIndex: "day", width: 140 },
  { title: "站", dataIndex: "name" },
  { title: "域名", dataIndex: "domain" },
  { title: "次数", dataIndex: "calls", width: 90 },
  { title: "金额", dataIndex: "amount", width: 120 },
];

async function load() {
  loading.value = true;
  try {
    const from = dayText(start.value) || todayText();
    const to = dayText(end.value) || todayText();
    const data = await api(`/api/spend?start=${from}&end=${to}`);
    rows.value = data.items.map((item, index) => ({ ...item, key: from + index + item.station_id }));
    total.value = data.total;
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
