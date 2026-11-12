import test from "node:test";
import assert from "node:assert/strict";
import { minimumInputPrice, summarizePublished } from "../src/price-summary.js";

test("unpriced media cannot turn a quoted group into a free group", () => {
  assert.equal(minimumInputPrice([{ input: null }, {}, { input: "" }, { input: 0.1 }, { input: 4 }]), 0.1);
  assert.equal(minimumInputPrice([{ input: null }, { input: false }, { input: -1 }, { input: Infinity }]), null);
  assert.equal(minimumInputPrice([{ input: 0 }, { input: 1 }]), 0);
});

test("reference prices without a relay multiplier do not generate a price score or latency", () => {
  const summary = summarizePublished([
    { id: "gpt-6-astra", name: "gpt-6-astra", input: 10, output: 50, ratio: null },
    { id: "claude-opus-5-5", name: "claude-opus-5-5", input: 4, output: 20, ratio: null },
  ]);
  assert.equal(summary.price, null);
  assert.equal(summary.balancedMs, null);
  assert.equal(summary.listedCount, 2);
});
