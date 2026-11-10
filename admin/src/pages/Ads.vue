<template>
  <a-card>
    <div class="toolbar">
      <a-select v-model="slot" placeholder="位置" allow-clear style="width: 160px">
        <a-option v-for="(label, key) in SLOT" :key="key" :value="key">{{ label }}</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-button type="primary" @click="router.push('/ads/new')">新建</a-button>
    </div>
    <p class="muted">全站赞助位是左右下角固定角标（列表页、站点详情页除外），最多 2 条；列表页顶部仅 /list 展示，最多 4 条；全站页脚不限。可单选位置，也可选「列表页加页脚」或「全包」套餐，套餐计入各位置容量。保存后前台自动更新，无需推代码。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #slot="{ record }">{{ SLOT[record.slot] || record.slot }}</template>
      <template #live="{ record }">
        <a-tag v-if="record.live" color="green">在投</a-tag>
        <a-tag v-else-if="record.paused">已停</a-tag>
        <a-tag v-else>未在档期</a-tag>
      </template>
      <template #ops="{ record }">
        <a-button type="text" @click="router.push('/ads/' + record.id)">编辑</a-button>
        <a-button type="text" @click="pause(record)">{{ record.paused ? "恢复" : "停用" }}</a-button>
      </template>
    </a-table>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { SLOT, api } from "../api";

const router = useRouter();
const rows = ref([]);
const loading = ref(false);
const slot = ref("");
const pager = reactive({ total: 0, current: 1, pageSize: 20, showTotal: true });
const columns = [
  { title: "位置", slotName: "slot", width: 140 },
  { title: "名称", dataIndex: "name" },
  { title: "开始", dataIndex: "start_date", width: 120 },
  { title: "到期撤下", dataIndex: "end_date", width: 120 },
  { title: "状态", slotName: "live", width: 110 },
  { title: "浏览", dataIndex: "impressions", width: 80 },
  { title: "点击", dataIndex: "clicks", width: 80 },
  { title: "操作", slotName: "ops", width: 160 },
];

async function load() {
  loading.value = true;
  try {
    const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
    if (slot.value) search.set("slot", slot.value);
    const data = await api("/api/ads?" + search.toString());
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

async function pause(record) {
  try {
    await api("/api/ads/" + record.id, {
      method: "POST",
      body: JSON.stringify({ ...record, paused: !record.paused }),
    });
    Message.success(record.paused ? "已恢复" : "已停用");
    load();
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
