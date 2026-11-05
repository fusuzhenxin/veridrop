<template>
  <a-card>
    <div class="toolbar">
      <a-button type="primary" @click="add">上架一件</a-button>
      <a-button type="primary" :loading="saving" @click="save">保存</a-button>
    </div>
    <p class="muted">点确定就会写到前台。刷新积分中心就能看到开放中的奖品。下架的不再出现。地址和 Key 只在兑换成功后给本人看。份数空着表示不限。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="false" row-key="id">
      <template #status="{ record }">
        <a-tag v-if="record.status === 'open'" color="green">开放</a-tag>
        <a-tag v-else>下架</a-tag>
      </template>
      <template #ops="{ rowIndex }">
        <a-button type="text" @click="edit(rowIndex)">编辑</a-button>
        <a-button type="text" status="danger" @click="remove(rowIndex)">去掉</a-button>
      </template>
    </a-table>
    <a-modal v-model:visible="open" title="奖品" :width="960" :ok-loading="saving" @ok="apply">
      <div class="prize-layout">
        <a-form :model="form" layout="vertical">
          <div class="prize-grid">
            <a-form-item label="名称"><a-input v-model="form.title" placeholder="¥20 免费额度" /></a-form-item>
            <a-form-item label="编号"><a-input v-model="form.id" placeholder="英文和短横线，例如 store-api" /></a-form-item>
            <a-form-item label="品牌"><a-input v-model="form.brand" placeholder="StoreAPI" /></a-form-item>
            <a-form-item label="角标"><a-input v-model="form.badge" placeholder="站主赞助" /></a-form-item>
          </div>
          <a-form-item label="说明"><a-textarea v-model="form.desc" placeholder="兑换 20 元免费额度" :auto-size="{ minRows: 2, maxRows: 4 }" /></a-form-item>
          <div class="prize-uploads">
            <div>
              <div class="prize-label">图标</div>
              <label class="prize-drop">
                <img v-if="form.icon" :src="form.icon" alt="" />
                <span v-else>上传图标</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="uploadImage($event, 'icon')" />
              </label>
            </div>
            <div class="prize-cover-field">
              <div class="prize-label">宣传图，可以不传</div>
              <label class="prize-drop wide">
                <img v-if="form.cover" :src="form.cover" alt="" />
                <span v-else>上传宣传图</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="uploadImage($event, 'cover')" />
              </label>
            </div>
          </div>
          <div class="prize-grid">
            <a-form-item label="积分"><a-input-number v-model="form.cost" :min="0" /></a-form-item>
            <a-form-item label="每人几份"><a-input-number v-model="form.perPerson" :min="1" /></a-form-item>
            <a-form-item label="总份数"><a-input v-model="form.stock" placeholder="空着不限" /></a-form-item>
            <a-form-item label="状态">
              <a-select v-model="form.status">
                <a-option value="open">开放</a-option>
                <a-option value="closed">下架</a-option>
              </a-select>
            </a-form-item>
          </div>
          <a-form-item label="截止说明"><a-input v-model="form.ends" placeholder="用完截止，或留空" /></a-form-item>
          <a-form-item label="兑换后展示的地址"><a-input v-model="form.url" /></a-form-item>
          <a-form-item label="兑换后展示的 Key"><a-input v-model="form.key" /></a-form-item>
        </a-form>
        <aside class="prize-preview">
          <div class="prize-card">
            <div v-if="form.cover" class="prize-card-cover"><img :src="form.cover" alt="" /></div>
            <div class="prize-card-top">
              <span class="prize-card-logo"><img v-if="form.icon" :src="form.icon" alt="" /><span v-else>奖</span></span>
              <strong>{{ form.brand || form.title || "品牌" }}</strong>
              <em v-if="form.badge">{{ form.badge }}</em>
            </div>
            <h3>{{ form.title || "奖品名称" }}</h3>
            <p>{{ form.desc || "说明会出现在这里" }}</p>
            <div class="prize-card-meta"><b>{{ form.cost || 0 }} 积分</b><span>{{ form.stock === "" || form.stock == null ? "不限份数" : `共 ${form.stock} 份` }}</span></div>
          </div>
        </aside>
      </div>
    </a-modal>
  </a-card>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const rows = ref([]);
const loading = ref(false);
const saving = ref(false);
const open = ref(false);
const editIndex = ref(-1);
const form = reactive(blank());
const columns = [
  { title: "编号", dataIndex: "id", width: 180 },
  { title: "名称", dataIndex: "title" },
  { title: "积分", dataIndex: "cost", width: 80 },
  { title: "已兑", dataIndex: "sold", width: 80 },
  { title: "份数", dataIndex: "stock", width: 80 },
  { title: "状态", slotName: "status", width: 90 },
  { title: "", slotName: "ops", width: 140 },
];

function blank() {
  return { id: "", title: "", desc: "", brand: "", badge: "", cost: 20, perPerson: 1, stock: "", status: "open", ends: "", icon: "", cover: "", url: "", key: "" };
}

async function uploadImage(event, field) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 2_000_000) {
    Message.error("请上传 2MB 以内的 png、jpg、webp 或 gif");
    return;
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片没有读出来"));
    reader.readAsDataURL(file);
  });
  try {
    const saved = await api("/api/prizes/upload", { method: "POST", body: JSON.stringify({ name: file.name, data }) });
    form[field] = saved.url;
  } catch (err) {
    Message.error(err.message);
  }
}

function edit(index) {
  editIndex.value = index;
  Object.assign(form, blank(), rows.value[index], { stock: rows.value[index].stock ?? "" });
  open.value = true;
}

function add() {
  editIndex.value = -1;
  Object.assign(form, blank());
  open.value = true;
}

function draftRow() {
  const { sold, rowKey, ...rest } = form;
  return { ...rest, stock: form.stock === "" || form.stock == null ? null : Number(form.stock) };
}

async function persist(next) {
  saving.value = true;
  try {
    rows.value = (await api("/api/prizes", { method: "POST", body: JSON.stringify({ items: next }) })).rows || [];
    Message.success("已上架，刷新前台积分中心即可看到");
    return true;
  } catch (err) {
    Message.error(err.message);
    return false;
  } finally {
    saving.value = false;
  }
}

async function apply() {
  const row = draftRow();
  const next = rows.value.slice();
  if (editIndex.value >= 0) next.splice(editIndex.value, 1, row);
  else next.push(row);
  if (await persist(next)) open.value = false;
}

async function remove(index) {
  const next = rows.value.slice();
  next.splice(index, 1);
  await persist(next);
}

async function load() {
  loading.value = true;
  try {
    rows.value = (await api("/api/prizes")).rows || [];
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function save() {
  await persist(rows.value);
}

onMounted(load);
</script>
