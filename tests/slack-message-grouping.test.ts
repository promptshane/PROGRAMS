import assert from "node:assert/strict";
import test from "node:test";
import { buildSlackConversationRenderItems } from "../src/renderer/src/lib/slack-message-grouping.ts";

test("Slack conversation grouping shows the sender label only on the first bubble in a contiguous run", () => {
  const items = buildSlackConversationRenderItems([
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
  assert.equal(items[1].dayLabel, null);
});

test("Slack conversation grouping resets the sender label when the sender changes or a user message breaks the run", () => {
  const items = buildSlackConversationRenderItems([
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
});

test("Slack conversation grouping resets the sender label on a new day", () => {
  const items = buildSlackConversationRenderItems([
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
  assert.equal(items[0].dayLabel !== null, true);
  assert.equal(items[1].dayLabel !== null, true);
});
