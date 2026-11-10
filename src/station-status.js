import { useEffect, useState } from "react";

const supported = new Set(["3", "479"]);
const cache = new Map();

export function mergeStatusModels(catalog, monitored) {
  const keys = new Set(monitored.map((row) => `${row.id}|${row.group}`));
  const placeholders = /^(gpt|claude|gemini|grok)$/i;
  return [
    ...monitored.map((row) => {
      const price = catalog.find((item) => item.id === row.id && item.group === row.group);
      return { ...price, ...row, input: price?.input ?? row.input, output: price?.output ?? row.output,
        cache: price?.cache ?? row.cache, ratio: price?.ratio ?? row.ratio, currency: price?.currency };
    }),
    ...catalog.filter((row) => !placeholders.test(row.id) && !keys.has(`${row.id}|${row.group}`)),
  ];
}

export function useStationStatus(station, period) {
  const id = String(station?.verdId || "");
  const enabled = supported.has(id);
  const key = `${id}:${period}`;
  const [state, setState] = useState({ key: "", data: null, loading: false, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let stop = false;
    const controller = new AbortController();
    const previous = cache.get(key);
    if (previous && Date.now() - previous.at < 300_000) {
      setState({ key, data: previous.data, loading: false, error: "" });
      return undefined;
    }
    setState({ key, data: null, loading: true, error: "" });
    const timer = setTimeout(() => controller.abort(), 25_000);
    fetch(`/api/station-status?station=${id}&period=${period}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.period !== period || !Array.isArray(data.models) || !data.models.length) throw new Error("status");
        return data;
      })
      .then((data) => {
        if (stop) return;
        cache.set(key, { at: Date.now(), data });
        setState({ key, data, loading: false, error: "" });
      })
      .catch(() => {
        if (!stop) setState({ key, data: null, loading: false, error: "暂时未能读取站方监测数据" });
      })
      .finally(() => clearTimeout(timer));
    return () => { stop = true; clearTimeout(timer); controller.abort(); };
  }, [enabled, key, id, period, attempt]);
  return { enabled, ...(state.key === key ? state : { data: null, loading: enabled, error: "" }), retry: () => { cache.delete(key); setAttempt((value) => value + 1); } };
}
