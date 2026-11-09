<template>
  <a-card title="收录提案">
    <p>来自主站的公开提名、支持与讨论。更新进度后，用户可在原提案查看处理说明和结果。</p>
    <div class="toolbar">
      <a-input v-model="query" placeholder="搜索站点、域名或需求" style="width: 260px" @press-enter="search" />
      <a-select v-model="status" placeholder="全部状态" allow-clear style="width: 140px">
        <a-option v-for="(label, key) in statuses" :key="key" :value="key">{{ label }}</a-option>
      </a-select>
      <a-button type="primary" @click="search">查询</a-button>
      <a-link :href="siteOrigin + '/proposals'" target="_blank" rel="noopener noreferrer">查看主站页面</a-link>
    </div>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="pager" row-key="id" @page-change="onPage">
      <template #site="{ record }"><b>{{ record.name }}</b><div>{{ record.host }}</div></template>
      <template #tests="{ record }">{{ record.tests.map(key => tests[key]).join('、') }}</template>
      <template #status="{ record }"><a-tag :color="record.hidden ? 'red' : record.status === 'done' ? 'green' : 'blue'">{{ record.hidden ? '已下架' : statuses[record.status] }}</a-tag></template>
      <template #ops="{ record }"><a-button type="text" @click="open(record.id)">处理</a-button></template>
    </a-table>
  </a-card>
  <a-modal v-model:visible="visible" title="处理收录提案" :footer="false" width="min(760px, 94vw)">
    <a-spin :loading="opening" style="width: 100%">
      <template v-if="detail">
        <h3>{{ detail.name }}</h3>
        <a-link :href="detail.url" target="_blank" rel="noopener noreferrer">{{ detail.url }}</a-link>
        <p class="proposal-text">{{ detail.reason }}</p>
        <p>{{ detail.votes }} 人支持 · {{ detail.tests.map(key => tests[key]).join('、') }} · {{ detail.author }}</p>
        <a-form layout="vertical" :model="form" @submit-success="save">
          <a-form-item label="处理进度"><a-select v-model="form.status"><a-option v-for="(label, key) in statuses" :key="key" :value="key">{{ label }}</a-option></a-select></a-form-item>
          <a-form-item label="公开处理说明"><a-textarea v-model="form.note" :max-length="1000" show-word-limit placeholder="例如：已联系站长，计划安排基础测试。" /></a-form-item>
          <a-form-item label="结果链接（本站路径）"><a-input v-model="form.result_url" placeholder="/site/...、/b/... 或 /check/..." /></a-form-item>
          <a-form-item label="下架这条提案"><a-switch v-model="form.hidden" /><span style="margin-left: 12px">下架后不在主站展示，支持和评论保留。</span></a-form-item>
          <a-button type="primary" html-type="submit" :loading="saving">保存并更新主站</a-button>
        </a-form>
        <a-divider />
        <h3>讨论管理（最近 100 条）</h3>
        <p v-if="!detail.comments.length">暂无讨论</p>
        <article v-for="row in detail.comments" :key="row.id" class="proposal-admin-comment">
          <div><b>{{ row.author }}</b> · {{ new Date(row.created).toLocaleString('zh-CN') }} <a-tag v-if="row.hidden" color="red">已隐藏</a-tag></div>
          <p class="proposal-text">{{ row.content }}</p>
          <a-button size="small" :loading="moderating === row.id" @click="toggleComment(row)">{{ row.hidden ? '恢复显示' : '隐藏评论' }}</a-button>
        </article>
      </template>
    </a-spin>
  </a-modal>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const statuses = { open: "征集中", planned: "已排期", testing: "测试中", done: "已完成", closed: "暂不处理" };
const tests = { basic: "基础测试", candy: "糖果测试", pelican: "鹈鹕骑车" };
const siteOrigin = import.meta.env.VITE_SITE_ORIGIN || (import.meta.env.DEV ? "http://127.0.0.1:5181" : "https://www.veridrop.cn");
const query = ref("");
const status = ref("");
const rows = ref([]);
const loading = ref(false);
const visible = ref(false);
const opening = ref(false);
const saving = ref(false);
const moderating = ref("");
const detail = ref(null);
const form = reactive({ status: "open", note: "", result_url: "", hidden: false });
const pager = reactive({ total: 0, current: 1, pageSize: 10, showTotal: true });
const columns = [
  { title: "站点", slotName: "site" },
  { title: "希望测试", slotName: "tests" },
  { title: "支持人数", dataIndex: "votes", width: 100 },
  { title: "讨论", dataIndex: "commentCount", width: 80 },
  { title: "进度", slotName: "status", width: 100 },
  { title: "提交时间", dataIndex: "created", width: 220 },
  { title: "", slotName: "ops", width: 80 },
];
async function load() {
  loading.value = true;
  try {
    const data = await api("/api/proposals?" + new URLSearchParams({ q: query.value, status: status.value || "", page: pager.current }));
    rows.value = data.items; pager.total = data.total; pager.current = data.page;
  } catch (err) { Message.error(err.message); }
  finally { loading.value = false; }
}
function search() { pager.current = 1; load(); }
function onPage(page) { pager.current = page; load(); }
async function open(id) {
  visible.value = true; opening.value = true; detail.value = null;
  try {
    detail.value = await api("/api/proposals/" + id);
    Object.assign(form, { status: detail.value.status, note: detail.value.note, result_url: detail.value.result_url, hidden: detail.value.hidden });
  } catch (err) { Message.error(err.message); visible.value = false; }
  finally { opening.value = false; }
}
async function save() {
  if (!detail.value || saving.value) return;
  saving.value = true;
  try {
    detail.value = await api("/api/proposals/" + detail.value.id, { method: "POST", body: JSON.stringify(form) });
    Message.success("已更新公开进度"); visible.value = false; load();
  } catch (err) { Message.error(err.message); }
  finally { saving.value = false; }
}
async function toggleComment(row) {
  if (moderating.value) return;
  moderating.value = row.id;
  try {
    const data = await api("/api/proposals/" + detail.value.id, { method: "POST", body: JSON.stringify({ commentId: row.id, hidden: !row.hidden }) });
    detail.value.comments = data.comments; load();
  } catch (err) { Message.error(err.message); }
  finally { moderating.value = ""; }
}
onMounted(load);
</script>

<style scoped>
.proposal-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
.proposal-admin-comment { padding: 14px 0; border-bottom: 1px solid var(--color-neutral-3); }
</style>
