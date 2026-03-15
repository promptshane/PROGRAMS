import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { CLAUDE_MODEL_OPTIONS, CODEX_MODEL_OPTIONS, AGENT_STAGES } from "@shared/types";
import type {
  AgentPlannedUpdate,
  AgentSession,
  AgentStage,
  AgentStageData,
  AiProvider,
  FlowchartGraph,
  HomeScratchpadItem,
  PendingPlannedUpdate,
  PlanningSession,
  ProjectOutlineReport,
  Project,
  ScratchpadItem,
  Settings,
  SettingsUpdateInput,
  SetupState,
  UpdateRecord,
} from "@shared/types";
import { DEFAULT_SETTINGS, DEFAULT_SETUP_STATE } from "@main/defaults";
import { ensureDirectory, pathExists } from "@main/utils/fs";

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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS home_scratchpad (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        items_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);

    this.persist();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.getRows<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((item) => item.name === column)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

    return {
      id: row.id,
      projectId: row.project_id,
      currentStage,
      conversationMode,
      stages,
      unifiedMessages: JSON.parse(((row as Record<string, unknown>).unified_messages_json as string) || "[]"),
      scratchpad,
      plannedUpdates,
      corePillars: JSON.parse(row.core_pillars_json || "[]"),
      coreDetailsChatHistory: JSON.parse(row.core_details_chat_json || "[]"),
      attachedMaterials: JSON.parse(row.attached_materials_json || "[]"),
      miscMaterials: JSON.parse(((row as Record<string, unknown>).misc_materials_json as string) || "[]"),
      cascadePending: JSON.parse(((row as Record<string, unknown>).cascade_pending_json as string) || "null"),
      provider: row.provider as AiProvider,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
    this.run(
      `REPLACE INTO agent_sessions (
         id, project_id, current_stage, stages_json, scratchpad_json,
         planned_updates_json, core_pillars_json, core_details_chat_json,
         attached_materials_json, provider, created_at, updated_at,
         conversation_mode, unified_messages_json, cascade_pending_json, misc_materials_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.projectId,
        session.currentStage,
        JSON.stringify(session.stages),
        JSON.stringify(session.scratchpad),
        JSON.stringify(session.plannedUpdates),
        JSON.stringify(session.corePillars),
        JSON.stringify(session.coreDetailsChatHistory),
        JSON.stringify(session.attachedMaterials),
        session.provider,
        session.createdAt,
        session.updatedAt,
        session.conversationMode,
        JSON.stringify(session.unifiedMessages),
        JSON.stringify(session.cascadePending),
        JSON.stringify(session.miscMaterials),
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
}
