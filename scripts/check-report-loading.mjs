// Verify server-first loading for browser-local reports without running a test API.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom" });
try {
  const snapshot = await server.ssrLoadModule("/src/html-snapshot.js");
  const app = await server.ssrLoadModule("/src/entry-server.jsx");
  const template = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const suite of ["basic", "all", "candy", "pelican"]) {
    const path = `/b/${suite}-localtest01`;
    const page = snapshot.renderSnapshot(path);
    assert.equal(page.status, 200, "A browser-local report must not get an initial 404");
    assert.equal(page.robots, "noindex,follow");
    page.markup = app.renderPage(path);
    const html = snapshot.injectSnapshot(template, page);
    assert(html.includes('class="topbar"'), "Use the full site shell during loading");
    assert(html.includes('class="wrap report-loading"'));
    assert(html.includes('aria-busy="true"'));
    assert(html.includes('href="/src/styles.css"'));
    assert(html.includes("正在加载检测结果"));
    assert(!html.includes("页面不存在"));
    assert(!html.includes("报告未找到"));
  }
  for (const path of ["/check/candy?replay=candy-localtest01", "/check/pelican?replay=pelican-localtest01", "/check/detect?run=all-localtest01", "/check/candy?share=fixture"]) {
    const markup = app.renderPage(path);
    assert(markup.includes("正在加载检测结果"), `${path} must show feedback before check assets load`);
    assert(markup.includes('aria-busy="true"'));
    assert(markup.includes('class="report-loading-skeleton"'));
    assert(markup.includes('class="check-nav"'), "Keep navigation available while loading");
    assert(markup.includes('class="check-page" style="display:none"'), "Do not display a stale result while loading");
  }
  const report = { id: "basic-savedtest01", suite: "basic", host: "fixture.example.test", model: "Fixture", rows: [], started: 1794090000000, finishedAt: 1794090001000 };
  const page = snapshot.renderSnapshot(`/b/${report.id}`, null, { report });
  assert.equal(page.status, 200);
  assert(page.body.includes("fixture.example.test"), "Server reports remain immediately available");
  const markup = app.renderPage(`/b/${report.id}`, { basicReport: report });
  assert(!markup.includes('class="wrap report-loading"'));
  assert.equal(snapshot.renderSnapshot("/b/not-a-report").status, 404, "Invalid routes remain 404");
  console.log("PASS: styled SSR loading, local report routes, available server reports, invalid-route 404.");
} finally {
  await server.close();
}
