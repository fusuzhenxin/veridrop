<template>
  <div class="login-page">
    <a-card class="login-card" :bordered="true">
      <h1>维渡运营</h1>
      <p class="muted">中转站、广告、外链站和收录都在这里处理。</p>
      <a-form :model="form" layout="vertical" style="margin-top: 20px">
        <a-form-item field="username" label="账号">
          <a-input v-model="form.username" placeholder="admin" allow-clear @press-enter="submit" />
        </a-form-item>
        <a-form-item field="password" label="密码">
          <a-input-password v-model="form.password" placeholder="密码" @press-enter="submit" />
        </a-form-item>
        <a-button type="primary" long :loading="loading" @click="submit">登录</a-button>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { api, auth } from "../api";

const router = useRouter();
const loading = ref(false);
const form = reactive({ username: "admin", password: "" });

async function submit() {
  if (!form.username || !form.password) {
    Message.warning("请填写账号和密码");
    return;
  }
  loading.value = true;
  try {
    auth.me = await api("/api/login", { method: "POST", body: JSON.stringify(form) });
    auth.ready = true;
    router.push("/");
  } catch (err) {
    Message.error(err.message);
  } finally {
    loading.value = false;
  }
}
</script>
