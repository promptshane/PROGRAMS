import type { SlackChatMessage } from "@shared/types";

export interface SlackConversationRenderItem {
  message: SlackChatMessage;
  dayLabel: string | null;
  showSenderLabel: boolean;
  isSenderContinuation: boolean;
}

const slackWeekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
});

const slackMonthDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const slackMonthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const getSlackDayStamp = (value: Date): number =>
  Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());

export const getSlackDayKey = (iso: string): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return `invalid-${iso}`;
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

export const formatSlackDaySeparator = (iso: string, now = new Date()): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  const dayDelta = Math.round((getSlackDayStamp(now) - getSlackDayStamp(value)) / 86_400_000);
  if (dayDelta === 0) {
    return "Today";
  }
  if (dayDelta === 1) {
    return "Yesterday";
  }
  if (dayDelta >= 2 && dayDelta < 7) {
    return slackWeekdayFormatter.format(value);
  }
  if (value.getFullYear() === now.getFullYear()) {
    return slackMonthDayFormatter.format(value);
  }

  return slackMonthDayYearFormatter.format(value);
};

const getSlackSenderKey = (message: SlackChatMessage): string | null => {
  if (message.role === "assistant" && message.directorId) {
    return `assistant:${message.directorId}`;
  }
  if (message.role === "user") {
    return "user";
  }
  return null;
};

export const buildSlackConversationRenderItems = (
  messages: SlackChatMessage[],
  options: { now?: Date } = {},
): SlackConversationRenderItem[] => {
  const now = options.now ?? new Date();
  const items: SlackConversationRenderItem[] = [];
  let previousDayKey: string | null = null;
  let previousSenderKey: string | null = null;

  for (const message of messages) {
    const dayKey = getSlackDayKey(message.createdAt);
    const senderKey = getSlackSenderKey(message);
    const isAssistant = message.role === "assistant" && Boolean(message.directorId);
    const isSenderContinuation = dayKey === previousDayKey && senderKey !== null && senderKey === previousSenderKey;

    items.push({
      message,
      dayLabel: dayKey === previousDayKey ? null : formatSlackDaySeparator(message.createdAt, now) || null,
      showSenderLabel: Boolean(isAssistant && (dayKey !== previousDayKey || senderKey !== previousSenderKey)),
      isSenderContinuation,
    });

    previousDayKey = dayKey;
    previousSenderKey = senderKey;
  }

  return items;
};
