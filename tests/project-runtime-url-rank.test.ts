import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeUrlPort, rankRuntimeLaunchUrl } from "../src/main/utils/project.ts";

const config = (openUrl: string | null, assignedPort: number | null = null) => ({ openUrl, assignedPort });

test("parseRuntimeUrlPort reads the port from a local URL", () => {
  assert.equal(parseRuntimeUrlPort("http://localhost:5173/"), 5173);
  assert.equal(parseRuntimeUrlPort("http://127.0.0.1:3001"), 3001);
  assert.equal(parseRuntimeUrlPort(""), null);
  assert.equal(parseRuntimeUrlPort(null), null);
  assert.equal(parseRuntimeUrlPort("not a url"), null);
});

test("the detected frontend (openUrl) outranks an API URL", () => {
  const options = config("http://localhost:5173/");
  assert.equal(rankRuntimeLaunchUrl("http://localhost:5173/", options), 2);
  assert.equal(rankRuntimeLaunchUrl("http://localhost:3001/", options), 0);
});

// The real Threads bug: a Vite UI (5173) and an Express/SQLite bridge (3001) start
// together. Whichever logs its URL last must not steal the launch target — the
// frontend has to win regardless of arrival order.
test("frontend wins over the API no matter which URL is seen first", () => {
  const options = config("http://localhost:5173/");
  const ui = "http://localhost:5173/";
  const api = "http://localhost:3001/";

  // Simulate the adoption rule: adopt a candidate when rank(candidate) >= rank(current).
  const adopt = (current: string | null, candidate: string): string =>
    current === null || rankRuntimeLaunchUrl(candidate, options) >= rankRuntimeLaunchUrl(current, options)
      ? candidate
      : current;

  // API logs first, then UI.
  assert.equal(adopt(adopt(null, api), ui), ui);
  // UI logs first, then API — API must NOT replace it.
  assert.equal(adopt(adopt(null, ui), api), ui);
});

test("the assigned port ranks above an unknown port but below the frontend", () => {
  const options = config("http://localhost:5173/", 4906);
  assert.equal(rankRuntimeLaunchUrl("http://localhost:5173/", options), 2);
  assert.equal(rankRuntimeLaunchUrl("http://127.0.0.1:4906/", options), 1);
  assert.equal(rankRuntimeLaunchUrl("http://localhost:8080/", options), 0);
});

test("an unparseable URL ranks below every real candidate", () => {
  const options = config("http://localhost:5173/");
  assert.equal(rankRuntimeLaunchUrl("garbage", options), -1);
  assert.ok(rankRuntimeLaunchUrl("garbage", options) < rankRuntimeLaunchUrl("http://localhost:3001/", options));
});

test("with no known frontend, real URLs tie at rank 0 (last-seen wins)", () => {
  const options = config(null);
  assert.equal(rankRuntimeLaunchUrl("http://localhost:5173/", options), 0);
  assert.equal(rankRuntimeLaunchUrl("http://localhost:3001/", options), 0);
});
