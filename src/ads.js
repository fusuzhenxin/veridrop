import { useEffect, useState } from "react";

let current = null;
let pending = null;
let checkedAt = 0;
const listeners = new Set();

function refresh() {
  if (pending || Date.now() - checkedAt < 15_000) return;
  checkedAt = Date.now();
  pending = fetch("/api/public/ads", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("ads unavailable");
      const { ads } = await response.json();
      if (!ads || !["sponsor", "listTop", "footer"].every((key) => Array.isArray(ads[key]))) return;
      current = ads;
      listeners.forEach((listener) => listener(ads));
    })
    .catch(() => {})
    .finally(() => { pending = null; });
}

export function useAds() {
  const [ads, setAds] = useState(null);
  useEffect(() => {
    setAds(current);
    listeners.add(setAds);
    refresh();
    const visible = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(visible, 30_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      listeners.delete(setAds);
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return ads;
}
