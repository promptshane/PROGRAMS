// Per-project chat persistence (localStorage-backed).
//
// This is the UI-phase store: the project chat is still mocked, so we keep its
// state on the renderer side keyed by project id. Each project has one `active`
// chat plus a `history` of past sessions. A chat is a list of *turns* — a user
// message or an assistant "Response area" (progress + thoughts + todos + plan +
// response). When real chat function lands this can migrate to the project-store
// DB without changing the call sites below.

import type { AssistantTurn, ChatTurn, UserTurn } from "../components/response-area";

// Serialized forms: identical to the runtime turns but with `createdAt` as an
// ISO string (revived to a Date when loaded into React state).
type SerializedUserTurn = Omit<UserTurn, "createdAt"> & { createdAt: string };
type SerializedAssistantTurn = Omit<AssistantTurn, "createdAt"> & { createdAt: string };
export type StoredTurn = SerializedUserTurn | SerializedAssistantTurn;

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: StoredTurn[];
}

export interface ProjectChatStore {
  active: StoredTurn[];
  history: ChatSession[];
}

const KEY_PREFIX = "programs.projectChats.";
const TITLE_MAX = 40;

const storageKey = (projectId: string): string => `${KEY_PREFIX}${projectId}`;

const emptyStore = (): ProjectChatStore => ({ active: [], history: [] });

function readStore(projectId: string): ProjectChatStore {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ProjectChatStore>;
    return {
      active: Array.isArray(parsed.active) ? parsed.active : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(projectId: string, store: ProjectChatStore): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(store));
  } catch {
    // Storage full or unavailable — non-fatal for a mock chat.
  }
}

const toStored = (turns: ChatTurn[]): StoredTurn[] =>
  turns.map((t) => ({
    ...t,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
  })) as StoredTurn[];

// A reloaded chat has no live backend, so any assistant turn still marked
// running/in_progress is stale — settle it so finished chats don't look like
// they're still working (blinking dots). Also backfill fields added after the
// turn was persisted.
const settleStored = (status: string): "completed" | "skipped" | "failed" | "pending" =>
  status === "in_progress" ? "completed" : (status as "completed" | "skipped" | "failed" | "pending");

export const reviveTurns = (turns: StoredTurn[]): ChatTurn[] =>
  turns.map((t) => {
    const createdAt = new Date(t.createdAt);
    if (t.role !== "assistant") {
      return { ...t, createdAt };
    }
    const stale = t.status === "running";
    return {
      ...t,
      createdAt,
      model: t.model ?? "",
      reasoningEffort: t.reasoningEffort ?? "high",
      status: stale ? "completed" : t.status,
      thinkingStatus: settleStored(t.thinkingStatus),
      planningStatus: settleStored(t.planningStatus),
      buildingStatus: settleStored(t.buildingStatus),
      verifyingStatus: settleStored(t.verifyingStatus),
      steps: t.steps.map((s) => ({ ...s, status: s.status === "in_progress" ? "completed" : s.status })),
    };
  }) as ChatTurn[];

function deriveTitle(turns: StoredTurn[]): string {
  const firstUser = turns.find((t): t is SerializedUserTurn => t.role === "user");
  const text = firstUser?.content.trim();
  if (text) {
    return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX).trimEnd()}…` : text;
  }
  return `Chat · ${new Date().toLocaleDateString()}`;
}

const sortedHistory = (history: ChatSession[]): ChatSession[] =>
  [...history].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** Load a project's full chat store. */
export function loadProjectChatStore(projectId: string): ProjectChatStore {
  return readStore(projectId);
}

/** Load just the history sessions for a project, most-recent first. */
export function loadProjectChatHistory(projectId: string): ChatSession[] {
  return sortedHistory(readStore(projectId).history);
}

/** Persist the in-progress active chat so it survives a crash/restart. */
export function saveActiveChat(projectId: string, turns: ChatTurn[]): void {
  const store = readStore(projectId);
  store.active = toStored(turns);
  writeStore(projectId, store);
}

/**
 * Move a non-empty active chat into history with a generated title, then clear
 * active. No-op for empty chats (keeps history clean). Returns updated history.
 */
export function archiveActiveChat(projectId: string): ChatSession[] {
  const store = readStore(projectId);
  if (store.active.length > 0) {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: `chat-${Date.now()}`,
      title: deriveTitle(store.active),
      createdAt: store.active[0]?.createdAt ?? now,
      updatedAt: now,
      turns: store.active,
    };
    store.history = [...store.history, session];
    store.active = [];
    writeStore(projectId, store);
  }
  return sortedHistory(store.history);
}

/**
 * Reload a history session as the active chat to continue it: archives the
 * current active chat first, removes the chosen session from history, and
 * returns the revived turns plus the updated history list.
 */
export function loadHistorySession(
  projectId: string,
  sessionId: string,
): { turns: ChatTurn[]; history: ChatSession[] } {
  archiveActiveChat(projectId);
  const store = readStore(projectId);
  const session = store.history.find((s) => s.id === sessionId);
  if (!session) {
    return { turns: [], history: sortedHistory(store.history) };
  }
  store.history = store.history.filter((s) => s.id !== sessionId);
  store.active = session.turns;
  writeStore(projectId, store);
  return { turns: reviveTurns(session.turns), history: sortedHistory(store.history) };
}

/** Delete a single history session. Returns the updated history list. */
export function deleteHistorySession(projectId: string, sessionId: string): ChatSession[] {
  const store = readStore(projectId);
  store.history = store.history.filter((s) => s.id !== sessionId);
  writeStore(projectId, store);
  return sortedHistory(store.history);
}
