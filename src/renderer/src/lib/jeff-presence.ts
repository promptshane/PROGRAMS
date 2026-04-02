import type { DirectorId, AgentChatMessage } from "@shared/types";
import { getAgentChatDayKey } from "./agent-chat-grouping.ts";

export const JEFF_CARD_VISIBLE_DELAY_MS = 1_000;
export const JEFF_TYPING_DELAY_MS = 2_000;
export const JEFF_LINGER_MS = 90_000;

export type JeffPresencePhase = "hidden" | "joining-visible" | "typing-allowed" | "linger-visible";

export interface JeffLivePresenceWindow {
  triggeredAt: number;
  animateEntry: boolean;
}

export interface AgentChatUserTurn {
  userMessage: AgentChatMessage;
  followingMessages: AgentChatMessage[];
}

export interface JeffPresenceState {
  phase: JeffPresencePhase;
  present: boolean;
  typingAllowed: boolean;
  source: "none" | "history" | "live";
  visibleAt: number | null;
  typingAt: number | null;
  leaveAt: number | null;
  nextTransitionAt: number | null;
}

const DIRECT_ROUTE_PATTERNS: { pattern: RegExp; directorId: DirectorId }[] = [
  { pattern: /^(?:hey\s+|@)?dan\b[,:\s]/i, directorId: "creative-director" },
  { pattern: /^(?:hey\s+|@)?todd\b[,:\s]/i, directorId: "rd-director" },
  { pattern: /^(?:hey\s+|@)?ping\b[,:\s]/i, directorId: "programming-director" },
  { pattern: /^(?:hey\s+|@)?pong\b[,:\s]/i, directorId: "validation-director" },
  { pattern: /^(?:hey\s+|@)?jeff\b[,:\s]/i, directorId: "project-manager" },
];

const HIDDEN_STATE: JeffPresenceState = {
  phase: "hidden",
  present: false,
  typingAllowed: false,
  source: "none",
  visibleAt: null,
  typingAt: null,
  leaveAt: null,
  nextTransitionAt: null,
};

export const resolveAgentChatRouteForRenderer = (
  message: string,
  presenceGuestId: DirectorId | null,
): DirectorId => {
  const trimmed = message.trim();
  if (trimmed) {
    for (const { pattern, directorId } of DIRECT_ROUTE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return directorId;
      }
    }
  }

  if (presenceGuestId && presenceGuestId !== "project-manager") {
    return presenceGuestId;
  }

  return "project-manager";
};

export const getLatestAgentChatUserTurn = (
  messages: AgentChatMessage[],
  options: { now?: Date; todayOnly?: boolean } = {},
): AgentChatUserTurn | null => {
  const now = options.now ?? new Date();
  const todayKey = getAgentChatDayKey(now.toISOString());
  let currentTurn: AgentChatUserTurn | null = null;
  let latestTurn: AgentChatUserTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      const includeTurn = !options.todayOnly || getAgentChatDayKey(message.createdAt) === todayKey;
      currentTurn = includeTurn
        ? {
            userMessage: message,
            followingMessages: [],
          }
        : null;
      if (currentTurn) {
        latestTurn = currentTurn;
      }
      continue;
    }

    if (currentTurn) {
      currentTurn.followingMessages.push(message);
    }
  }

  return latestTurn;
};

export const userTurnIncludesDirector = (turn: AgentChatUserTurn | null, directorId: DirectorId): boolean =>
  Boolean(turn?.followingMessages.some((message) => message.role === "assistant" && message.directorId === directorId));

export const userTurnHasWorkingDirectorMessage = (
  turn: AgentChatUserTurn | null,
  directorId: DirectorId,
): boolean =>
  Boolean(
    turn?.followingMessages.some(
      (message) => message.role === "assistant" && message.directorId === directorId && message.status === "working",
    ),
  );

const buildJeffPresenceState = (input: {
  nowMs: number;
  triggeredAt: number;
  animateEntry: boolean;
  hasWorkingJeffMessage: boolean;
  source: "history" | "live";
}): JeffPresenceState => {
  const {
    nowMs,
    triggeredAt,
    animateEntry,
    hasWorkingJeffMessage,
    source,
  } = input;
  const visibleAt = animateEntry ? triggeredAt + JEFF_CARD_VISIBLE_DELAY_MS : triggeredAt;
  const typingAt = animateEntry ? triggeredAt + JEFF_TYPING_DELAY_MS : triggeredAt;
  const leaveAt = triggeredAt + JEFF_LINGER_MS;

  if (nowMs >= leaveAt) {
    return HIDDEN_STATE;
  }

  if (nowMs < visibleAt) {
    return {
      phase: "hidden",
      present: false,
      typingAllowed: false,
      source,
      visibleAt,
      typingAt,
      leaveAt,
      nextTransitionAt: visibleAt,
    };
  }

  if (nowMs < typingAt) {
    return {
      phase: "joining-visible",
      present: true,
      typingAllowed: false,
      source,
      visibleAt,
      typingAt,
      leaveAt,
      nextTransitionAt: typingAt,
    };
  }

  if (hasWorkingJeffMessage) {
    return {
      phase: "typing-allowed",
      present: true,
      typingAllowed: true,
      source,
      visibleAt,
      typingAt,
      leaveAt,
      nextTransitionAt: leaveAt,
    };
  }

  return {
    phase: "linger-visible",
    present: true,
    typingAllowed: false,
    source,
    visibleAt,
    typingAt,
    leaveAt,
    nextTransitionAt: leaveAt,
  };
};

export const deriveJeffPresenceState = (input: {
  messages: AgentChatMessage[];
  now?: Date;
  liveWindow?: JeffLivePresenceWindow | null;
}): JeffPresenceState => {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const latestTurn = getLatestAgentChatUserTurn(input.messages);
  const hasWorkingJeffMessage = userTurnHasWorkingDirectorMessage(latestTurn, "project-manager");

  const liveWindow = input.liveWindow;
  if (liveWindow && nowMs < liveWindow.triggeredAt + JEFF_LINGER_MS) {
    return buildJeffPresenceState({
      nowMs,
      triggeredAt: liveWindow.triggeredAt,
      animateEntry: liveWindow.animateEntry,
      hasWorkingJeffMessage,
      source: "live",
    });
  }

  const latestTodayTurn = getLatestAgentChatUserTurn(input.messages, { now, todayOnly: true });
  if (!latestTodayTurn || !userTurnIncludesDirector(latestTodayTurn, "project-manager")) {
    return HIDDEN_STATE;
  }

  return buildJeffPresenceState({
    nowMs,
    triggeredAt: new Date(latestTodayTurn.userMessage.createdAt).getTime(),
    animateEntry: false,
    hasWorkingJeffMessage: userTurnHasWorkingDirectorMessage(latestTodayTurn, "project-manager"),
    source: "history",
  });
};
