import test from "node:test";
import assert from "node:assert/strict";
import { mergeStatusModels } from "../src/station-status.js";

test("public monitors replace placeholders, preserve exact-line prices and do not borrow another line's price", () => {
  const catalog = [
    { id: "gpt", group: "目录" },
    { id: "gpt-test", group: "线路一", input: 1, output: 2, cache: 0.1, ratio: 0.5, currency: "USD", unit: "次" },
    { id: "gpt-other", group: "线路二", input: 30, output: 40 },
  ];
  const monitors = [
    { id: "gpt-test", group: "线路一", input: null, output: null, cache: null, ratio: null, uptime: "99.52%", score: null },
    { id: "gpt-other", group: "线路三", input: null, output: null, uptime: "0%", score: null },
  ];
  const rows = mergeStatusModels(catalog, monitors);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].input, 1);
  assert.equal(rows[0].output, 2);
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[0].unit, "次");
  assert.equal(rows[0].uptime, "99.52%");
  assert.equal(rows[1].input, null);
  assert.equal(rows[1].uptime, "0%");
  assert.equal(rows[2].input, 30);
  assert.ok(rows.every((row) => row.id !== "gpt"));
  assert.equal(catalog.length, 3);
});
