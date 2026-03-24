import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { CLAUDE_MODEL_OPTIONS, CODEX_MODEL_OPTIONS, AGENT_STAGES } from "../../shared/types.ts";
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
  DynamicSubAgent,
  FlowchartGraph,
  HomeScratchpadItem,
  JeffExecutionReport,
  PendingPlannedUpdate,
  PendingApproval,
  PingMemory,
  PingRawReport,
  PlanningSession,
  ProjectCategory,
  ProjectDirectorProgress,
  ProjectOutlineReport,
  Project,
  RdFocusMode,
  ScratchpadItem,
  Skill,
  Settings,
  SettingsUpdateInput,
  SetupState,
  ToddCodebaseIndexedMap,
  ToddMemory,
  UnifiedTodoItem,
  UpdateRecord,
  ValidationFocusMode,
  VersionPlan,
  VersionUpdate,
} from "../../shared/types.ts";
import {
  sanitizeDirectorStateMap,
  sanitizePendingApprovals,
  sanitizeSlackMessages,
} from "../../shared/agent-session.ts";
import { DEFAULT_SETTINGS, DEFAULT_SETUP_STATE } from "../defaults.ts";
import { ensureDirectory, pathExists } from "../utils/fs.ts";

interface LegacySettingsShape extends Partial<Settings> {
  githubClientId?: string | null;
}

const normalizeModel = (value: string | undefined): Settings["advancedDefaults"]["model"] => {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_SETTINGS.advancedDefaults.model;
  }

  if (
    normalized === "gpt-5-codex" ||
    normalized === "gpt-5.4-codex" ||
    normalized === "gpt-5.2-codex" ||
    normalized === "gpt-5.1-codex-max" ||
    normalized === "gpt-5.1-codex" ||
    normalized === "gpt-5.1-codex-mini"
  ) {
    return "gpt-5.4";
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

const buildConfirmedConceptFromLegacy = (session: {
  stages: AgentSession["stages"];
  corePillars: CorePillar[];
}): AgentCoreDetails | null => {
  const confirmedConcept: AgentCoreDetails = {
    function: session.stages.function.confirmed ?? null,
    thesis: session.stages.thesis.confirmed ?? null,
    corePillars: session.corePillars,
    fullFlow: session.stages.full_flow.confirmed ?? null,
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
  const confirmedConcept = session.danMemory?.confirmedConcept ?? buildConfirmedConceptFromLegacy(session);
  return {
    confirmedConcept,
    draftConcept: session.danMemory?.draftConcept ?? session.danDraftCoreDetails ?? null,
    notes: session.danMemory?.notes ?? session.danInternalNotes ?? [],
    sideNotes: session.danMemory?.sideNotes ?? session.danSideNotes ?? [],
    draftChangeSummary: session.danMemory?.draftChangeSummary ?? session.danDraftChangeSummary ?? [],
    draftStatus: session.danMemory?.draftStatus ?? session.danDraftStatus ?? null,
    fullExperienceDescription: session.danMemory?.fullExperienceDescription
      ?? confirmedConcept?.fullFlow?.summary
      ?? null,
    archivedNotes: session.danMemory?.archivedNotes ?? session.danArchivedNotes ?? [],
    deletedNotes: session.danMemory?.deletedNotes ?? session.deletedNotes ?? [],
    rawMemories: session.danMemory?.rawMemories ?? [],
    forgottenMemories: session.danMemory?.forgottenMemories ?? [],
    creativeHistory: session.danMemory?.creativeHistory ?? [],
    toddHandoffNotes: session.danMemory?.toddHandoffNotes ?? [],
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

  return {
    confirmedConcept: session.toddMemory?.confirmedConcept ?? session.danMemory.confirmedConcept,
    versionPlan: {
      v1: session.toddMemory?.versionPlan.v1 ?? findRoadmapVersion(session.versions, "v1"),
      v2: session.toddMemory?.versionPlan.v2 ?? findRoadmapVersion(session.versions, "v2"),
      v3: session.toddMemory?.versionPlan.v3 ?? findRoadmapVersion(session.versions, "v3"),
    },
    futureUpdatePlan,
    previousUpdateLog: session.toddMemory?.previousUpdateLog ?? [],
    troubleLog,
    codebaseIndexedMap: buildToddCodebaseIndexedMap(session, session.toddMemory?.codebaseIndexedMap ?? null),
    notes: session.toddMemory?.notes ?? [],
    pendingHandoff: session.toddMemory?.pendingHandoff ?? null,
    backupNotes: session.toddMemory?.backupNotes ?? [],
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
  latestRawReport: session.pingMemory?.latestRawReport ?? null,
  latestJeffReport: session.pingMemory?.latestJeffReport ?? null,
});

const syncLegacyFieldsFromMemory = (session: AgentSession): AgentSession => {
  session.danInternalNotes = [...session.danMemory.notes];
  session.danSideNotes = [...session.danMemory.sideNotes];
  session.danDraftCoreDetails = session.danMemory.draftConcept;
  session.danDraftChangeSummary = [...session.danMemory.draftChangeSummary];
  session.danDraftStatus = session.danMemory.draftStatus;
  session.danArchivedNotes = [...session.danMemory.archivedNotes];
  session.deletedNotes = [...session.danMemory.deletedNotes];
  session.versions = [session.toddMemory.versionPlan.v1, session.toddMemory.versionPlan.v2, session.toddMemory.versionPlan.v3]
    .filter((version): version is VersionPlan => Boolean(version));
  session.versionUpdates = session.toddMemory.futureUpdatePlan.map(normalizeVersionUpdate);
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
  status: Project["status"];
  created_at: string;
  updated_at: string;
  metadata_json: string;
  last_error: string | null;
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
  status: UpdateRecord["status"];
  error_message: string | null;
}

const parseFlowchartGraphJson = (value: string | null | undefined): FlowchartGraph | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as FlowchartGraph;
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
  remoteUrl: row.remote_url,
  defaultBranch: row.default_branch,
  threadId: row.thread_id,
  flowchartPath: row.flowchart_path,
  lastUpdatedAt: row.last_updated_at,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  runtimeConfig: JSON.parse(row.metadata_json),
  lastError: row.last_error,
});

const mapUpdateRow = (row: UpdateRow): UpdateRecord => ({
  id: row.id,
  projectId: row.project_id,
  prompt: row.prompt,
  summary: row.summary,
  commitSha: row.commit_sha,
  flowchart: row.flowchart,
  flowchartGraph: parseFlowchartGraphJson(row.flowchart_graph_json),
  createdAt: row.created_at,
  kind: row.kind,
  status: row.status,
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
        last_error TEXT
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
    // Multi-agent system columns (legacy)
    this.ensureColumn("agent_sessions", "agent_conversations_json", "TEXT DEFAULT '{}'");
    this.ensureColumn("agent_sessions", "versions_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "version_updates_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "feasibility_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "validation_results_json", "TEXT DEFAULT '[]'");
    this.ensureColumn("agent_sessions", "validation_frequency", "TEXT DEFAULT 'manual'");
    this.ensureColumn("agent_sessions", "active_agent_id", "TEXT");
    // Director system columns
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
    this.ensureColumn("agent_sessions", "dynamic_sub_agents_json", "TEXT DEFAULT '[]'");
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

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source_provider TEXT NOT NULL DEFAULT 'claude',
        source_type TEXT NOT NULL DEFAULT 'skill',
        instructions TEXT NOT NULL,
        original_file_path TEXT,
        is_universal INTEGER NOT NULL DEFAULT 0,
        install_status TEXT NOT NULL DEFAULT 'ready',
        install_slug TEXT,
        install_path TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("skills", "source_type", "TEXT NOT NULL DEFAULT 'skill'");
    this.ensureColumn("skills", "install_status", "TEXT NOT NULL DEFAULT 'ready'");
    this.ensureColumn("skills", "install_slug", "TEXT");
    this.ensureColumn("skills", "install_path", "TEXT");
    this.ensureColumn("skills", "last_error", "TEXT");

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
        const items = JSON.parse(scratchpadRows[0].items_json) as HomeScratchpadItem[];
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

  private mergeSettings(settings: LegacySettingsShape): Settings {
    const githubClientIdOverride =
      settings.githubClientIdOverride !== undefined
        ? settings.githubClientIdOverride
        : settings.githubClientId ?? DEFAULT_SETTINGS.githubClientIdOverride;
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
      appSourcePath,
      githubClientIdOverride,
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
         metadata_json, last_error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project.id,
        project.name,
        project.iconColor,
        project.description,
        project.localPath,
        project.remoteUrl,
        project.defaultBranch,
        project.threadId,
        project.flowchartPath,
        project.lastUpdatedAt,
        project.status,
        project.createdAt,
        project.updatedAt,
        JSON.stringify(project.runtimeConfig),
        project.lastError,
      ],
    );

    return project;
  }

  async updateProject(project: Project): Promise<Project> {
    this.run(
      `UPDATE projects
       SET name = ?, icon_color = ?, description = ?, local_path = ?, remote_url = ?, default_branch = ?,
           thread_id = ?, flowchart_path = ?, last_updated_at = ?, status = ?, updated_at = ?,
           metadata_json = ?, last_error = ?
       WHERE id = ?`,
      [
        project.name,
        project.iconColor,
        project.description,
        project.localPath,
        project.remoteUrl,
        project.defaultBranch,
        project.threadId,
        project.flowchartPath,
        project.lastUpdatedAt,
        project.status,
        project.updatedAt,
        JSON.stringify(project.runtimeConfig),
        project.lastError,
        project.id,
      ],
    );

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
        update.flowchart,
        update.flowchartGraph ? JSON.stringify(update.flowchartGraph) : null,
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
        update.flowchart,
        update.flowchartGraph ? JSON.stringify(update.flowchartGraph) : null,
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

  async readLatestPendingSync(projectId: string): Promise<UpdateRecord | null> {
    const row = this.getRows<UpdateRow>(
      `SELECT * FROM updates
       WHERE project_id = ? AND status = 'pendingSync'
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId],
    )[0];

    return row ? mapUpdateRow(row) : null;
  }

  async savePendingUpdate(update: PendingPlannedUpdate): Promise<PendingPlannedUpdate> {
    this.run(
      `REPLACE INTO pending_planned_updates (
         id, project_id, flowchart, flowchart_graph_json, previous_flowchart, previous_flowchart_graph_json, description, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        update.id,
        update.projectId,
        update.flowchart,
        update.flowchartGraph ? JSON.stringify(update.flowchartGraph) : null,
        update.previousFlowchart,
        update.previousFlowchartGraph ? JSON.stringify(update.previousFlowchartGraph) : null,
        update.description,
        update.createdAt,
      ],
    );
    return update;
  }

  async getPendingUpdate(projectId: string): Promise<PendingPlannedUpdate | null> {
    const row = this.getRows<{
      id: string;
      project_id: string;
      flowchart: string;
      flowchart_graph_json: string | null;
      previous_flowchart: string;
      previous_flowchart_graph_json: string | null;
      description: string;
      created_at: string;
    }>(
      "SELECT * FROM pending_planned_updates WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
      [projectId],
    )[0];

    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      flowchart: row.flowchart,
      flowchartGraph: parseFlowchartGraphJson(row.flowchart_graph_json),
      previousFlowchart: row.previous_flowchart,
      previousFlowchartGraph: parseFlowchartGraphJson(row.previous_flowchart_graph_json),
      description: row.description,
      createdAt: row.created_at,
    };
  }

  async deletePendingUpdate(projectId: string): Promise<void> {
    this.run("DELETE FROM pending_planned_updates WHERE project_id = ?", [projectId]);
  }

  async savePlanningSession(session: PlanningSession): Promise<PlanningSession> {
    this.run(
      `REPLACE INTO planning_sessions (
         id, project_id, provider, messages_json, current_flowchart, current_flowchart_graph_json,
         previous_flowchart, previous_flowchart_graph_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.projectId,
        session.provider,
        JSON.stringify(session.messages),
        session.currentFlowchart,
        session.currentFlowchartGraph ? JSON.stringify(session.currentFlowchartGraph) : null,
        session.previousFlowchart,
        session.previousFlowchartGraph ? JSON.stringify(session.previousFlowchartGraph) : null,
        session.createdAt,
        session.updatedAt,
      ],
    );
    return session;
  }

  async getPlanningSession(sessionId: string): Promise<PlanningSession | null> {
    const row = this.getRows<{
      id: string;
      project_id: string;
      provider: string;
      messages_json: string;
      current_flowchart: string;
      current_flowchart_graph_json: string | null;
      previous_flowchart: string;
      previous_flowchart_graph_json: string | null;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT * FROM planning_sessions WHERE id = ?",
      [sessionId],
    )[0];

    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      provider: row.provider as PlanningSession["provider"],
      messages: JSON.parse(row.messages_json),
      currentFlowchart: row.current_flowchart,
      currentFlowchartGraph: parseFlowchartGraphJson(row.current_flowchart_graph_json),
      previousFlowchart: row.previous_flowchart,
      previousFlowchartGraph: parseFlowchartGraphJson(row.previous_flowchart_graph_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deletePlanningSession(sessionId: string): Promise<void> {
    this.run("DELETE FROM planning_sessions WHERE id = ?", [sessionId]);
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
      unifiedMessages: JSON.parse((r.unified_messages_json as string) || "[]"),
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
      dynamicSubAgents: JSON.parse((r.dynamic_sub_agents_json as string) || "[]") as DynamicSubAgent[],
      slackMessages,
      slackActiveDirectorId: ((r.slack_active_director_id as string) || "project-manager") as DirectorId,
      slackPresenceGuestId: ((r.slack_presence_guest_id as string | null) ?? null) as DirectorId | null,
      pendingApprovals,
      directorSettingsOverrides: JSON.parse((r.director_settings_overrides_json as string) || "{}"),
      directorStateMap,
      danMemory: JSON.parse((r.dan_memory_json as string) || "null") as AgentSession["danMemory"] | null,
      toddMemory: JSON.parse((r.todd_memory_json as string) || "null") as ToddMemory | null,
      pingMemory: JSON.parse((r.ping_memory_json as string) || "null") as PingMemory | null,
      // Deprecated aliases (kept for backward compat)
      agentConversations: directorConvos,
      activeAgentId: ((r.active_director_id as string | null) ?? (r.active_agent_id as string | null) ?? null) as DirectorId | null,
    } as AgentSession;

    baseSession.danMemory = buildDanMemory(baseSession);
    baseSession.toddMemory = buildToddMemory(baseSession);
    baseSession.pingMemory = buildPingMemory(baseSession);

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
    } as AgentSession);
    this.run(
      `REPLACE INTO agent_sessions (
         id, project_id, current_stage, stages_json, scratchpad_json,
         planned_updates_json, core_pillars_json, core_details_chat_json,
         attached_materials_json, provider, created_at, updated_at,
         conversation_mode, unified_messages_json, cascade_pending_json, misc_materials_json,
         agent_conversations_json, versions_json, version_updates_json,
         feasibility_json, validation_results_json, validation_frequency, active_agent_id,
         director_conversations_json, director_progress_json,
         creative_focus_mode, rd_focus_mode, validation_focus_mode,
         dan_internal_notes_json, dan_side_notes_json, dan_draft_core_details_json,
         dan_draft_change_summary_json, dan_draft_status,
         project_category, dynamic_sub_agents_json, active_director_id,
         slack_messages_json, slack_active_director_id, pending_approvals_json,
         director_settings_overrides_json, current_core_pillars_json,
         director_state_map_json, deleted_notes_json, dan_archived_notes_json,
         ping_task_context_json, pong_task_context_json, slack_presence_guest_id,
         dan_memory_json, todd_memory_json, ping_memory_json
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
        JSON.stringify(prepared.directorConversations),
        JSON.stringify(prepared.versions),
        JSON.stringify(prepared.versionUpdates),
        JSON.stringify(prepared.feasibilityAssessments),
        JSON.stringify(prepared.validationResults),
        prepared.validationFrequency,
        prepared.activeDirectorId,
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
        JSON.stringify(prepared.dynamicSubAgents),
        prepared.activeDirectorId,
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
      ],
    );
  }

  async deleteAgentSession(projectId: string): Promise<void> {
    this.run("DELETE FROM agent_sessions WHERE project_id = ?", [projectId]);
  }

  // --- Home Scratchpad ---

  async getHomeScratchpad(): Promise<HomeScratchpadItem[]> {
    const rows = this.getRows<{ items_json: string }>(
      "SELECT items_json FROM home_scratchpad WHERE id = 'singleton'",
    );
    if (rows.length === 0) return [];
    return JSON.parse(rows[0].items_json);
  }

  async saveHomeScratchpad(items: HomeScratchpadItem[]): Promise<void> {
    this.run(
      `INSERT OR REPLACE INTO home_scratchpad (id, items_json, updated_at) VALUES ('singleton', ?, ?)`,
      [JSON.stringify(items), new Date().toISOString()],
    );
  }

  // --- Unified To-dos ---

  listTodos(projectId?: string | null, includeProcessed = false): UnifiedTodoItem[] {
    let sql = "SELECT * FROM unified_todos";
    const params: (string | null)[] = [];
    const clauses: string[] = [];

    if (projectId !== undefined && projectId !== null) {
      clauses.push("project_id = ?");
      params.push(projectId);
    }
    if (!includeProcessed) {
      clauses.push("processed_into_pillar = 0");
    }
    if (clauses.length) {
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }
    sql += " ORDER BY created_at ASC";

    const rows = this.getRows<{
      id: string;
      text: string;
      project_id: string | null;
      completed: number;
      processed_into_pillar: number;
      source: string;
      created_at: string;
    }>(sql, params);

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      projectId: row.project_id,
      completed: row.completed === 1,
      processedIntoPillar: row.processed_into_pillar === 1,
      source: (row.source as "user" | "agent") || "user",
      createdAt: row.created_at,
    }));
  }

  addTodo(item: UnifiedTodoItem): void {
    this.run(
      "INSERT OR REPLACE INTO unified_todos (id, text, project_id, completed, processed_into_pillar, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [item.id, item.text, item.projectId, String(item.completed ? 1 : 0), String(item.processedIntoPillar ? 1 : 0), item.source, item.createdAt],
    );
  }

  removeTodo(id: string): void {
    this.run("DELETE FROM unified_todos WHERE id = ?", [id]);
  }

  markTodoProcessed(id: string): void {
    this.run("UPDATE unified_todos SET processed_into_pillar = 1 WHERE id = ?", [id]);
  }

  saveTodos(items: UnifiedTodoItem[]): void {
    this.db.exec("DELETE FROM unified_todos");
    for (const item of items) {
      this.addTodo(item);
    }
  }

  // --- Skills ---

  listSkills(): Skill[] {
    const rows = this.getRows<{
      id: string;
      name: string;
      description: string;
      source_provider: string;
      source_type: string;
      instructions: string;
      original_file_path: string | null;
      is_universal: number;
      install_status: string;
      install_slug: string | null;
      install_path: string | null;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM skills ORDER BY created_at DESC");

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      sourceProvider: row.source_provider as Skill["sourceProvider"],
      sourceType: row.source_type as Skill["sourceType"],
      instructions: row.instructions,
      originalFilePath: row.original_file_path,
      isUniversal: row.is_universal === 1,
      installStatus: row.install_status as Skill["installStatus"],
      installSlug: row.install_slug,
      installPath: row.install_path,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  readSkill(id: string): Skill | null {
    const rows = this.getRows<{
      id: string;
      name: string;
      description: string;
      source_provider: string;
      source_type: string;
      instructions: string;
      original_file_path: string | null;
      is_universal: number;
      install_status: string;
      install_slug: string | null;
      install_path: string | null;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM skills WHERE id = ?", [id]);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceProvider: row.source_provider as Skill["sourceProvider"],
      sourceType: row.source_type as Skill["sourceType"],
      instructions: row.instructions,
      originalFilePath: row.original_file_path,
      isUniversal: row.is_universal === 1,
      installStatus: row.install_status as Skill["installStatus"],
      installSlug: row.install_slug,
      installPath: row.install_path,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  saveSkill(skill: Skill): void {
    this.run(
      `INSERT OR REPLACE INTO skills (
         id, name, description, source_provider, source_type, instructions, original_file_path,
         is_universal, install_status, install_slug, install_path, last_error, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        skill.id,
        skill.name,
        skill.description,
        skill.sourceProvider,
        skill.sourceType,
        skill.instructions,
        skill.originalFilePath,
        String(skill.isUniversal ? 1 : 0),
        skill.installStatus,
        skill.installSlug,
        skill.installPath,
        skill.lastError,
        skill.createdAt,
        skill.updatedAt,
      ],
    );
  }

  deleteSkill(id: string): void {
    this.run("DELETE FROM skills WHERE id = ?", [id]);
  }
}
