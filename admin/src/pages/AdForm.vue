<template>
  <a-card>
    <a-form :model="form" layout="vertical" style="max-width: 720px">
      <a-form-item label="位置" required>
        <a-radio-group v-model="form.slot">
          <a-radio value="sponsor">全站赞助，同时 2 条</a-radio>
          <a-radio value="list_top">列表页顶部，同时 4 条</a-radio>
          <a-radio value="footer">全站页脚，不限</a-radio>
        </a-radio-group>
      </a-form-item>
      <a-form-item label="名称" required>
        <a-input v-model="form.name" :max-length="40" placeholder="站名" />
      </a-form-item>
      <a-form-item label="介绍" extra="最多 40 个字。页面上会带「赞助」，不要写成推荐或站长在用。">
        <a-input v-model="form.blurb" :max-length="40" show-word-limit />
      </a-form-item>
      <a-form-item label="图片地址">
        <a-input v-model="form.image_url" placeholder="列表页可用 920×350" />
      </a-form-item>
      <a-form-item label="跳转地址" required>
        <a-input v-model="form.target_url" placeholder="https://" />
      </a-form-item>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="开始日" required>
            <a-date-picker v-model="form.start_date" style="width: 100%" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="到期日" extra="这一天撤下，不包含当天。" required>
            <a-date-picker v-model="form.end_date" style="width: 100%" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-space style="margin-bottom: 16px">
        <a-switch v-model="form.paused" />
        <span>暂停</span>
      </a-space>
      <div class="ad-preview">
        <div>
          <strong>{{ form.name || "广告名称" }}</strong>
          <span>{{ form.blurb || "一句介绍" }}</span>
          <span class="sponsor-mark"> 赞助</span>
        </div>
        <span class="muted">点击走 /go/{{ id || "编号" }}</span>
      </div>
      <a-space style="margin-top: 16px">
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
        <a-button @click="router.push('/ads')">取消</a-button>
      </a-space>
    </a-form>
    <a-table v-if="daily.length" style="margin-top: 16px" :columns="columns" :data="daily" :pagination="false" row-key="day" />
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api, dayText, todayText } from "../api";

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
const daily = ref([]);
const form = reactive({
  slot: "footer",
  name: "",
  blurb: "",
  image_url: "",
  target_url: "",
  start_date: todayText(),
  end_date: "",
  paused: false,
});
const columns = [
  { title: "日期", dataIndex: "day" },
  { title: "浏览", dataIndex: "impressions" },
  { title: "点击", dataIndex: "clicks" },
];

async function load() {
  if (!id.value) return;
  try {
    const row = await api("/api/ads/" + id.value);
    Object.assign(form, row, { paused: !!row.paused });
    daily.value = row.daily || [];
  } catch (err) {
    Message.error(err.message);
    router.push("/ads");
  }
}

async function save() {
  if (!form.name || !form.target_url || !form.start_date || !form.end_date) {
    Message.warning("请填写名称、跳转地址和档期");
    return;
  }
  saving.value = true;
  try {
    const saved = await api(id.value ? "/api/ads/" + id.value : "/api/ads", {
      method: "POST",
      body: JSON.stringify({
        slot: form.slot,
        name: form.name,
        blurb: form.blurb,
        image_url: form.image_url,
        target_url: form.target_url,
        start_date: dayText(form.start_date),
        end_date: dayText(form.end_date),
        paused: form.paused,
      }),
    });
    Message.success("已保存");
    Object.assign(form, saved, { paused: !!saved.paused });
    if (Array.isArray(saved.daily)) daily.value = saved.daily;
    if (!id.value) {
      id.value = String(saved.id);
      router.replace("/ads/" + saved.id);
    }
  } catch (err) {
    Message.error(err.message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
