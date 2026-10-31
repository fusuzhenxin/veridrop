<template>
  <div>
    <div class="toolbar">
      <a-button type="primary" :loading="running" @click="runDue">跑到期任务</a-button>
      <a-button @click="load">刷新</a-button>
      <span v-if="batch" class="muted">最近任务：{{ batch.status }} {{ batch.done }}/{{ batch.total }} {{ batch.message }}</span>
    </div>
    <a-row :gutter="16">
      <a-col v-for="item in cards" :key="item.label" :span="6">
        <a-card class="stat-card" :bordered="true">
          <a-statistic v-if="typeof item.value === 'number'" :title="item.label" :value="item.value" />
          <div v-else>
            <div class="muted">{{ item.label }}</div>
            <div class="stat-text">{{ item.value }}</div>
          </div>
        </a-card>
      </a-col>
    </a-row>
    <a-card title="未关闭告警" class="section-gap">
      <a-table :columns="alertColumns" :data="data.alertsPreview || []" :pagination="false" row-key="id">
        <template #ops="{ record }">
          <a-button type="text" @click="router.push('/alerts')">去处理</a-button>
          <span class="muted">{{ record.title }}</span>
        </template>
      </a-table>
      <a-empty v-if="!(data.alertsPreview || []).length" />
    </a-card>
    <a-card title="今天的变动" class="section-gap">
      <a-table :columns="changeColumns" :data="data.changesPreview || []" :pagination="false" row-key="id" />
    </a-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const router = useRouter();
const data = ref({});
const running = ref(false);
const batch = computed(() => data.value.batch);
const cards = computed(() => [
  { label: "站档", value: data.value.stations || 0 },
  { label: "测不通", value: data.value.down || 0 },
  { label: "未关闭告警", value: data.value.alerts || 0 },
  { label: "待审收录", value: data.value.pending || 0 },
  { label: "未结投诉", value: data.value.complaints || 0 },
  { label: "在投广告", value: data.value.liveAds || 0 },
  { label: "今日探测花费", value: data.value.spendToday || 0 },
  { label: "今日人 / 爬虫", value: `${data.value.humanToday || 0} / ${data.value.botToday || 0}` },
]);
const alertColumns = [
  { title: "类型", dataIndex: "kind", width: 100 },
  { title: "内容", slotName: "ops" },
  { title: "时间", dataIndex: "created_at", width: 220 },
];
const changeColumns = [
  { title: "站", dataIndex: "name" },
  { title: "域名", dataIndex: "domain" },
  { title: "类型", dataIndex: "kind", width: 120 },
  { title: "说明", dataIndex: "detail" },
];

async function load() {
  data.value = await api("/api/dashboard");
}

async function runDue() {
  running.value = true;
  try {
    await api("/api/jobs/run", { method: "POST", body: "{}" });
    Message.success("已开始跑到期任务");
    setTimeout(load, 1200);
  } catch (err) {
    Message.error(err.message);
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>
