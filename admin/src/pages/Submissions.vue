<template>
  <a-card>
    <div class="toolbar">
      <a-select v-model="status" placeholder="状态" allow-clear style="width: 140px">
        <a-option value="pending">待审</a-option>
        <a-option value="approved">已通过</a-option>
        <a-option value="rejected">已拒绝</a-option>
      </a-select>
      <a-select v-model="source" placeholder="来源" allow-clear style="width: 140px">
        <a-option v-for="(label, key) in SOURCE" :key="key" :value="key">{{ label }}</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-button type="primary" @click="router.push('/submissions/new')">新建</a-button>
      <a-button :loading="syncing" @click="sync">同步主站申请</a-button>
    </div>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #source="{ record }">{{ SOURCE[record.source] || record.source }}</template>
      <template #status="{ record }">
        <a-tag v-if="record.status === 'pending'" color="orange">待审</a-tag>
        <a-tag v-else-if="record.status === 'approved'" color="green">已通过</a-tag>
        <a-tag v-else>已拒绝</a-tag>
      </template>
      <template #ops="{ record }">
        <a-button type="text" @click="router.push('/submissions/' + record.id)">处理</a-button>
      </template>
    </a-table>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { SOURCE, api } from "../api";

const router = useRouter();
const rows = ref([]);
const loading = ref(false);
const syncing = ref(false);
const status = ref("pending");
const source = ref("");
const pager = reactive({ total: 0, current: 1, pageSize: 20, showTotal: true });
const columns = [
  { title: "时间", dataIndex: "created_at", width: 220 },
  { title: "来源", slotName: "source", width: 100 },
  { title: "名称", dataIndex: "site_name" },
  { title: "网址", dataIndex: "url" },
  { title: "联系", dataIndex: "contact", width: 180 },
  { title: "状态", slotName: "status", width: 100 },
  { title: "", slotName: "ops", width: 80 },
];

async function load() {
  loading.value = true;
  try {
    const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
    if (status.value) search.set("status", status.value);
    if (source.value) search.set("source", source.value);
    const data = await api("/api/submissions?" + search.toString());
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

async function sync() {
  syncing.value = true;
  try {
    const result = await api("/api/submissions/sync", { method: "POST", body: "{}" });
    Message.success(`新同步 ${result.added} 条`);
    load();
  } catch (err) {
    Message.error(err.message);
  } finally {
    syncing.value = false;
  }
}

onMounted(load);
</script>
