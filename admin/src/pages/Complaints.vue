<template>
  <a-card>
    <div class="toolbar">
      <a-select v-model="status" allow-clear placeholder="状态" style="width: 140px">
        <a-option value="open">未结</a-option>
        <a-option value="closed">已结</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-button type="primary" @click="router.push('/complaints/new')">新建</a-button>
    </div>
    <p class="muted">投诉记在这里。测不通记在探测记录里，两边不混。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #status="{ record }">
        <a-tag :color="record.status === 'open' ? 'red' : 'gray'">{{ record.status === "open" ? "未结" : "已结" }}</a-tag>
      </template>
      <template #ops="{ record }">
        <a-button type="text" @click="router.push('/complaints/' + record.id)">编辑</a-button>
        <a-button v-if="record.status === 'open'" type="text" @click="close(record)">结案</a-button>
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
  { title: "站档", dataIndex: "station_id", width: 80 },
  { title: "网址", dataIndex: "url" },
  { title: "内容", dataIndex: "body" },
  { title: "状态", slotName: "status", width: 90 },
  { title: "操作", slotName: "ops", width: 160 },
];

async function load() {
  loading.value = true;
  try {
    const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
    if (status.value) search.set("status", status.value);
    const data = await api("/api/complaints?" + search.toString());
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

async function close(record) {
  try {
    await api(`/api/complaints/${record.id}/close`, { method: "POST", body: "{}" });
    load();
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
