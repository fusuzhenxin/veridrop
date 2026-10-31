<template>
  <a-layout class="shell">
    <a-layout-sider class="sider" :width="220" theme="light" breakpoint="lg" collapsible>
      <div class="brand">维渡运营</div>
      <a-menu class="sider-menu" :selected-keys="[section]" v-model:open-keys="openKeys" @menu-item-click="go">
        <a-menu-item key="/">
          <template #icon><IconDashboard /></template>
          总览
        </a-menu-item>
        <a-sub-menu key="catalog">
          <template #icon><IconFolder /></template>
          <template #title>目录</template>
          <a-menu-item key="/stations">
            <template #icon><IconStorage /></template>
            站档
          </a-menu-item>
          <a-menu-item key="/runs">
            <template #icon><IconHistory /></template>
            探测记录
          </a-menu-item>
          <a-menu-item key="/alerts">
            <template #icon><IconNotification /></template>
            告警
          </a-menu-item>
          <a-menu-item key="/changes">
            <template #icon><IconSwap /></template>
            今日变动
          </a-menu-item>
        </a-sub-menu>
        <a-sub-menu key="business">
          <template #icon><IconBarChart /></template>
          <template #title>经营</template>
          <a-menu-item key="/ads">
            <template #icon><IconTags /></template>
            广告
          </a-menu-item>
          <a-menu-item key="/traffic">
            <template #icon><IconThunderbolt /></template>
            流量
          </a-menu-item>
          <a-menu-item key="/spend">
            <template #icon><IconCommon /></template>
            探测花费
          </a-menu-item>
        </a-sub-menu>
        <a-sub-menu key="sites">
          <template #icon><IconDesktop /></template>
          <template #title>站点</template>
          <a-menu-item key="/sites">
            <template #icon><IconLink /></template>
            外链和仿站
          </a-menu-item>
          <a-menu-item key="/submissions">
            <template #icon><IconBookmark /></template>
            收录
          </a-menu-item>
          <a-menu-item key="/complaints">
            <template #icon><IconExclamationCircle /></template>
            投诉
          </a-menu-item>
        </a-sub-menu>
        <a-sub-menu key="system">
          <template #icon><IconApps /></template>
          <template #title>系统</template>
          <a-menu-item key="/publish">
            <template #icon><IconSend /></template>
            发布
          </a-menu-item>
          <a-menu-item key="/settings">
            <template #icon><IconSettings /></template>
            设置
          </a-menu-item>
        </a-sub-menu>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="top">
        <span class="top-title">{{ route.meta.title || "维渡运营" }}</span>
        <a-space>
          <span class="muted">{{ auth.me?.username }}</span>
          <a-button type="text" @click="logout">退出</a-button>
        </a-space>
      </a-layout-header>
      <a-layout-content class="main">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  IconApps,
  IconBarChart,
  IconBookmark,
  IconCommon,
  IconDashboard,
  IconDesktop,
  IconExclamationCircle,
  IconFolder,
  IconHistory,
  IconLink,
  IconNotification,
  IconSend,
  IconSettings,
  IconStorage,
  IconSwap,
  IconTags,
  IconThunderbolt,
} from "@arco-design/web-vue/es/icon";
import { api, auth } from "../api";

const route = useRoute();
const router = useRouter();
const section = computed(() => route.meta.section || route.path);
const groupOf = {
  "/stations": "catalog",
  "/runs": "catalog",
  "/alerts": "catalog",
  "/changes": "catalog",
  "/ads": "business",
  "/traffic": "business",
  "/spend": "business",
  "/sites": "sites",
  "/submissions": "sites",
  "/complaints": "sites",
  "/publish": "system",
  "/settings": "system",
};
const openKeys = ref(["catalog", "business", "sites", "system"]);

watch(section, (value) => {
  const group = groupOf[value];
  if (group && !openKeys.value.includes(group)) openKeys.value = [...openKeys.value, group];
});

function go(key) {
  router.push(key);
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  auth.me = null;
  auth.ready = true;
  router.push("/login");
}
</script>
