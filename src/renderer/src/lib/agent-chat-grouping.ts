import type { AgentChatMessage } from "@shared/types";

export interface AgentChatConversationRenderItem {
  message: AgentChatMessage;
  dayLabel: string | null;
  showSenderLabel: boolean;
  isSenderContinuation: boolean;
}

const agentChatWeekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
});

const agentChatMonthDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const agentChatMonthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const getAgentChatDayStamp = (value: Date): number =>
  Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());

export const getAgentChatDayKey = (iso: string): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return `invalid-${iso}`;
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

export const formatAgentChatDaySeparator = (iso: string, now = new Date()): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  const dayDelta = Math.round((getAgentChatDayStamp(now) - getAgentChatDayStamp(value)) / 86_400_000);
  if (dayDelta === 0) {
    return "Today";
  }
  if (dayDelta === 1) {
    return "Yesterday";
  }
  if (dayDelta >= 2 && dayDelta < 7) {
    return agentChatWeekdayFormatter.format(value);
  }
  if (value.getFullYear() === now.getFullYear()) {
    return agentChatMonthDayFormatter.format(value);
  }

  return agentChatMonthDayYearFormatter.format(value);
};

const getAgentChatSenderKey = (message: AgentChatMessage): string | null => {
  if (message.role === "assistant" && message.directorId) {
    return `assistant:${message.directorId}`;
  }
  if (message.role === "user") {
    return "user";
  }
  return null;
};

export const buildAgentChatConversationRenderItems = (
  messages: AgentChatMessage[],
  options: { now?: Date } = {},
): AgentChatConversationRenderItem[] => {
  const now = options.now ?? new Date();
  const items: AgentChatConversationRenderItem[] = [];
  let previousDayKey: string | null = null;
  let previousSenderKey: string | null = null;

  for (const message of messages) {
    const dayKey = getAgentChatDayKey(message.createdAt);
    const senderKey = getAgentChatSenderKey(message);
    const isAssistant = message.role === "assistant" && Boolean(message.directorId);
    const isSenderContinuation = dayKey === previousDayKey && senderKey !== null && senderKey === previousSenderKey;

    items.push({
      message,
      dayLabel: dayKey === previousDayKey ? null : formatAgentChatDaySeparator(message.createdAt, now) || null,
      showSenderLabel: Boolean(isAssistant && (dayKey !== previousDayKey || senderKey !== previousSenderKey)),
      isSenderContinuation,
    });

    previousDayKey = dayKey;
    previousSenderKey = senderKey;
  }

  return items;
};
