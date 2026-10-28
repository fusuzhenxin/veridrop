import { applyRemoteAccount, readAvatar, readFavs, readSubmissions } from "./account.js";
import { readPoints } from "./points.js";

const TOKEN = "veridrop-token";

export function authToken() {
  return localStorage.getItem(TOKEN) || "";
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(TOKEN, token);
  else localStorage.removeItem(TOKEN);
}

export function voteKey(station) {
  if (!station) return "";
  if (station.verdId != null && station.verdId !== "") return String(station.verdId);
  return station.slug || "";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = authToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const error = new Error(data.error || "请先登录");
    error.status = 401;
    throw error;
  }
  if (!res.ok) throw new Error(data.error || "接口没有记下");
  return data;
}

export function registerAccount(body) {
  return api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function loginAccount(body) {
  return api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function resetAccount(body) {
  return api("/api/auth/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateProfile(body) {
  return api("/api/auth/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function changePassword(body) {
  return api("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function stationVoteId(station) {
  if (!station) return "";
  if (station.verdId != null && station.verdId !== "") {
    const text = String(station.verdId).trim();
    if (/^\d+$/.test(text)) return String(Number(text));
  }
  return station.slug || "";
}

export function fetchVotes() {
  return api("/api/votes");
}

export function sendVote(id, dir) {
  return api("/api/votes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, dir }),
  });
}

export function fetchComments(slug) {
  const query = slug ? `?slug=${encodeURIComponent(slug)}` : "";
  return api(`/api/comments${query}`);
}

export function fetchPoints() {
  return api("/api/points");
}

export function sendPoints(id) {
  return api("/api/points", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export function fetchAccount() {
  return api("/api/account");
}

export function saveAvatar(avatar) {
  return api("/api/account/avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatar }),
  });
}

export function saveFavorite(slug, on) {
  return api("/api/account/favorite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, on }),
  });
}

export function saveSubmission(entry) {
  return api("/api/account/submission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function pullAccount() {
  if (!authToken()) return null;
  let data = await fetchAccount();
  const migrated = localStorage.getItem("okk-account-migrated") === data.email;
  if (!migrated) {
    data = await api("/api/account/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar: readAvatar(),
        favorites: Object.keys(readFavs()),
        submissions: readSubmissions(),
        ledger: readPoints().ledger,
      }),
    });
    localStorage.setItem("okk-account-migrated", data.email);
  }
  applyRemoteAccount(data);
  return data;
}

export function sendCheckin() {
  return api("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

export function sendComment(body) {
  return api("/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
