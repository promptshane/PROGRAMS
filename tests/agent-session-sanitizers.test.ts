import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const loadAgentSessionModule = async () => {
  const sourcePath = new URL("../src/shared/agent-session.ts", import.meta.url);
  const typesUrl = new URL("../src/shared/types.ts", import.meta.url).href;
  const originalSource = await readFile(sourcePath, "utf8");
  const rewrittenSource = originalSource.replace('} from "./types.ts";', `} from ${JSON.stringify(typesUrl)};`);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "programs-agent-session-"));
  const tempPath = path.join(tempDir, "agent-session.test.ts");
  await writeFile(tempPath, rewrittenSource, "utf8");

  try {
    const module = await import(pathToFileURL(tempPath).href);
    return module;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const {
  sanitizeDanArchivedNotes,
  sanitizeDirectorStateMap,
  sanitizePendingApprovals,
  sanitizeSlackPresenceGuestId,
  sanitizeSlackMessages,
  sanitizeSlackResponseContent,
} = await loadAgentSessionModule();

test("sanitizeSlackMessages repairs malformed legacy Slack assistant messages", () => {
  const { messages, changed } = sanitizeSlackMessages([
    {
      id: "msg-1",
      role: "assistant",
      directorId: "programming-director",
      createdAt: "2026-03-19T12:00:00.000Z",
    },
    {
      id: "msg-2",
      role: "user",
      content: "Keep this one.",
      createdAt: "2026-03-19T12:01:00.000Z",
    },
    {
      id: "msg-3",
      role: "not-a-real-role",
    },
  ]);

  assert.equal(changed, true);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.content, "Ping did not return a message.");
  assert.equal(messages[1]?.content, "Keep this one.");
});

test("sanitizeSlackMessages preserves hard-memory report metadata", () => {
  const hardMemoryReport = {
    type: "hard-memory-report",
    dataType: "danDraftCoreDetails",
    directorId: "creative-director",
    approvalId: "approval-1",
    summary: "Confirm Dan's core details draft.",
    currentState: "Current",
    idealState: "Ideal",
    changeSummary: ["Updated the function summary."],
    draftCoreDetails: null,
    roadmapVersions: null,
    versionUpdates: null,
    createdAt: "2026-03-19T12:00:00.000Z",
  } as const;

  const { messages, changed } = sanitizeSlackMessages([
    {
      id: "msg-1",
      role: "assistant",
      directorId: "creative-director",
      content: "Here is the proposal.",
      createdAt: "2026-03-19T12:00:00.000Z",
      metadata: hardMemoryReport,
    },
  ]);

  assert.equal(changed, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.metadata, hardMemoryReport);
});

test("sanitizeDirectorStateMap keeps string assumptions and drops malformed entries", () => {
  const { directorStateMap, changed } = sanitizeDirectorStateMap({
    "rd-director": {
      currentState: "Current",
      idealState: "Ideal",
      assumptions: ["Keep", "", 42, "Also keep"],
    },
    "bad-director": {
      currentState: "Nope",
      idealState: "Nope",
      assumptions: ["bad"],
    },
  });

  assert.equal(changed, true);
  assert.deepEqual(directorStateMap["rd-director"], {
    currentState: "Current",
    idealState: "Ideal",
    assumptions: ["Keep", "Also keep"],
  });
  assert.equal(directorStateMap["project-manager"], undefined);
});

test("sanitizePendingApprovals drops invalid approvals and normalizes malformed payloads", () => {
  const { pendingApprovals, changed } = sanitizePendingApprovals([
    {
      id: "approval-1",
      kind: "handoff",
      status: "later",
      requestedByDirectorId: "project-manager",
      targetDirectorId: "rd-director",
      summary: "",
      draftMessage: "Check with Todd",
      draftPayload: "not-an-object",
      createdAt: "2026-03-19T12:00:00.000Z",
      updatedAt: "2026-03-19T12:05:00.000Z",
    },
    {
      id: "approval-2",
      kind: "unsupported-kind",
    },
  ]);

  assert.equal(changed, true);
  assert.equal(pendingApprovals.length, 1);
  assert.deepEqual(pendingApprovals[0], {
    id: "approval-1",
    kind: "handoff",
    status: "later",
    requestedByDirectorId: "project-manager",
    targetDirectorId: "rd-director",
    summary: "Pending approval",
    draftMessage: "Check with Todd",
    draftPayload: null,
    createdAt: "2026-03-19T12:00:00.000Z",
    updatedAt: "2026-03-19T12:05:00.000Z",
  });
});

test("sanitizeSlackResponseContent falls back when a director response is blank", () => {
  assert.equal(
    sanitizeSlackResponseContent("", "rd-director"),
    "Todd did not return a message.",
  );
  assert.equal(
    sanitizeSlackResponseContent("Research queued for approval.", "rd-director"),
    "Research queued for approval.",
  );
});

test("sanitizeDanArchivedNotes keeps only non-empty strings", () => {
  const { notes, changed } = sanitizeDanArchivedNotes(["Keep", "", 42, "Also keep"]);

  assert.equal(changed, true);
  assert.deepEqual(notes, ["Keep", "Also keep"]);
});

test("sanitizeSlackPresenceGuestId drops Jeff and invalid directors from transient presence", () => {
  assert.deepEqual(sanitizeSlackPresenceGuestId("project-manager"), {
    directorId: null,
    changed: true,
  });
  assert.deepEqual(sanitizeSlackPresenceGuestId("creative-director"), {
    directorId: "creative-director",
    changed: false,
  });
  assert.deepEqual(sanitizeSlackPresenceGuestId("nope"), {
    directorId: null,
    changed: true,
  });
});
