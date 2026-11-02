import { useEffect, useState } from "react";
import { applyStationPrice, findStation, hasFullStationPrice, modelsOf } from "./data.js";
import { priceVersion } from "./price-version.js";
import { FAMILY_MODEL_IDS } from "./verd-meta.js";

const modelLoads = new Map();

export async function preloadStationPrices(token) {
  const station = findStation(token);
  if (!station?.verdId || hasFullStationPrice(station)) return;
  const response = await fetch(`/prices/station/${encodeURIComponent(station.verdId)}.json?v=${priceVersion}`);
  if (!response.ok) return;
  applyStationPrice(station, await response.json(), { full: true });
}

export function preloadModelPrices(slug) {
  if (!slug || FAMILY_MODEL_IDS.includes(slug)) return Promise.resolve();
  if (modelLoads.has(slug)) return modelLoads.get(slug);
  const job = fetch(`/prices/model/${encodeURIComponent(slug)}.json?v=${priceVersion}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      for (const [id, models] of Object.entries(payload || {})) {
        const station = findStation(id) || { verdId: id, announcements: [] };
        if (!station.announcements) station.announcements = [];
        applyStationPrice(station, { models }, { full: false });
      }
    })
    .catch(() => {});
  modelLoads.set(slug, job);
  return job;
}

export function preloadRoutePrices(pathname) {
  const path = decodeURIComponent(String(pathname || "/").split("?")[0]);
  if (path.startsWith("/site/")) return preloadStationPrices(path.slice("/site/".length).split("/")[0]);
  if (path.startsWith("/model/")) return preloadModelPrices(path.slice("/model/".length).split("/")[0]);
  return Promise.resolve();
}

export function useStationModels(station) {
  const id = station?.verdId == null || station.verdId === "" ? "" : String(station.verdId);
  const [models, setModels] = useState(() => modelsOf(station));
  useEffect(() => {
    if (!station || !id) return undefined;
    let cancel = false;
    preloadStationPrices(station.slug || station.siteToken || station.path?.split("/").pop() || id)
      .then(() => {
        if (!cancel) setModels(modelsOf(station));
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [station, id]);
  return models;
}
