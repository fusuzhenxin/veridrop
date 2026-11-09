<template>
  <a-card title="站点公告" class="notice-editor">
    <p class="notice-help">左侧编辑，右侧实时预览。点击保存后更新前台，无需重新生成页面。访客关闭后，同一版公告不再重复弹出；内容更新后会再显示一次。</p>
    <a-alert v-if="loadError" type="error" class="notice-load-error">
      {{ loadError }} <a-button type="text" @click="load">重新加载</a-button>
    </a-alert>
    <a-spin :loading="loading" class="notice-editor-spin">
      <div class="notice-editor-layout">
        <a-form :model="form" layout="vertical" :disabled="!loaded || saving">
          <a-form-item label="显示公告">
            <a-switch v-model="form.enabled" />
          </a-form-item>
          <a-form-item label="公告图标">
            <div class="notice-icon-field">
              <label class="notice-icon-upload" :class="{ busy: uploading }">
                <img :src="iconSrc" alt="当前公告图标" @error="iconError = true" />
                <span>{{ uploading ? '上传中…' : '上传图标' }}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传公告图标" :disabled="uploading || saving || !loaded" @change="uploadIcon" />
              </label>
              <div class="notice-icon-help">
                <p>建议使用正方形图标</p>
                <p>PNG、JPG、WebP 或 GIF，2MB 以内</p>
                <a-button type="text" size="small" :disabled="uploading || form.icon === DEFAULT_ICON" @click="useDefaultIcon">使用默认图标</a-button>
              </div>
            </div>
          </a-form-item>
          <div class="notice-form-row">
            <a-form-item label="标题">
              <a-input v-model="form.title" :max-length="80" placeholder="请输入公告标题" />
            </a-form-item>
            <a-form-item label="日期">
              <a-input v-model="form.date" placeholder="YYYY-MM-DD" :max-length="10" />
            </a-form-item>
          </div>
          <a-form-item label="正文">
            <a-textarea v-model="form.body" :max-length="500" show-word-limit placeholder="请输入公告内容，支持换行" :auto-size="{ minRows: 5, maxRows: 12 }" />
          </a-form-item>
          <a-form-item label="按钮文字">
            <a-input v-model="form.actionLabel" :max-length="20" placeholder="例如：去兑换；留空则隐藏跳转按钮" />
          </a-form-item>
          <a-form-item label="按钮链接">
            <a-input v-model="form.actionTo" placeholder="/points#redeem" />
          </a-form-item>
          <a-button type="primary" :loading="saving" :disabled="uploading || !loaded" @click="save">保存公告</a-button>
          <span class="notice-save-hint">预览不会自动保存</span>
        </a-form>
        <aside class="notice-live-preview" aria-label="公告实时预览">
          <div class="notice-preview-heading">
            <strong>前台效果预览</strong>
            <a-tag :color="form.enabled ? 'green' : 'gray'">{{ form.enabled ? '显示中' : '已关闭' }}</a-tag>
          </div>
          <p class="notice-preview-note">{{ form.enabled ? '内容随编辑同步变化，按钮仅作展示。' : '当前已关闭，保存后前台不会弹出公告。' }}</p>
          <div class="notice-preview-stage">
            <article class="notice-preview-box">
              <header class="notice-preview-hero">
                <span class="notice-preview-x" aria-hidden="true">×</span>
                <span class="notice-preview-logo"><img :src="iconSrc" alt="" @error="iconError = true" /></span>
                <em>站点公告</em>
                <h2>{{ form.title.trim() || '公告标题' }}</h2>
                <time v-if="form.date">{{ form.date }}</time>
              </header>
              <div class="notice-preview-body">
                <p>{{ form.body.trim() || '公告内容会显示在这里。' }}</p>
                <div class="notice-preview-actions">
                  <button type="button" class="notice-preview-skip" @click="previewHint">知道了</button>
                  <button v-if="showAction" type="button" class="notice-preview-go" @click="previewHint">{{ form.actionLabel.trim() }}</button>
                </div>
              </div>
            </article>
          </div>
          <div v-if="showAction" class="notice-preview-target">按钮跳转：<span>{{ form.actionTo.trim() }}</span></div>
        </aside>
      </div>
    </a-spin>
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Message } from "@arco-design/web-vue";
import { api } from "../api";

const saving = ref(false);
const uploading = ref(false);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");
const iconError = ref(false);
const DEFAULT_ICON = "/icons/vendor/deepseek.svg";
const form = reactive({ enabled: true, icon: DEFAULT_ICON, title: "", date: "", body: "", actionLabel: "", actionTo: "" });
const iconSrc = computed(() => iconError.value ? DEFAULT_ICON : form.icon || DEFAULT_ICON);
const showAction = computed(() => Boolean(form.actionLabel.trim() && form.actionTo.trim()));
watch(() => form.icon, () => { iconError.value = false; });

function useDefaultIcon() {
  form.icon = DEFAULT_ICON;
  iconError.value = false;
}

function previewHint() {
  Message.info("这是效果预览，不会跳转或保存公告");
}

async function uploadIcon(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 2_000_000) {
    Message.error("请上传 2MB 以内的 PNG、JPG、WebP 或 GIF 图片");
    return;
  }
  uploading.value = true;
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片没有读出来"));
      reader.readAsDataURL(file);
    });
    const saved = await api("/api/notice/upload", { method: "POST", body: JSON.stringify({ name: file.name, data }) });
    form.icon = saved.url;
    Message.success("图标已上传，保存公告后对前台生效");
  } catch (err) {
    Message.error(err.message);
  } finally {
    uploading.value = false;
  }
}

async function load() {
  loading.value = true;
  loadError.value = "";
  loaded.value = false;
  try {
    const data = await api("/api/notice");
    Object.assign(form, data, { icon: data.icon || DEFAULT_ICON });
    loaded.value = true;
  } catch (err) {
    loadError.value = err.message || "公告没有加载成功";
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!loaded.value || uploading.value || saving.value) return;
  if (!form.title.trim() || !form.body.trim()) {
    Message.error("标题和正文都要填");
    return;
  }
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

<style scoped>
.notice-editor { max-width: 1200px; }
.notice-help { margin: 0 0 24px; color: #86909c; font-size: 13px; line-height: 1.8; }
.notice-load-error { margin-bottom: 20px; }
.notice-editor-spin { display: block; width: 100%; }
.notice-editor-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 508px); gap: 32px; align-items: start; }
.notice-form-row { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; }
.notice-icon-field { display: flex; gap: 16px; align-items: center; }
.notice-icon-upload { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: 100px; height: 100px; flex: none; border: 1px dashed #c9cdd4; border-radius: 14px; background: #f7f8fa; font-size: 12px; color: #4e5969; overflow: hidden; cursor: pointer; }
.notice-icon-upload:hover, .notice-icon-upload:focus-within { border-color: #165dff; }
.notice-icon-upload img { width: 44px; height: 44px; object-fit: contain; }
.notice-icon-upload input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.notice-icon-upload.busy { opacity: .6; }
.notice-icon-help p { margin: 0 0 6px; color: #86909c; font-size: 12px; }
.notice-icon-help :deep(.arco-btn) { padding-left: 0; }
.notice-save-hint { margin-left: 12px; color: #86909c; font-size: 12px; }
.notice-live-preview { position: sticky; top: 20px; min-width: 0; }
.notice-preview-heading { display: flex; align-items: center; justify-content: space-between; }
.notice-preview-heading strong { font-size: 14px; }
.notice-preview-note { margin: 8px 0 16px; color: #86909c; font-size: 12px; line-height: 1.7; }
.notice-preview-stage { display: grid; place-items: center; padding: 28px 24px; background: #eef1e9; border: 1px solid #e5e9df; border-radius: 16px; }
.notice-preview-box { width: 100%; max-width: 460px; overflow: hidden; border-radius: 20px; background: #fff; box-shadow: 0 10px 32px #2335101a; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: -.16px; }
.notice-preview-hero { position: relative; padding: 28px 24px 22px; background: radial-gradient(ellipse at 12% 0%, #ffffff2e, transparent 46%), linear-gradient(160deg, #3f6212 0%, #65a30d 58%, #4d7c0f 100%); color: #fff; }
.notice-preview-logo { display: grid; place-items: center; width: 64px; height: 64px; background: #fff; border-radius: 18px; box-shadow: 0 8px 20px #0000002e; }
.notice-preview-logo img { display: block; width: 40px; height: 40px; object-fit: contain; }
.notice-preview-hero em { display: block; margin-top: 14px; font-size: 12px; font-style: normal; font-weight: 700; letter-spacing: .14em; color: #ecfccb; }
.notice-preview-hero h2 { margin: 6px 0 0; font-size: 28px; letter-spacing: -.04em; line-height: 1.2; color: #fff; overflow-wrap: anywhere; }
.notice-preview-hero time { display: block; margin-top: 8px; font-size: 13px; color: #ffffffc7; }
.notice-preview-x { position: absolute; top: 12px; right: 12px; display: grid; place-items: center; width: 36px; height: 36px; background: #ffffff2e; border-radius: 50%; color: #fff; font-size: 22px; line-height: 1; }
.notice-preview-body { padding: 22px 24px; }
.notice-preview-body p { margin: 0; color: #1d1d1f; font-size: 15px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.notice-preview-actions { display: flex; gap: 10px; margin-top: 20px; }
.notice-preview-actions button { height: 46px; padding: 0 16px; border-radius: 12px; font: inherit; font-weight: 650; cursor: pointer; }
.notice-preview-skip { flex: none; border: 1px solid #e5e6eb; background: #fff; color: #1d2129; }
.notice-preview-actions .notice-preview-go { flex: 1; min-width: 0; border: none; background: #65a30d; color: #fff; font-size: 16px; font-weight: 750; overflow-wrap: anywhere; }
.notice-preview-target { margin-top: 12px; font-size: 12px; color: #86909c; line-height: 1.7; overflow-wrap: anywhere; }
.notice-preview-target span { color: #4e5969; }
@media (max-width: 1150px) {
  .notice-editor-layout { grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .notice-live-preview { position: static; }
  .notice-preview-stage { padding: 24px 16px; }
}
@media (max-width: 600px) {
  .notice-form-row { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .notice-icon-field { gap: 12px; }
  .notice-preview-stage { padding: 20px 12px; }
}
</style>
