import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import { chinaDay, planCheck } from "./check-schedule.mjs";
import { runAbilitySuites } from "./basic-suite.mjs";

const gradePath = new URL("../public/original-check/check-grade.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const gradeModule = new Module(gradePath);
gradeModule._compile(fs.readFileSync(gradePath, "utf8"), gradePath);
const questions = gradeModule.exports.CANDY_QUESTIONS;
const job = { base: "https://relay.example/v1", model: "gpt-6-astra", key: "sk-private-test-key", candyCount: 5 };
const jsonReply = (content) => new Response(JSON.stringify({ model: job.model, choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
const html = '<!doctype html><html><body><svg><circle r="5"><animate attributeName="cx" from="0" to="10" dur="1s" repeatCount="indefinite"/></circle></svg></body></html>';

test("Shanghai midnight, three-day boundary and duplicate prevention", () => {
  assert.equal(chinaDay(new Date("2026-11-09T16:00:00Z")), "2026-11-10");
  assert.equal(planCheck({}, "2026-11-10"), "all");
  assert.equal(planCheck({ fullDay: "2026-11-10" }, "2026-11-12"), "basic");
  assert.equal(planCheck({ fullDay: "2026-11-10" }, "2026-11-13"), "all");
  assert.equal(planCheck({ fullDay: "2026-11-10", basicAttemptDay: "2026-11-12" }, "2026-11-12"), "skip");
  assert.equal(planCheck({ fullAttemptDay: "2026-11-13", basicAttemptDay: "2026-11-13" }, "2026-11-13"), "skip");
  assert.equal(planCheck({ fullAttemptDay: "2026-11-13", basicAttemptDay: "2026-11-13" }, "2026-11-14"), "all");
});

test("Full check uses original grading and retains streamed pelican HTML", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://relay.example/v1/chat/completions");
    const body = JSON.parse(options.body);
    if (calls++ < 5) return jsonReply(questions[calls - 1].answer);
    assert.equal(body.stream, true);
    return new Response(`data: ${JSON.stringify({ model: job.model, choices: [{ delta: { content: html } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const out = await runAbilitySuites(job);
    assert.equal(out.partRight, 5);
    assert.equal(out.partScore, 100);
    assert.equal(out.complete, true);
    assert.equal(out.pelicanHtml, html);
    assert.equal(out.rows[1].status, "pass");
    assert.equal(calls, 6);
  } finally { globalThis.fetch = original; }
});

test("Quota rejection marks unasked questions as missed and redacts credentials", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: `quota exceeded ${job.key}` } }), { status: 429 });
  };
  try {
    const out = await runAbilitySuites(job);
    assert.equal(out.complete, false);
    assert.equal(out.rows[0].status, "error");
    assert.equal(out.candyRows.length, 5);
    assert.ok(out.candyRows.every((row) => row.missed));
    assert.ok(!JSON.stringify(out).includes(job.key));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("Candy-only check uses original grading without requesting pelican generation", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.notEqual(body.stream, true);
    assert.ok(calls < questions.slice(0, 5).length);
    return jsonReply(questions[calls++].answer);
  };
  try {
    const out = await runAbilitySuites({ ...job, suite: "candy" });
    assert.equal(calls, 5);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].id, "candy");
    assert.equal(out.partRight, 5);
    assert.equal(out.complete, true);
    assert.equal(out.pelicanHtml, "");
  } finally { globalThis.fetch = original; }
});
