import { createRouter, createWebHistory } from "vue-router";
import { api, auth } from "./api";
import Shell from "./layouts/Shell.vue";
import Login from "./pages/Login.vue";
import Dashboard from "./pages/Dashboard.vue";
import Stations from "./pages/Stations.vue";
import StationForm from "./pages/StationForm.vue";
import Runs from "./pages/Runs.vue";
import RunDetail from "./pages/RunDetail.vue";
import Alerts from "./pages/Alerts.vue";
import Ads from "./pages/Ads.vue";
import AdForm from "./pages/AdForm.vue";
import Traffic from "./pages/Traffic.vue";
import Sites from "./pages/Sites.vue";
import SiteForm from "./pages/SiteForm.vue";
import Submissions from "./pages/Submissions.vue";
import SubmissionForm from "./pages/SubmissionForm.vue";
import Complaints from "./pages/Complaints.vue";
import ComplaintForm from "./pages/ComplaintForm.vue";
import Changes from "./pages/Changes.vue";
import Spend from "./pages/Spend.vue";
import Publish from "./pages/Publish.vue";
import Settings from "./pages/Settings.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: Login, meta: { title: "登录" } },
    {
      path: "/",
      component: Shell,
      children: [
        { path: "", component: Dashboard, meta: { title: "总览", section: "/" } },
        { path: "stations", component: Stations, meta: { title: "站档", section: "/stations" } },
        { path: "stations/new", component: StationForm, meta: { title: "新建中转站", section: "/stations" } },
        { path: "stations/:id", component: StationForm, meta: { title: "编辑中转站", section: "/stations" } },
        { path: "runs", component: Runs, meta: { title: "探测记录", section: "/runs" } },
        { path: "runs/:id", component: RunDetail, meta: { title: "探测详情", section: "/runs" } },
        { path: "alerts", component: Alerts, meta: { title: "告警", section: "/alerts" } },
        { path: "ads", component: Ads, meta: { title: "广告", section: "/ads" } },
        { path: "ads/new", component: AdForm, meta: { title: "新建广告", section: "/ads" } },
        { path: "ads/:id", component: AdForm, meta: { title: "编辑广告", section: "/ads" } },
        { path: "traffic", component: Traffic, meta: { title: "流量", section: "/traffic" } },
        { path: "sites", component: Sites, meta: { title: "外链和仿站", section: "/sites" } },
        { path: "sites/new", component: SiteForm, meta: { title: "登记站点", section: "/sites" } },
        { path: "sites/:id", component: SiteForm, meta: { title: "编辑站点", section: "/sites" } },
        { path: "submissions", component: Submissions, meta: { title: "收录", section: "/submissions" } },
        { path: "submissions/new", component: SubmissionForm, meta: { title: "新建申请", section: "/submissions" } },
        { path: "submissions/:id", component: SubmissionForm, meta: { title: "处理申请", section: "/submissions" } },
        { path: "complaints", component: Complaints, meta: { title: "投诉", section: "/complaints" } },
        { path: "complaints/new", component: ComplaintForm, meta: { title: "新建投诉", section: "/complaints" } },
        { path: "complaints/:id", component: ComplaintForm, meta: { title: "编辑投诉", section: "/complaints" } },
        { path: "changes", component: Changes, meta: { title: "今日变动", section: "/changes" } },
        { path: "spend", component: Spend, meta: { title: "探测花费", section: "/spend" } },
        { path: "publish", component: Publish, meta: { title: "发布", section: "/publish" } },
        { path: "settings", component: Settings, meta: { title: "设置", section: "/settings" } },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  if (!auth.ready) {
    try {
      auth.me = await api("/api/me");
    } catch {
      auth.me = null;
    }
    auth.ready = true;
  }
  if (to.path === "/login") return auth.me ? "/" : true;
  if (!auth.me) return "/login";
  return true;
});

export default router;
