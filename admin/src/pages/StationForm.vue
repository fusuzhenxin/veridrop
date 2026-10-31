<template>
  <a-card>
    <a-tabs default-active-key="profile">
      <a-tab-pane key="profile" title="资料">
        <a-form :model="form" layout="vertical" style="max-width: 720px">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="名称" required>
                <a-input v-model="form.name" placeholder="站名" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="域名" required>
                <a-input v-model="form.domain" placeholder="example.com" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="网址" required>
            <a-input v-model="form.url" placeholder="https://example.com" />
          </a-form-item>
          <a-form-item label="状态来源" required>
            <a-radio-group v-model="form.status_mode">
              <a-radio value="public">公开状态页</a-radio>
              <a-radio value="auth">要登录才看得到</a-radio>
              <a-radio value="plaza">模型广场</a-radio>
              <a-radio value="none">没有状态</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item v-if="form.status_mode === 'public'" label="状态页地址">
            <a-input v-model="form.status_url" placeholder="留空则用网址下的 /api/status" />
          </a-form-item>
          <p v-if="form.channel_status_url" class="muted">渠道状态：{{ form.channel_status_url }}</p>
          <p v-if="form.plaza_url" class="muted">模型广场：{{ form.plaza_url }}</p>
          <p v-if="form.status_mode === 'auth'" class="muted">只在保存了测试 Key 时请求模型和一次便宜调用。不会用账号密码登录对方后台。</p>
          <a-form-item v-if="form.status_mode === 'auth'" label="基础测试模型">
            <a-input v-model="form.test_model" placeholder="留空则用对方模型列表的第一个" />
          </a-form-item>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="探测频率">
                <a-select v-model="form.tier">
                  <a-option v-for="(label, key) in TIER" :key="key" :value="key">{{ label }}</a-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="目录标识">
                <a-input v-model="form.source_token" placeholder="可空，用于对上详情页流量" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-space style="margin-bottom: 16px">
            <a-switch v-model="form.listed" />
            <span>在收录里</span>
            <a-switch v-model="form.enabled" />
            <span>参与探测</span>
          </a-space>
          <a-form-item label="备注">
            <a-textarea v-model="form.notes" :max-length="1000" show-word-limit />
          </a-form-item>
          <a-descriptions v-if="id" :column="2" size="small" style="margin-bottom: 16px">
            <a-descriptions-item label="最近结果">{{ form.last_up === 1 ? "开" : form.last_up === 0 ? "不通" : "未测" }}</a-descriptions-item>
            <a-descriptions-item label="模型数">{{ form.last_model_count ?? "—" }}</a-descriptions-item>
            <a-descriptions-item label="价格快照">{{ form.last_price || "—" }}</a-descriptions-item>
            <a-descriptions-item label="上次成功">{{ form.last_success_at || "—" }}</a-descriptions-item>
            <a-descriptions-item label="上次检查">{{ form.last_checked_at || "—" }}</a-descriptions-item>
            <a-descriptions-item label="证书到期">{{ form.cert_not_after || "—" }}</a-descriptions-item>
          </a-descriptions>
          <a-space>
            <a-button type="primary" :loading="saving" @click="save">保存</a-button>
            <a-button @click="router.push('/stations')">取消</a-button>
            <a-button v-if="id" :loading="probing" @click="probe">立即探测</a-button>
            <a-button v-if="id" @click="queue">加入下一轮</a-button>
            <a-button v-if="id" status="danger" @click="take">{{ form.taken_down ? "恢复" : "下架" }}</a-button>
          </a-space>
        </a-form>
      </a-tab-pane>
      <a-tab-pane v-if="id && form.status_mode === 'auth'" key="key" title="测试 Key">
        <a-form layout="vertical" style="max-width: 520px">
          <a-form-item :label="form.key_hint ? '已保存 ' + form.key_hint : '还没有测试 Key'">
            <a-input-password v-model="key" placeholder="留空不会改已保存的 Key" />
          </a-form-item>
          <a-space>
            <a-button type="primary" :loading="savingKey" @click="saveKey">保存 Key</a-button>
            <a-button status="danger" @click="clearKey">清除 Key</a-button>
          </a-space>
          <p class="muted">Key 只写进加密库，编辑页和前台都不会再显示原文。</p>
        </a-form>
      </a-tab-pane>
      <a-tab-pane v-if="id" key="runs" title="探测记录">
        <a-table :columns="runColumns" :data="runs" :pagination="false" row-key="id">
          <template #ok="{ record }">
            <a-tag :color="record.ok ? 'green' : 'red'">{{ record.ok ? "成功" : "失败" }}</a-tag>
          </template>
          <template #ops="{ record }">
            <a-button type="text" @click="router.push('/runs/' + record.id)">查看</a-button>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message, Modal } from "@arco-design/web-vue";
import { TIER, api } from "../api";

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
const savingKey = ref(false);
const probing = ref(false);
const key = ref("");
const runs = ref([]);
const form = reactive({
  name: "",
  domain: "",
  url: "",
  status_mode: "none",
  status_url: "",
  channel_status_url: "",
  plaza_url: "",
  tier: "longtail",
  test_model: "",
  source_token: "",
  listed: true,
  enabled: true,
  notes: "",
  taken_down: 0,
  key_hint: "",
  last_up: null,
  last_model_count: null,
  last_price: "",
  last_success_at: "",
  last_checked_at: "",
  cert_not_after: "",
});
const runColumns = [
  { title: "时间", dataIndex: "created_at" },
  { title: "类型", dataIndex: "kind", width: 100 },
  { title: "结果", slotName: "ok", width: 90 },
  { title: "延迟", dataIndex: "latency_ms", width: 90 },
  { title: "模型", dataIndex: "model" },
  { title: "花费", dataIndex: "cost", width: 90 },
  { title: "错误", dataIndex: "error_type", width: 100 },
  { title: "", slotName: "ops", width: 80 },
];

function fill(row) {
  Object.assign(form, row, { listed: !!row.listed, enabled: !!row.enabled });
  if (Array.isArray(row.runs)) runs.value = row.runs;
}

async function load() {
  if (!id.value) return;
  try {
    fill(await api("/api/stations/" + id.value));
  } catch (err) {
    Message.error(err.message);
    router.push("/stations");
  }
}

function payload() {
  return {
    name: form.name,
    domain: form.domain,
    url: form.url,
    status_mode: form.status_mode,
    status_url: form.status_url,
    tier: form.tier,
    test_model: form.test_model,
    source_token: form.source_token,
    listed: form.listed,
    enabled: form.enabled,
    notes: form.notes,
  };
}

async function save() {
  if (!form.name || !form.domain || !form.url) {
    Message.warning("请填写名称、域名和网址");
    return;
  }
  saving.value = true;
  try {
    const saved = await api(id.value ? "/api/stations/" + id.value : "/api/stations", {
      method: "POST",
      body: JSON.stringify(payload()),
    });
    Message.success("已保存");
    if (!id.value) {
      id.value = String(saved.id);
      fill(saved);
      router.replace("/stations/" + saved.id);
    } else fill(saved);
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function saveKey() {
  if (!key.value.trim()) {
    Message.warning("请填写新的 Key，或点清除");
    return;
  }
  savingKey.value = true;
  try {
    fill(await api(`/api/stations/${id.value}/key`, { method: "POST", body: JSON.stringify({ key: key.value }) }));
    key.value = "";
    Message.success("Key 已保存");
  } catch (err) {
    Message.error(err.message);
  } finally {
    savingKey.value = false;
  }
}

function clearKey() {
  Modal.confirm({
    title: "清除测试 Key？",
    content: "清除后，这站不会再做要登录的模型测试。",
    onOk: async () => {
      fill(await api(`/api/stations/${id.value}/key`, { method: "POST", body: JSON.stringify({ key: "" }) }));
      Message.success("已清除");
    },
  });
}

async function probe() {
  probing.value = true;
  try {
    fill(await api(`/api/stations/${id.value}/probe`, { method: "POST", body: "{}" }));
    Message.success("探测完成");
  } catch (err) {
    Message.error(err.message);
  } finally {
    probing.value = false;
  }
}

async function queue() {
  await api(`/api/stations/${id.value}/queue`, { method: "POST", body: "{}" });
  Message.success("已加入下一轮");
}

function take() {
  const down = !form.taken_down;
  Modal.confirm({
    title: down ? "下架这个站？" : "恢复这个站？",
    onOk: async () => {
      fill(await api(`/api/stations/${id.value}/takedown`, { method: "POST", body: JSON.stringify({ down }) }));
      Message.success(down ? "已下架" : "已恢复");
    },
  });
}

onMounted(load);
</script>
