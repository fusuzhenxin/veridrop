import { reactive } from "vue";

export const auth = reactive({ me: null, ready: false });

export const MODE = {
  public: "公开状态页",
  auth: "要登录才看得到",
  plaza: "模型广场",
  none: "没有状态",
};

export const TIER = {
  ad: "广告位每天",
  featured: "首页推荐每天",
  traffic: "有流量每天",
  longtail: "长尾每周",
};

export const SLOT = {
  sponsor: "全站赞助",
  list_top: "列表页顶部",
  footer: "全站页脚",
};

export const SOURCE = {
  main: "主站",
  external: "外链站",
  replica: "仿站",
};

export function dayText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayText() {
  return dayText(new Date());
}

export async function api(path, options = {}) {
  const headers = { "X-Ops": "1", ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (response.status === 401) {
    auth.me = null;
    auth.ready = true;
    if (!location.pathname.endsWith("/login")) location.assign("/login");
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
