<template>
  <a-card>
    <div class="toolbar">
      <a-statistic title="兑换人数" :value="people" />
      <a-statistic title="兑换次数" :value="count" />
      <a-button @click="load">刷新</a-button>
    </div>
    <p class="muted">人数按邮箱去重。每笔记录保留实际发放的 Key / 兑换码，用户仅能查看自己的兑换信息。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="{ pageSize: 20 }" row-key="rowKey" />
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const rows = ref([]);
const people = ref(0);
const count = ref(0);
const loading = ref(false);
const columns = [
  { title: "邮箱", dataIndex: "email" },
  { title: "奖品", dataIndex: "title" },
  { title: "时间", dataIndex: "at", width: 220 },
  { title: "地址", dataIndex: "url" },
  { title: "Key / 兑换码", dataIndex: "key" },
];

async function load() {
  loading.value = true;
  try {
    const data = await api("/api/redemptions");
    rows.value = (data.rows || []).map((row, index) => ({ ...row, rowKey: `${row.email}-${row.itemId}-${index}` }));
    people.value = data.people || 0;
    count.value = data.count || 0;
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
