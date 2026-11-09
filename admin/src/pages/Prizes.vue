<template>
  <a-card>
    <div class="toolbar">
      <a-button type="primary" @click="add">上架一件</a-button>
      <a-button type="primary" :loading="saving" @click="save">保存</a-button>
    </div>
    <p class="muted">地址和兑换码只在兑换成功后给本人看。支持共用一个码，或每份发放不同的码；独立兑换码用完后自动停止兑换。</p>
    <a-table :columns="columns" :data="rows" :loading="loading" :pagination="false" :scroll="{ x: 1060 }" row-key="id">
      <template #status="{ record }">
        <a-tag v-if="record.status === 'open'" color="green">开放</a-tag>
        <a-tag v-else>下架</a-tag>
      </template>
      <template #inventory="{ record }">
        <span v-if="record.codeMode === 'unique'">剩 {{ record.remaining }} 份 · 码 {{ record.codeRemaining }}/{{ record.codeTotal }}</span>
        <span v-else>{{ record.stock == null ? '不限份数' : `剩 ${record.remaining} 份` }} · 共用码</span>
      </template>
      <template #ops="{ rowIndex }">
        <a-button type="text" @click="edit(rowIndex)">编辑</a-button>
        <a-button type="text" status="danger" @click="remove(rowIndex)">去掉</a-button>
      </template>
    </a-table>
    <a-modal v-model:visible="open" title="奖品" :width="960" :modal-style="{ maxWidth: 'calc(100vw - 32px)' }" :ok-loading="saving" @before-ok="apply">
      <div class="prize-layout">
        <a-form :model="form" layout="vertical">
          <div class="prize-grid">
            <a-form-item label="名称"><a-input v-model="form.title" placeholder="¥20 免费额度" /></a-form-item>
            <a-form-item label="编号"><a-input v-model="form.id" :disabled="editIndex >= 0" placeholder="英文和短横线，例如 store-api" /></a-form-item>
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
            <a-form-item label="每人几份"><a-input-number v-model="form.perPerson" :min="1" :disabled="form.codeMode === 'unique'" /></a-form-item>
            <a-form-item label="总份数"><a-input v-model="form.stock" :placeholder="form.codeMode === 'unique' ? '留空按兑换码数量发放' : '空着不限'" /></a-form-item>
            <a-form-item label="状态">
              <a-select v-model="form.status">
                <a-option value="open">开放</a-option>
                <a-option value="closed">下架</a-option>
              </a-select>
            </a-form-item>
          </div>
          <a-form-item label="截止说明"><a-input v-model="form.ends" placeholder="用完截止，或留空" /></a-form-item>
          <a-form-item label="兑换后展示的地址"><a-input v-model="form.url" /></a-form-item>
          <a-form-item label="兑换码发放方式">
            <a-radio-group v-model="form.codeMode" type="button" @change="onModeChange">
              <a-radio value="shared">共用一个码</a-radio>
              <a-radio value="unique">每份不同码</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item v-if="form.codeMode !== 'unique'" label="兑换后展示的 Key / 兑换码"><a-input v-model="form.key" /></a-form-item>
          <template v-else>
            <a-form-item label="独立兑换码，每行一个">
              <a-textarea v-model="codeText" placeholder="兑换码 1&#10;兑换码 2&#10;兑换码 3" :auto-size="{ minRows: 5, maxRows: 12 }" />
            </a-form-item>
            <p class="muted">已填写 {{ parsedCodes.length }} 个码{{ duplicateCodes ? '，有重复，请删除重复码' : '' }}。每人限兑一份，成功兑换才会占用一个码；补货在末尾追加即可，已发出的码不会再次发放。</p>
            <p v-if="editIndex >= 0" class="muted">保存前库存：已兑 {{ form.sold || 0 }} 份，码池内已发 {{ form.codeUsed || 0 }} 个，未发 {{ form.codeRemaining || 0 }} 个。修改码池不会改变用户已获得的码。</p>
          </template>
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
            <div class="prize-card-meta"><b>{{ form.cost || 0 }} 积分</b><span>{{ form.codeMode === 'unique' ? `独立兑换码 ${parsedCodes.length} 个` : form.stock === "" || form.stock == null ? "不限份数" : `共 ${form.stock} 份` }}</span></div>
          </div>
        </aside>
      </div>
    </a-modal>
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const rows = ref([]);
const loading = ref(false);
const saving = ref(false);
const open = ref(false);
const editIndex = ref(-1);
const form = reactive(blank());
const codeText = ref("");
const parsedCodes = computed(() => codeText.value.split(/\r?\n/).map((code) => code.trim()).filter(Boolean));
const duplicateCodes = computed(() => new Set(parsedCodes.value).size !== parsedCodes.value.length);
const columns = [
  { title: "编号", dataIndex: "id", width: 180 },
  { title: "名称", dataIndex: "title" },
  { title: "积分", dataIndex: "cost", width: 80 },
  { title: "已兑", dataIndex: "sold", width: 80 },
  { title: "库存 / 兑换码", slotName: "inventory", width: 220 },
  { title: "状态", slotName: "status", width: 90 },
  { title: "", slotName: "ops", width: 140 },
];

function blank() {
  return { id: "", title: "", desc: "", brand: "", badge: "", cost: 20, perPerson: 1, stock: "", status: "open", ends: "", icon: "", cover: "", url: "", key: "", codeMode: "shared", codes: [] };
}

function onModeChange(mode) {
  if (mode === "unique") form.perPerson = 1;
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
  codeText.value = (form.codes || []).join("\n");
  open.value = true;
}

function add() {
  editIndex.value = -1;
  Object.assign(form, blank());
  codeText.value = "";
  open.value = true;
}

function draftRow() {
  const { sold, rowKey, ...rest } = form;
  return { ...rest, codes: parsedCodes.value, stock: form.stock === "" || form.stock == null ? null : Number(form.stock) };
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
  if (duplicateCodes.value) {
    Message.error("兑换码有重复，请删除重复码后保存");
    return false;
  }
  const row = draftRow();
  const next = rows.value.slice();
  if (editIndex.value >= 0) next.splice(editIndex.value, 1, row);
  else next.push(row);
  return await persist(next);
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

<style scoped>
@media (max-width: 900px) {
  .prize-layout { grid-template-columns: minmax(0, 1fr); }
  .prize-preview { position: static; }
}
@media (max-width: 480px) {
  .prize-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
