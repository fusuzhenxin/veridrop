import test from "node:test";
import assert from "node:assert/strict";
import { mergeRecentTests } from "../src/recent-tests.js";

const stations = [{ slug: "relay", verdId: 1852, host: "relay.example", name: "Relay", img: "/relay.png" }];
const archived = [{ slug: "relay", station: "Relay", at: Date.parse("2026-11-01T00:00:00Z"), score: 95, href: "/b/old" }];
const summary = { id: "basic-new123", stationId: 1852, host: "api.relay.example", score: 89, model: "gpt-6-astra", at: "2026-11-09T16:30:00Z" };

test("Recent reports replace the same station even when its score falls; date uses Shanghai", () => {
  const result = mergeRecentTests(archived, [summary, { ...summary, id: "basic-older123", at: "2026-11-02T00:00:00Z" }], stations, (s) => s.name);
  assert.equal(result.length, 1);
  assert.equal(result[0].score, 89);
  assert.equal(result[0].date, "11-10");
  assert.equal(result[0].href, "/b/basic-new123");
  assert.equal(result[0].station, "Relay");
});

test("Invalid, failed and unknown-station reports do not replace the archived result", () => {
  const reports = [
    { ...summary, score: null }, { ...summary, score: "100" }, { ...summary, score: 101 },
    { ...summary, id: "../../secret" }, { ...summary, at: "invalid" },
    { ...summary, stationId: 999, host: "unknown.example" },
  ];
  assert.deepEqual(mergeRecentTests(archived, reports, stations, (s) => s.name), archived);
  assert.deepEqual(mergeRecentTests(archived, null, stations, (s) => s.name), archived);
});

test("Zero is a valid score and public host matching works without a station id", () => {
  const rows = mergeRecentTests(archived, [{ ...summary, stationId: null, host: "www.relay.example", score: 0 }], stations, (s) => s.name);
  assert.equal(rows[0].score, 0);
});
