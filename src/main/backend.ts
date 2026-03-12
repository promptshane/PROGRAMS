import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app, shell } from "electron";
import {
  CLAUDE_DOWNLOAD_URL,
  CODEX_DOWNLOAD_URL,
  GIT_DOWNLOAD_URL,
  EMPTY_RUNTIME,
  createStarterFlowchart,
} from "@main/defaults";
import { ClaudeService } from "@main/services/claude-service";
import { CodexService } from "@main/services/codex-service";
import { GitHubService } from "@main/services/github-service";
import { GitService } from "@main/services/git-service";
import { ProjectStore } from "@main/services/project-store";
import { RunnerService } from "@main/services/runner-service";
import {
  FLOWCHART_OUTPUT_CONTRACT,
  FLOWCHART_PROMPT_RULES,
  type FlowchartRepoHints,
  collectFlowchartRepoHints,
  flowchartGraphJsonSchema,
  formatFlowchartRepoHints,
  materializeFlowchartSnapshot,
  nullableFlowchartGraphJsonSchema,
  readFlowchartSnapshot,
  writeFlowchartSnapshot,
} from "@main/utils/flowchart";
import { parseEnvEntries, parseProjectOutlineReportResponse, serializeEnvEntries } from "@main/utils/project-outline";
import { detectRuntimeConfig, deriveAttachedProjectName, deriveProjectDescription, slugifyRepositoryName } from "@main/utils/project";
import { ensureDirectory, pathExists, readTextFile, writeTextFile } from "@main/utils/fs";
import { execCommand } from "@main/utils/process";
import { DEFAULT_MODEL_CATALOG } from "@shared/types";
import type {
  AppUpdateStatus,
  AppEvent,
  ApprovePlanInput,
  AttachPathInspection,
  BootstrapPayload,
  ClaudeAuthStatus,
  CodexAuthStatus,
  EnvFileSnapshot,
  GenerateFlowchartResult,
  GenerateProjectOutlineReportInput,
  GitHubAuthStatus,
  ModelCatalog,
  PlanDraft,
  Project,
  ProjectAttachInput,
  ProjectCreateInput,
  ProjectDetail,
  ProjectEnableSyncInput,
  ProjectOutlineReport,
  RenameProjectInput,
  RetrySyncInput,
  Settings,
  SettingsUpdateInput,
  SetupCheck,
  SetupSnapshot,
  StartPlanInput,
  UpdateProjectInput,
  UpdateRecord,
  RuntimeState,
  UsageSnapshot,
  GenerateFlowchartInput,
  PlanningChatInput,
  PlanningChatResponse,
  PlanningChatMessage,
  PlanningSession,
  SavePlannedUpdateInput,
  PendingPlannedUpdate,
  WriteProjectEnvFileInput,
} from "@shared/types";

type Emit = (event: AppEvent) => void;

const APP_UPDATE_FRESHNESS_WINDOW_MS = 1000;
const APP_UPDATE_SOURCE_ROOTS = ["src", "scripts"] as const;
const APP_UPDATE_SOURCE_FILES = [
  "build/icon.icns",
  "build/icon.png",
  "build/icon.svg",
  "package.json",
  "package-lock.json",
  "electron-builder.yml",
  "electron.vite.config.ts",
  "tsconfig.json",
] as const;

interface AppUpdateWorkspaceInfo {
  workspacePath: string | null;
  workspaceExists: boolean;
  workspaceValid: boolean;
  workspaceError: string | null;
  sourceUpdatedAt: string | null;
  candidateAppPath: string | null;
  candidateUpdatedAt: string | null;
}

interface AppUpdateEvaluation {
  status: AppUpdateStatus;
  shouldPackage: boolean;
  packageKey: string | null;
  statusKey: string | null;
  workspacePath: string | null;
}

const flowchartGenerationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["flowchartGraph"],
  properties: {
    flowchartGraph: flowchartGraphJsonSchema,
  },
} as const;

const planningChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "flowchartGraph"],
  properties: {
    response: { type: "string" },
    flowchartGraph: nullableFlowchartGraphJsonSchema,
  },
} as const;

const buildProjectOutlinePrompt = ({
  project,
  repoHints,
  currentFlowchart,
}: {
  project: Project;
  repoHints: FlowchartRepoHints;
  currentFlowchart: string;
}): string => `
You are analyzing a software project for a non-technical dashboard view.

Project: "${project.name}"
Current description: ${project.description}
Current runtime command: ${project.runtimeConfig.runCommand ?? "Unknown"}
Current open URL: ${project.runtimeConfig.openUrl ?? "Unknown"}

Current system flowchart:
${currentFlowchart}

${formatFlowchartRepoHints(repoHints)}

Instructions:
- Explore the codebase in read-only mode.
- Do not change any files.
- Focus on plain-English explanations for a non-coder.
- For storedData, describe user-facing or app-managed data stores such as databases, JSON files, browser storage, uploaded assets, caches, and app-generated content.
- For connections, list external APIs, SDKs, hosted services, payment tools, auth providers, databases, and developer services that the code connects to.
- For costs, provide rough placeholder cost notes when the project appears to use a paid service. If exact pricing is unknown, say so clearly.
- For referencedEnvKeys, include any environment variables you see referenced in code or config.
- Return strict JSON only with this shape:
  {
    "storedData": [{ "label": string, "description": string, "children": [...] }],
    "connections": [{ "name": string, "kind": string, "description": string, "envKeys": string[] }],
    "costs": [{ "label": string, "amount": string | null, "description": string }],
    "referencedEnvKeys": string[]
  }
- Use empty arrays when nothing is detected.
`.trim();

export class ProgramsBackend {
  private readonly launchedAppPath = this.currentAppBundlePath();
  private readonly launchedAppUpdatedAtPromise = this.launchedAppPath
    ? this.readModifiedAt(this.launchedAppPath)
    : Promise.resolve(null);
  private appUpdatePackagingJob: Promise<void> | null = null;
  private appUpdatePackagingKey: string | null = null;
  private appUpdateFailedKey: string | null = null;
  private appUpdateBuildError: string | null = null;
  private appUpdateInstalling = false;
  private lastAppUpdateStatusJson: string | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly store: ProjectStore,
    private readonly git: GitService,
    private readonly github: GitHubService,
    private readonly runner: RunnerService,
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly emit: Emit,
  ) {}

  async bootstrap(): Promise<BootstrapPayload> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const projects = await this.syncSelfRuntime(
      settings,
      await this.refreshProjectsRuntimeConfig(await this.store.listProjects()),
    );
    const runtimes = this.runner.getRuntimeMap(projects.map((project) => project.id));
    const modelCatalog = await this.readModelCatalog(settings);
    const auth = {
      codex: await this.codex.getAuthStatus(settings),
      claude: await this.claude.getAuthStatus(settings),
      github: await this.github.getStatus(this.resolveGitHubClientId(settings)),
    };
    const setup = await this.buildSetupSnapshot(settings, auth.codex, auth.claude, auth.github);
    const appUpdate = await this.readAppUpdateStatus();

    return {
      settings,
      projects,
      runtimes,
      auth,
      setup,
      appUpdate,
      modelCatalog,
    };
  }

  async readAppUpdateStatus(): Promise<AppUpdateStatus> {
    const settings = await this.store.readSettings();
    const status = await this.refreshAppUpdateStatus(settings, true);
    this.emitAppUpdateStatus(status);
    return status;
  }

  async installAppUpdate(): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    let evaluation = await this.evaluateAppUpdate(settings);
    let status = evaluation.status;
    if (!status.supported) {
      throw new Error(status.reason || "This build cannot install app updates.");
    }
    if (status.buildState === "packaging") {
      throw new Error("PROGRAMS is still preparing the latest app build.");
    }
    if (status.action === "none" || !status.currentAppPath) {
      throw new Error(status.reason || "No newer packaged app build is available.");
    }

    this.appUpdateInstalling = true;
    this.appUpdateBuildError = null;
    status = await this.refreshAppUpdateStatus(settings, false);
    this.emitAppUpdateStatus(status);
    const currentAppPath = status.currentAppPath;
    if (!currentAppPath) {
      this.appUpdateInstalling = false;
      throw new Error("PROGRAMS could not determine which app bundle is running.");
    }

    try {
      if (status.action === "restart") {
        await this.startAppRelaunch(currentAppPath);
      } else {
        if (!status.candidateAppPath) {
          throw new Error("PROGRAMS could not find the packaged app bundle to install.");
        }

        const requiresAdminPrompt =
          status.requiresAdminPrompt || !(await this.canReplaceInstalledApp(currentAppPath));

        if (requiresAdminPrompt) {
          await this.startPrivilegedAppSwap(currentAppPath, status.candidateAppPath);
        } else {
          await this.startWritableAppSwap(currentAppPath, status.candidateAppPath);
        }
      }
    } catch (error) {
      this.appUpdateInstalling = false;
      this.appUpdateFailedKey = evaluation.statusKey;
      this.appUpdateBuildError = this.formatAppUpdateInstallError(
        error,
        status.candidateAppPath,
      );
      const failedStatus = await this.refreshAppUpdateStatus(settings, false);
      this.emitAppUpdateStatus(failedStatus);
      throw new Error(this.appUpdateBuildError);
    }

    app.quit();
    return { started: true };
  }

  async readSettings(): Promise<Settings> {
    return this.store.readSettings();
  }

  async updateSettings(input: SettingsUpdateInput): Promise<Settings> {
    await this.ensureInitialized();
    const settings = await this.store.updateSettings(input);
    if (input.appSourcePath !== undefined) {
      this.appUpdateFailedKey = null;
      this.appUpdateBuildError = null;
    }
    await this.syncSelfRuntime(settings, await this.store.listProjects(), true);
    await this.emitSetupUpdated(settings);
    const appUpdateStatus = await this.refreshAppUpdateStatus(settings, true);
    this.emitAppUpdateStatus(appUpdateStatus);
    await this.emitModelCatalogUpdated(settings);
    return settings;
  }

  async listProjects(): Promise<Project[]> {
    await this.ensureInitialized();
    return this.syncSelfRuntime(
      undefined,
      await this.refreshProjectsRuntimeConfig(await this.store.listProjects()),
    );
  }

  async readProject(projectId: string): Promise<ProjectDetail> {
    await this.ensureInitialized();
    const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const { project, runtime } = await this.syncProjectRuntimeState(refreshedProject);
    const updates = await this.store.readHistory(projectId);
    const flowchartSnapshot = await this.readFlowchart(project);
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);

    return {
      project,
      updates,
      flowchart: flowchartSnapshot.flowchart,
      flowchartGraph: flowchartSnapshot.flowchartGraph,
      runtime,
      activePlan,
    };
  }

  async readHistory(projectId: string): Promise<UpdateRecord[]> {
    await this.ensureInitialized();
    return this.store.readHistory(projectId);
  }

  async readPlanView(projectId: string): Promise<string> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    return (await this.readFlowchart(project)).flowchart;
  }

  async readOutlineReport(projectId: string): Promise<ProjectOutlineReport | null> {
    await this.ensureInitialized();
    await this.requireProject(projectId);
    return this.store.readOutlineReport(projectId);
  }

  async generateOutlineReport(input: GenerateProjectOutlineReportInput): Promise<ProjectOutlineReport> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const provider = input.provider ?? settings.advancedDefaults.provider;
    const model = provider === "claude"
      ? input.claudeModel ?? settings.advancedDefaults.claudeModel
      : input.model ?? settings.advancedDefaults.model;
    const repoHints = await collectFlowchartRepoHints(project.localPath);
    const currentFlowchart = await this.readFlowchart(project);
    const prompt = buildProjectOutlinePrompt({
      project,
      repoHints,
      currentFlowchart: currentFlowchart.flowchart,
    });
    const rawResult = await this.aiService(provider).runOneShot(project, settings, prompt, model);
    const report = parseProjectOutlineReportResponse(project.id, rawResult);

    await this.store.saveOutlineReport(report);
    this.emit({ type: "project.outlineReport", projectId: project.id, report });
    return report;
  }

  async readEnvFile(projectId: string): Promise<EnvFileSnapshot> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const path = join(project.localPath, ".env");
    const exists = await pathExists(path);
    const source = await readTextFile(path);

    return {
      projectId: project.id,
      path,
      exists,
      entries: parseEnvEntries(source),
    };
  }

  async writeEnvFile(input: WriteProjectEnvFileInput): Promise<EnvFileSnapshot> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const path = join(project.localPath, ".env");
    const content = serializeEnvEntries(input.entries);

    await writeTextFile(path, content);
    return {
      projectId: project.id,
      path,
      exists: true,
      entries: parseEnvEntries(content),
    };
  }

  async generateFlowchart(input: GenerateFlowchartInput): Promise<GenerateFlowchartResult> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const repoHints = await collectFlowchartRepoHints(project.localPath);

    const prompt = `
You are analyzing a codebase to produce a structured high-level user-flow diagram.

Project: "${project.name}"
Current description: ${project.description}

${formatFlowchartRepoHints(repoHints)}

Instructions:
- Explore the codebase at the project root.
- Do not change any files.
- Model the user-visible experience and major system flow, not line-level code.
- Keep the graph compact, but do not merge major screens just to reduce node count.
${FLOWCHART_PROMPT_RULES}
${FLOWCHART_OUTPUT_CONTRACT}
`.trim();

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(project, settings, prompt, model, flowchartGenerationSchema);
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));
    const snapshot = materializeFlowchartSnapshot(parsed.flowchartGraph);

    await this.writeFlowchart(project, snapshot);
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });

    return snapshot;
  }

  async planningChat(input: PlanningChatInput): Promise<PlanningChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);

    let session: PlanningSession;
    if (input.sessionId) {
      const existing = await this.store.getPlanningSession(input.sessionId);
      if (!existing) throw new Error("Planning session not found.");
      session = existing;
    } else {
      const currentFlowchart = await this.readFlowchart(project);
      session = {
        id: randomUUID(),
        projectId: input.projectId,
        provider: input.provider,
        messages: [],
        currentFlowchart: currentFlowchart.flowchart,
        currentFlowchartGraph: currentFlowchart.flowchartGraph,
        previousFlowchart: currentFlowchart.flowchart,
        previousFlowchartGraph: currentFlowchart.flowchartGraph,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const userMessage: PlanningChatMessage = {
      id: randomUUID(),
      role: "user",
      content: input.message,
      flowchart: null,
      flowchartGraph: null,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(userMessage);

    const recentMessages = session.messages.slice(-10);
    const conversationContext = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const repoHints = await collectFlowchartRepoHints(project.localPath);

    const prompt = `
You are a planning assistant helping a non-technical user update their software project "${project.name}".

Current system flowchart (Mermaid format):
${session.currentFlowchart}

Current system flowchart (structured graph JSON):
${session.currentFlowchartGraph ? JSON.stringify(session.currentFlowchartGraph, null, 2) : "null"}

${formatFlowchartRepoHints(repoHints)}

Conversation so far:
${conversationContext}

Instructions:
- Respond concisely and pragmatically about what you would change.
- If the user's request is clear enough, also produce an updated structured flowchart graph.
- Use the structured flowchart rules below when you update the graph.
${FLOWCHART_PROMPT_RULES}
- Your final answer must be ONLY strict JSON (no markdown fences):
  {"response": string, "flowchartGraph": FlowchartGraph | null}
- If no flowchart update is needed yet, set flowchartGraph to null.
`.trim();

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(project, settings, prompt, model, planningChatSchema);
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));
    const nextSnapshot = parsed.flowchartGraph ? materializeFlowchartSnapshot(parsed.flowchartGraph) : null;

    const assistantMessage: PlanningChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: parsed.response,
      flowchart: nextSnapshot?.flowchart ?? null,
      flowchartGraph: nextSnapshot?.flowchartGraph ?? null,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(assistantMessage);

    if (nextSnapshot) {
      session.currentFlowchart = nextSnapshot.flowchart;
      session.currentFlowchartGraph = nextSnapshot.flowchartGraph;
    }

    session.updatedAt = new Date().toISOString();
    await this.store.savePlanningSession(session);

    return {
      sessionId: session.id,
      message: assistantMessage,
      updatedFlowchart: nextSnapshot?.flowchart ?? null,
      updatedFlowchartGraph: nextSnapshot?.flowchartGraph ?? null,
    };
  }

  async savePlannedUpdate(input: SavePlannedUpdateInput): Promise<PendingPlannedUpdate> {
    await this.ensureInitialized();
    const pending: PendingPlannedUpdate = {
      id: randomUUID(),
      projectId: input.projectId,
      flowchart: input.flowchart,
      flowchartGraph: input.flowchartGraph,
      previousFlowchart: input.previousFlowchart,
      previousFlowchartGraph: input.previousFlowchartGraph,
      description: input.description,
      createdAt: new Date().toISOString(),
    };

    await this.store.savePendingUpdate(pending);
    this.emit({ type: "project.pendingUpdate", projectId: input.projectId, pending });
    return pending;
  }

  async getPendingUpdate(projectId: string): Promise<PendingPlannedUpdate | null> {
    await this.ensureInitialized();
    return this.store.getPendingUpdate(projectId);
  }

  async applyPlannedUpdate(projectId: string): Promise<{ started: true }> {
    await this.ensureInitialized();
    const pending = await this.store.getPendingUpdate(projectId);
    if (!pending) throw new Error("No pending planned update found.");

    const settings = await this.store.readSettings();
    const prompt = `Update the codebase to match this target system flowchart:

Mermaid flowchart:
${pending.flowchart}

Structured flowchart graph:
${pending.flowchartGraph ? JSON.stringify(pending.flowchartGraph, null, 2) : "null"}

Changes described: ${pending.description}`;

    const input: StartPlanInput = {
      projectId,
      provider: settings.advancedDefaults.provider,
      prompt,
      speed: settings.defaultSpeed,
      model: settings.advancedDefaults.model,
      claudeModel: settings.advancedDefaults.claudeModel,
      reasoningEffort: settings.advancedDefaults.reasoningEffort,
      autoApprove: settings.autoApprovePlans,
      contextPaths: [],
    };

    await this.store.deletePendingUpdate(projectId);
    this.emit({ type: "project.pendingUpdate", projectId, pending: null });

    return this.startPlan(input);
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    await this.ensureInitialized();
    if (!input.name.trim()) {
      throw new Error("Enter a program name first.");
    }
    if (!input.parentDirectory.trim()) {
      throw new Error("Choose where the new program should live first.");
    }

    const existingProjects = await this.store.listProjects();
    const settings = await this.store.readSettings();
    const localPath = join(input.parentDirectory, input.name);
    if (existingProjects.some((project) => project.localPath === localPath)) {
      throw new Error("That project is already attached in PROGRAMS.");
    }
    if (await pathExists(localPath)) {
      throw new Error("That folder already exists. Choose a different location or attach it instead.");
    }

    await this.git.initializeRepository(localPath, "main");

    const flowchartPath = join(localPath, ".programs", "system-flow.mmd");
    const description = deriveProjectDescription(input.name, input.initialIdea);
    const starterFlowchart = createStarterFlowchart(input.name);
    await writeTextFile(
      join(localPath, "README.md"),
      `# ${input.name}\n\n${description}\n`,
    );
    await writeTextFile(flowchartPath, starterFlowchart);

    let remoteUrl: string | null = null;
    let defaultBranch = "main";
    if (input.createRemote) {
      const clientId = this.resolveGitHubClientId(settings);
      const githubStatus = await this.github.getStatus(clientId);
      if (!githubStatus.configured) {
        throw new Error(this.githubConfigurationMessage());
      }
      if (!githubStatus.loggedIn) {
        throw new Error("Connect GitHub before saving this program with online sync.");
      }

      const repo = await this.github.createRepository({
        clientId,
        name: slugifyRepositoryName(input.name),
        description,
        visibility: input.visibility,
      });
      remoteUrl = repo.remoteUrl;
      defaultBranch = repo.defaultBranch || "main";
      await this.git.configureRemote(localPath, remoteUrl);
    }

    const runtimeConfig = await detectRuntimeConfig(localPath);
    runtimeConfig.initialIdea = input.initialIdea || null;
    runtimeConfig.githubRepoName = slugifyRepositoryName(input.name);

    const project: Project = {
      id: randomUUID(),
      name: input.name,
      iconColor: input.iconColor,
      description,
      localPath,
      remoteUrl,
      defaultBranch,
      threadId: null,
      flowchartPath,
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig,
      lastError: null,
    };

    const commitSha = await this.git.commitAll(localPath, `Initialize ${input.name}`);
    if (remoteUrl && commitSha) {
      await this.git.push(localPath, defaultBranch);
    }

    await this.store.createProject(project);
    this.emit({ type: "project.updated", project });
    await this.syncSelfRuntime(settings, [...existingProjects, project], true);
    return project;
  }

  async attachProject(input: ProjectAttachInput): Promise<Project> {
    await this.ensureInitialized();
    if (!input.localPath.trim()) {
      throw new Error("Choose a project folder to attach first.");
    }
    const existingProjects = await this.store.listProjects();
    if (existingProjects.some((project) => project.localPath === input.localPath)) {
      throw new Error("That project is already attached in PROGRAMS.");
    }
    if (!(await pathExists(input.localPath))) {
      throw new Error("PROGRAMS could not find that project folder.");
    }

    const settings = await this.store.readSettings();
    const inspected = await this.git.inspectRepository(input.localPath);
    if (!inspected.isRepo) {
      await this.git.initializeRepository(input.localPath, "main");
    }

    let remoteUrl = inspected.remoteUrl;
    let defaultBranch = inspected.defaultBranch;
    const name = deriveAttachedProjectName(input.localPath);

    if (!remoteUrl && input.createRemote) {
      const clientId = this.resolveGitHubClientId(settings);
      const githubStatus = await this.github.getStatus(clientId);
      if (!githubStatus.configured) {
        throw new Error(this.githubConfigurationMessage());
      }
      if (!githubStatus.loggedIn) {
        throw new Error("Connect GitHub before saving this program with online sync.");
      }

      const repo = await this.github.createRepository({
        clientId,
        name: slugifyRepositoryName(name),
        description: deriveProjectDescription(name),
        visibility: input.visibility,
      });
      remoteUrl = repo.remoteUrl;
      defaultBranch = repo.defaultBranch || defaultBranch;
      await this.git.configureRemote(input.localPath, remoteUrl);
    }

    const runtimeConfig = await detectRuntimeConfig(input.localPath);
    runtimeConfig.githubRepoName = slugifyRepositoryName(name);

    const project: Project = {
      id: randomUUID(),
      name,
      iconColor: input.iconColor,
      description: deriveProjectDescription(name),
      localPath: input.localPath,
      remoteUrl,
      defaultBranch,
      threadId: null,
      flowchartPath: join(input.localPath, ".programs", "system-flow.mmd"),
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig,
      lastError: null,
    };

    await this.store.createProject(project);
    this.emit({ type: "project.updated", project });
    await this.syncSelfRuntime(settings, [...existingProjects, project], true);
    return project;
  }

  async renameProject(input: RenameProjectInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.store.renameProject(input.projectId, input.name.trim());
    this.emit({ type: "project.updated", project });
    return project;
  }

  async updateProject(input: UpdateProjectInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const name = input.name.trim();
    const iconColor = input.iconColor.trim();

    if (!name) {
      throw new Error("Enter a project name first.");
    }
    if (!iconColor) {
      throw new Error("Choose a project color first.");
    }

    project.name = name;
    project.iconColor = iconColor;
    project.updatedAt = new Date().toISOString();

    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }

  async unlinkProject(projectId: string): Promise<{ removed: true }> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);
    if (activePlan) {
      throw new Error("Cancel the current update before unlinking this project.");
    }

    const runtime = await this.runner.validateRuntime(projectId);
    if (runtime.running && runtime.controllable) {
      await this.runner.stop(projectId);
    }
    await this.store.deleteProject(projectId);
    await this.syncSelfRuntime(undefined, await this.store.listProjects(), false);
    this.emit({ type: "project.removed", projectId });
    this.emit({
      type: "toast",
      level: "success",
      message: `${project.name} was removed from the dashboard.`,
    });
    return { removed: true };
  }

  async enableProjectSync(input: ProjectEnableSyncInput): Promise<Project> {
    const settings = await this.store.readSettings();
    let project = await this.requireProject(input.projectId);

    if (project.remoteUrl) {
      throw new Error("This project is already connected to GitHub.");
    }

    project = await this.updateProjectStatus(project, "syncing", null);

    try {
      const clientId = this.resolveGitHubClientId(settings);
      if (!clientId) {
        throw new Error(this.githubConfigurationMessage());
      }

      const githubStatus = await this.github.getStatus(clientId);
      if (!githubStatus.loggedIn) {
        throw new Error("Connect GitHub in Settings before enabling GitHub sync.");
      }

      const branch = (await this.git.getCurrentBranch(project.localPath)) || project.defaultBranch || "main";
      const repo = await this.github.createRepository({
        clientId,
        name: project.runtimeConfig.githubRepoName || slugifyRepositoryName(project.name),
        description: project.description,
        visibility: input.visibility,
      });

      await this.git.configureRemote(project.localPath, repo.remoteUrl);

      if (!(await this.git.hasCommit(project.localPath))) {
        const commitSha = await this.git.commitAll(project.localPath, `Initialize ${project.name}`);
        if (!commitSha) {
          throw new Error("Add at least one file before enabling GitHub sync.");
        }
      }

      await this.git.push(project.localPath, branch);

      project.remoteUrl = repo.remoteUrl;
      project.defaultBranch = branch;
      project.status = "idle";
      project.lastError = null;
      project.updatedAt = new Date().toISOString();
      await this.store.updateProject(project);
      this.emit({ type: "project.updated", project });
      this.emit({
        type: "toast",
        level: "success",
        message: "GitHub sync is enabled for this project.",
      });

      return project;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PROGRAMS could not connect this project to GitHub.";
      await this.updateProjectStatus(project, "idle", message);
      throw error;
    }
  }

  async getCodexStatus(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.getAuthStatus(settings);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async readUsage(): Promise<UsageSnapshot> {
    const settings = await this.store.readSettings();
    const [codex, claude] = await Promise.all([
      this.codex.getUsage(settings),
      this.claude.getUsage(settings),
    ]);

    return {
      codex,
      claude,
      updatedAt: new Date().toISOString(),
    };
  }

  async loginCodex(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.login(settings);
    await this.emitSetupUpdated(settings, status);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async setupCodex(): Promise<CodexAuthStatus> {
    let settings = await this.store.readSettings();

    try {
      let installation = await this.codex.inspectInstallation(settings);
      if (!installation.available || !installation.binaryPath) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Installing Codex for PROGRAMS.",
        });
        const binaryPath = await this.installCodexCli();
        settings = await this.store.updateSettings({ codexBinaryPath: binaryPath });
        installation = await this.codex.inspectInstallation(settings);
      } else if (installation.binaryPath !== settings.codexBinaryPath) {
        settings = await this.store.updateSettings({ codexBinaryPath: installation.binaryPath });
      }

      let status = await this.codex.getAuthStatus(settings);
      if (!status.loggedIn) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Opening the Codex sign-in flow.",
        });
        status = await this.codex.login(settings);
      }

      if (status.binaryPath && status.binaryPath !== settings.codexBinaryPath) {
        settings = await this.store.updateSettings({ codexBinaryPath: status.binaryPath });
      }

      await this.emitSetupUpdated(settings, status);
      await this.emitModelCatalogUpdated(settings);
      return status;
    } catch (error) {
      await this.emitSetupUpdated(settings);
      await this.emitModelCatalogUpdated(settings);
      throw error;
    }
  }

  async logoutCodex(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.logout(settings);
    await this.emitSetupUpdated(settings, status);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async getClaudeStatus(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    return this.claude.getAuthStatus(settings);
  }

  async setupClaude(): Promise<ClaudeAuthStatus> {
    let settings = await this.store.readSettings();

    try {
      let status = await this.claude.getAuthStatus(settings);
      if (!status.available || !status.binaryPath) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Installing Claude Code for PROGRAMS.",
        });
        await this.installClaudeCli();
        status = await this.claude.getAuthStatus(settings);
      }

      if (!status.available || !status.binaryPath) {
        await shell.openExternal(CLAUDE_DOWNLOAD_URL);
        throw new Error("PROGRAMS could not finish the Claude install automatically. It opened the official Claude Code docs.");
      }

      if (status.binaryPath !== settings.claudeBinaryPath) {
        settings = await this.store.updateSettings({ claudeBinaryPath: status.binaryPath });
      }

      if (!status.loggedIn) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Opening the Claude sign-in flow.",
        });
        status = await this.claude.login(settings);
      }

      if (status.binaryPath && status.binaryPath !== settings.claudeBinaryPath) {
        settings = await this.store.updateSettings({ claudeBinaryPath: status.binaryPath });
      }

      await this.emitSetupUpdated(settings, undefined, status);
      return status;
    } catch (error) {
      await this.emitSetupUpdated(settings);
      throw error;
    }
  }

  async loginClaude(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.claude.login(settings);
    await this.emitSetupUpdated(settings, undefined, status);
    return status;
  }

  private async readModelCatalog(settings: Settings): Promise<ModelCatalog> {
    const codex = await this.codex.getModelCatalog(settings);
    const matchesFallback =
      JSON.stringify(codex.map((option) => option.id)) ===
      JSON.stringify(DEFAULT_MODEL_CATALOG.codex.map((option) => option.id));

    return {
      codex: codex.length ? codex : DEFAULT_MODEL_CATALOG.codex,
      claude: DEFAULT_MODEL_CATALOG.claude,
      source: matchesFallback ? "fallback" : "live",
      updatedAt: new Date().toISOString(),
    };
  }

  private async emitModelCatalogUpdated(settings: Settings): Promise<void> {
    this.emit({
      type: "modelCatalog.updated",
      catalog: await this.readModelCatalog(settings),
    });
  }

  async getGitHubStatus(): Promise<GitHubAuthStatus> {
    const settings = await this.store.readSettings();
    return this.github.getStatus(this.resolveGitHubClientId(settings));
  }

  async inspectAttachPath(localPath: string): Promise<AttachPathInspection> {
    const normalizedPath = localPath.trim();
    if (!normalizedPath) {
      return {
        localPath: "",
        name: null,
        exists: false,
        isRepo: false,
        remoteUrl: null,
        defaultBranch: null,
      };
    }

    const exists = await pathExists(normalizedPath);
    if (!exists) {
      return {
        localPath: normalizedPath,
        name: deriveAttachedProjectName(normalizedPath),
        exists: false,
        isRepo: false,
        remoteUrl: null,
        defaultBranch: null,
      };
    }

    const inspected = await this.git.inspectRepository(normalizedPath);
    return {
      localPath: normalizedPath,
      name: deriveAttachedProjectName(normalizedPath),
      exists: true,
      isRepo: inspected.isRepo,
      remoteUrl: inspected.remoteUrl,
      defaultBranch: inspected.defaultBranch,
    };
  }

  async loginGitHub() {
    const settings = await this.store.readSettings();
    const clientId = this.resolveGitHubClientId(settings);
    if (!clientId) {
      throw new Error(this.githubConfigurationMessage());
    }

    return this.github.login(clientId);
  }

  async logoutGitHub(): Promise<GitHubAuthStatus> {
    const status = await this.github.logout();
    await this.emitSetupUpdated();
    return status;
  }

  async readSetup(): Promise<SetupSnapshot> {
    return this.buildSetupSnapshot();
  }

  async refreshSetup(): Promise<SetupSnapshot> {
    const snapshot = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: snapshot });
    return snapshot;
  }

  async installGit(): Promise<{ outcome: "alreadyAvailable" | "requested" | "manualDownload" }> {
    const outcome = await this.git.promptInstall();

    if (outcome === "requested") {
      this.emit({
        type: "toast",
        level: "info",
        message: "macOS opened the Git install prompt. Confirm it, then refresh the checks.",
      });
    } else if (outcome === "alreadyAvailable") {
      this.emit({
        type: "toast",
        level: "success",
        message: "Git is already installed.",
      });
    } else {
      this.emit({
        type: "toast",
        level: "info",
        message: "PROGRAMS opened the Git download page because macOS did not start the installer automatically.",
      });
      await shell.openExternal(GIT_DOWNLOAD_URL);
    }

    const snapshot = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: snapshot });
    return { outcome };
  }

  private async installCodexCli(): Promise<string> {
    if (process.platform !== "darwin") {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("Automatic Codex setup is only available on macOS right now. PROGRAMS opened the official Codex page.");
    }

    const npmVersion = await execCommand("npm --version", process.cwd());
    if (npmVersion.code !== 0) {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not find npm to install Codex automatically. It opened the official Codex page.");
    }

    const installDir = join(app.getPath("userData"), "tools", "codex");
    await ensureDirectory(installDir);
    const installResult = await execCommand(
      `npm install --prefix "${installDir}" --no-audit --no-fund @openai/codex`,
      process.cwd(),
    );

    const binaryPath = join(installDir, "node_modules", ".bin", "codex");
    if (installResult.code !== 0 || !(await pathExists(binaryPath))) {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not install Codex automatically. It opened the official Codex page.");
    }

    return binaryPath;
  }

  private async installClaudeCli(): Promise<void> {
    if (process.platform !== "darwin") {
      await shell.openExternal(CLAUDE_DOWNLOAD_URL);
      throw new Error("Automatic Claude setup is only available on macOS right now. PROGRAMS opened the official Claude Code docs.");
    }

    const installResult = await execCommand(
      `/bin/zsh -lc 'curl -fsSL https://claude.ai/install.sh | bash'`,
      process.cwd(),
    );

    if (installResult.code !== 0) {
      await shell.openExternal(CLAUDE_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not install Claude Code automatically. It opened the official Claude Code docs.");
    }
  }

  async dismissSetup(): Promise<SetupSnapshot> {
    const snapshot = await this.buildSetupSnapshot();
    if (!snapshot.isSetupComplete) {
      throw new Error("Finish the required setup steps before entering PROGRAMS.");
    }

    await this.store.updateSetupState({
      completedAt: snapshot.completedAt ?? new Date().toISOString(),
    });

    const next = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: next });
    return next;
  }

  async runProject(projectId: string) {
    await this.ensureInitialized();
    let project = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const existing = await this.syncProjectRuntimeState(project);
    project = existing.project;
    if (existing.runtime.running) {
      return existing.runtime;
    }

    project = await this.updateProjectStatus(project, "running", null);

    try {
      await this.git.ensureRepository(project.localPath, null, project.defaultBranch);
      await this.runner.install(project);
      return await this.runner.start(project);
    } catch (error) {
      await this.updateProjectStatus(
        project,
        "error",
        error instanceof Error ? error.message : "PROGRAMS could not run this project.",
      );
      throw error;
    }
  }

  async killProject(projectId: string) {
    await this.ensureInitialized();
    const validatedRuntime = await this.runner.validateRuntime(projectId);
    if (!validatedRuntime.running) {
      return validatedRuntime;
    }

    const project = await this.requireProject(projectId);
    if (validatedRuntime.source === "self") {
      const nextRuntime = EMPTY_RUNTIME(projectId);
      await this.updateProjectStatus(project, "idle", null);
      this.emit({ type: "project.runtime", projectId, runtime: nextRuntime });
      setImmediate(() => app.quit());
      return nextRuntime;
    }

    const runtime = await this.runner.stop(projectId);
    await this.updateProjectStatus(project, "idle", null);
    return runtime;
  }

  async openProject(projectId: string): Promise<boolean> {
    await this.ensureInitialized();
    const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const { runtime } = await this.syncProjectRuntimeState(refreshedProject);
    if (!runtime.running || !runtime.url) {
      return false;
    }

    await shell.openExternal(runtime.url);
    return true;
  }

  async handleRuntimeExit(projectId: string): Promise<void> {
    const project = await this.store.readProject(projectId);
    if (!project || project.status !== "running") {
      return;
    }

    await this.updateProjectStatus(project, "idle", null);
  }

  async handleRuntimeUrlDetected(projectId: string, url: string): Promise<void> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      return;
    }

    const nextRuntimeConfig = {
      ...project.runtimeConfig,
      lastRunUrl: url,
    };

    if (JSON.stringify(nextRuntimeConfig) === JSON.stringify(project.runtimeConfig)) {
      return;
    }

    project.runtimeConfig = nextRuntimeConfig;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
  }

  private aiService(provider: StartPlanInput["provider"]): CodexService | ClaudeService {
    return provider === "claude" ? this.claude : this.codex;
  }

  async startPlan(input: StartPlanInput): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    await this.updateProjectStatus(project, "planning", null);
    const service = this.aiService(input.provider);
    const providerLabel = input.provider === "claude" ? "Claude" : "Codex";

    void service
      .startPlanningTurn(project, settings, input)
      .then(async (draft) => {
        const latest = await this.requireProject(project.id);
        latest.threadId = draft.threadId;
        latest.updatedAt = new Date().toISOString();
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });

        if (draft.autoApprove) {
          await this.executePlan(latest, settings, draft);
          return;
        }

        await this.updateProjectStatus(latest, "awaitingApproval");
      })
      .catch(async (error) => {
        const latest = await this.requireProject(project.id);
        await this.updateProjectStatus(
          latest,
          "error",
          error instanceof Error ? error.message : `PROGRAMS could not create a plan with ${providerLabel}.`,
        );
      });

    return { started: true };
  }

  async revisePlan(input: StartPlanInput): Promise<{ started: true }> {
    const service = this.aiService(input.provider);
    await service.interruptPlan(input.projectId);
    return this.startPlan(input);
  }

  async cancelPlan(projectId: string): Promise<{ cancelled: true }> {
    // Interrupt whichever service has an active plan
    const codexPlan = this.codex.getActivePlan(projectId);
    const claudePlan = this.claude.getActivePlan(projectId);
    if (codexPlan) await this.codex.interruptPlan(projectId);
    if (claudePlan) await this.claude.interruptPlan(projectId);
    const project = await this.requireProject(projectId);
    await this.updateProjectStatus(project, "idle");
    return { cancelled: true };
  }

  async approvePlan(input: ApprovePlanInput): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const draft = this.codex.getActivePlan(project.id) ?? this.claude.getActivePlan(project.id);
    if (!draft || draft.status !== "awaitingApproval") {
      throw new Error("There is no approved plan ready to confirm.");
    }

    await this.executePlan(project, settings, draft);

    return { started: true };
  }

  async undoUpdate(projectId: string, updateId: string): Promise<{ started: true }> {
    let project = await this.requireProject(projectId);
    const updates = await this.store.readHistory(projectId);
    const target = updates.find((item) => item.id === updateId);
    if (!target?.commitSha) {
      throw new Error("That update cannot be undone.");
    }

    project = await this.updateProjectStatus(project, "executing");
    await this.git.ensureRepository(project.localPath, null, project.defaultBranch);
    const revertSha = await this.git.revertCommit(project.localPath, target.commitSha);

    target.status = "reverted";
    target.errorMessage = null;
    await this.store.updateHistoryRecord(target);

    const flowchart = await this.readFlowchart(project);
    const undoRecord: UpdateRecord = {
      id: randomUUID(),
      projectId: project.id,
      prompt: `Undo ${target.summary}`,
      summary: `Undid: ${target.summary}`,
      commitSha: revertSha,
      flowchart: flowchart.flowchart,
      flowchartGraph: flowchart.flowchartGraph,
      createdAt: new Date().toISOString(),
      kind: "undo",
      status: "saved",
      errorMessage: null,
    };

    await this.store.addUpdateRecord(undoRecord);
    project.lastUpdatedAt = undoRecord.createdAt;
    project.status = "idle";
    project.lastError = null;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    await this.emitHistory(project.id);
    return { started: true };
  }

  async retrySync(input: RetrySyncInput): Promise<{ started: true }> {
    const project = await this.requireProject(input.projectId);
    const updates = await this.store.readHistory(input.projectId);
    const target = updates.find((item) => item.id === input.updateId);
    if (!target || target.status !== "pendingSync") {
      throw new Error("That update is not waiting to sync.");
    }

    target.status = "saved";
    target.errorMessage = null;
    await this.store.updateHistoryRecord(target);
    project.status = "idle";
    project.lastError = null;
    project.lastUpdatedAt = target.createdAt;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    await this.emitHistory(project.id);
    return { started: true };
  }

  private async executePlan(project: Project, settings: Settings, draft: PlanDraft): Promise<void> {
    const executingProject = await this.updateProjectStatus(project, "executing", null);
    const service = this.aiService(draft.provider);
    const providerLabel = draft.provider === "claude" ? "Claude" : "Codex";

    void service
      .executeApprovedPlan(executingProject, settings, draft)
      .then(async (result) => {
        let latest = await this.requireProject(executingProject.id);
        await this.git.ensureRepository(latest.localPath, null, latest.defaultBranch);
        await this.writeFlowchart(latest, {
          flowchart: result.flowchart,
          flowchartGraph: result.flowchartGraph,
        });
        latest.description = result.description;
        latest.threadId = result.draft.threadId;
        latest.updatedAt = new Date().toISOString();
        latest.status = "executing";
        latest.lastError = null;
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });

        const commitSha = await this.git.commitAll(latest.localPath, result.commitMessage);
        if (!commitSha) {
          latest = await this.updateProjectStatus(latest, "idle", null);
          service.clearPlan(latest.id);
          this.emit({
            type: "toast",
            level: "info",
            message: `${providerLabel} finished, but no local file changes were needed.`,
          });
          return;
        }

        const historyRecord: UpdateRecord = {
          id: randomUUID(),
          projectId: latest.id,
          prompt: draft.prompt,
          summary: result.summary,
          commitSha,
          flowchart: result.flowchart,
          flowchartGraph: result.flowchartGraph,
          createdAt: new Date().toISOString(),
          kind: "update",
          status: "saved",
          errorMessage: null,
        };
        await this.store.addUpdateRecord(historyRecord);
        latest.lastUpdatedAt = historyRecord.createdAt;
        latest.status = "idle";
        latest.updatedAt = new Date().toISOString();
        latest.lastError = null;
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });
        await this.emitHistory(latest.id);
        service.clearPlan(latest.id);
        this.emit({
          type: "toast",
          level: "success",
          message: "Update saved locally.",
        });
      })
      .catch(async (error) => {
        const latest = await this.requireProject(executingProject.id);
        await this.updateProjectStatus(
          latest,
          "error",
          error instanceof Error ? error.message : `PROGRAMS could not finish the update with ${providerLabel}.`,
        );
      });
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    return project;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRuntimeState();
    }

    await this.initializationPromise;
  }

  private async initializeRuntimeState(): Promise<void> {
    const settings = await this.store.readSettings();
    const projects = await this.store.listProjects();
    await this.runner.restorePersistedRuntimes(projects, settings.appSourcePath, process.env.ELECTRON_RENDERER_URL ?? null);
    await this.reconcileProjectStatuses(projects, false);
  }

  private async syncSelfRuntime(
    settingsArg?: Settings,
    projectsArg?: Project[],
    emitEvents = false,
  ): Promise<Project[]> {
    const settings = settingsArg ?? (await this.store.readSettings());
    const projects = projectsArg ?? (await this.store.listProjects());
    const changedIds = this.runner.syncSelfRuntime(
      projects,
      settings.appSourcePath,
      process.env.ELECTRON_RENDERER_URL ?? null,
    );
    const nextProjects = await this.reconcileProjectStatuses(projects, emitEvents);

    if (emitEvents) {
      for (const projectId of changedIds) {
        this.emit({
          type: "project.runtime",
          projectId,
          runtime: this.runner.getRuntime(projectId),
        });
      }
    }

    return nextProjects;
  }

  private async reconcileProjectStatuses(projects: Project[], emitEvents: boolean): Promise<Project[]> {
    const nextProjects: Project[] = [];

    for (const project of projects) {
      const runtime = this.runner.getRuntime(project.id);
      const nextStatus = this.resolveRuntimeBackedStatus(project.status, runtime.running);
      const nextLastError = runtime.running ? null : project.lastError;

      if (nextStatus === project.status && nextLastError === project.lastError) {
        nextProjects.push(project);
        continue;
      }

      const nextProject: Project = {
        ...project,
        status: nextStatus,
        lastError: nextLastError,
        updatedAt: new Date().toISOString(),
      };
      await this.store.updateProject(nextProject);
      if (emitEvents) {
        this.emit({ type: "project.updated", project: nextProject });
      }
      nextProjects.push(nextProject);
    }

    return nextProjects;
  }

  private async syncProjectRuntimeState(
    project: Project,
    emitUpdates = true,
  ): Promise<{ project: Project; runtime: RuntimeState }> {
    let runtime = await this.runner.validateRuntime(project.id);
    if (!runtime.running) {
      runtime = await this.runner.detectExternalRuntime(project);
    }
    const nextStatus = this.resolveRuntimeBackedStatus(project.status, runtime.running);
    const nextLastError = runtime.running ? null : project.lastError;

    if (nextStatus === project.status && nextLastError === project.lastError) {
      return { project, runtime };
    }

    const nextProject: Project = {
      ...project,
      status: nextStatus,
      lastError: nextLastError,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateProject(nextProject);
    if (emitUpdates) {
      this.emit({ type: "project.updated", project: nextProject });
    }

    return { project: nextProject, runtime };
  }

  private resolveRuntimeBackedStatus(status: Project["status"], runtimeRunning: boolean): Project["status"] {
    if (runtimeRunning) {
      if (status === "executing" || status === "syncing" || status === "planning" || status === "awaitingApproval") {
        return status;
      }

      return "running";
    }

    return status === "running" ? "idle" : status;
  }

  private async refreshProjectsRuntimeConfig(projects: Project[]): Promise<Project[]> {
    return Promise.all(projects.map((project) => this.refreshProjectRuntimeConfig(project)));
  }

  private async refreshProjectRuntimeConfig(project: Project): Promise<Project> {
    let detected: Project["runtimeConfig"];
    try {
      detected = await detectRuntimeConfig(project.localPath);
    } catch {
      return project;
    }

    const nextRuntimeConfig = {
      ...detected,
      openUrl: detected.openUrl ?? project.runtimeConfig.openUrl,
      lastRunUrl: project.runtimeConfig.lastRunUrl,
      initialIdea: project.runtimeConfig.initialIdea,
      githubRepoName: project.runtimeConfig.githubRepoName ?? detected.githubRepoName,
    };

    if (JSON.stringify(nextRuntimeConfig) === JSON.stringify(project.runtimeConfig)) {
      return project;
    }

    const nextProject: Project = {
      ...project,
      runtimeConfig: nextRuntimeConfig,
    };
    await this.store.updateProject(nextProject);
    return nextProject;
  }

  private async readFlowchart(project: Project): Promise<GenerateFlowchartResult> {
    return readFlowchartSnapshot(project);
  }

  private async writeFlowchart(project: Project, snapshot: GenerateFlowchartResult): Promise<void> {
    await writeFlowchartSnapshot(project, snapshot);
  }

  private async emitHistory(projectId: string): Promise<void> {
    const updates = await this.store.readHistory(projectId);
    this.emit({ type: "project.history", projectId, updates });
  }

  private async emitSetupUpdated(
    settings?: Settings,
    codex?: CodexAuthStatus,
    claudeStatus?: ClaudeAuthStatus,
    github?: GitHubAuthStatus,
  ): Promise<void> {
    const snapshot = await this.buildSetupSnapshot(settings, codex, claudeStatus, github);
    this.emit({ type: "setup.updated", setup: snapshot });
  }

  private async buildSetupSnapshot(
    settingsArg?: Settings,
    codexArg?: CodexAuthStatus,
    claudeArg?: ClaudeAuthStatus,
    _githubArg?: GitHubAuthStatus,
  ): Promise<SetupSnapshot> {
    const settings = settingsArg ?? (await this.store.readSettings());
    const [setupState, gitVersion, codex, claudeStatus] = await Promise.all([
      this.store.readSetupState(),
      this.git.getVersion(),
      codexArg ? Promise.resolve(codexArg) : this.codex.getAuthStatus(settings),
      claudeArg ? Promise.resolve(claudeArg) : this.claude.getAuthStatus(settings),
    ]);

    const isPackagedBuild = app.isPackaged;
    const githubConfigured = Boolean(this.resolveGitHubClientId(settings));
    const codexInstalled = codex.available && Boolean(codex.binaryPath);
    const claudeInstalled = claudeStatus.available && Boolean(claudeStatus.binaryPath);
    const gitInstalled = Boolean(gitVersion);

    const checks: SetupCheck[] = [
      {
        id: "codexInstall",
        section: "need",
        label: "Install Codex",
        status: codexInstalled ? "confirmed" : "action_required",
        version: codex.version,
        detail: codexInstalled
          ? codex.binaryPath
            ? `Installed at ${codex.binaryPath}.`
            : "Installed and ready."
          : "Required before PROGRAMS can plan or apply changes.",
        actionLabel: codexInstalled ? null : "Install & Connect",
        actionKind: codexInstalled ? "none" : "setupCodex",
        actionTarget: null,
        secondaryActionLabel: codexInstalled ? "View" : null,
        secondaryActionKind: codexInstalled ? "openExternal" : "none",
        secondaryActionTarget: codexInstalled ? CODEX_DOWNLOAD_URL : null,
        required: true,
      },
      {
        id: "codexLogin",
        section: "need",
        label: "Connect Codex",
        status: !codexInstalled ? "info" : codex.loggedIn ? "confirmed" : "action_required",
        version: null,
        detail: !codexInstalled
          ? "Install Codex first."
          : codex.loggedIn
            ? codex.email
              ? `Confirmed as ${codex.email}.`
              : "Confirmed."
            : "PROGRAMS opens the browser sign-in flow and validates it after login.",
        actionLabel: !codexInstalled ? null : codex.loggedIn ? null : "Connect",
        actionKind: !codexInstalled ? "none" : codex.loggedIn ? "none" : "codexLogin",
        actionTarget: null,
        secondaryActionLabel: null,
        secondaryActionKind: "none",
        secondaryActionTarget: null,
        required: true,
      },
      {
        id: "claudeInstall",
        section: "assistant",
        label: "Install Claude Code",
        status: claudeInstalled ? "confirmed" : "info",
        version: claudeStatus.version,
        detail: claudeInstalled
          ? claudeStatus.binaryPath
            ? `Installed at ${claudeStatus.binaryPath}.`
            : "Installed and ready."
          : "Optional. Install and connect Claude Code to use Claude for updates.",
        actionLabel: claudeInstalled ? null : "Install & Connect",
        actionKind: claudeInstalled ? "none" : "setupClaude",
        actionTarget: null,
        secondaryActionLabel: claudeInstalled ? "View" : null,
        secondaryActionKind: claudeInstalled ? "openExternal" : "none",
        secondaryActionTarget: claudeInstalled ? CLAUDE_DOWNLOAD_URL : null,
        required: false,
      },
      {
        id: "claudeLogin",
        section: "assistant",
        label: "Connect Claude",
        status: !claudeInstalled ? "info" : claudeStatus.loggedIn ? "confirmed" : "info",
        version: null,
        detail: !claudeInstalled
          ? "Install Claude Code first."
          : claudeStatus.loggedIn
            ? "Confirmed and ready."
            : "Sign in to use your Claude subscription.",
        actionLabel: !claudeInstalled ? null : claudeStatus.loggedIn ? null : "Connect",
        actionKind: !claudeInstalled ? "none" : claudeStatus.loggedIn ? "none" : "claudeLogin",
        actionTarget: null,
        secondaryActionLabel: null,
        secondaryActionKind: "none",
        secondaryActionTarget: null,
        required: false,
      },
      {
        id: "gitInstall",
        section: "assistant",
        label: "Install Git",
        status: gitInstalled ? "confirmed" : "action_required",
        version: gitVersion,
        detail: gitInstalled
          ? "Confirmed and ready for sync."
          : "PROGRAMS can ask macOS to install it. You only confirm the system prompt.",
        actionLabel: gitInstalled ? null : "Install",
        actionKind: gitInstalled ? "none" : "installGit",
        actionTarget: null,
        secondaryActionLabel: gitInstalled ? "Refresh" : null,
        secondaryActionKind: gitInstalled ? "refresh" : "none",
        secondaryActionTarget: null,
        required: true,
      },
    ];

    const isSetupComplete = checks.every((check) => !check.required || check.status === "confirmed");
    const currentCheckId = checks.find((check) => check.required && check.status !== "confirmed")?.id ?? null;

    return {
      checks,
      completedAt: setupState.completedAt,
      isSetupComplete,
      showSetupOnLaunch: false,
      currentCheckId,
      isPackagedBuild,
      githubConfigured,
    };
  }

  private resolveGitHubClientId(settings: Settings): string | null {
    const overrideId = settings.githubClientIdOverride?.trim();
    const bundledId = process.env.GITHUB_CLIENT_ID?.trim();
    return overrideId || bundledId || null;
  }

  private emitAppUpdateStatus(status: AppUpdateStatus): void {
    const nextJson = JSON.stringify(status);
    if (nextJson === this.lastAppUpdateStatusJson) {
      return;
    }

    this.lastAppUpdateStatusJson = nextJson;
    this.emit({ type: "appUpdate.status", status });
  }

  private async refreshAppUpdateStatus(settings: Settings, autoBuild: boolean): Promise<AppUpdateStatus> {
    const evaluation = await this.evaluateAppUpdate(settings);

    if (autoBuild && evaluation.shouldPackage && evaluation.packageKey && evaluation.workspacePath) {
      this.ensureAppUpdatePackaging(settings, evaluation.workspacePath, evaluation.packageKey);
      return (await this.evaluateAppUpdate(settings)).status;
    }

    return evaluation.status;
  }

  private async evaluateAppUpdate(settings: Settings): Promise<AppUpdateEvaluation> {
    if (process.platform !== "darwin" || !app.isPackaged) {
      return {
        status: {
          supported: false,
          available: false,
          currentAppPath: null,
          candidateAppPath: null,
          workspacePath: null,
          workspaceExists: false,
          sourceUpdatedAt: null,
          launchedAppUpdatedAt: null,
          currentUpdatedAt: null,
          candidateUpdatedAt: null,
          buildState: "idle",
          buildError: null,
          requiresAdminPrompt: false,
          action: "none",
          reason: "App updates are only available from the packaged macOS app.",
        },
        shouldPackage: false,
        packageKey: null,
        statusKey: null,
        workspacePath: null,
      };
    }

    const currentAppPath = this.currentAppBundlePath();
    const launchedAppUpdatedAt = await this.launchedAppUpdatedAtPromise;
    const currentUpdatedAt = currentAppPath ? await this.readModifiedAt(currentAppPath) : null;
    const workspace = await this.readAppUpdateWorkspace(settings);
    const packageKey =
      workspace.workspaceValid && workspace.workspacePath && workspace.sourceUpdatedAt
        ? this.buildAppUpdatePackageKey(workspace.workspacePath, workspace.sourceUpdatedAt)
        : null;
    const statusKey = this.buildAppUpdateStatusKey(
      workspace.workspacePath ?? currentAppPath,
      workspace.sourceUpdatedAt ?? workspace.candidateUpdatedAt,
    );
    const candidateMatchesLatestSource = this.candidateMatchesLatestSource(
      workspace.workspaceValid,
      workspace.sourceUpdatedAt,
      workspace.candidateUpdatedAt,
    );
    const sourceIsNewer =
      workspace.workspaceValid && workspace.sourceUpdatedAt
        ? !candidateMatchesLatestSource
        : false;

    let action: AppUpdateStatus["action"] = "none";
    if (
      candidateMatchesLatestSource &&
      currentAppPath &&
      workspace.candidateAppPath &&
      workspace.candidateUpdatedAt
    ) {
      if (currentAppPath === workspace.candidateAppPath) {
        if (launchedAppUpdatedAt && this.isTimestampNewer(workspace.candidateUpdatedAt, launchedAppUpdatedAt)) {
          action = "restart";
        }
      } else if (!currentUpdatedAt || this.isTimestampNewer(workspace.candidateUpdatedAt, currentUpdatedAt)) {
        action = "install";
      }
    }

    const requiresAdminPrompt =
      action === "install" && currentAppPath ? !(await this.canReplaceInstalledApp(currentAppPath)) : false;

    let buildState: AppUpdateStatus["buildState"] = "idle";
    if (this.appUpdateInstalling) {
      buildState = "installing";
    } else if (this.appUpdatePackagingJob) {
      buildState = "packaging";
    } else if (statusKey && this.appUpdateFailedKey === statusKey) {
      buildState = "failed";
    } else if (candidateMatchesLatestSource && workspace.candidateUpdatedAt) {
      buildState = "ready";
    }

    const reason = this.describeAppUpdateStatus({
      supported: true,
      currentAppPath,
      workspace,
      sourceIsNewer,
      buildState,
      action,
      requiresAdminPrompt,
      buildError: this.appUpdateBuildError,
    });

    return {
      status: {
        supported: true,
        available: action !== "none",
        currentAppPath,
        candidateAppPath: workspace.candidateAppPath,
        workspacePath: workspace.workspacePath,
        workspaceExists: workspace.workspaceExists,
        sourceUpdatedAt: workspace.sourceUpdatedAt,
        launchedAppUpdatedAt,
        currentUpdatedAt,
        candidateUpdatedAt: workspace.candidateUpdatedAt,
        buildState,
        buildError: buildState === "failed" ? this.appUpdateBuildError : null,
        requiresAdminPrompt,
        action,
        reason,
      },
      shouldPackage:
        Boolean(packageKey) &&
        sourceIsNewer &&
        !this.appUpdatePackagingJob &&
        this.appUpdateFailedKey !== statusKey,
      packageKey,
      statusKey,
      workspacePath: workspace.workspacePath,
    };
  }

  private async ensureAppUpdatePackaging(
    settings: Settings,
    workspacePath: string,
    packageKey: string,
  ): Promise<void> {
    if (this.appUpdatePackagingJob && this.appUpdatePackagingKey === packageKey) {
      return;
    }
    if (this.appUpdatePackagingJob) {
      return;
    }

    this.appUpdatePackagingKey = packageKey;
    this.appUpdateFailedKey = null;
    this.appUpdateBuildError = null;
    const job = this.runAppUpdatePackaging(settings, workspacePath, packageKey);
    this.appUpdatePackagingJob = job;
    void this.evaluateAppUpdate(settings)
      .then((result) => this.emitAppUpdateStatus(result.status))
      .catch(() => undefined);
    void job.finally(() => {
      if (this.appUpdatePackagingJob === job) {
        this.appUpdatePackagingJob = null;
      }
    });
  }

  private async runAppUpdatePackaging(settings: Settings, workspacePath: string, packageKey: string): Promise<void> {
    try {
      const preflightError = await this.preflightAppPackaging(workspacePath);
      if (preflightError) {
        throw new Error(preflightError);
      }

      const result = await execCommand("npm run package:mac", workspacePath);
      if (result.code !== 0) {
        const message = (result.stderr || result.stdout).trim() || "PROGRAMS could not package the latest app build.";
        throw new Error(message);
      }

      this.appUpdateFailedKey = null;
      this.appUpdateBuildError = null;
      this.appUpdatePackagingKey = null;
      this.emitAppUpdateStatus(await this.refreshAppUpdateStatus(settings, false));
    } catch (error) {
      this.appUpdatePackagingKey = null;
      this.appUpdateFailedKey = packageKey;
      this.appUpdateBuildError =
        error instanceof Error ? error.message : "PROGRAMS could not package the latest app build.";
      this.emitAppUpdateStatus(await this.refreshAppUpdateStatus(settings, false));
    }
  }

  private async preflightAppPackaging(workspacePath: string): Promise<string | null> {
    const packageJsonPath = join(workspacePath, "package.json");
    const packageJsonText = await readTextFile(packageJsonPath);
    if (!packageJsonText.trim()) {
      return "PROGRAMS could not read package.json from the configured source workspace.";
    }

    try {
      const packageJson = JSON.parse(packageJsonText) as {
        scripts?: Record<string, string>;
      };
      if (!packageJson.scripts?.["package:mac"]) {
        return "The configured source workspace is missing the package:mac build script.";
      }
    } catch {
      return "PROGRAMS could not parse package.json from the configured source workspace.";
    }

    const npmVersion = await execCommand("npm --version", workspacePath);
    if (npmVersion.code !== 0) {
      return "PROGRAMS could not find npm. Install Node.js with npm to enable in-app app packaging.";
    }

    return null;
  }

  private async readAppUpdateWorkspace(settings: Settings): Promise<AppUpdateWorkspaceInfo> {
    const workspacePath = settings.appSourcePath?.trim() || null;
    if (!workspacePath) {
      return {
        workspacePath: null,
        workspaceExists: false,
        workspaceValid: false,
        workspaceError: "Choose the PROGRAMS source workspace in Settings to enable in-app updates.",
        sourceUpdatedAt: null,
        candidateAppPath: null,
        candidateUpdatedAt: null,
      };
    }

    const workspaceExists = await pathExists(workspacePath);
    if (!workspaceExists) {
      return {
        workspacePath,
        workspaceExists: false,
        workspaceValid: false,
        workspaceError: "PROGRAMS could not find the configured source workspace.",
        sourceUpdatedAt: null,
        candidateAppPath: null,
        candidateUpdatedAt: null,
      };
    }

    const packageJsonPath = join(workspacePath, "package.json");
    const builderConfigPath = join(workspacePath, "electron-builder.yml");
    const workspaceValid = (await pathExists(packageJsonPath)) && (await pathExists(builderConfigPath));
    const candidateAppPath = await this.resolveCandidateAppPath(workspacePath);
    const candidateUpdatedAt = candidateAppPath ? await this.readModifiedAt(candidateAppPath) : null;

    if (!workspaceValid) {
      return {
        workspacePath,
        workspaceExists,
        workspaceValid: false,
        workspaceError: "The configured source workspace is missing package.json or electron-builder.yml.",
        sourceUpdatedAt: null,
        candidateAppPath,
        candidateUpdatedAt,
      };
    }

    return {
      workspacePath,
      workspaceExists,
      workspaceValid: true,
      workspaceError: null,
      sourceUpdatedAt: await this.readLatestSourceModifiedAt(workspacePath),
      candidateAppPath,
      candidateUpdatedAt,
    };
  }

  private async readLatestSourceModifiedAt(workspacePath: string): Promise<string | null> {
    let latest = 0;

    for (const relativePath of APP_UPDATE_SOURCE_FILES) {
      const absolutePath = join(workspacePath, relativePath);
      const modifiedAt = await this.readModifiedAt(absolutePath);
      if (!modifiedAt) {
        continue;
      }

      latest = Math.max(latest, new Date(modifiedAt).getTime());
    }

    for (const relativePath of APP_UPDATE_SOURCE_ROOTS) {
      latest = Math.max(latest, await this.readLatestDirectoryModifiedAt(join(workspacePath, relativePath)));
    }

    return latest > 0 ? new Date(latest).toISOString() : null;
  }

  private async readLatestDirectoryModifiedAt(path: string): Promise<number> {
    if (!(await pathExists(path))) {
      return 0;
    }

    let latest = 0;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        latest = Math.max(latest, await this.readLatestDirectoryModifiedAt(entryPath));
        continue;
      }

      const modifiedAt = await this.readModifiedAt(entryPath);
      if (!modifiedAt) {
        continue;
      }

      latest = Math.max(latest, new Date(modifiedAt).getTime());
    }

    return latest;
  }

  private describeAppUpdateStatus({
    supported,
    currentAppPath,
    workspace,
    sourceIsNewer,
    buildState,
    action,
    requiresAdminPrompt,
    buildError,
  }: {
    supported: boolean;
    currentAppPath: string | null;
    workspace: AppUpdateWorkspaceInfo;
    sourceIsNewer: boolean;
    buildState: AppUpdateStatus["buildState"];
    action: AppUpdateStatus["action"];
    requiresAdminPrompt: boolean;
    buildError: string | null;
  }): string {
    if (!supported) {
      return "App updates are only available from the packaged macOS app.";
    }
    if (!currentAppPath) {
      return "PROGRAMS could not determine the running app bundle path.";
    }
    if (buildState === "installing") {
      return "Installing the latest PROGRAMS app build.";
    }
    if (buildState === "packaging") {
      return "PROGRAMS is packaging the latest macOS app in the background.";
    }
    if (buildState === "failed") {
      return buildError || "PROGRAMS could not prepare the latest app build.";
    }
    if (!workspace.workspacePath) {
      return workspace.workspaceError || "Choose the PROGRAMS source workspace in Settings to enable in-app updates.";
    }
    if (!workspace.workspaceExists || !workspace.workspaceValid) {
      return workspace.workspaceError || "PROGRAMS could not inspect the configured source workspace.";
    }
    if (action === "restart") {
      return "A newer build is ready. Restart PROGRAMS to load it.";
    }
    if (action === "install") {
      return requiresAdminPrompt
        ? "A newer build is ready. PROGRAMS will ask macOS for permission to replace the installed app."
        : "A newer build is ready to install.";
    }
    if (sourceIsNewer) {
      return "PROGRAMS needs to package a fresh macOS app build from the latest source changes.";
    }
    if (workspace.candidateUpdatedAt) {
      return "The installed app already matches the latest packaged build.";
    }
    return "PROGRAMS has not packaged a macOS app bundle from this workspace yet.";
  }

  private candidateMatchesLatestSource(
    workspaceValid: boolean,
    sourceUpdatedAt: string | null,
    candidateUpdatedAt: string | null,
  ): boolean {
    if (!candidateUpdatedAt) {
      return false;
    }
    if (!workspaceValid || !sourceUpdatedAt) {
      return true;
    }
    return !this.isTimestampNewer(sourceUpdatedAt, candidateUpdatedAt);
  }

  private buildAppUpdatePackageKey(workspacePath: string, sourceUpdatedAt: string): string {
    return `${workspacePath}::${sourceUpdatedAt}`;
  }

  private buildAppUpdateStatusKey(scope: string | null, timestamp: string | null): string | null {
    if (!scope) {
      return null;
    }

    return `${scope}::${timestamp ?? "unknown"}`;
  }

  private isTimestampNewer(left: string, right: string): boolean {
    return new Date(left).getTime() > new Date(right).getTime() + APP_UPDATE_FRESHNESS_WINDOW_MS;
  }

  private async canReplaceInstalledApp(appPath: string): Promise<boolean> {
    try {
      await access(dirname(appPath), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async startAppRelaunch(appPath: string): Promise<void> {
    const scriptPath = await this.createAppUpdateScript(
      "relaunch-app.sh",
      [
        "#!/bin/zsh",
        "sleep 1",
        `/usr/bin/open '${this.escapeShellPath(appPath)}'`,
      ],
    );
    this.launchDetachedScript(scriptPath);
  }

  private async startWritableAppSwap(currentAppPath: string, candidateAppPath: string): Promise<void> {
    const escapedCurrent = this.escapeShellPath(currentAppPath);
    const escapedCandidate = this.escapeShellPath(candidateAppPath);
    const escapedNext = this.escapeShellPath(`${currentAppPath}.next`);
    const escapedBackup = this.escapeShellPath(`${currentAppPath}.previous`);
    const scriptPath = await this.createAppUpdateScript(
      "install-update.sh",
      [
        "#!/bin/zsh",
        "set -e",
        "sleep 1",
        `/bin/rm -rf '${escapedNext}'`,
        `/usr/bin/ditto '${escapedCandidate}' '${escapedNext}'`,
        `/bin/rm -rf '${escapedBackup}'`,
        `/bin/mv '${escapedCurrent}' '${escapedBackup}'`,
        `/bin/mv '${escapedNext}' '${escapedCurrent}'`,
        `/usr/bin/open '${escapedCurrent}'`,
        `/bin/rm -rf '${escapedBackup}'`,
      ],
    );
    this.launchDetachedScript(scriptPath);
  }

  private async startPrivilegedAppSwap(currentAppPath: string, candidateAppPath: string): Promise<void> {
    const escapedCurrent = this.escapeShellPath(currentAppPath);
    const escapedCandidate = this.escapeShellPath(candidateAppPath);
    const escapedNext = this.escapeShellPath(`${currentAppPath}.next`);
    const escapedBackup = this.escapeShellPath(`${currentAppPath}.previous`);
    const installScript = await this.createAppUpdateScript(
      "install-update-admin.sh",
      [
        "#!/bin/zsh",
        "set -e",
        "sleep 1",
        `/bin/rm -rf '${escapedNext}'`,
        `/usr/bin/ditto '${escapedCandidate}' '${escapedNext}'`,
        `/bin/rm -rf '${escapedBackup}'`,
        `/bin/mv '${escapedCurrent}' '${escapedBackup}'`,
        `/bin/mv '${escapedNext}' '${escapedCurrent}'`,
        `/bin/rm -rf '${escapedBackup}'`,
      ],
    );
    const relaunchScript = await this.createAppUpdateScript(
      "relaunch-after-install.sh",
      [
        "#!/bin/zsh",
        "sleep 3",
        `/usr/bin/open '${escapedCurrent}'`,
      ],
    );

    await this.launchPrivilegedDetachedScript(installScript);
    this.launchDetachedScript(relaunchScript);
  }

  private async createAppUpdateScript(name: string, lines: string[]): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "programs-update-"));
    const scriptPath = join(tempDir, name);
    await writeTextFile(scriptPath, `${lines.join("\n")}\n/bin/rm -f '${this.escapeShellPath(scriptPath)}'\n`);
    return scriptPath;
  }

  private launchDetachedScript(scriptPath: string): void {
    const child = spawn("/bin/zsh", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  private async launchPrivilegedDetachedScript(scriptPath: string): Promise<void> {
    const shellCommand = `/bin/zsh '${this.escapeShellPath(scriptPath)}' >/dev/null 2>&1 &`;
    const result = await execCommand(
      `/usr/bin/osascript -e "${this.escapeAppleScriptString(
        `do shell script "${shellCommand}" with administrator privileges`,
      )}"`,
      app.getPath("home"),
    );

    if (result.code !== 0) {
      const details = `${result.stderr}\n${result.stdout}`.trim();
      throw new Error(details || "macOS did not approve the app replacement.");
    }
  }

  private currentAppBundlePath(): string | null {
    if (!app.isPackaged) {
      return null;
    }

    const macosDirectory = dirname(process.execPath);
    const contentsDirectory = dirname(macosDirectory);
    const appBundlePath = dirname(contentsDirectory);
    return appBundlePath.endsWith(".app") ? appBundlePath : null;
  }

  private async resolveCandidateAppPath(workspaceRoot: string): Promise<string | null> {
    const candidates = [
      join(workspaceRoot, "dist", "mac-arm64", "PROGRAMS.app"),
      join(workspaceRoot, "dist", "mac", "PROGRAMS.app"),
    ];
    let latestPath: string | null = null;
    let latestTimestamp = 0;

    for (const candidate of candidates) {
      const modifiedAt = await this.readModifiedAt(candidate);
      if (!modifiedAt) {
        continue;
      }

      const timestamp = new Date(modifiedAt).getTime();
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestPath = candidate;
      }
    }

    return latestPath;
  }

  private async readModifiedAt(path: string): Promise<string | null> {
    try {
      const details = await stat(path);
      return details.mtime.toISOString();
    } catch {
      return null;
    }
  }

  private escapeShellPath(value: string): string {
    return value.replace(/'/g, `'\\''`);
  }

  private escapeAppleScriptString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private formatAppUpdateInstallError(error: unknown, candidateAppPath: string | null): string {
    const baseMessage =
      error instanceof Error ? error.message : "PROGRAMS could not install the latest app build.";
    if (!candidateAppPath) {
      return baseMessage;
    }

    return `${baseMessage} Built app: ${candidateAppPath}`;
  }

  private githubConfigurationMessage(): string {
    return app.isPackaged
      ? "GitHub sign-in is not bundled in this build of PROGRAMS."
      : "GitHub sign-in is not configured for this development build yet. Add a GitHub client ID override in Developer settings or bundle GITHUB_CLIENT_ID.";
  }

  private async updateProjectStatus(
    project: Project,
    status: Project["status"],
    lastError: string | null = null,
  ): Promise<Project> {
    project.status = status;
    project.lastError = lastError;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }
}
