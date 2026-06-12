import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS,
  AGENT_STAGES,
  createEmptyProjectRelationshipSummary,
  normalizeProjectRelationshipSummary,
} from "../../shared/types.ts";
import type {
  AgentCoreDetails,
  AgentPlannedUpdate,
  AgentSession,
  AgentStage,
  AgentStageData,
  AiProvider,
  CorePillar,
  CreativeFocusMode,
  DanDraftStatus,
  DirectorConversation,
  DirectorId,
  DirectorFocusMode,
  GithubConnection,
  JeffExecutionReport,
  JeffMemory,
  PendingApproval,
  PingMemory,
  PingRawReport,
  PongMemory,
  ProjectCategory,
  ProjectDirectorProgress,
  ProjectOutlineReport,
  Project,
  RdFocusMode,
  ScratchpadItem,
  Settings,
  SettingsUpdateInput,
  SetupState,
  TaggedNote,
  ToddCodebaseIndexedMap,
  ToddMemory,
  UpdateRecord,
  ValidationFocusMode,
  VersionPlan,
  VersionUpdate,
} from "../../shared/types.ts";
import {
  sanitizeDirectorStateMap,
  sanitizeJeffMemory,
  sanitizePendingApprovals,
  sanitizePongMemory,
  sanitizeSlackMessages,
} from "../../shared/agent-session.ts";
import { DEFAULT_SETTINGS, DEFAULT_SETUP_STATE } from "../defaults.ts";
import { ensureDirectory, pathExists } from "../utils/fs.ts";

const LEGACY_FLOWCHART_PATH = "";
const LEGACY_FLOWCHART_TEXT = "";

const normalizeModel = (value: string | undefined): Settings["advancedDefaults"]["model"] => {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_SETTINGS.advancedDefaults.model;
  }

  if (
    normalized === "gpt-5-codex" ||
    normalized === "gpt-5.5-codex" ||
    normalized === "gpt-5.4-codex" ||
    normalized === "gpt-5.4" ||
    normalized === "gpt-5.3-codex" ||
    normalized === "gpt-5.2-codex" ||
    normalized === "gpt-5.1-codex-max" ||
    normalized === "gpt-5.1-codex" ||
    normalized === "gpt-5.1-codex-mini"
  ) {
    return "gpt-5.5";
  }

  if ((CODEX_MODEL_OPTIONS as readonly string[]).includes(normalized)) {
    return normalized;
  }

  return normalized;
};

const normalizeClaudeModel = (value: string | undefined): Settings["advancedDefaults"]["claudeModel"] => {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_SETTINGS.advancedDefaults.claudeModel;
  }

  if (normalized === "claude-sonnet-4-20250514" || normalized === "claude-sonnet-4-20241022") {
    return "sonnet";
  }
  if (normalized === "claude-opus-4-20250514" || normalized === "claude-opus-4-20241022") {
    return "opus";
  }

  if ((CLAUDE_MODEL_OPTIONS as readonly string[]).includes(normalized)) {
    return normalized;
  }

  return normalized;
};

const normalizeProvider = (value: string | undefined): Settings["advancedDefaults"]["provider"] => {
  return value === "codex" || value === "claude" ? value : DEFAULT_SETTINGS.advancedDefaults.provider;
};

type LegacyHomeScratchpadItem = {
  id: string;
  text: string;
  projectId: string | null;
  completed: boolean;
  createdAt: string;
};

const buildConfirmedConceptFromLegacy = (session: {
  stages: AgentSession["stages"];
  corePillars: CorePillar[];
}): AgentCoreDetails | null => {
  const confirmedConcept: AgentCoreDetails = {
    function: session.stages.function.confirmed ?? null,
    thesis: session.stages.thesis.confirmed ?? null,
    corePillars: session.corePillars,
    fullFlow: session.stages.full_flow.confirmed ?? null,
    threads: [],
  };

  return confirmedConcept.function || confirmedConcept.thesis || confirmedConcept.corePillars.length > 0 || confirmedConcept.fullFlow
    ? confirmedConcept
    : null;
};

const normalizeVersionUpdate = (update: VersionUpdate, index: number): VersionUpdate => ({
  ...update,
  order: typeof update.order === "number" ? update.order : index,
  dependencies: Array.isArray(update.dependencies) ? update.dependencies : [],
  pillarIds: Array.isArray(update.pillarIds) ? update.pillarIds : [],
  skillsNeeded: Array.isArray(update.skillsNeeded) ? update.skillsNeeded.filter((item): item is string => typeof item === "string") : [],
  updateKind: update.updateKind === "create" || update.updateKind === "expand" || update.updateKind === "refine" || update.updateKind === "simplify"
    ? update.updateKind
    : null,
  simplificationMode: update.simplificationMode === "inline" || update.simplificationMode === "staged" || update.simplificationMode === "overhaul"
    ? update.simplificationMode
    : null,
  structuralReason: typeof update.structuralReason === "string" && update.structuralReason.trim().length > 0
    ? update.structuralReason.trim()
    : null,
  supportsNextStep: typeof update.supportsNextStep === "string" && update.supportsNextStep.trim().length > 0
    ? update.supportsNextStep.trim()
    : null,
});

const findRoadmapVersion = (versions: VersionPlan[], label: "v1" | "v2" | "v3"): VersionPlan | null =>
  versions.find((version) => version.label.trim().toLowerCase().includes(label)) ?? null;

const buildToddCodebaseIndexedMap = (session: {
  currentCorePillars: CorePillar[];
  directorStateMap: Partial<Record<DirectorId, AgentSession["directorStateMap"][DirectorId]>>;
}, existing: ToddCodebaseIndexedMap | null): ToddCodebaseIndexedMap | null => {
  const rdState = session.directorStateMap["rd-director"];
  const featureAreas = session.currentCorePillars
    .map((pillar) => pillar.name.trim())
    .filter((name) => name.length > 0);
  const repoNotes = rdState?.assumptions ?? [];
  const summary = existing?.summary ?? rdState?.currentState ?? null;

  if (!summary && featureAreas.length === 0 && repoNotes.length === 0 && !existing) {
    return null;
  }

  return {
    summary,
    indexedAt: existing?.indexedAt ?? null,
    featureAreas: existing?.featureAreas?.length ? existing.featureAreas : featureAreas,
    repoNotes: existing?.repoNotes?.length ? existing.repoNotes : repoNotes,
    lastIndexedFingerprint: existing?.lastIndexedFingerprint ?? null,
  };
};

const buildDanMemory = (session: {
  danMemory?: AgentSession["danMemory"];
  stages: AgentSession["stages"];
  corePillars: CorePillar[];
  danDraftCoreDetails: AgentCoreDetails | null;
  danInternalNotes: string[];
  danSideNotes: string[];
  danDraftChangeSummary: string[];
  danDraftStatus: AgentSession["danDraftStatus"];
  danArchivedNotes: string[];
  deletedNotes: string[];
}): AgentSession["danMemory"] => {
  const confirmedConcept = buildConfirmedConceptFromLegacy(session) ?? session.danMemory?.confirmedConcept ?? null;
  const hardMemory = session.danMemory?.hardMemory ?? confirmedConcept ?? null;
  const softMemory = session.danMemory?.softMemory ?? session.danMemory?.notes ?? (session.danInternalNotes ?? []).map((n, i): TaggedNote => typeof n === "string" ? { id: `legacy-${i}`, content: n, tag: "general", createdAt: new Date(0).toISOString(), sourceRefs: [], resolution: null } : n);
  const backupMemory = session.danMemory?.backupMemory ?? (session.danMemory?.archivedNotes ?? session.danArchivedNotes ?? []).map((n, i): TaggedNote => typeof n === "string" ? { id: `dan-backup-${i}`, content: n, tag: "likely-backup", createdAt: new Date(0).toISOString(), sourceRefs: [], resolution: { target: "backup", resolvedAt: new Date(0).toISOString(), reportId: null } } : n);
  return {
    softMemory,
    hardMemory,
    backupMemory,
    hardMemoryUpdatedAt: session.danMemory?.hardMemoryUpdatedAt ?? null,
    latestReportId: session.danMemory?.latestReportId ?? null,
    confirmedConcept: hardMemory ?? confirmedConcept,
    draftConcept: session.danMemory?.draftConcept ?? session.danDraftCoreDetails ?? null,
    derivedConcept: session.danMemory?.derivedConcept ?? null,
    notes: softMemory,
    derivedNotes: session.danMemory?.derivedNotes ?? [],
    sideNotes: session.danMemory?.sideNotes ?? session.danSideNotes ?? [],
    draftChangeSummary: session.danMemory?.draftChangeSummary ?? session.danDraftChangeSummary ?? [],
    draftStatus: session.danMemory?.draftStatus ?? session.danDraftStatus ?? null,
    derivedUpdatedAt: session.danMemory?.derivedUpdatedAt ?? null,
    fullExperienceDescription: session.danMemory?.fullExperienceDescription
      ?? confirmedConcept?.fullFlow?.summary
      ?? null,
    archivedNotes: backupMemory.map((note) => note.content),
    deletedNotes: session.danMemory?.deletedNotes ?? session.deletedNotes ?? [],
    rawMemories: session.danMemory?.rawMemories ?? [],
    forgottenMemories: session.danMemory?.forgottenMemories ?? [],
    creativeHistory: session.danMemory?.creativeHistory ?? [],
    toddHandoffNotes: session.danMemory?.toddHandoffNotes ?? [] as TaggedNote[],
    threads: [],
  };
};

const buildToddMemory = (session: {
  toddMemory?: ToddMemory;
  versions: VersionPlan[];
  versionUpdates: VersionUpdate[];
  currentCorePillars: CorePillar[];
  directorStateMap: AgentSession["directorStateMap"];
  pingTaskContext: AgentSession["pingTaskContext"];
  danMemory: AgentSession["danMemory"];
}): ToddMemory => {
  const futureUpdatePlan = session.toddMemory?.futureUpdatePlan?.length
    ? session.toddMemory.futureUpdatePlan.map(normalizeVersionUpdate)
    : session.versionUpdates.map(normalizeVersionUpdate);
  const troubleLog = session.toddMemory?.troubleLog?.length
    ? session.toddMemory.troubleLog
    : session.pingTaskContext?.lastFailureReason
      ? [{
          id: `legacy-trouble-${session.pingTaskContext.currentTask ?? "task"}`,
          title: session.pingTaskContext.currentTask ?? "Implementation issue",
          details: session.pingTaskContext.lastFailureReason,
          priority: "medium" as const,
          occurrences: 1,
          lastSeenAt: new Date().toISOString(),
          updateIds: [],
        }]
      : [];

  const hardMemory = session.toddMemory?.hardMemory ?? session.toddMemory?.roadmap ?? null;
  const softMemory = session.toddMemory?.softMemory ?? session.toddMemory?.notes ?? [];
  const backupMemory = session.toddMemory?.backupMemory ?? session.toddMemory?.backupNotes ?? [];
  return {
    softMemory,
    hardMemory,
    backupMemory,
    hardMemoryUpdatedAt: session.toddMemory?.hardMemoryUpdatedAt ?? null,
    latestReportId: session.toddMemory?.latestReportId ?? null,
    confirmedConcept: session.danMemory.confirmedConcept,
    roadmap: hardMemory ?? session.toddMemory?.roadmap ?? null,
    currentState: session.toddMemory?.currentState ?? null,
    endStateGoal: session.toddMemory?.endStateGoal ?? null,
    successChain: session.toddMemory?.successChain ?? [],
    nextUpdate: session.toddMemory?.nextUpdate ?? null,
    futureUpdatePlan,
    previousUpdateLog: session.toddMemory?.previousUpdateLog ?? [],
    troubleLog,
    codebaseIndexedMap: buildToddCodebaseIndexedMap(session, session.toddMemory?.codebaseIndexedMap ?? null),
    notes: softMemory,
    pendingHandoff: session.toddMemory?.pendingHandoff ?? null,
    backupNotes: backupMemory,
  };
};

const buildPingMemory = (session: {
  pingMemory?: PingMemory;
  pingTaskContext: AgentSession["pingTaskContext"];
  toddMemory: ToddMemory;
}): PingMemory => ({
  activeUpdateId: session.pingMemory?.activeUpdateId ?? null,
  activeTask: session.pingMemory?.activeTask ?? session.pingTaskContext?.currentTask ?? null,
  context: session.pingMemory?.context ?? session.pingTaskContext?.toddUpdateExplanation ?? null,
  codebaseMapSummary: session.pingMemory?.codebaseMapSummary ?? session.toddMemory.codebaseIndexedMap?.summary ?? null,
  latestPlanReport: session.pingMemory?.latestPlanReport ?? null,
  latestIndexedMap: session.pingMemory?.latestIndexedMap ?? (session.toddMemory.codebaseIndexedMap ? { ...session.toddMemory.codebaseIndexedMap } : null),
  latestRawReport: session.pingMemory?.latestRawReport ?? null,
  latestJeffReport: session.pingMemory?.latestJeffReport ?? null,
  currentRun: session.pingMemory?.currentRun ?? null,
});

const buildJeffMemory = (session: {
  jeffMemory?: JeffMemory;
}): JeffMemory => ({
  softMemory: session.jeffMemory?.softMemory ?? session.jeffMemory?.notes ?? [],
  hardMemory: session.jeffMemory?.hardMemory ?? session.jeffMemory?.managerSummary ?? null,
  backupMemory: session.jeffMemory?.backupMemory ?? session.jeffMemory?.backupNotes ?? [],
  hardMemoryUpdatedAt: session.jeffMemory?.hardMemoryUpdatedAt ?? null,
  latestReportId: session.jeffMemory?.latestReportId ?? null,
  pendingReports: session.jeffMemory?.pendingReports ?? [],
  pendingValidations: session.jeffMemory?.pendingValidations ?? [],
  outcomeLog: session.jeffMemory?.outcomeLog ?? [],
  managerSummary: session.jeffMemory?.managerSummary ?? null,
  projectStatusHistory: session.jeffMemory?.projectStatusHistory ?? [],
  currentProjectStatus: session.jeffMemory?.currentProjectStatus ?? null,
  notes: session.jeffMemory?.softMemory ?? session.jeffMemory?.notes ?? [],
  backupNotes: session.jeffMemory?.backupMemory ?? session.jeffMemory?.backupNotes ?? [],
});

const buildPongMemory = (session: {
  pongMemory?: PongMemory;
}): PongMemory => ({
  jeffInstruction: session.pongMemory?.jeffInstruction ?? null,
  validationRequest: session.pongMemory?.validationRequest ?? null,
  previousValidationReports: session.pongMemory?.previousValidationReports ?? [],
  latestValidationReport: session.pongMemory?.latestValidationReport ?? null,
  screenshotPaths: session.pongMemory?.screenshotPaths ?? [],
});

const buildAutomationState = (
  automation: AgentSession["automation"] | null | undefined,
): AgentSession["automation"] => ({
  status: automation?.status ?? "idle",
  selectedTargetUpdateId: automation?.selectedTargetUpdateId ?? null,
  selectedTargetVersionId: automation?.selectedTargetVersionId ?? null,
  inScopeUpdateIds: Array.isArray(automation?.inScopeUpdateIds) ? automation!.inScopeUpdateIds : [],
  constraints: {
    allowedHours: automation?.constraints?.allowedHours ?? null,
    codexMaxUsedPercent: typeof automation?.constraints?.codexMaxUsedPercent === "number"
      ? automation.constraints.codexMaxUsedPercent
      : null,
    claudeMaxUsedPercent: typeof automation?.constraints?.claudeMaxUsedPercent === "number"
      ? automation.constraints.claudeMaxUsedPercent
      : null,
  },
  stopReason: automation?.stopReason ?? null,
  stopSummary: automation?.stopSummary ?? null,
  currentStep: automation?.currentStep ?? "idle",
  startedAt: automation?.startedAt ?? null,
  lastResumedAt: automation?.lastResumedAt ?? null,
  updatedAt: automation?.updatedAt ?? null,
  completedAt: automation?.completedAt ?? null,
  resumeRequired: automation?.resumeRequired ?? false,
  nextUpdateId: automation?.nextUpdateId ?? null,
  lastSuccessfulUpdateId: automation?.lastSuccessfulUpdateId ?? null,
  lastSuccessfulHistoryUpdateId: automation?.lastSuccessfulHistoryUpdateId ?? null,
  pendingRevertReportId: automation?.pendingRevertReportId ?? null,
  pendingRevertHistoryUpdateId: automation?.pendingRevertHistoryUpdateId ?? null,
  pendingRevertCommitSha: automation?.pendingRevertCommitSha ?? null,
});

const syncLegacyFieldsFromMemory = (session: AgentSession): AgentSession => {
  session.danInternalNotes = session.danMemory.softMemory.map((n) => typeof n === "string" ? n : n.content);
  session.danSideNotes = [...session.danMemory.sideNotes];
  session.danDraftCoreDetails = session.danMemory.draftConcept;
  session.danDraftChangeSummary = [...session.danMemory.draftChangeSummary];
  session.danDraftStatus = session.danMemory.draftStatus;
  session.danArchivedNotes = [...session.danMemory.backupMemory.map((note) => note.content)];
  session.deletedNotes = [...session.danMemory.deletedNotes];
  session.versions = [];
  session.versionUpdates = session.toddMemory.futureUpdatePlan.map(normalizeVersionUpdate);
  session.automation = buildAutomationState(session.automation);
  session.pingTaskContext = session.pingMemory.activeTask
    ? {
        currentTask: session.pingMemory.activeTask,
        lastResult: session.pingMemory.latestRawReport?.summary ?? null,
        lastFailureReason: session.pingMemory.latestRawReport?.blocker ?? null,
        toddUpdateExplanation: session.pingMemory.context,
        relevantPillarIds: [],
      }
    : session.pingTaskContext;
  return session;
};

interface ProjectRow {
  id: string;
  name: string;
  icon_color: string;
  description: string;
  local_path: string;
  remote_url: string | null;
  default_branch: string;
  thread_id: string | null;
  flowchart_path: string;
  last_updated_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  metadata_json: string;
  last_error: string | null;
  github_connection: string | null;
  relationship_json: string | null;
}

interface UpdateRow {
  id: string;
  project_id: string;
  prompt: string;
  summary: string;
  commit_sha: string | null;
  flowchart: string;
  flowchart_graph_json: string | null;
  created_at: string;
  kind: UpdateRecord["kind"];
  status: string;
  error_message: string | null;
}

const normalizeProjectStatus = (status: string): Project["status"] => {
  switch (status) {
    case "planning":
    case "awaitingApproval":
    case "executing":
    case "running":
    case "error":
      return status;
    default:
      return "idle";
  }
};

const normalizeUpdateStatus = (status: string): UpdateRecord["status"] => {
  switch (status) {
    case "planned":
    case "executing":
    case "saved":
    case "reverted":
    case "failed":
      return status;
    default:
      return "saved";
  }
};

const normalizeNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const normalizeGithubConnection = (value: string | null): GithubConnection | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<GithubConnection>;
    return {
      repoUrl: normalizeNullableString(parsed.repoUrl),
      lastPushedAt: normalizeNullableString(parsed.lastPushedAt),
      lastPushedCommitSha: normalizeNullableString(parsed.lastPushedCommitSha),
      lastDownloadedAt: normalizeNullableString(parsed.lastDownloadedAt),
      lastDownloadedCommitSha: normalizeNullableString(parsed.lastDownloadedCommitSha),
    };
  } catch {
    return null;
  }
};

const mapProjectRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  iconColor: row.icon_color,
  description: row.description,
  localPath: row.local_path,
  threadId: row.thread_id,
  lastUpdatedAt: row.last_updated_at,
  status: normalizeProjectStatus(row.status),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  runtimeConfig: JSON.parse(row.metadata_json),
  lastError: row.last_error,
  githubConnection: normalizeGithubConnection(row.github_connection),
  relationship: row.relationship_json
    ? normalizeProjectRelationshipSummary(JSON.parse(row.relationship_json))
    : createEmptyProjectRelationshipSummary(),
});

const mapUpdateRow = (row: UpdateRow): UpdateRecord => ({
  id: row.id,
  projectId: row.project_id,
  prompt: row.prompt,
  summary: row.summary,
  commitSha: row.commit_sha,
  createdAt: row.created_at,
  kind: row.kind,
  status: normalizeUpdateStatus(row.status),
  errorMessage: row.error_message,
});

export class ProjectStore {
  private db!: Database;
  private sql!: SqlJsStatic;
  private readonly filePath = join(app.getPath("userData"), "programs.sqlite");

  async initialize(): Promise<void> {
    await ensureDirectory(app.getPath("userData"));

    this.sql = await initSqlJs({
      locateFile: (file) => join(app.getAppPath(), "node_modules", "sql.js", "dist", file),
    });

    if (await pathExists(this.filePath)) {
      this.db = new this.sql.Database(readFileSync(this.filePath));
    } else {
      this.db = new this.sql.Database();
    }

    this.migrate();
    await this.ensureSettings();
    await this.ensureSetupState();
    await this.normalizeTransientStatuses();
    this.repairLegacyAgentSessions();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon_color TEXT NOT NULL,
        description TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        remote_url TEXT,
        default_branch TEXT NOT NULL,
        thread_id TEXT,
        flowchart_path TEXT NOT NULL,
        last_updated_at TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        last_error TEXT,
        relationship_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS updates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        summary TEXT NOT NULL,
        commit_sha TEXT,
        flowchart TEXT NOT NULL,
        flowchart_graph_json TEXT,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS pending_planned_updates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        flowchart TEXT NOT NULL,
        flowchart_graph_json TEXT,
        previous_flowchart TEXT NOT NULL,
        previous_flowchart_graph_json TEXT,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS planning_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        current_flowchart TEXT NOT NULL,
        current_flowchart_graph_json TEXT,
        previous_flowchart TEXT NOT NULL,
        previous_flowchart_graph_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS project_outline_reports (
        project_id TEXT PRIMARY KEY,
        report_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE,
        current_stage TEXT NOT NULL DEFAULT 'function',
        stages_json TEXT NOT NULL DEFAULT '{}',
        scratchpad_json TEXT NOT NULL DEFAULT '[]',
        planned_updates_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL DEFAULT 'claude',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
    `);

    this.ensureColumn("updates", "flowchart_graph_json", "TEXT");
    this.ensureColumn("pending_planned_updates", "flowchart_graph_json", "TEXT");
    this.ensureColumn("pending_planned_updates", "previous_flowchart_graph_json", "TEXT");
    this.ensureColumn("planning_sessions", "current_flowchart_graph_json", "TEXT");
    this.ensureColumn("planning_sessions", "previous_flowchart_graph_json", "TEXT");
    this.ensureColumn("agent_sessions", "attached_materials_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "core_pillars_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "core_details_chat_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "conversation_mode", "TEXT DEFAULT 'guided'");
    this.ensureColumn("agent_sessions", "unified_messages_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "cascade_pending_json", "TEXT");
    this.ensureColumn("agent_sessions", "misc_materials_json", "TEXT DEFAULT '[]'");
    // Director system columns
    this.ensureColumn("agent_sessions", "versions_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "version_updates_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "feasibility_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "validation_results_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "validation_frequency", "TEXT DEFAULT 'manual'");
    this.ensureColumn("agent_sessions", "director_conversations_json", "TEXT DEFAULT '{}'");
    this.ensureColumn("agent_sessions", "director_progress_json", "TEXT DEFAULT '{}'");
    this.ensureColumn("agent_sessions", "creative_focus_mode", "TEXT");
    this.ensureColumn("agent_sessions", "rd_focus_mode", "TEXT");
    this.ensureColumn("agent_sessions", "validation_focus_mode", "TEXT");
    this.ensureColumn("agent_sessions", "dan_internal_notes_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "dan_side_notes_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "dan_draft_core_details_json", "TEXT");
    this.ensureColumn("agent_sessions", "dan_draft_change_summary_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "dan_draft_status", "TEXT");
    this.ensureColumn("agent_sessions", "project_category", "TEXT DEFAULT 'general-project'");
    this.ensureColumn("agent_sessions", "active_director_id", "TEXT");
    // Slack chat columns
    this.ensureColumn("agent_sessions", "slack_messages_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "slack_active_director_id", "TEXT DEFAULT 'project-manager'");
    this.ensureColumn("agent_sessions", "pending_approvals_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "director_settings_overrides_json", "TEXT DEFAULT '{}'");
    this.ensureColumn("agent_sessions", "current_core_pillars_json", "TEXT DEFAULT '[]'");
    // Refinement pass: persist directorStateMap + new fields
    this.ensureColumn("agent_sessions", "director_state_map_json", "TEXT DEFAULT '{}'");
    this.ensureColumn("agent_sessions", "deleted_notes_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "dan_archived_notes_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "ping_task_context_json", "TEXT");
    this.ensureColumn("agent_sessions", "pong_task_context_json", "TEXT");
    this.ensureColumn("agent_sessions", "slack_presence_guest_id", "TEXT");
    this.ensureColumn("agent_sessions", "dan_memory_json", "TEXT");
    this.ensureColumn("agent_sessions", "todd_memory_json", "TEXT");
    this.ensureColumn("agent_sessions", "ping_memory_json", "TEXT");
    this.ensureColumn("agent_sessions", "jeff_memory_json", "TEXT");
    this.ensureColumn("agent_sessions", "pong_memory_json", "TEXT");
    this.ensureColumn("agent_sessions", "automation_json", "TEXT");
    this.ensureColumn("projects", "github_connection", "TEXT");
    this.ensureColumn("projects", "relationship_json", "TEXT NOT NULL DEFAULT '{}'");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS home_scratchpad (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        items_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS unified_todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        project_id TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        processed_into_pillar INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL
      );

    `);


    this.migrateExistingTodosOnce();

    this.persist();
  }

  private migrateExistingTodosOnce(): void {
    // Check if we've already migrated
    const existingCount = this.getRows<{ cnt: number }>("SELECT COUNT(*) as cnt FROM unified_todos");
    if (existingCount[0]?.cnt > 0) return;

    // Migrate from home_scratchpad
    const scratchpadRows = this.getRows<{ items_json: string }>("SELECT items_json FROM home_scratchpad LIMIT 1");
    if (scratchpadRows.length > 0 && scratchpadRows[0].items_json) {
      try {
        const items = JSON.parse(scratchpadRows[0].items_json) as LegacyHomeScratchpadItem[];
        for (const item of items) {
          this.db.run(
            "INSERT OR IGNORE INTO unified_todos (id, text, project_id, completed, processed_into_pillar, source, created_at) VALUES (?, ?, ?, ?, 0, 'user', ?)",
            [item.id, item.text, item.projectId ?? null, item.completed ? 1 : 0, item.createdAt],
          );
        }
      } catch { /* ignore parse errors */ }
    }

    // Migrate from agent_sessions scratchpad
    const agentRows = this.getRows<{ project_id: string; scratchpad_json: string }>(
      "SELECT project_id, scratchpad_json FROM agent_sessions WHERE scratchpad_json != '[]'",
    );
    for (const row of agentRows) {
      try {
        const items = JSON.parse(row.scratchpad_json) as ScratchpadItem[];
        for (const item of items) {
          this.db.run(
            "INSERT OR IGNORE INTO unified_todos (id, text, project_id, completed, processed_into_pillar, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [item.id, item.text, row.project_id, item.completed ? 1 : 0, item.completed ? 1 : 0, item.source, item.createdAt],
          );
        }
      } catch { /* ignore parse errors */ }
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.getRows<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((item) => item.name === column)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private repairLegacyAgentSessions(): void {
    const rows = this.getRows<{
      id: string;
      slack_messages_json?: string;
      director_state_map_json?: string;
      pending_approvals_json?: string;
    }>("SELECT id, slack_messages_json, director_state_map_json, pending_approvals_json FROM agent_sessions");

    for (const row of rows) {
      let changed = false;

      const rawSlackMessages = row.slack_messages_json ? JSON.parse(row.slack_messages_json) : [];
      const { messages: slackMessages, changed: slackChanged } = sanitizeSlackMessages(rawSlackMessages);
      changed ||= slackChanged;

      const rawDirectorStateMap = row.director_state_map_json ? JSON.parse(row.director_state_map_json) : {};
      const { directorStateMap, changed: directorStateChanged } = sanitizeDirectorStateMap(rawDirectorStateMap);
      changed ||= directorStateChanged;

      const rawPendingApprovals = row.pending_approvals_json ? JSON.parse(row.pending_approvals_json) : [];
      const { pendingApprovals, changed: approvalsChanged } = sanitizePendingApprovals(rawPendingApprovals);
      changed ||= approvalsChanged;

      if (!changed) {
        continue;
      }

      this.run(
        `UPDATE agent_sessions
         SET slack_messages_json = ?, director_state_map_json = ?, pending_approvals_json = ?
         WHERE id = ?`,
        [
          JSON.stringify(slackMessages),
          JSON.stringify(directorStateMap),
          JSON.stringify(pendingApprovals),
          row.id,
        ],
      );
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, Buffer.from(this.db.export()));
  }

  private getSingleValue<T = string>(sql: string, params: (string | null)[] = []): T | null {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      if (!statement.step()) {
        return null;
      }

      const row = statement.getAsObject() as Record<string, T>;
      const firstKey = Object.keys(row)[0];
      return row[firstKey] ?? null;
    } finally {
      statement.free();
    }
  }

  private getRows<T>(sql: string, params: (string | null)[] = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private run(sql: string, params: (string | null)[] = []): void {
    this.db.run(sql, params);
    this.persist();
  }

  private async ensureSettings(): Promise<void> {
    const existing = this.getSingleValue<string>("SELECT value_json FROM settings WHERE key = ?", ["app"]);
    if (existing) {
      const merged = this.mergeSettings(JSON.parse(existing) as Settings);
      this.run("REPLACE INTO settings (key, value_json) VALUES (?, ?)", ["app", JSON.stringify(merged)]);
      return;
    }

    this.run("INSERT INTO settings (key, value_json) VALUES (?, ?)", [
      "app",
      JSON.stringify(DEFAULT_SETTINGS),
    ]);
  }

  private async ensureSetupState(): Promise<void> {
    const existing = this.getSingleValue<string>("SELECT value_json FROM settings WHERE key = ?", ["setup"]);
    if (existing) {
      const merged = this.mergeSetupState(JSON.parse(existing) as SetupState);
      this.run("REPLACE INTO settings (key, value_json) VALUES (?, ?)", ["setup", JSON.stringify(merged)]);
      return;
    }

    this.run("INSERT INTO settings (key, value_json) VALUES (?, ?)", [
      "setup",
      JSON.stringify(DEFAULT_SETUP_STATE),
    ]);
  }

  private mergeSettings(settings: Partial<Settings>): Settings {
    const appSourcePath =
      typeof settings.appSourcePath === "string"
        ? settings.appSourcePath.trim() || null
        : settings.appSourcePath === null
          ? null
          : DEFAULT_SETTINGS.appSourcePath;
    const advancedDefaults = {
      ...DEFAULT_SETTINGS.advancedDefaults,
      ...settings.advancedDefaults,
      provider: normalizeProvider(settings.advancedDefaults?.provider),
      model: normalizeModel(settings.advancedDefaults?.model),
      claudeModel: normalizeClaudeModel(settings.advancedDefaults?.claudeModel),
    };

    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      autoApprovePlans: settings.autoApprovePlans ?? DEFAULT_SETTINGS.autoApprovePlans,
      autoInstallAppUpdates: settings.autoInstallAppUpdates ?? DEFAULT_SETTINGS.autoInstallAppUpdates,
      appSourcePath,
      advancedDefaults,
    };
  }

  private mergeSetupState(setupState: SetupState): SetupState {
    return {
      ...DEFAULT_SETUP_STATE,
      ...setupState,
    };
  }

  async normalizeTransientStatuses(): Promise<void> {
    this.run(
      `UPDATE projects
       SET status = 'idle',
           last_error = CASE WHEN status = 'syncBlocked' THEN NULL ELSE last_error END
       WHERE status IN ('planning', 'awaitingApproval', 'executing', 'syncing', 'syncBlocked')`,
    );
    this.run(
      `UPDATE updates
       SET status = 'saved',
           error_message = NULL
       WHERE status IN ('pushed', 'pendingSync')`,
    );
    this.run(
      `UPDATE agent_sessions SET current_stage = 'iterations' WHERE current_stage = 'execution'`,
    );
  }

  async readSettings(): Promise<Settings> {
    const raw = this.getSingleValue<string>("SELECT value_json FROM settings WHERE key = ?", ["app"]);
    return this.mergeSettings(raw ? (JSON.parse(raw) as Settings) : DEFAULT_SETTINGS);
  }

  async updateSettings(input: SettingsUpdateInput): Promise<Settings> {
    const current = await this.readSettings();
    const next = this.mergeSettings({
      ...current,
      ...input,
      advancedDefaults: {
        ...current.advancedDefaults,
        ...input.advancedDefaults,
      },
    });

    this.run("REPLACE INTO settings (key, value_json) VALUES (?, ?)", ["app", JSON.stringify(next)]);
    return next;
  }

  async readSetupState(): Promise<SetupState> {
    const raw = this.getSingleValue<string>("SELECT value_json FROM settings WHERE key = ?", ["setup"]);
    return this.mergeSetupState(raw ? (JSON.parse(raw) as SetupState) : DEFAULT_SETUP_STATE);
  }

  async updateSetupState(input: Partial<SetupState>): Promise<SetupState> {
    const current = await this.readSetupState();
    const next = this.mergeSetupState({
      ...current,
      ...input,
    });

    this.run("REPLACE INTO settings (key, value_json) VALUES (?, ?)", ["setup", JSON.stringify(next)]);
    return next;
  }

  async listProjects(): Promise<Project[]> {
    return this.getRows<ProjectRow>("SELECT * FROM projects ORDER BY updated_at DESC").map(mapProjectRow);
  }

  async readProject(projectId: string): Promise<Project | null> {
    const row = this.getRows<ProjectRow>("SELECT * FROM projects WHERE id = ?", [projectId])[0];
    return row ? mapProjectRow(row) : null;
  }

  async createProject(project: Project): Promise<Project> {
    this.run(
      `INSERT INTO projects (
         id, name, icon_color, description, local_path, remote_url, default_branch,
         thread_id, flowchart_path, last_updated_at, status, created_at, updated_at,
         metadata_json, last_error, relationship_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project.id,
        project.name,
        project.iconColor,
        project.description,
        project.localPath,
        null,
        "main",
        project.threadId,
        LEGACY_FLOWCHART_PATH,
        project.lastUpdatedAt,
        project.status,
        project.createdAt,
        project.updatedAt,
        JSON.stringify(project.runtimeConfig),
        project.lastError,
        JSON.stringify(project.relationship),
      ],
    );

    return project;
  }

  async updateProject(project: Project): Promise<Project> {
    this.run(
      `UPDATE projects
       SET name = ?, icon_color = ?, description = ?, local_path = ?, remote_url = ?, default_branch = ?,
           thread_id = ?, flowchart_path = ?, last_updated_at = ?, status = ?, updated_at = ?,
           metadata_json = ?, last_error = ?, relationship_json = ?
       WHERE id = ?`,
      [
        project.name,
        project.iconColor,
        project.description,
        project.localPath,
        null,
        "main",
        project.threadId,
        LEGACY_FLOWCHART_PATH,
        project.lastUpdatedAt,
        project.status,
        project.updatedAt,
        JSON.stringify(project.runtimeConfig),
        project.lastError,
        JSON.stringify(project.relationship),
        project.id,
      ],
    );

    return project;
  }

  async updateGithubConnection(projectId: string, connection: GithubConnection | null): Promise<Project> {
    this.run(
      "UPDATE projects SET github_connection = ? WHERE id = ?",
      [connection ? JSON.stringify(connection) : null, projectId],
    );
    const project = await this.readProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    this.persist();
    return project;
  }

  async renameProject(projectId: string, name: string): Promise<Project> {
    const current = await this.readProject(projectId);
    if (!current) {
      throw new Error("Project not found.");
    }

    current.name = name;
    current.updatedAt = new Date().toISOString();
    return this.updateProject(current);
  }

  async deleteProject(projectId: string): Promise<void> {
    this.run("DELETE FROM updates WHERE project_id = ?", [projectId]);
    this.run("DELETE FROM pending_planned_updates WHERE project_id = ?", [projectId]);
    this.run("DELETE FROM planning_sessions WHERE project_id = ?", [projectId]);
    this.run("DELETE FROM project_outline_reports WHERE project_id = ?", [projectId]);
    this.run("DELETE FROM agent_sessions WHERE project_id = ?", [projectId]);
    this.run("DELETE FROM projects WHERE id = ?", [projectId]);
  }

  async addUpdateRecord(update: UpdateRecord): Promise<UpdateRecord> {
    this.run(
      `INSERT INTO updates (
        id, project_id, prompt, summary, commit_sha, flowchart, flowchart_graph_json, created_at, kind, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        update.id,
        update.projectId,
        update.prompt,
        update.summary,
        update.commitSha,
        LEGACY_FLOWCHART_TEXT,
        null,
        update.createdAt,
        update.kind,
        update.status,
        update.errorMessage,
      ],
    );

    return update;
  }

  async updateHistoryRecord(update: UpdateRecord): Promise<UpdateRecord> {
    this.run(
      `UPDATE updates
       SET prompt = ?, summary = ?, commit_sha = ?, flowchart = ?, flowchart_graph_json = ?, kind = ?, status = ?, error_message = ?
       WHERE id = ?`,
      [
        update.prompt,
        update.summary,
        update.commitSha,
        LEGACY_FLOWCHART_TEXT,
        null,
        update.kind,
        update.status,
        update.errorMessage,
        update.id,
      ],
    );
    return update;
  }

  async readHistory(projectId: string): Promise<UpdateRecord[]> {
    return this.getRows<UpdateRow>(
      "SELECT * FROM updates WHERE project_id = ? ORDER BY created_at DESC",
      [projectId],
    ).map(mapUpdateRow);
  }

  async readOutlineReport(projectId: string): Promise<ProjectOutlineReport | null> {
    const row = this.getRows<{ report_json: string }>(
      "SELECT report_json FROM project_outline_reports WHERE project_id = ?",
      [projectId],
    )[0];
    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.report_json) as ProjectOutlineReport;
    } catch {
      return null;
    }
  }

  async saveOutlineReport(report: ProjectOutlineReport): Promise<ProjectOutlineReport> {
    this.run(
      `REPLACE INTO project_outline_reports (
         project_id, report_json, updated_at
       ) VALUES (?, ?, ?)`,
      [report.projectId, JSON.stringify(report), report.generatedAt],
    );
    return report;
  }

  // --- Agent Sessions ---

  /**
   * Finalize any assistant messages still marked `working` at session-load
   * time. Because the backend has no in-flight AI requests when a session is
   * loaded from the database, any `working` placeholder must be orphaned —
   * left over from a crashed/killed/aborted run. Mutating them in place here
   * retroactively clears stuck typing-dot bubbles and stops them from ever
   * persisting past an app restart.
   */
  private finalizeOrphanWorkingMessages(messages: Array<{ role?: string; status?: string; content?: string }>): void {
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      if (message.role === "assistant" && message.status === "working") {
        message.status = "complete";
        if (typeof message.content !== "string" || !message.content.trim()) {
          message.content = "(Response interrupted — please try again.)";
        }
      }
    }
  }

  private mapAgentSessionRow(row: {
    id: string;
    project_id: string;
    current_stage: string;
    stages_json: string;
    scratchpad_json: string;
    planned_updates_json: string;
    attached_materials_json?: string;
    core_pillars_json?: string;
    core_details_chat_json?: string;
    provider: string;
    created_at: string;
    updated_at: string;
  }): AgentSession {
    const defaultStageData: AgentStageData = { messages: [], confirmed: null };
    let stages: Record<AgentStage, AgentStageData>;
    try {
      const parsed = JSON.parse(row.stages_json);
      stages = {} as Record<AgentStage, AgentStageData>;
      for (const s of AGENT_STAGES) {
        stages[s] = parsed[s] ?? { ...defaultStageData };
      }
    } catch {
      stages = {} as Record<AgentStage, AgentStageData>;
      for (const s of AGENT_STAGES) {
        stages[s] = { ...defaultStageData };
      }
    }

    // Backward compat: default source on scratchpad items
    const scratchpad: ScratchpadItem[] = (JSON.parse(row.scratchpad_json || "[]") as ScratchpadItem[]).map((item) => ({
      ...item,
      source: item.source ?? "user",
    }));

    // Backward compat: default sourceTodoIds on planned updates
    const plannedUpdates: AgentPlannedUpdate[] = (JSON.parse(row.planned_updates_json || "[]") as AgentPlannedUpdate[]).map((item) => ({
      ...item,
      sourceTodoIds: item.sourceTodoIds ?? [],
    }));

    // Normalize currentStage
    let currentStage = row.current_stage as AgentStage;
    if (!AGENT_STAGES.includes(currentStage)) currentStage = "function";

    // Determine conversation mode: auto-detect "general" for existing sessions
    let conversationMode: "guided" | "general" = ((row as Record<string, unknown>).conversation_mode as string ?? "guided") as "guided" | "general";
    if (conversationMode === "guided") {
      const hasFunction = stages.function?.confirmed != null;
      const hasThesis = stages.thesis?.confirmed != null;
      const hasPillars = stages.core_pillars?.confirmed != null;
      const hasFlow = stages.full_flow?.confirmed != null;
      if (hasFunction && hasThesis && hasPillars && hasFlow) {
        conversationMode = "general";
      }
    }

    const r = row as Record<string, unknown>;

    // Parse legacy agent conversations and migrate to director conversations
    const legacyAgentConvos: Record<string, DirectorConversation> = JSON.parse((r.agent_conversations_json as string) || "{}");
    let directorConvos: Record<string, DirectorConversation>;
    try {
      directorConvos = JSON.parse((r.director_conversations_json as string) || "{}");
    } catch { directorConvos = {}; }

    // If directorConvos is empty but legacy has data, migrate old sub-agent conversations into directors
    if (Object.keys(directorConvos).length === 0 && Object.keys(legacyAgentConvos).length > 0) {
      const SUB_AGENT_TO_DIRECTOR: Record<string, DirectorId> = {
        "core-architect": "creative-director",
        "vibe-artist": "creative-director",
        "version-planner": "rd-director",
        "update-planner": "rd-director",
        "front-end": "programming-director",
        "back-end": "programming-director",
        "visual-validator": "validation-director",
        "functional-validator": "validation-director",
      };
      for (const [key, conv] of Object.entries(legacyAgentConvos)) {
        const targetId = SUB_AGENT_TO_DIRECTOR[key] ?? key;
        if (!directorConvos[targetId]) {
          directorConvos[targetId] = { directorId: targetId as DirectorId, focusMode: null, messages: [], lastActiveAt: null };
        }
        if (conv.messages?.length) {
          directorConvos[targetId].messages.push(...conv.messages);
          if (conv.lastActiveAt && (!directorConvos[targetId].lastActiveAt || conv.lastActiveAt > directorConvos[targetId].lastActiveAt!)) {
            directorConvos[targetId].lastActiveAt = conv.lastActiveAt;
          }
        }
      }
    }

    // Parse director progress with backward-compat derivation
    let directorProgress: ProjectDirectorProgress;
    try {
      const parsed = JSON.parse((r.director_progress_json as string) || "{}");
      if (parsed.creative) {
        directorProgress = parsed;
      } else {
        throw new Error("empty");
      }
    } catch {
      const fc = stages.function?.confirmed != null;
      const tc = stages.thesis?.confirmed != null;
      const cpc = stages.core_pillars?.confirmed != null;
      const ffc = stages.full_flow?.confirmed != null;
      directorProgress = {
        creative: fc && tc && cpc && ffc ? "completed" : fc ? "in-progress" : "not-started",
        rd: "not-started",
        programming: "not-started",
        validation: "not-started",
        currentDirector: null,
      };
    }

    // Backward-compat: add pillarType to pillars that lack it
    const rawPillars: CorePillar[] = JSON.parse(row.core_pillars_json || "[]");
    const { messages: slackMessages } = sanitizeSlackMessages(JSON.parse((r.slack_messages_json as string) || "[]"));
    this.finalizeOrphanWorkingMessages(slackMessages);
    for (const conv of Object.values(directorConvos)) {
      if (conv && Array.isArray(conv.messages)) {
        this.finalizeOrphanWorkingMessages(conv.messages);
      }
    }
    const unifiedMessages = JSON.parse((r.unified_messages_json as string) || "[]") as Array<{ role?: string; status?: string; content?: string }>;
    this.finalizeOrphanWorkingMessages(unifiedMessages);
    const { directorStateMap } = sanitizeDirectorStateMap(JSON.parse((r.director_state_map_json as string) || "{}"));
    const { pendingApprovals } = sanitizePendingApprovals(JSON.parse((r.pending_approvals_json as string) || "[]"));
    const migratePillars = (pillars: CorePillar[]): CorePillar[] =>
      pillars.map((p, idx) => ({
        ...p,
        pillarType: p.pillarType ?? "core",
        description: p.description ?? null,
        connectedPillarIds: p.connectedPillarIds ?? [],
        order: p.order ?? idx,
        corePillars: migratePillars(p.corePillars ?? []),
      }));

    const corePillars = migratePillars(rawPillars);
    const currentCorePillars = migratePillars(JSON.parse((r.current_core_pillars_json as string) || "[]"));
    const versionUpdates = (JSON.parse((r.version_updates_json as string) || "[]") as VersionUpdate[]).map(normalizeVersionUpdate);
    const danDraftCoreDetails = JSON.parse((r.dan_draft_core_details_json as string) || "null") as AgentCoreDetails | null;
    const baseSession = {
      id: row.id,
      projectId: row.project_id,
      currentStage,
      conversationMode,
      stages,
      unifiedMessages,
      scratchpad,
      plannedUpdates,
      corePillars,
      currentCorePillars,
      coreDetailsChatHistory: JSON.parse(row.core_details_chat_json || "[]"),
      attachedMaterials: JSON.parse(row.attached_materials_json || "[]"),
      miscMaterials: JSON.parse((r.misc_materials_json as string) || "[]"),
      cascadePending: JSON.parse((r.cascade_pending_json as string) || "null"),
      provider: row.provider as AiProvider,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Director system fields
      directorConversations: directorConvos,
      versions: JSON.parse((r.versions_json as string) || "[]"),
      versionUpdates,
      feasibilityAssessments: JSON.parse((r.feasibility_json as string) || "[]"),
      validationResults: JSON.parse((r.validation_results_json as string) || "[]"),
      validationFrequency: ((r.validation_frequency as string) || "manual") as AgentSession["validationFrequency"],
      activeDirectorId: ((r.active_director_id as string | null) ?? (r.active_agent_id as string | null) ?? null) as DirectorId | null,
      directorProgress,
      creativeFocusMode: ((r.creative_focus_mode as string) || null) as CreativeFocusMode | null,
      rdFocusMode: ((r.rd_focus_mode as string) || null) as RdFocusMode | null,
      validationFocusMode: ((r.validation_focus_mode as string) || null) as ValidationFocusMode | null,
      danInternalNotes: JSON.parse((r.dan_internal_notes_json as string) || "[]"),
      danSideNotes: JSON.parse((r.dan_side_notes_json as string) || "[]"),
      danDraftCoreDetails,
      danDraftChangeSummary: JSON.parse((r.dan_draft_change_summary_json as string) || "[]"),
      danDraftStatus: ((r.dan_draft_status as string) || null) as DanDraftStatus | null,
      danArchivedNotes: JSON.parse((r.dan_archived_notes_json as string) || "[]"),
      deletedNotes: JSON.parse((r.deleted_notes_json as string) || "[]"),
      pingTaskContext: JSON.parse((r.ping_task_context_json as string) || "null"),
      pongTaskContext: JSON.parse((r.pong_task_context_json as string) || "null"),
      projectCategory: ((r.project_category as string) || "general-project") as ProjectCategory,
      // Legacy storage-backed Slack field names remain until a dedicated migration updates the session schema.
      slackMessages,
      slackActiveDirectorId: ((r.slack_active_director_id as string) || "project-manager") as DirectorId,
      slackPresenceGuestId: ((r.slack_presence_guest_id as string | null) ?? null) as DirectorId | null,
      pendingApprovals,
      directorSettingsOverrides: JSON.parse((r.director_settings_overrides_json as string) || "{}"),
      directorStateMap,
      danMemory: JSON.parse((r.dan_memory_json as string) || "null") as AgentSession["danMemory"] | null,
      toddMemory: JSON.parse((r.todd_memory_json as string) || "null") as ToddMemory | null,
      pingMemory: JSON.parse((r.ping_memory_json as string) || "null") as PingMemory | null,
      jeffMemory: sanitizeJeffMemory(JSON.parse((r.jeff_memory_json as string) || "null")),
      pongMemory: sanitizePongMemory(JSON.parse((r.pong_memory_json as string) || "null")),
      automation: buildAutomationState(JSON.parse((r.automation_json as string) || "null") as AgentSession["automation"] | null),
    } as AgentSession;

    baseSession.danMemory = buildDanMemory(baseSession);
    baseSession.toddMemory = buildToddMemory(baseSession);
    baseSession.pingMemory = buildPingMemory(baseSession);
    baseSession.jeffMemory = buildJeffMemory(baseSession);
    baseSession.pongMemory = buildPongMemory(baseSession);

    return syncLegacyFieldsFromMemory(baseSession);
  }

  async getAgentSession(projectId: string): Promise<AgentSession | null> {
    const row = this.getRows<{
      id: string;
      project_id: string;
      current_stage: string;
      stages_json: string;
      scratchpad_json: string;
      planned_updates_json: string;
      provider: string;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT * FROM agent_sessions WHERE project_id = ?",
      [projectId],
    )[0];

    if (!row) return null;
    return this.mapAgentSessionRow(row);
  }

  async saveAgentSession(session: AgentSession): Promise<void> {
    const prepared = syncLegacyFieldsFromMemory({
      ...session,
      danMemory: buildDanMemory(session),
      toddMemory: buildToddMemory({
        ...session,
        danMemory: buildDanMemory(session),
      }),
      pingMemory: buildPingMemory({
        ...session,
        toddMemory: buildToddMemory({
          ...session,
          danMemory: buildDanMemory(session),
        }),
      }),
      jeffMemory: buildJeffMemory(session),
      pongMemory: buildPongMemory(session),
    } as AgentSession);
    this.run(
      `REPLACE INTO agent_sessions (
         id, project_id, current_stage, stages_json, scratchpad_json,
         planned_updates_json, core_pillars_json, core_details_chat_json,
         attached_materials_json, provider, created_at, updated_at,
         conversation_mode, unified_messages_json, cascade_pending_json, misc_materials_json,
         versions_json, version_updates_json,
         feasibility_json, validation_results_json, validation_frequency,
         director_conversations_json, director_progress_json,
         creative_focus_mode, rd_focus_mode, validation_focus_mode,
         dan_internal_notes_json, dan_side_notes_json, dan_draft_core_details_json,
         dan_draft_change_summary_json, dan_draft_status,
         project_category, active_director_id,
         slack_messages_json, slack_active_director_id, pending_approvals_json,
         director_settings_overrides_json, current_core_pillars_json,
         director_state_map_json, deleted_notes_json, dan_archived_notes_json,
         ping_task_context_json, pong_task_context_json, slack_presence_guest_id,
         dan_memory_json, todd_memory_json, ping_memory_json, jeff_memory_json, pong_memory_json, automation_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prepared.id,
        prepared.projectId,
        prepared.currentStage,
        JSON.stringify(prepared.stages),
        JSON.stringify(prepared.scratchpad),
        JSON.stringify(prepared.plannedUpdates),
        JSON.stringify(prepared.corePillars),
        JSON.stringify(prepared.coreDetailsChatHistory),
        JSON.stringify(prepared.attachedMaterials),
        prepared.provider,
        prepared.createdAt,
        prepared.updatedAt,
        prepared.conversationMode,
        JSON.stringify(prepared.unifiedMessages),
        JSON.stringify(prepared.cascadePending),
        JSON.stringify(prepared.miscMaterials),
        JSON.stringify(prepared.versions),
        JSON.stringify(prepared.versionUpdates),
        JSON.stringify(prepared.feasibilityAssessments),
        JSON.stringify(prepared.validationResults),
        prepared.validationFrequency,
        JSON.stringify(prepared.directorConversations),
        JSON.stringify(prepared.directorProgress),
        prepared.creativeFocusMode,
        prepared.rdFocusMode,
        prepared.validationFocusMode,
        JSON.stringify(prepared.danInternalNotes),
        JSON.stringify(prepared.danSideNotes ?? []),
        JSON.stringify(prepared.danDraftCoreDetails),
        JSON.stringify(prepared.danDraftChangeSummary ?? []),
        prepared.danDraftStatus,
        prepared.projectCategory,
        prepared.activeDirectorId,
        // Legacy storage-backed Slack column names remain until a dedicated migration updates persisted sessions.
        JSON.stringify(prepared.slackMessages ?? []),
        prepared.slackActiveDirectorId ?? "project-manager",
        JSON.stringify(prepared.pendingApprovals ?? []),
        JSON.stringify(prepared.directorSettingsOverrides ?? {}),
        JSON.stringify(prepared.currentCorePillars ?? []),
        JSON.stringify(prepared.directorStateMap ?? {}),
        JSON.stringify(prepared.deletedNotes ?? []),
        JSON.stringify(prepared.danArchivedNotes ?? []),
        JSON.stringify(prepared.pingTaskContext),
        JSON.stringify(prepared.pongTaskContext),
        prepared.slackPresenceGuestId,
        JSON.stringify(prepared.danMemory),
        JSON.stringify(prepared.toddMemory),
        JSON.stringify(prepared.pingMemory),
        JSON.stringify(prepared.jeffMemory),
        JSON.stringify(prepared.pongMemory),
        JSON.stringify(prepared.automation),
      ],
    );
  }

  async deleteAgentSession(projectId: string): Promise<void> {
    this.run("DELETE FROM agent_sessions WHERE project_id = ?", [projectId]);
  }

}
