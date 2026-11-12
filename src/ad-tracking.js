import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAds } from "./ads.js";

const selector = "[data-ad-id], [data-vd-station]";
const hostOf = (value) => { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const eventId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
export function sponsorHref(href, place, path) {
  const query = new URLSearchParams({ placement: place, path, surface: "banner" });
  return `${href}?${query}`;
}

export function useAdAnalytics() {
  const ads = useAds();
  const location = useLocation();
  const signature = JSON.stringify(ads);
  useEffect(() => {
    if (!ads) return;
    const activeHosts = new Set(Object.values(ads).flat().map(ad => ad.targetHost).filter(Boolean));
    const seen = new Set(), timers = new Map(), visible = new Set(), observed = new Set();
    const context = (node) => {
      if (node.closest('[aria-hidden="true"]')) return null;
      if (node.dataset.adId) return { ad_id: Number(node.dataset.adId), surface: "banner", placement: node.dataset.vdAd || "unspecified" };
      const target = node.dataset.vdStation;
      if (!activeHosts.has(hostOf(target))) return null;
      return { target_url: target, surface: "directory", placement: node.dataset.vdPlace || "directory" };
    };
    const send = (data, action, automated = navigator.webdriver === true) => {
      const body = JSON.stringify({ ...data, kind: "ad", action, path: location.pathname, automated, event_id: eventId() });
      // No browser identifier, API key, IP address or full query string is collected.
      fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    const stop = (node) => { clearTimeout(timers.get(node)); timers.delete(node); };
    const start = (node) => {
      const data = context(node);
      if (!data || document.hidden || timers.has(node)) return;
      const key = `${data.ad_id || data.target_url}:${data.surface}:${data.placement}`;
      if (seen.has(key)) return;
      timers.set(node, setTimeout(() => {
        timers.delete(node);
        if (!node.isConnected || document.hidden || !visible.has(node) || seen.has(key)) return;
        seen.add(key);
        send(data, "impression");
      }, 1000));
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= .5) { visible.add(entry.target); start(entry.target); }
        else { visible.delete(entry.target); stop(entry.target); }
      }
    }, { threshold: [.5] });
    const scan = () => {
      for (const node of observed) if (!node.isConnected) { observer.unobserve(node); stop(node); observed.delete(node); visible.delete(node); }
      document.querySelectorAll(selector).forEach(node => {
        // Observe a row/card once; its nested links are click-specific entrances.
        if (node.parentElement?.closest(selector) || observed.has(node) || !context(node)) return;
        observed.add(node); observer.observe(node);
      });
    };
    scan();
    const mutation = new MutationObserver(scan);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-vd-station", "data-ad-id"] });
    const visibility = () => { if (document.hidden) timers.forEach((_,node) => stop(node)); else visible.forEach(start); };
    const click = (event) => {
      if (event.type === "auxclick" ? event.button !== 1 : event.button !== 0) return;
      const node = event.target.closest?.(selector);
      if (!node || event.target.closest('button,input,select,textarea')) return;
      const data = context(node);
      if (!data) return;
      // Cards measure visibility; only their actual navigation links count clicks.
      if (node.dataset.vdExposureOnly != null) return;
      if (data.surface === "directory") send(data, "click", navigator.webdriver === true || event.isTrusted === false);
      else {
        // Banner clicks are counted exactly once by the /go redirect.
        const url = new URL(node.href);
        if (navigator.webdriver || event.isTrusted === false) url.searchParams.set("automated", "1");
        else url.searchParams.delete("automated");
        node.href = url.href;
      }
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", click, true);
    document.addEventListener("auxclick", click, true);
    return () => { observer.disconnect(); mutation.disconnect(); timers.forEach(clearTimeout); document.removeEventListener("visibilitychange",visibility); document.removeEventListener("click",click,true); document.removeEventListener("auxclick",click,true); };
  }, [signature, location.pathname, location.search]);
}
