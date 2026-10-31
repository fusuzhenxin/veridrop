<template>
  <a-card>
    <div class="toolbar">
      <a-button type="primary" :loading="saving" @click="snapshot">生成快照</a-button>
      <a-button :loading="building" @click="build">构建静态站</a-button>
      <a-button @click="load">刷新</a-button>
    </div>
    <p class="muted">快照只带在投广告、站的开关和今天的变动。不含名次、在线率和延迟。广告链接是 /go/编号，点击先记数再跳走。</p>
    <a-descriptions v-if="summary" :column="4" style="margin-bottom: 16px">
      <a-descriptions-item label="全站赞助">{{ summary.ads?.sponsor || 0 }}</a-descriptions-item>
      <a-descriptions-item label="列表顶部">{{ summary.ads?.listTop || 0 }}</a-descriptions-item>
      <a-descriptions-item label="页脚">{{ summary.ads?.footer || 0 }}</a-descriptions-item>
      <a-descriptions-item label="站">{{ summary.stations || 0 }}</a-descriptions-item>
    </a-descriptions>
    <a-table :columns="columns" :data="rows" :pagination="false" row-key="id" />
  </a-card>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const rows = ref([]);
const summary = ref(null);
const saving = ref(false);
const building = ref(false);
const columns = [
  { title: "时间", dataIndex: "created_at", width: 220 },
  { title: "状态", dataIndex: "status", width: 120 },
  { title: "说明", dataIndex: "message" },
  { title: "完成", dataIndex: "finished_at", width: 220 },
];

async function load() {
  try {
    rows.value = (await api("/api/publish")).items;
    try {
      const snap = await api("/api/publish/snapshot");
      summary.value = {
        ads: {
          sponsor: snap.ads.sponsor.length,
          listTop: snap.ads.listTop.length,
          footer: snap.ads.footer.length,
        },
        stations: snap.stations.length,
      };
    } catch {
      summary.value = null;
    }
  } catch (err) {
    Message.error(err.message);
  }
}

async function snapshot() {
  saving.value = true;
  try {
    const result = await api("/api/publish", { method: "POST", body: "{}" });
    summary.value = { ads: result.ads, stations: result.stations };
    Message.success("快照已写入");
    load();
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function build() {
  building.value = true;
  try {
    await api("/api/publish/build", { method: "POST", body: "{}" });
    Message.success("已开始构建，完成后刷新这张表");
    setTimeout(load, 1500);
  } catch (err) {
    Message.error(err.message);
  } finally {
    building.value = false;
  }
}

onMounted(load);
</script>
