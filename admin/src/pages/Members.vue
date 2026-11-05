<template>
  <a-card>
    <div class="toolbar">
      <a-statistic title="注册人数" :value="count" />
      <a-button @click="load">刷新</a-button>
    </div>
    <p class="muted">只在后台显示。没有注册时间的是这页上线前的账户。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="{ pageSize: 20 }" row-key="email" />
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const rows = ref([]);
const count = ref(0);
const loading = ref(false);
const columns = [
  { title: "邮箱", dataIndex: "email" },
  { title: "昵称", dataIndex: "nick", width: 160 },
  { title: "注册时间", dataIndex: "created", width: 220 },
  { title: "当前积分", dataIndex: "points", width: 120 },
];

async function load() {
  loading.value = true;
  try {
    const data = await api("/api/members");
    rows.value = data.rows || [];
    count.value = data.count || 0;
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
