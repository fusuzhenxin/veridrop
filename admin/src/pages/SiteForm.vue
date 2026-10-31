<template>
  <a-card>
    <a-form :model="form" layout="vertical" style="max-width: 720px">
      <a-form-item label="类型" required>
        <a-radio-group v-model="form.kind">
          <a-radio value="external">外链站</a-radio>
          <a-radio value="replica">仿站</a-radio>
        </a-radio-group>
      </a-form-item>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="域名" required>
            <a-input v-model="form.domain" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="模板">
            <a-input v-model="form.template" placeholder="页面仍用现有脚本生成" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="网址" required>
        <a-input v-model="form.url" placeholder="https://" />
      </a-form-item>
      <a-form-item label="上次发布时间">
        <a-input v-model="form.last_published_at" placeholder="2026-10-31 或一段说明" />
      </a-form-item>
      <a-form-item label="备注">
        <a-textarea v-model="form.notes" />
      </a-form-item>
      <p class="muted">收录表单可向 /api/public/submission 提交，字段为 source、site_name、url、contact、body。source 用 external 或 replica。待审数：{{ pending }}</p>
      <a-descriptions v-if="id" :column="2" size="small" style="margin-bottom: 16px">
        <a-descriptions-item label="是否打开">{{ form.last_up === 1 ? "开" : form.last_up === 0 ? "打不开" : "未查" }}</a-descriptions-item>
        <a-descriptions-item label="证书到期">{{ form.cert_not_after || "—" }}</a-descriptions-item>
        <a-descriptions-item label="上次检查">{{ form.last_checked_at || "—" }}</a-descriptions-item>
        <a-descriptions-item label="错误">{{ form.last_error || "—" }}</a-descriptions-item>
      </a-descriptions>
      <a-space>
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
        <a-button @click="router.push('/sites')">取消</a-button>
        <a-button v-if="id" :loading="checking" @click="check">立即检查</a-button>
      </a-space>
    </a-form>
    <a-table v-if="checks.length" style="margin-top: 16px" :columns="columns" :data="checks" :pagination="false" row-key="id">
      <template #ok="{ record }">{{ record.ok ? "开" : "失败" }}</template>
    </a-table>
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
const checking = ref(false);
const checks = ref([]);
const pending = ref(0);
const form = reactive({
  kind: "external",
  domain: "",
  template: "",
  url: "",
  last_published_at: "",
  notes: "",
  last_up: null,
  cert_not_after: "",
  last_checked_at: "",
  last_error: "",
});
const columns = [
  { title: "时间", dataIndex: "created_at" },
  { title: "结果", slotName: "ok", width: 80 },
  { title: "延迟", dataIndex: "latency_ms", width: 90 },
  { title: "错误", dataIndex: "error_type" },
];

function fill(row) {
  Object.assign(form, row);
  checks.value = row.checks || [];
  pending.value = row.pending_forms || 0;
}

async function load() {
  if (!id.value) return;
  try {
    fill(await api("/api/sites/" + id.value));
  } catch (err) {
    Message.error(err.message);
    router.push("/sites");
  }
}

async function save() {
  if (!form.domain || !form.url) {
    Message.warning("请填写域名和网址");
    return;
  }
  saving.value = true;
  try {
    const saved = await api(id.value ? "/api/sites/" + id.value : "/api/sites", {
      method: "POST",
      body: JSON.stringify({
        kind: form.kind,
        domain: form.domain,
        template: form.template,
        url: form.url,
        last_published_at: form.last_published_at,
        notes: form.notes,
      }),
    });
    Message.success("已保存");
    const created = !id.value;
    if (created) id.value = String(saved.id);
    fill({ ...form, ...saved, checks: checks.value, pending_forms: pending.value });
    if (created) router.replace("/sites/" + saved.id);
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function check() {
  checking.value = true;
  try {
    fill(await api(`/api/sites/${id.value}/check`, { method: "POST", body: "{}" }));
    Message.success("检查完成");
  } catch (err) {
    Message.error(err.message);
  } finally {
    checking.value = false;
  }
}

onMounted(load);
</script>
