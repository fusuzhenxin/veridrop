<template>
  <a-card>
    <a-descriptions v-if="row" :column="2" bordered>
      <a-descriptions-item label="时间">{{ row.created_at }}</a-descriptions-item>
      <a-descriptions-item label="类型">{{ row.kind }}</a-descriptions-item>
      <a-descriptions-item label="结果">{{ row.ok ? "成功" : "失败" }}</a-descriptions-item>
      <a-descriptions-item label="错误类型">{{ row.error_type || "—" }}</a-descriptions-item>
      <a-descriptions-item label="延迟">{{ row.latency_ms ?? "—" }} 毫秒</a-descriptions-item>
      <a-descriptions-item label="模型">{{ row.model || "—" }}</a-descriptions-item>
      <a-descriptions-item label="花费">{{ row.cost }}</a-descriptions-item>
      <a-descriptions-item label="站">
        <a-button v-if="row.station_id" type="text" @click="router.push('/stations/' + row.station_id)">{{ row.station_name || row.domain || row.station_id }}</a-button>
        <span v-else>—</span>
      </a-descriptions-item>
    </a-descriptions>
    <h3>返回内容</h3>
    <pre class="detail">{{ row?.detail }}</pre>
    <a-button @click="router.push('/runs')">返回列表</a-button>
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const route = useRoute();
const router = useRouter();
const row = ref(null);

onMounted(async () => {
  try {
    row.value = await api("/api/runs/" + route.params.id);
  } catch (err) {
    Message.error(err.message);
    router.push("/runs");
  }
});
</script>

<style scoped>
.detail {
  white-space: pre-wrap;
  background: #fff;
  border: 1px solid #e5e6eb;
  padding: 12px;
  max-height: 420px;
  overflow: auto;
}
</style>
