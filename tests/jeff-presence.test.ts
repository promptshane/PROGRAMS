import assert from "node:assert/strict";
import test from "node:test";
import type { AgentChatMessage } from "../src/shared/types.ts";
import {
  deriveJeffPresenceState,
  getLatestAgentChatUserTurn,
  JEFF_CARD_VISIBLE_DELAY_MS,
  JEFF_LINGER_MS,
  JEFF_TYPING_DELAY_MS,
  resolveAgentChatRouteForRenderer,
  userTurnIncludesDirector,
} from "../src/renderer/src/lib/jeff-presence.ts";

const buildUserMessage = (id: string, createdAt: string, content = "hello"): AgentChatMessage => ({
  id,
  role: "user",
  directorId: null,
  content,
  createdAt,
});

const buildAssistantMessage = (
  id: string,
  directorId: AgentChatMessage["directorId"],
  createdAt: string,
  status: AgentChatMessage["status"] = "complete",
): AgentChatMessage => ({
  id,
  role: "assistant",
  directorId,
  content: status === "working" ? "" : "Reply",
  createdAt,
  status,
});

test("Jeff stays hidden when there is no user message today even if project-manager is the session fallback", () => {
  const state = deriveJeffPresenceState({
    messages: [
      buildAssistantMessage("assistant-1", "project-manager", "2026-04-01T13:00:00.000Z"),
    ],
    now: new Date("2026-04-01T13:01:00.000Z"),
  });

  assert.equal(state.phase, "hidden");
  assert.equal(state.present, false);
});

test("Jeff joins after 1 second and can type after 2 seconds on the first Jeff-owned user turn", () => {
  const triggeredAt = Date.parse("2026-04-01T14:00:00.000Z");
  const messages: AgentChatMessage[] = [
    buildUserMessage("user-1", "2026-04-01T14:00:00.000Z"),
    buildAssistantMessage("assistant-1", "project-manager", "2026-04-01T14:00:00.500Z", "working"),
  ];

  const beforeJoin = deriveJeffPresenceState({
    messages,
    now: new Date(triggeredAt + JEFF_CARD_VISIBLE_DELAY_MS - 1),
    liveWindow: { triggeredAt, animateEntry: true },
  });
  const afterJoin = deriveJeffPresenceState({
    messages,
    now: new Date(triggeredAt + JEFF_CARD_VISIBLE_DELAY_MS),
    liveWindow: { triggeredAt, animateEntry: true },
  });
  const afterTyping = deriveJeffPresenceState({
    messages,
    now: new Date(triggeredAt + JEFF_TYPING_DELAY_MS),
    liveWindow: { triggeredAt, animateEntry: true },
  });

  assert.equal(beforeJoin.phase, "hidden");
  assert.equal(afterJoin.phase, "joining-visible");
  assert.equal(afterTyping.phase, "typing-allowed");
  assert.equal(afterTyping.typingAllowed, true);
});

test("A completed Jeff reply can appear as soon as Jeff is visible even before the typing delay", () => {
  const triggeredAt = Date.parse("2026-04-01T14:10:00.000Z");
  const messages: AgentChatMessage[] = [
    buildUserMessage("user-1", "2026-04-01T14:10:00.000Z"),
    buildAssistantMessage("assistant-1", "project-manager", "2026-04-01T14:10:00.700Z"),
  ];

  const state = deriveJeffPresenceState({
    messages,
    now: new Date(triggeredAt + JEFF_CARD_VISIBLE_DELAY_MS),
    liveWindow: { triggeredAt, animateEntry: true },
  });

  assert.equal(state.phase, "joining-visible");
  assert.equal(state.present, true);
  assert.equal(state.typingAllowed, false);
});

test("Jeff lingers for 90 seconds after the latest Jeff-owned user turn, then leaves", () => {
  const triggeredAt = Date.parse("2026-04-01T14:20:00.000Z");
  const messages: AgentChatMessage[] = [
    buildUserMessage("user-1", "2026-04-01T14:20:00.000Z"),
    buildAssistantMessage("assistant-1", "project-manager", "2026-04-01T14:20:01.000Z"),
  ];

  const beforeLeave = deriveJeffPresenceState({
    messages,
    now: new Date(triggeredAt + JEFF_LINGER_MS - 1),
    liveWindow: { triggeredAt, animateEntry: false },
  });
  const afterLeave = deriveJeffPresenceState({
    messages,
    now: new Date(triggeredAt + JEFF_LINGER_MS),
    liveWindow: { triggeredAt, animateEntry: false },
  });

  assert.equal(beforeLeave.phase, "linger-visible");
  assert.equal(beforeLeave.present, true);
  assert.equal(afterLeave.phase, "hidden");
  assert.equal(afterLeave.present, false);
});

test("Jeff can replay the join sequence later the same day after leaving", () => {
  const firstTriggeredAt = Date.parse("2026-04-01T14:30:00.000Z");
  const secondTriggeredAt = Date.parse("2026-04-01T15:00:00.000Z");
  const messages: AgentChatMessage[] = [
    buildUserMessage("user-1", "2026-04-01T14:30:00.000Z"),
    buildAssistantMessage("assistant-1", "project-manager", "2026-04-01T14:30:01.000Z"),
    buildUserMessage("user-2", "2026-04-01T15:00:00.000Z"),
    buildAssistantMessage("assistant-2", "project-manager", "2026-04-01T15:00:00.800Z", "working"),
  ];

  const state = deriveJeffPresenceState({
    messages,
    now: new Date(secondTriggeredAt + JEFF_CARD_VISIBLE_DELAY_MS),
    liveWindow: { triggeredAt: secondTriggeredAt, animateEntry: true },
  });

  assert.equal(firstTriggeredAt + JEFF_LINGER_MS < secondTriggeredAt, true);
  assert.equal(state.phase, "joining-visible");
});

test("A later non-Jeff user turn suppresses Jeff history state and keeps routing with the present non-Jeff director", () => {
  const messages: AgentChatMessage[] = [
    buildUserMessage("user-1", "2026-04-01T16:00:00.000Z"),
    buildAssistantMessage("assistant-1", "project-manager", "2026-04-01T16:00:01.000Z"),
    buildUserMessage("user-2", "2026-04-01T16:01:00.000Z", "@dan can you review this?"),
    buildAssistantMessage("assistant-2", "creative-director", "2026-04-01T16:01:01.000Z"),
  ];
  const latestTurn = getLatestAgentChatUserTurn(messages, { now: new Date("2026-04-01T16:01:30.000Z"), todayOnly: true });
  const state = deriveJeffPresenceState({
    messages,
    now: new Date("2026-04-01T16:01:30.000Z"),
  });

  assert.equal(userTurnIncludesDirector(latestTurn, "project-manager"), false);
  assert.equal(state.phase, "hidden");
  assert.equal(resolveAgentChatRouteForRenderer("Can you take another look?", "creative-director"), "creative-director");
});
