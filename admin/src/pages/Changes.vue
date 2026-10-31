<template>
  <a-card>
    <div class="toolbar">
      <a-date-picker v-model="day" />
      <a-button type="primary" @click="load">查询</a-button>
    </div>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="false" row-key="id">
      <template #kind="{ record }">{{ KIND[record.kind] || record.kind }}</template>
      <template #ops="{ record }">
        <a-button v-if="record.station_id" type="text" @click="router.push('/stations/' + record.station_id)">打开</a-button>
      </template>
    </a-table>
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api, dayText, todayText } from "../api";

const KIND = { up: "恢复", down: "新挂", models: "模型增减", price: "价格", redirect: "域名跳走" };
const router = useRouter();
const day = ref(todayText());
const rows = ref([]);
const loading = ref(false);
const columns = [
  { title: "时间", dataIndex: "created_at", width: 220 },
  { title: "站", dataIndex: "name" },
  { title: "域名", dataIndex: "domain" },
  { title: "变动", slotName: "kind", width: 120 },
  { title: "说明", dataIndex: "detail" },
  { title: "", slotName: "ops", width: 80 },
];

async function load() {
  loading.value = true;
  try {
    const data = await api("/api/changes?day=" + (dayText(day.value) || todayText()));
    rows.value = data.items;
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
