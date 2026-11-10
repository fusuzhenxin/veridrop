<template>
  <a-card :title="id ? '编辑广告' : '新建广告'" class="ad-editor">
    <p class="muted">左侧编辑，右侧实时预览。保存后按档期自动展示，暂停或到期自动撤下，无需重新构建前台。</p>
    <a-spin :loading="loading" style="display: block">
      <div class="ad-editor-layout">
        <a-form :model="form" layout="vertical">
          <a-form-item label="投放位置" required>
            <a-radio-group v-model="form.slot" direction="vertical">
              <a-radio value="sponsor">全站赞助位 · 电脑左右下角 / 手机导航下方（列表页、站点详情页除外），最多 2 条</a-radio>
              <a-radio value="list_top">站点列表页赞助区 · 同时最多 4 条</a-radio>
              <a-radio value="footer">全站页脚 · 仅各页底部赞助区，不限条数</a-radio>
              <a-radio value="list_footer">列表页加页脚 · 同时投放两个位置</a-radio>
              <a-radio value="full">全包 · 全站赞助位 + 列表页顶部 + 全站页脚</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item label="广告名称" required><a-input v-model="form.name" :max-length="40" show-word-limit placeholder="品牌或站点名称" /></a-form-item>
          <a-form-item label="简短介绍" extra="最多 40 个字，前台统一标注「赞助」。"><a-input v-model="form.blurb" :max-length="40" show-word-limit /></a-form-item>
          <a-form-item label="详细文案"><a-textarea v-model="form.description" :max-length="500" show-word-limit :auto-size="{ minRows: 3, maxRows: 7 }" placeholder="补充活动内容或服务介绍，卡片最多展示三行" /></a-form-item>
          <a-form-item label="广告图片" extra="建议比例 920:350，支持 PNG、JPG、WebP、GIF，最大 2MB。">
            <div class="ad-image-fields">
              <div class="ad-upload-row">
                <label class="ad-upload-button">{{ uploading ? '正在上传…' : '上传图片' }}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="uploading || saving || loading" aria-label="上传广告图片" @change="uploadImage" /></label>
                <a-button v-if="form.image_url" :disabled="uploading" @click="form.image_url = ''">移除图片</a-button>
              </div>
              <a-input v-model="form.image_url" placeholder="也可以填写 https:// 开头的图片地址" />
            </div>
          </a-form-item>
          <a-form-item label="跳转地址" required><a-input v-model="form.target_url" placeholder="https://" /></a-form-item>
          <a-row :gutter="16"><a-col :span="12"><a-form-item label="开始日（北京时间）" required><a-date-picker v-model="form.start_date" style="width: 100%" /></a-form-item></a-col><a-col :span="12"><a-form-item label="到期撤下日" extra="不包含当天。" required><a-date-picker v-model="form.end_date" style="width: 100%" /></a-form-item></a-col></a-row>
          <a-form-item label="暂停投放"><a-switch v-model="form.paused" /></a-form-item>
          <a-space><a-button type="primary" :loading="saving" :disabled="uploading || loading" @click="save">保存广告</a-button><a-button @click="router.push('/ads')">返回列表</a-button></a-space>
          <p class="muted">预览不会自动保存，预览卡片也不会记录浏览或点击。</p>
        </a-form>
        <aside class="ad-live-preview" aria-label="广告实时预览">
          <div class="ad-preview-heading"><strong>前台效果预览</strong><a-radio-group v-model="device" type="button" size="small"><a-radio value="desktop">电脑</a-radio><a-radio value="mobile">手机</a-radio></a-radio-group></div>
          <p class="muted">{{ positionText }} · {{ scheduleText }}</p>
          <a-radio-group v-if="previewPositions.length > 1" v-model="previewPlace" type="button" size="small" class="ad-preview-positions"><a-radio v-for="position in previewPositions" :key="position" :value="position">{{ previewLabels[position] }}</a-radio></a-radio-group>
          <div class="ad-preview-stage" :class="{ 'ad-preview-corners': previewPlace === 'sides', 'ad-preview-phone': device === 'mobile' }">
            <div v-if="previewPlace === 'sides'" class="ad-preview-page"><div>网站导航</div><strong>页面正文</strong><p>{{ device === 'mobile' ? '赞助条在导航下方，随页面滚动' : '左右角标固定在下角，不占正文位置' }}</p><small>列表页、站点详情页不显示此赞助位</small></div>
            <div class="ad-preview-section" :class="[device, { 'ad-preview-side': previewPlace === 'sides' }]">
              <div class="ad-preview-section-title">赞助商 <span>成为赞助商</span><i>×</i></div>
              <div :class="{ 'sp-side-shell': previewPlace === 'sides', 'sp-side-mobile': previewPlace === 'sides' && device === 'mobile' }">
              <div v-if="previewPlace === 'sides'" class="sp-side-head"><span><i aria-hidden="true" />赞助商</span><button type="button" class="sponsor-rail-close" aria-label="预览关闭按钮" @click="previewHint"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg></button></div>
              <article class="sp-card" :class="{ 'sp-side-card': previewPlace === 'sides' }" @click="previewHint">
                <div class="sp-art"><img v-if="imageSrc && !imageError" :src="imageSrc" alt="广告图片预览" @error="imageError = true" /><span v-else class="sp-initial">{{ (form.name.trim() || '广').slice(0, 1) }}</span></div>
                <div class="bd"><b><span>{{ form.name.trim() || '广告名称' }}</span><span v-if="previewPlace !== 'sides'" class="sp-flag">赞助</span></b><span v-if="form.blurb" class="sp-line">{{ form.blurb }}</span><span v-if="form.description" class="sp-desc">{{ form.description }}</span></div>
                <span v-if="previewPlace === 'sides'" class="sp-side-action"><span>访问站点</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg></span>
              </article>
              </div>
            </div>
          </div>
          <p v-if="imageError" class="ad-preview-error">图片无法显示，请检查地址或重新上传。</p>
          <div class="ad-preview-target">点击后前往：<span>{{ form.target_url || '尚未填写跳转地址' }}</span></div>
        </aside>
      </div>
    </a-spin>
    <a-table v-if="daily.length" style="margin-top: 24px" :columns="columns" :data="daily" :pagination="false" row-key="day" />
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api, dayText, todayText } from "../api";
import "../../../src/sponsor-card.css";

const route = useRoute(), router = useRouter();
const id = ref(route.params.id && route.params.id !== "new" ? String(route.params.id) : "");
const saving = ref(false), loading = ref(false), uploading = ref(false), imageError = ref(false), device = ref("desktop"), daily = ref([]);
const defaults = () => ({ slot: "footer", name: "", blurb: "", description: "", image_url: "", target_url: "", start_date: todayText(), end_date: "", paused: false });
const form = reactive(defaults());
const columns = [{ title: "日期", dataIndex: "day" }, { title: "浏览", dataIndex: "impressions" }, { title: "点击", dataIndex: "clicks" }];
const previewLabels = { sides: "全站赞助位", list: "列表页顶部", footer: "全站页脚" };
const previewPositions = computed(() => ({ sponsor: ["sides"], list_top: ["list"], footer: ["footer"], list_footer: ["list", "footer"], full: ["sides", "list", "footer"] })[form.slot] || ["footer"]);
const previewPlace = ref("footer");
watch(() => form.slot, () => { previewPlace.value = previewPositions.value[0]; }, { immediate: true });
const positionText = computed(() => ({ sponsor: "电脑左右下角，手机导航下方；列表页和站点详情页除外", list_top: "仅 /list 标题和筛选之间", footer: "所有页面正文结束、页脚菜单之前", list_footer: "列表页顶部 + 全站页脚", full: "全包：全站赞助位 + 列表页顶部 + 全站页脚" })[form.slot]);
const scheduleText = computed(() => {
  if (form.paused) return "已暂停，保存后不展示";
  const start = dayText(form.start_date), end = dayText(form.end_date), today = todayText();
  if (!start || !end) return "请设置投放档期";
  if (end <= start) return "到期日须晚于开始日";
  return today < start ? "等待开始" : today >= end ? "已到期" : "在投放期内";
});
const imageSrc = computed(() => {
  const value = form.image_url.trim();
  return /^\/media\/(ads|sponsors)\/[\w.-]+\.(png|jpe?g|webp|gif)$/.test(value) || /^https?:\/\//i.test(value) ? value : "";
});
watch(() => form.image_url, () => { imageError.value = false; });
watch(() => route.params.id, (value) => {
  const next = value && value !== "new" ? String(value) : "";
  if (next === id.value) return;
  id.value = next;
  Object.assign(form, defaults()); daily.value = [];
  load();
});
function previewHint() { Message.info("这是效果预览，不会跳转或计数"); }
async function uploadImage(event) {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 2_000_000) { Message.error("请上传 2MB 以内的 PNG、JPG、WebP 或 GIF 图片"); return; }
  uploading.value = true;
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("图片没有读出来")); reader.readAsDataURL(file); });
    form.image_url = (await api("/api/ads/upload", { method: "POST", body: JSON.stringify({ data }) })).url;
    Message.success("图片已上传，保存广告后生效");
  } catch (err) { Message.error(err.message); } finally { uploading.value = false; }
}
async function load() {
  if (!id.value) return;
  loading.value = true;
  try { const row = await api("/api/ads/" + id.value); Object.assign(form, row, { paused: !!row.paused }); daily.value = row.daily || []; }
  catch (err) { Message.error(err.message); router.push("/ads"); }
  finally { loading.value = false; }
}
async function save() {
  if (!form.name.trim() || !form.target_url.trim() || !form.start_date || !form.end_date) { Message.warning("请填写名称、跳转地址和档期"); return; }
  if (dayText(form.start_date) >= dayText(form.end_date)) { Message.warning("到期日要晚于开始日"); return; }
  saving.value = true;
  try {
    const saved = await api(id.value ? "/api/ads/" + id.value : "/api/ads", { method: "POST", body: JSON.stringify({ ...form, start_date: dayText(form.start_date), end_date: dayText(form.end_date) }) });
    Object.assign(form, saved, { paused: !!saved.paused });
    Message.success("已保存，前台按投放档期自动更新");
    if (!id.value) { id.value = String(saved.id); router.replace("/ads/" + saved.id); }
  } catch (err) { Message.error(err.message); } finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.ad-editor-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(330px, .9fr); gap: 40px; margin-top: 24px; }
.ad-image-fields { width: 100%; display: grid; gap: 10px; }
.ad-upload-row, .ad-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ad-upload-row { justify-content: flex-start; }
.ad-upload-button { position: relative; padding: 7px 15px; border: 1px solid #c9cdd4; border-radius: 4px; cursor: pointer; }
.ad-upload-button input { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer; }
.ad-live-preview { position: sticky; top: 20px; align-self: start; min-width: 0; --line: #e5e5ea; --card: #fff; --chip: #f3f4f6; --faint: #8b8b90; --fg: #1d1d1f; }
.ad-preview-stage { padding: 30px 18px; border: 1px solid #e5e9df; background: #f3f5ef; border-radius: 14px; display: grid; justify-items: center; }
.ad-preview-section { width: 100%; max-width: 304px; padding: 16px; border: 1px solid #e5e5ea; border-radius: 16px; background: #fff; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.ad-preview-section.mobile { max-width: 374px; }
.ad-preview-section-title { display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 650; margin-bottom: 12px; }
.ad-preview-section-title span { font-size: 12px; color: #65a30d; font-weight: 400; }
.ad-preview-section-title i { margin-left: auto; font-style: normal; color: #8b8b90; }
.ad-preview-target { margin-top: 16px; color: #86909c; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.ad-preview-target span { color: #4e5969; }
.ad-preview-error { color: #f53f3f; }
.ad-preview-positions { margin: 0 0 12px; }
.ad-preview-corners { position: relative; min-height: 390px; align-items: end; justify-items: start; overflow: hidden; }
.ad-preview-page { position: absolute; inset: 16px 18%; border: 1px solid #e5e5ea; border-radius: 8px; background: #fff; text-align: center; color: #86909c; padding: 0 12px; font-size: 12px; }
.ad-preview-page > div { border-bottom: 1px solid #ececee; padding: 14px 0; margin-bottom: 24px; }
.ad-preview-page p, .ad-preview-page small { display: block; line-height: 1.8; }
.ad-preview-side { z-index: 1; width: 240px; padding: 0; border: 0; background: transparent; }
.ad-preview-side .ad-preview-section-title { display: none; }
.ad-preview-phone.ad-preview-corners { max-width: 374px; margin: auto; min-height: 430px; }
.ad-preview-phone .ad-preview-side { position: absolute; top: 79px; left: 14px; right: 14px; width: auto; max-width: none; }
.ad-preview-phone .ad-preview-page { inset: 16px 0; border-left: 0; border-right: 0; }
.ad-preview-phone .ad-preview-page > div { margin-bottom: 110px; }
@media (max-width: 1050px) { .ad-editor-layout { grid-template-columns: 1fr; gap: 24px; } .ad-live-preview { position: static; } }
</style>
