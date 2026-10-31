<template>
  <a-card>
    <a-form :model="form" layout="vertical" style="max-width: 720px">
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="每天几点跑">
            <a-input-number v-model="form.probe_hour" :min="0" :max="23" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="每轮最多几家">
            <a-input-number v-model="form.batch_limit" :min="1" :max="200" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="定时任务">
            <a-switch v-model="scheduler" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="连续不通几小时告警">
            <a-input-number v-model="form.down_hours" :min="1" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="已挂复测间隔（小时）">
            <a-input-number v-model="form.recheck_hours" :min="1" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="每天档间隔（小时）">
            <a-input-number v-model="form.daily_hours" :min="1" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="长尾间隔（天）">
            <a-input-number v-model="form.longtail_days" :min="1" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="价格跳动比例">
            <a-input-number v-model="form.price_jump" :min="0.1" :step="0.1" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="证书提前几天提醒">
            <a-input-number v-model="form.cert_warn_days" :min="1" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="每日探测预算">
            <a-input-number v-model="form.daily_budget" :min="0" :step="0.1" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="单次基础测试记多少">
            <a-input-number v-model="form.cost_per_call" :min="0" :step="0.0001" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="详情页多少人访问升为每天测">
            <a-input-number v-model="form.traffic_min" :min="1" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="主力模型，逗号分隔">
        <a-input v-model="form.flagships" />
      </a-form-item>
      <a-form-item label="探测代理">
        <a-input v-model="form.proxy" placeholder="可空，例如 http://127.0.0.1:7897" />
      </a-form-item>
      <a-button type="primary" :loading="saving" @click="save">保存设置</a-button>
    </a-form>
    <a-divider />
    <a-form :model="password" layout="vertical" style="max-width: 420px">
      <a-form-item label="原密码">
        <a-input-password v-model="password.old" />
      </a-form-item>
      <a-form-item label="新密码">
        <a-input-password v-model="password.next" placeholder="至少 6 位" />
      </a-form-item>
      <a-button :loading="changing" @click="changePassword">修改密码</a-button>
    </a-form>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api, auth } from "../api";

const router = useRouter();
const saving = ref(false);
const changing = ref(false);
const scheduler = ref(true);
const form = reactive({
  probe_hour: 3,
  batch_limit: 20,
  down_hours: 6,
  recheck_hours: 2,
  daily_hours: 20,
  longtail_days: 7,
  price_jump: 0.5,
  cert_warn_days: 14,
  daily_budget: 5,
  cost_per_call: 0.0001,
  traffic_min: 20,
  flagships: "",
  proxy: "",
});
const password = reactive({ old: "", next: "" });
const numberKeys = ["probe_hour", "batch_limit", "down_hours", "recheck_hours", "daily_hours", "longtail_days", "price_jump", "cert_warn_days", "daily_budget", "cost_per_call", "traffic_min"];

async function load() {
  const data = await api("/api/settings");
  for (const key of numberKeys) form[key] = Number(data[key]);
  form.flagships = data.flagships || "";
  form.proxy = data.proxy || "";
  scheduler.value = data.scheduler === "1";
}

async function save() {
  saving.value = true;
  try {
    const payload = { scheduler: scheduler.value ? "1" : "0", flagships: form.flagships, proxy: form.proxy };
    for (const key of numberKeys) payload[key] = String(form[key]);
    await api("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    Message.success("已保存");
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function changePassword() {
  changing.value = true;
  try {
    await api("/api/password", { method: "POST", body: JSON.stringify({ old: password.old, new: password.next }) });
    auth.me = null;
    Message.success("密码已改，请重新登录");
    router.push("/login");
  } catch (err) {
    Message.error(err.message);
  } finally {
    changing.value = false;
  }
}

onMounted(load);
</script>
