import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveActiveChat,
  loadProjectActiveChat,
  loadProjectChatHistory,
  saveActiveChat,
} from "../src/renderer/src/lib/project-chat-store.ts";
import type { ChatTurn } from "../src/renderer/src/components/response-area.tsx";

const installLocalStorageMock = () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    },
  });
};

const createTurns = (): ChatTurn[] => [
  {
    id: "u-1",
    role: "user",
    content: "Plan the checkout cleanup.",
    createdAt: new Date("2026-06-13T12:00:00.000Z"),
  },
  {
    id: "a-1",
    role: "assistant",
    createdAt: new Date("2026-06-13T12:00:01.000Z"),
    provider: "codex",
    mode: "plan",
    model: "GPT",
    reasoningEffort: "high",
    status: "running",
    thinkingStatus: "in_progress",
    planningStatus: "in_progress",
    buildingStatus: "pending",
    verifyingStatus: "pending",
    thought: "Reading checkout files.",
    steps: [{ step: "Inspect checkout flow", status: "in_progress" }],
    plan: null,
    finalText: null,
    durationSec: null,
  },
];

test("active project chat reloads without being archived", () => {
  installLocalStorageMock();
  const turns = createTurns();

  saveActiveChat("project-1", turns);

  const active = loadProjectActiveChat("project-1");
  assert.equal(active.length, 2);
  assert.equal(active[0]?.role, "user");
  assert.equal(active[1]?.role, "assistant");
  if (active[1]?.role === "assistant") {
    assert.equal(active[1].status, "completed");
    assert.equal(active[1].thinkingStatus, "completed");
    assert.equal(active[1].steps[0]?.status, "completed");
  }
  assert.equal(loadProjectChatHistory("project-1").length, 0);
});

test("archiving active project chat moves it to history and clears active", () => {
  installLocalStorageMock();
  saveActiveChat("project-1", createTurns());

  const history = archiveActiveChat("project-1");

  assert.equal(history.length, 1);
  assert.equal(history[0]?.title, "Plan the checkout cleanup.");
  assert.equal(loadProjectActiveChat("project-1").length, 0);
});
