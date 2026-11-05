<template>
  <a-card title="站点公告" style="max-width: 720px">
    <p class="muted">保存后前台下次打开就会用新文案。正文改过的话，当天已经关掉的人也会再看到一次。不用重新生成页面。</p>
    <a-form :model="form" layout="vertical">
      <a-form-item label="显示">
        <a-switch v-model="form.enabled" />
      </a-form-item>
      <a-form-item label="标题">
        <a-input v-model="form.title" :max-length="80" />
      </a-form-item>
      <a-form-item label="日期">
        <a-input v-model="form.date" placeholder="2026-11-02" />
      </a-form-item>
      <a-form-item label="正文">
        <a-textarea v-model="form.body" :max-length="500" show-word-limit :auto-size="{ minRows: 4 }" />
      </a-form-item>
      <a-form-item label="按钮文字">
        <a-input v-model="form.actionLabel" :max-length="20" />
      </a-form-item>
      <a-form-item label="按钮链接">
        <a-input v-model="form.actionTo" placeholder="/points#redeem" />
      </a-form-item>
      <a-button type="primary" :loading="saving" @click="save">保存</a-button>
    </a-form>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const saving = ref(false);
const form = reactive({ enabled: true, title: "", date: "", body: "", actionLabel: "", actionTo: "" });

async function load() {
  const data = await api("/api/notice");
  Object.assign(form, data);
}

async function save() {
  saving.value = true;
  try {
    Object.assign(form, await api("/api/notice", { method: "POST", body: JSON.stringify(form) }));
    Message.success("已保存");
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
