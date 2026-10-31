<template>
  <a-card>
    <div class="toolbar">
      <a-input v-model="q" placeholder="域名或模板" allow-clear style="width: 200px" @press-enter="search" />
      <a-select v-model="kind" placeholder="类型" allow-clear style="width: 140px">
        <a-option value="external">外链站</a-option>
        <a-option value="replica">仿站</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-button type="primary" @click="router.push('/sites/new')">新建</a-button>
      <a-button @click="checkAll">检查全部</a-button>
    </div>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #kind="{ record }">{{ record.kind === "replica" ? "仿站" : "外链站" }}</template>
      <template #up="{ record }">
        <a-tag v-if="record.last_up === 1" color="green">开</a-tag>
        <a-tag v-else-if="record.last_up === 0" color="red">打不开</a-tag>
        <span v-else class="muted">未查</span>
      </template>
      <template #ops="{ record }">
        <a-button type="text" @click="router.push('/sites/' + record.id)">编辑</a-button>
        <a-button type="text" :loading="busy === record.id" @click="check(record)">检查</a-button>
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
const busy = ref(0);
const q = ref("");
const kind = ref("");
const pager = reactive({ total: 0, current: 1, pageSize: 20, showTotal: true });
const columns = [
  { title: "域名", dataIndex: "domain" },
  { title: "类型", slotName: "kind", width: 100 },
  { title: "模板", dataIndex: "template" },
  { title: "上次发布", dataIndex: "last_published_at", width: 180 },
  { title: "证书到期", dataIndex: "cert_not_after", width: 180 },
  { title: "状态", slotName: "up", width: 100 },
  { title: "操作", slotName: "ops", width: 160 },
];

async function load() {
  loading.value = true;
  try {
    const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
    if (q.value) search.set("q", q.value);
    if (kind.value) search.set("kind", kind.value);
    const data = await api("/api/sites?" + search.toString());
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

async function check(record) {
  busy.value = record.id;
  try {
    await api(`/api/sites/${record.id}/check`, { method: "POST", body: "{}" });
    Message.success("检查完成");
    load();
  } catch (err) {
    Message.error(err.message);
  } finally {
    busy.value = 0;
  }
}

async function checkAll() {
  try {
    await api("/api/sites/check", { method: "POST", body: "{}" });
    Message.success("已开始检查");
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
