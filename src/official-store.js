import { useSyncExternalStore } from "react";
import { officialBoards, officialUpdated } from "./data.js";

const ORDER = ["openai", "anthropic", "gemini", "deepseek", "moonshot", "xai"];
const STORAGE_KEY = "veridrop-official-live";

function liveBoards(boards, liveIds) {
  const allowed = new Set(liveIds);
  return officialBoards.map((old) => {
    const row = (boards || []).find((item) => item?.provider === old.provider);
    if (!row || !allowed.has(old.provider) || row.level === "unknown") return old;
    return row;
  });
}

function readSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.boards) || !Array.isArray(parsed.live)) return null;
    const time = new Date(parsed.updatedAt);
    const snapshotTime = new Date(officialUpdated);
    if (Number.isNaN(time.getTime()) || time.getTime() <= snapshotTime.getTime()) return null;
    const live = parsed.live.filter((id) => ORDER.includes(id));
    if (!live.length) return null;
    return { updatedAt: time.toISOString(), boards: liveBoards(parsed.boards, live) };
  } catch {
    return null;
  }
}

function writeSaved(next, live) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      updatedAt: next.updatedAt,
      live,
      boards: next.boards,
    }));
  } catch {
    // The bar still shows for this page when storage is full or blocked.
  }
}

const saved = typeof window !== "undefined" ? readSaved() : null;
let state = {
  boards: saved?.boards || officialBoards,
  updatedAt: saved?.updatedAt || officialUpdated,
  note: "",
  busy: false,
};
const listeners = new Set();
let inflight = null;

function emit(next) {
  state = next;
  for (const listener of listeners) listener();
}

export function getOfficialSnapshot() {
  return state;
}

export function subscribeOfficial(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOfficialStatus() {
  return useSyncExternalStore(subscribeOfficial, getOfficialSnapshot, getOfficialSnapshot);
}

function mergeOfficial(prev, next) {
  return next.map((row) => {
    if (row && row.level !== "unknown") return row;
    const old = (prev || []).find((item) => item.provider === row?.provider);
    return old && old.level !== "unknown" ? old : row;
  }).filter(Boolean);
}

async function fetchOne(provider) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`/api/official/${provider}`, { cache: "no-store", signal: controller.signal });
    const row = await response.json();
    if (!response.ok || !row || row.provider !== provider || row.level === "unknown") {
      return { provider, level: "unknown" };
    }
    return row;
  } catch {
    return { provider, level: "unknown" };
  } finally {
    window.clearTimeout(timer);
  }
}

export function refreshOfficialStatus(options = {}) {
  const quiet = options.quiet === true;
  if (inflight) return inflight;
  const previous = state;
  emit({ ...previous, busy: true, note: quiet ? "" : "正在同步官方状态…" });
  inflight = (async () => {
    const next = await Promise.all(ORDER.map((provider) => fetchOne(provider)));
    const fresh = next.filter((row) => row && row.level !== "unknown");
    if (!fresh.length) {
      emit({ ...previous, busy: false, note: quiet ? "" : "今天的官方状态没有同步成功" });
    } else {
      const updated = {
        boards: mergeOfficial(previous.boards, next),
        updatedAt: new Date().toISOString(),
        note: "",
        busy: false,
      };
      writeSaved(updated, fresh.map((row) => row.provider));
      emit(updated);
    }
    inflight = null;
  })();
  return inflight;
}

if (typeof window !== "undefined") refreshOfficialStatus({ quiet: true });
