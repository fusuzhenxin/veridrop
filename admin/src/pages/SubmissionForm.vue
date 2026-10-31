<template>
  <a-card>
    <a-form :model="form" layout="vertical" style="max-width: 720px">
      <a-form-item label="来源">
        <a-select v-model="form.source" :disabled="!!id">
          <a-option v-for="(label, key) in SOURCE" :key="key" :value="key">{{ label }}</a-option>
        </a-select>
      </a-form-item>
      <a-form-item label="站点名称" required>
        <a-input v-model="form.site_name" :disabled="locked" />
      </a-form-item>
      <a-form-item label="网址" required>
        <a-input v-model="form.url" :disabled="locked" />
      </a-form-item>
      <a-form-item label="联系方式">
        <a-input v-model="form.contact" :disabled="locked" />
      </a-form-item>
      <a-form-item label="说明">
        <a-textarea v-model="form.body" :disabled="locked" />
      </a-form-item>
      <a-descriptions v-if="id" :column="2" size="small" style="margin-bottom: 16px">
        <a-descriptions-item label="状态">{{ form.status }}</a-descriptions-item>
        <a-descriptions-item label="写入的站档">{{ form.station_id || "—" }}</a-descriptions-item>
      </a-descriptions>
      <a-space>
        <a-button v-if="!locked" type="primary" :loading="saving" @click="save">保存</a-button>
        <a-button v-if="id && form.status === 'pending'" type="primary" status="success" @click="decide(true)">通过并写入站档</a-button>
        <a-button v-if="id && form.status === 'pending'" status="danger" @click="decide(false)">拒绝</a-button>
        <a-button v-if="form.station_id" type="text" @click="router.push('/stations/' + form.station_id)">打开站档</a-button>
        <a-button @click="router.push('/submissions')">返回</a-button>
      </a-space>
    </a-form>
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { SOURCE, api } from "../api";

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
const form = reactive({ source: "main", site_name: "", url: "", contact: "", body: "", status: "pending", station_id: null });
const locked = computed(() => !!id.value && form.status !== "pending");

function fill(row) {
  Object.assign(form, row);
}

async function load() {
  if (!id.value) return;
  try {
    fill(await api("/api/submissions/" + id.value));
  } catch (err) {
    Message.error(err.message);
    router.push("/submissions");
  }
}

async function save() {
  if (!form.site_name || !form.url) {
    Message.warning("请填写名称和网址");
    return;
  }
  saving.value = true;
  try {
    const saved = await api(id.value ? "/api/submissions/" + id.value : "/api/submissions", {
      method: "POST",
      body: JSON.stringify({
        source: form.source,
        site_name: form.site_name,
        url: form.url,
        contact: form.contact,
        body: form.body,
      }),
    });
    Message.success("已保存");
    const created = !id.value;
    if (created) id.value = String(saved.id);
    fill(saved);
    if (created) router.replace("/submissions/" + saved.id);
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function decide(approve) {
  try {
    fill(await api(`/api/submissions/${id.value}/${approve ? "approve" : "reject"}`, { method: "POST", body: "{}" }));
    Message.success(approve ? "已通过，并写入站档" : "已拒绝");
  } catch (err) {
    Message.error(err.message);
  }
}

onMounted(load);
</script>
