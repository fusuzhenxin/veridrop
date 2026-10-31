<template>
  <a-card>
    <a-alert style="margin-bottom: 12px">后台日常操作不改前台页面。站档、探测、广告、收录都只写运营库。</a-alert>
    <div class="toolbar">
      <a-button type="primary" :loading="saving" @click="snapshot">生成快照（不改前台）</a-button>
      <a-button status="warning" :loading="building" @click="askBuild">构建静态站（会改前台）</a-button>
      <a-button @click="load">刷新</a-button>
    </div>
    <p class="muted">生成快照只写入运营数据：在投广告、站的开关和今天的变动。不含名次、在线率和延迟。广告链接是 /go/编号，点击先记数再跳走。前台页面现在不读这份快照。</p>
    <p class="muted">构建静态站会重写前台的 dist 目录。正在打开的开发站不会跟着变。这不是日常操作。</p>
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
import { Message, Modal } from "@arco-design/web-vue";
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

function askBuild() {
  Modal.confirm({
    title: "这会改前台静态文件",
    content: "将重新构建整站，结果写入 dist。站档、广告和探测记录不会因此出现在前台页面上。正在打开的开发站保持原样。确定要构建吗？",
    okText: "构建并改前台",
    cancelText: "取消",
    onOk: build,
  });
}

async function build() {
  building.value = true;
  try {
    await api("/api/publish/build", { method: "POST", body: "{}" });
    Message.success("已开始构建前台静态文件，完成后刷新这张表");
    setTimeout(load, 1500);
  } catch (err) {
    Message.error(err.message);
  } finally {
    building.value = false;
  }
}

onMounted(load);
</script>
