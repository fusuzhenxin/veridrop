<template>
  <a-card>
    <div class="toolbar">
      <a-select v-model="status" placeholder="状态" allow-clear style="width: 140px" @change="search">
        <a-option value="open">未处理</a-option>
        <a-option value="ack">已知晓</a-option>
        <a-option value="closed">已关闭</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
    </div>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #status="{ record }">
        <a-tag v-if="record.status === 'open'" color="red">未处理</a-tag>
        <a-tag v-else-if="record.status === 'ack'" color="orange">已知晓</a-tag>
        <a-tag v-else>已关闭</a-tag>
      </template>
      <template #ops="{ record }">
        <a-button v-if="record.station_id" type="text" @click="router.push('/stations/' + record.station_id)">打开站</a-button>
        <a-button v-if="record.status === 'open'" type="text" @click="setStatus(record, 'ack')">知道了</a-button>
        <a-button v-if="record.status !== 'closed'" type="text" @click="setStatus(record, 'closed')">关闭</a-button>
      </template>
    </a-table>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const router = useRouter();
const rows = ref([]);
const loading = ref(false);
const status = ref("open");
const pager = reactive({ total: 0, current: 1, pageSize: 20, showTotal: true });
const columns = [
  { title: "时间", dataIndex: "created_at", width: 220 },
  { title: "类型", dataIndex: "kind", width: 110 },
  { title: "标题", dataIndex: "title" },
  { title: "说明", dataIndex: "body" },
  { title: "状态", slotName: "status", width: 100 },
  { title: "操作", slotName: "ops", width: 220 },
];

async function load() {
  loading.value = true;
  try {
    const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
    if (status.value) search.set("status", status.value);
    const data = await api("/api/alerts?" + search.toString());
    rows.value = data.items;
    pager.total = data.total;
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

function search() {
  pager.current = 1;
  load();
}

function onPage(page) {
  pager.current = page;
  load();
}

async function setStatus(record, next) {
  try {
    await api("/api/alerts/" + record.id, { method: "POST", body: JSON.stringify({ status: next }) });
    load();
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
