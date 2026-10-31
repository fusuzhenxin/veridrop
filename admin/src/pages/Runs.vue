<template>
  <a-card>
    <div class="toolbar">
      <a-input v-model="query.station_id" placeholder="站档编号" allow-clear style="width: 140px" />
      <a-select v-model="query.kind" placeholder="类型" allow-clear style="width: 140px">
        <a-option value="ping">首页</a-option>
        <a-option value="status">状态页</a-option>
        <a-option value="models">模型</a-option>
        <a-option value="basic">基础测试</a-option>
        <a-option value="cert">证书</a-option>
        <a-option value="site">自有站点</a-option>
      </a-select>
      <a-select v-model="query.ok" placeholder="结果" allow-clear style="width: 120px">
        <a-option value="1">成功</a-option>
        <a-option value="0">失败</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-button @click="runDue">跑到期任务</a-button>
      <span v-if="batch" class="muted">{{ batch.status }} {{ batch.done }}/{{ batch.total }} {{ batch.message }}</span>
    </div>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #ok="{ record }">
        <a-tag :color="record.ok ? 'green' : 'red'">{{ record.ok ? "成功" : "失败" }}</a-tag>
      </template>
      <template #ops="{ record }">
        <a-button type="text" @click="router.push('/runs/' + record.id)">查看</a-button>
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
const batch = ref(null);
const query = reactive({ station_id: "", kind: "", ok: "" });
const pager = reactive({ total: 0, current: 1, pageSize: 20, showTotal: true });
const columns = [
  { title: "时间", dataIndex: "created_at", width: 220 },
  { title: "站", dataIndex: "station_id", width: 80 },
  { title: "类型", dataIndex: "kind", width: 100 },
  { title: "结果", slotName: "ok", width: 90 },
  { title: "延迟毫秒", dataIndex: "latency_ms", width: 110 },
  { title: "模型", dataIndex: "model" },
  { title: "花费", dataIndex: "cost", width: 90 },
  { title: "错误", dataIndex: "error_type", width: 110 },
  { title: "", slotName: "ops", width: 80 },
];

async function load() {
  loading.value = true;
  try {
    const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
    if (query.station_id) search.set("station_id", query.station_id);
    if (query.kind) search.set("kind", query.kind);
    if (query.ok) search.set("ok", query.ok);
    const data = await api("/api/runs?" + search.toString());
    rows.value = data.items;
    pager.total = data.total;
    batch.value = (await api("/api/jobs/status")).batch;
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

async function runDue() {
  try {
    await api("/api/jobs/run", { method: "POST", body: "{}" });
    Message.success("已开始");
    setTimeout(load, 1200);
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
