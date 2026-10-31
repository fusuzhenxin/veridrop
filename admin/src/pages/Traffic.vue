<template>
  <a-card>
    <div class="toolbar">
      <a-date-picker v-model="day" />
      <a-button type="primary" @click="load">查询</a-button>
      <span class="muted">人 {{ report.human || 0 }}，爬虫 {{ report.bot || 0 }}</span>
    </div>
    <p class="muted">前台页面会把浏览打到 /api/collect。带 bot、spider、curl 这类标识的算爬虫，其余算人。</p>
    <a-table :columns="columns" :data="report.paths || []" :loading="loading" :pagination="false" row-key="path" />
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api, dayText, todayText } from "../api";

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
