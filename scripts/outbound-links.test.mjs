import test from "node:test";
import assert from "node:assert/strict";
import { stationHref, listedStationHref } from "../src/outbound-links.js";

test("website links keep referral codes, raw query encoding and fragments", () => {
  assert.equal(stationHref("https://api.sublyx.org/register?aff=R4Y2SMJ45VR4#start"), "https://api.sublyx.org/register?aff=R4Y2SMJ45VR4&utm_source=veridrop.cn#start");
  assert.equal(stationHref("https://example.com/register?promo=A%2fb+Z&next=%2Fconsole%3Fa%3D1"), "https://example.com/register?promo=A%2fb+Z&next=%2Fconsole%3Fa%3D1&utm_source=veridrop.cn");
  assert.equal(stationHref("https://example.com"), "https://example.com?utm_source=veridrop.cn");
});

test("existing source is replaced once, retaining other campaign parameters", () => {
  const result = stationHref("https://example.com/?UTM_SOURCE=veridrop&utm%5Fsource=duplicate&utm_campaign=launch&aff=X");
  assert.equal(result, "https://example.com/?utm_campaign=launch&aff=X&utm_source=veridrop.cn");
  assert.equal(stationHref(result), result);
});

test("internal, API, signed and non-web links are unchanged", () => {
  for (const url of ["/site/sublyx", "https://www.veridrop.cn/list", "http://localhost:5181/", "https://api.example.com/v1", "https://example.com/api/chat", "https://example.com/download?X-Amz-Signature=abc&aff=X", "https://example.com/?signature=abc", "mailto:a@example.com", "javascript:void(0)", "bad url", ""]) assert.equal(stationHref(url), url);
});

test("mixed activity lists tag known station hosts only", () => {
  const sites = ["https://www.station.example/register?aff=A"];
  assert.equal(listedStationHref("https://station.example/promo?code=B", sites), "https://station.example/promo?code=B&utm_source=veridrop.cn");
  assert.equal(listedStationHref("https://other.example/activity", sites), "https://other.example/activity");
});

test("rendered station entry points carry attribution and preserve API resources", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const { stations } = await server.ssrLoadModule("/src/data.js");
    const { renderPage } = await server.ssrLoadModule("/src/entry-server.jsx");
    const { renderSnapshot } = await server.ssrLoadModule("/src/html-snapshot.js");
    const station = stations.find(item => item.name === "Sublyx");
    assert.ok(station);
    const originalSite = station.site;
    const detail = renderPage(station.path, { static: true });
    assert.match(detail, /href="https:\/\/api\.sublyx\.org\/register\?aff=R4Y2SMJ45VR4&amp;utm_source=veridrop\.cn"/);
    assert.match(detail, /href="https:\/\/sublyx\.org\/\?utm_source=veridrop\.cn"/);
    assert.match(detail, /href="https:\/\/api\.sublyx\.org"/);
    assert.ok(renderSnapshot(station.path).body.includes("utm_source=veridrop.cn"));
    for (const route of ["/", "/list", "/model", "/model/claude"]) {
      const html = renderPage(route, { static: true });
      const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g)].map(match => match[0]);
      const official = links.filter(link => /href="https?:\/\//.test(link) && /class="(?:rank-jump|vd-rec-name[^"\n]*|vd-site-external|mini|st-jump|st-out)"/.test(link));
      assert.ok(official.length, `${route} has station website links`);
      for (const link of official) assert.match(link, /utm_source=veridrop\.cn(?:&amp;|[&#"])/, `${route}: ${link}`);
    }
    assert.equal(station.site, originalSite);
    assert.ok(!station.site.includes("utm_source"));
  } finally { await server.close(); }
});
