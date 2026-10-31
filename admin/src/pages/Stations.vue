<template>
  <a-card>
    <div class="toolbar">
      <a-input v-model="query.q" placeholder="名称或域名" allow-clear style="width: 200px" @press-enter="search" />
      <a-select v-model="query.mode" placeholder="状态来源" allow-clear style="width: 160px">
        <a-option v-for="(label, key) in MODE" :key="key" :value="key">{{ label }}</a-option>
      </a-select>
      <a-select v-model="query.tier" placeholder="探测频率" allow-clear style="width: 160px">
        <a-option v-for="(label, key) in TIER" :key="key" :value="key">{{ label }}</a-option>
      </a-select>
      <a-select v-model="query.listed" placeholder="收录" allow-clear style="width: 120px">
        <a-option value="1">在收录里</a-option>
        <a-option value="0">未收录</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-button type="primary" @click="router.push('/stations/new')">新建</a-button>
      <a-button :loading="importing" @click="importCatalog">从目录导入</a-button>
      <a-button @click="runDue">跑到期任务</a-button>
    </div>
    <p class="muted">渠道状态和「打开站点」只跳到对方的公开页面，不改维渡前台。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #mode="{ record }">
        <div>{{ MODE[record.status_mode] || record.status_mode }}</div>
        <a v-if="record.plaza_url && record.status_mode !== 'plaza'" :href="record.plaza_url" target="_blank" rel="noopener">模型广场</a>
      </template>
      <template #channel="{ record }">
        <a v-if="record.channel_status_url" :href="record.channel_status_url" target="_blank" rel="noopener">有</a>
        <span v-else class="muted">{{ record.pages_checked_at ? "无" : "未核" }}</span>
      </template>
      <template #tier="{ record }">{{ TIER[record.tier] || record.tier }}</template>
      <template #listed="{ record }">
        <a-tag v-if="record.taken_down" color="red">已下架</a-tag>
        <a-tag v-else-if="record.listed" color="green">收录</a-tag>
        <a-tag v-else>未收录</a-tag>
      </template>
      <template #up="{ record }">
        <a-tag v-if="record.last_up === 1" color="green">开</a-tag>
        <a-tag v-else-if="record.last_up === 0" color="red">不通</a-tag>
        <span v-else class="muted">未测</span>
      </template>
      <template #ops="{ record }">
        <a-button type="text" :disabled="!record.url" @click="openSite(record)">打开站点</a-button>
        <a-button type="text" @click="router.push('/stations/' + record.id)">编辑</a-button>
        <a-button type="text" :loading="busy === record.id" @click="probe(record)">探测</a-button>
        <a-button type="text" @click="queue(record)">加入下一轮</a-button>
        <a-button type="text" status="danger" @click="take(record)">{{ record.taken_down ? "恢复" : "下架" }}</a-button>
      </template>
    </a-table>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message, Modal } from "@arco-design/web-vue";
import { MODE, TIER, api } from "../api";

const router = useRouter();
const rows = ref([]);
const loading = ref(false);
const importing = ref(false);
const busy = ref(0);
const query = reactive({ q: "", mode: "", tier: "", listed: "" });
const pager = reactive({ total: 0, current: 1, pageSize: 20, showTotal: true });
const columns = [
  { title: "名称", dataIndex: "name", width: 160 },
  { title: "域名", dataIndex: "domain", width: 180 },
  { title: "来源", slotName: "mode", width: 140 },
  { title: "渠道状态", slotName: "channel", width: 100 },
  { title: "频率", slotName: "tier", width: 140 },
  { title: "收录", slotName: "listed", width: 100 },
  { title: "最近", slotName: "up", width: 90 },
  { title: "模型数", dataIndex: "last_model_count", width: 90 },
  { title: "价格快照", dataIndex: "last_price", width: 120 },
  { title: "Key", dataIndex: "key_hint", width: 90 },
  { title: "操作", slotName: "ops", width: 390 },
];

function params() {
  const search = new URLSearchParams({ page: pager.current, size: pager.pageSize });
  if (query.q) search.set("q", query.q);
  if (query.mode) search.set("mode", query.mode);
  if (query.tier) search.set("tier", query.tier);
  if (query.listed) search.set("listed", query.listed);
  return search.toString();
}

async function load() {
  loading.value = true;
  try {
    const data = await api("/api/stations?" + params());
    rows.value = data.items;
    pager.total = data.total;
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

function openSite(record) {
  window.open(record.url, "_blank", "noopener");
}

function search() {
  pager.current = 1;
  load();
}

function onPage(page) {
  pager.current = page;
  load();
}

function importCatalog() {
  Modal.confirm({
    title: "从现有目录导入？",
    content: "只补还没有的域名，不改名称和网址，也不立刻全量探测。原先标成没有状态、但记录里能看出状态来源的，会改成公开状态页或要登录才看得到。",
    onOk: async () => {
      importing.value = true;
      try {
        const result = await api("/api/stations/import", { method: "POST", body: "{}" });
        const modes = result.modes || {};
        Message.success(`新增 ${result.added}，补了来源 ${result.updated || 0}。公开状态页 ${modes.public || 0}，要登录 ${modes.auth || 0}，没有状态 ${modes.none || 0}`);
        load();
      } catch (err) {
        Message.error(err.message);
      } finally {
        importing.value = false;
      }
    },
  });
}

async function runDue() {
  try {
    await api("/api/jobs/run", { method: "POST", body: "{}" });
    Message.success("已开始跑到期任务");
  } catch (err) {
    Message.error(err.message);
  }
}

async function probe(record) {
  busy.value = record.id;
  try {
    await api(`/api/stations/${record.id}/probe`, { method: "POST", body: "{}" });
    Message.success("探测完成");
    load();
  } catch (err) {
    Message.error(err.message);
  } finally {
    busy.value = 0;
  }
}

async function queue(record) {
  try {
    await api(`/api/stations/${record.id}/queue`, { method: "POST", body: "{}" });
    Message.success("已加入下一轮");
  } catch (err) {
    Message.error(err.message);
  }
}

function take(record) {
  const down = !record.taken_down;
  Modal.confirm({
    title: down ? "下架这个站？" : "恢复这个站？",
    content: down ? "下架后不再探测，并从收录里拿掉。" : "恢复后可以继续探测。收录开关在编辑页。",
    onOk: async () => {
      await api(`/api/stations/${record.id}/takedown`, { method: "POST", body: JSON.stringify({ down }) });
      Message.success(down ? "已下架" : "已恢复");
      load();
    },
  });
}

onMounted(load);
</script>
