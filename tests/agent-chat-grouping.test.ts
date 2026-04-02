import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentChatConversationRenderItems } from "../src/renderer/src/lib/agent-chat-grouping.ts";

test("Agent chat grouping shows the sender label only on the first bubble in a contiguous run", () => {
  const items = buildAgentChatConversationRenderItems([
    {
      id: "1",
      role: "assistant",
      directorId: "creative-director",
      content: "Thinking...",
      createdAt: "2026-03-19T14:00:00.000Z",
    },
    {
      id: "2",
      role: "assistant",
      directorId: "creative-director",
      content: "Still thinking...",
      createdAt: "2026-03-19T14:01:00.000Z",
    },
  ]);

  assert.deepEqual(items.map((item) => item.showSenderLabel), [true, false]);
  assert.deepEqual(items.map((item) => item.isSenderContinuation), [false, true]);
  assert.equal(items[1].dayLabel, null);
});

test("Agent chat grouping resets the sender label when the sender changes or a user message breaks the run", () => {
  const items = buildAgentChatConversationRenderItems([
    {
      id: "1",
      role: "assistant",
      directorId: "creative-director",
      content: "Dan intro",
      createdAt: "2026-03-19T14:00:00.000Z",
    },
    {
      id: "2",
      role: "assistant",
      directorId: "creative-director",
      content: "Dan follow-up",
      createdAt: "2026-03-19T14:01:00.000Z",
    },
    {
      id: "3",
      role: "assistant",
      directorId: "rd-director",
      content: "Todd intro",
      createdAt: "2026-03-19T14:02:00.000Z",
    },
    {
      id: "4",
      role: "assistant",
      directorId: "rd-director",
      content: "Todd follow-up",
      createdAt: "2026-03-19T14:03:00.000Z",
    },
    {
      id: "5",
      role: "user",
      directorId: null,
      content: "Thanks",
      createdAt: "2026-03-19T14:04:00.000Z",
    },
    {
      id: "6",
      role: "assistant",
      directorId: "rd-director",
      content: "Todd after reply",
      createdAt: "2026-03-19T14:05:00.000Z",
    },
  ]);

  assert.deepEqual(items.map((item) => item.showSenderLabel), [true, false, true, false, false, true]);
  assert.deepEqual(items.map((item) => item.isSenderContinuation), [false, true, false, true, false, false]);
});

test("Agent chat grouping resets the sender label on a new day", () => {
  const items = buildAgentChatConversationRenderItems([
    {
      id: "1",
      role: "assistant",
      directorId: "creative-director",
      content: "Yesterday intro",
      createdAt: "2026-03-19T14:00:00.000Z",
    },
    {
      id: "2",
      role: "assistant",
      directorId: "creative-director",
      content: "Today intro",
      createdAt: "2026-03-20T14:00:00.000Z",
    },
  ], {
    now: new Date("2026-03-20T16:00:00.000Z"),
  });

  assert.deepEqual(items.map((item) => item.showSenderLabel), [true, true]);
  assert.deepEqual(items.map((item) => item.isSenderContinuation), [false, false]);
  assert.deepEqual(items.map((item) => item.dayLabel), ["Yesterday", "Today"]);
});
