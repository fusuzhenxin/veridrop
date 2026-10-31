<template>
  <a-card>
    <a-form :model="form" layout="vertical" style="max-width: 720px">
      <a-form-item label="站档编号">
        <a-input v-model="form.station_id" placeholder="可空" />
      </a-form-item>
      <a-form-item label="网址">
        <a-input v-model="form.url" />
      </a-form-item>
      <a-form-item label="联系方式">
        <a-input v-model="form.contact" />
      </a-form-item>
      <a-form-item label="内容" required>
        <a-textarea v-model="form.body" />
      </a-form-item>
      <a-space>
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
        <a-button v-if="id && form.status === 'open'" status="danger" @click="close">结案</a-button>
        <a-button @click="router.push('/complaints')">返回</a-button>
      </a-space>
    </a-form>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const route = useRoute();
const router = useRouter();
function recordId(value) {
  return value && value !== "new" ? String(value) : "";
}

const id = ref(recordId(route.params.id));
watch(
  () => route.params.id,
  (next) => {
    const value = recordId(next);
    if (value === id.value) return;
    id.value = value;
    if (value) load();
  },
);
const saving = ref(false);
const form = reactive({ station_id: "", url: "", contact: "", body: "", status: "open" });

async function load() {
  if (!id.value) return;
  try {
    const row = await api("/api/complaints/" + id.value);
    Object.assign(form, row, { station_id: row.station_id || "" });
  } catch (err) {
    Message.error(err.message);
    router.push("/complaints");
  }
}

async function save() {
  if (!form.body.trim()) {
    Message.warning("请填写投诉内容");
    return;
  }
  saving.value = true;
  try {
    const saved = await api(id.value ? "/api/complaints/" + id.value : "/api/complaints", {
      method: "POST",
      body: JSON.stringify({
        station_id: form.station_id || null,
        url: form.url,
        contact: form.contact,
        body: form.body,
      }),
    });
    Message.success("已保存");
    const created = !id.value;
    if (created) id.value = String(saved.id);
    Object.assign(form, saved, { station_id: saved.station_id || "" });
    if (created) router.replace("/complaints/" + saved.id);
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function close() {
  try {
    Object.assign(form, await api(`/api/complaints/${id.value}/close`, { method: "POST", body: "{}" }));
    Message.success("已结案");
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
