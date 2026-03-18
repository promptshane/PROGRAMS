import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AddTodoInput,
  AgentAttachMaterialsInput,
  AgentAttachMaterialsResult,
  AgentChatInput,
  AgentChatResponse,
  AgentConfirmStageInput,
  AgentCoreDetails,
  AgentExecuteUpdateInput,
  AgentProcessTodosInput,
  AgentReorderUpdatesInput,
  AgentSession,
  AgentStage,
  AgentSubmitTodosInput,
  AgentSubmitTodosResponse,
  AgentUpdateScratchpadInput,
  AttachSkillInput,
  ConvertSkillInput,
  CoreDetailsChatInput,
  CoreDetailsChatResponse,
  ClaudeConnectionTestResult,
  AgentSuggestUpdateInput,
  AgentSuggestUpdateResponse,
  AgentApplyCoreDetailsInput,
  AttachVibeInput,
  ConfirmAgentDataInput,
  DirectorChatInput,
  DirectorChatResponse,
  DirectorFocusMode,
  DirectorId,
  SlackChatInput,
  SlackChatResponse,
  ProjectCategory,
  RemoveVibeInput,
  RouteUpdateToProgrammingInput,
  RunValidationInput,
  SetValidationFrequencyInput,
  ValidationResult,
  AppUpdateStatus,
  AppEvent,
  ApprovePlanInput,
  AttachPathInspection,
  BootstrapPayload,
  ContextPathPickResult,
  DiffStats,
  DownloadSkillInput,
  GitHubLoginPrompt,
  InstallSkillCatalogInput,
  DroppedContextPathResult,
  DirectoryPickMode,
  DirectoryPickResult,
  EnvFileSnapshot,
  GenerateFlowchartInput,
  GenerateFlowchartResult,
  GenerateProjectOutlineReportInput,
  GitSyncInput,
  GitSyncResult,
  HomeScratchpadItem,
  ListTodosInput,
  PendingPlannedUpdate,
  PlanningChatInput,
  PlanningChatResponse,
  Project,
  ProjectAttachInput,
  ProjectCreateInput,
  ProjectDetail,
  ProjectOutlineReport,
  ProjectEnableSyncInput,
  RenameProjectInput,
  ResolveDroppedContextPathsInput,
  RetrySyncInput,
  SavePlannedUpdateInput,
  Settings,
  SettingsUpdateInput,
  SetupSnapshot,
  Skill,
  PlaywrightRunInput,
  PlaywrightRunResult,
  StartPlanInput,
  UnifiedTodoItem,
  UpdateProjectInput,
  UpdateTodosInput,
  UsageSnapshot,
  WriteProjectEnvFileInput,
} from "@shared/types";

const api = {
  bootstrap: (): Promise<BootstrapPayload> => ipcRenderer.invoke("bootstrap.read"),
  readSetup: (): Promise<SetupSnapshot> => ipcRenderer.invoke("setup.read"),
  refreshSetup: (): Promise<SetupSnapshot> => ipcRenderer.invoke("setup.refresh"),
  installGit: () => ipcRenderer.invoke("setup.installGit"),
  setupCodex: () => ipcRenderer.invoke("setup.codex"),
  setupClaude: () => ipcRenderer.invoke("setup.claude"),
  dismissSetup: (): Promise<SetupSnapshot> => ipcRenderer.invoke("setup.dismiss"),
  readSettings: (): Promise<Settings> => ipcRenderer.invoke("settings.read"),
  updateSettings: (input: SettingsUpdateInput): Promise<Settings> =>
    ipcRenderer.invoke("settings.update", input),

  getCodexStatus: () => ipcRenderer.invoke("auth.codex.status"),
  loginCodex: () => ipcRenderer.invoke("auth.codex.login"),
  logoutCodex: () => ipcRenderer.invoke("auth.codex.logout"),

  getClaudeStatus: () => ipcRenderer.invoke("auth.claude.status"),
  loginClaude: () => ipcRenderer.invoke("auth.claude.login"),
  logoutClaude: () => ipcRenderer.invoke("auth.claude.logout"),
  testClaudeConnection: (): Promise<ClaudeConnectionTestResult> =>
    ipcRenderer.invoke("auth.claude.test"),
  submitClaudeLoginCode: (code: string): Promise<void> =>
    ipcRenderer.invoke("auth.claude.submitLoginCode", code),

  getGitHubStatus: () => ipcRenderer.invoke("auth.github.status"),
  inspectAttachPath: (localPath: string): Promise<AttachPathInspection> =>
    ipcRenderer.invoke("auth.github.inspectAttachPath", localPath),
  loginGitHub: (): Promise<GitHubLoginPrompt> => ipcRenderer.invoke("auth.github.login"),
  logoutGitHub: () => ipcRenderer.invoke("auth.github.logout"),
  readUsage: (): Promise<UsageSnapshot> => ipcRenderer.invoke("usage.read"),

  readAppUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("appUpdate.read"),
  installAppUpdate: (): Promise<{ started: true }> => ipcRenderer.invoke("appUpdate.install"),

  listProjects: () => ipcRenderer.invoke("projects.list"),
  readProject: (projectId: string): Promise<ProjectDetail> => ipcRenderer.invoke("projects.read", projectId),
  createProject: (input: ProjectCreateInput) => ipcRenderer.invoke("projects.create", input),
  attachProject: (input: ProjectAttachInput) => ipcRenderer.invoke("projects.attach", input),
  enableProjectSync: (input: ProjectEnableSyncInput) => ipcRenderer.invoke("projects.enableSync", input),
  renameProject: (input: RenameProjectInput) => ipcRenderer.invoke("projects.rename", input),
  updateProject: (input: UpdateProjectInput) => ipcRenderer.invoke("projects.update", input),
  unlinkProject: (projectId: string) => ipcRenderer.invoke("projects.unlink", projectId),
  readPlanView: (projectId: string): Promise<string> => ipcRenderer.invoke("projects.planView", projectId),
  readHistory: (projectId: string) => ipcRenderer.invoke("projects.readHistory", projectId),
  readOutlineReport: (projectId: string): Promise<ProjectOutlineReport | null> =>
    ipcRenderer.invoke("projects.readOutlineReport", projectId),
  generateOutlineReport: (input: GenerateProjectOutlineReportInput): Promise<ProjectOutlineReport> =>
    ipcRenderer.invoke("projects.generateOutlineReport", input),
  readEnvFile: (projectId: string): Promise<EnvFileSnapshot> => ipcRenderer.invoke("projects.readEnvFile", projectId),
  writeEnvFile: (input: WriteProjectEnvFileInput): Promise<EnvFileSnapshot> =>
    ipcRenderer.invoke("projects.writeEnvFile", input),
  runProject: (projectId: string) => ipcRenderer.invoke("projects.run", projectId),
  killProject: (projectId: string) => ipcRenderer.invoke("projects.kill", projectId),
  openProject: (projectId: string) => ipcRenderer.invoke("projects.open", projectId),

  startPlan: (input: StartPlanInput) => ipcRenderer.invoke("updates.startPlan", input),
  revisePlan: (input: StartPlanInput) => ipcRenderer.invoke("updates.revisePlan", input),
  cancelPlan: (projectId: string) => ipcRenderer.invoke("updates.cancelPlan", projectId),
  approvePlan: (input: ApprovePlanInput) => ipcRenderer.invoke("updates.approvePlan", input),
  undoUpdate: (projectId: string, updateId: string) =>
    ipcRenderer.invoke("updates.undoUpdate", projectId, updateId),
  retrySync: (input: RetrySyncInput) => ipcRenderer.invoke("updates.retrySync", input),

  generateFlowchart: (input: GenerateFlowchartInput): Promise<GenerateFlowchartResult> =>
    ipcRenderer.invoke("projects.generateFlowchart", input),
  planningChat: (input: PlanningChatInput): Promise<PlanningChatResponse> =>
    ipcRenderer.invoke("planning.chat", input),
  savePlannedUpdate: (input: SavePlannedUpdateInput): Promise<PendingPlannedUpdate> =>
    ipcRenderer.invoke("planning.saveUpdate", input),
  getPendingUpdate: (projectId: string): Promise<PendingPlannedUpdate | null> =>
    ipcRenderer.invoke("planning.getPending", projectId),
  applyPlannedUpdate: (projectId: string): Promise<{ started: true }> =>
    ipcRenderer.invoke("planning.applyUpdate", projectId),

  getAgentSession: (projectId: string): Promise<AgentSession | null> =>
    ipcRenderer.invoke("agents.getSession", projectId),
  agentChat: (input: AgentChatInput): Promise<AgentChatResponse> =>
    ipcRenderer.invoke("agents.chat", input),
  agentConfirmStage: (input: AgentConfirmStageInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.confirmStage", input),
  agentUpdateScratchpad: (input: AgentUpdateScratchpadInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.updateScratchpad", input),
  agentSubmitTodos: (input: AgentSubmitTodosInput): Promise<AgentSubmitTodosResponse> =>
    ipcRenderer.invoke("agents.submitTodos", input),
  agentReorderUpdates: (input: AgentReorderUpdatesInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.reorderUpdates", input),
  agentExecuteUpdate: (input: AgentExecuteUpdateInput): Promise<{ started: true }> =>
    ipcRenderer.invoke("agents.executeUpdate", input),
  agentResetStage: (projectId: string, stage: AgentStage): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.resetStage", projectId, stage),
  deleteAgentSession: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("agents.deleteSession", projectId),
  agentAttachMaterials: (input: AgentAttachMaterialsInput): Promise<AgentAttachMaterialsResult> =>
    ipcRenderer.invoke("agents.attachMaterials", input),
  agentGetCoreDetails: (projectId: string): Promise<AgentCoreDetails> =>
    ipcRenderer.invoke("agents.getCoreDetails", projectId),
  agentCoreDetailsChat: (input: CoreDetailsChatInput): Promise<CoreDetailsChatResponse> =>
    ipcRenderer.invoke("agents.coreDetailsChat", input),
  agentSuggestUpdate: (input: AgentSuggestUpdateInput): Promise<AgentSuggestUpdateResponse> =>
    ipcRenderer.invoke("agents.suggestUpdate", input),
  agentApplyCoreDetails: (input: AgentApplyCoreDetailsInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.applyCoreDetails", input),
  agentConfirmCoreDetail: (projectId: string, field: AgentStage): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.confirmCoreDetail", projectId, field),
  agentProcessTodosFromProgram: (input: AgentProcessTodosInput): Promise<AgentSubmitTodosResponse> =>
    ipcRenderer.invoke("agents.processTodosFromProgram", input),

  // Cascade
  agentGenerateCascade: (projectId: string, triggeredByStage: string, provider: string, model: string): Promise<import("@shared/types").CascadeProposal | null> =>
    ipcRenderer.invoke("agents.generateCascade", projectId, triggeredByStage, provider, model),
  agentAcceptCascade: (input: import("@shared/types").AgentAcceptCascadeInput): Promise<import("@shared/types").AgentSession> =>
    ipcRenderer.invoke("agents.acceptCascade", input),

  // Director system
  directorChat: (input: DirectorChatInput): Promise<DirectorChatResponse> =>
    ipcRenderer.invoke("directors.chat", input),
  slackChat: (input: SlackChatInput): Promise<SlackChatResponse> =>
    ipcRenderer.invoke("slack.chat", input),
  setDirectorFocusMode: (projectId: string, directorId: DirectorId, focusMode: DirectorFocusMode): Promise<AgentSession> =>
    ipcRenderer.invoke("directors.setFocusMode", projectId, directorId, focusMode),
  deriveProjectCategory: (projectId: string): Promise<ProjectCategory> =>
    ipcRenderer.invoke("projects.deriveCategory", projectId),

  // Legacy multi-agent alias
  multiAgentChat: (input: DirectorChatInput): Promise<DirectorChatResponse> =>
    ipcRenderer.invoke("agents.multiChat", input),
  attachVibe: (input: AttachVibeInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.attachVibe", input),
  removeVibe: (input: RemoveVibeInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.removeVibe", input),
  confirmAgentData: (input: ConfirmAgentDataInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.confirmData", input),
  routeUpdateToProgramming: (input: RouteUpdateToProgrammingInput): Promise<{ started: true }> =>
    ipcRenderer.invoke("agents.routeUpdate", input),
  runValidation: (input: RunValidationInput): Promise<ValidationResult> =>
    ipcRenderer.invoke("agents.runValidation", input),
  setValidationFrequency: (input: SetValidationFrequencyInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.setValidationFrequency", input),

  // Home scratchpad (legacy)
  readHomeScratchpad: (): Promise<HomeScratchpadItem[]> =>
    ipcRenderer.invoke("home.readScratchpad"),
  updateHomeScratchpad: (input: { items: HomeScratchpadItem[] }): Promise<HomeScratchpadItem[]> =>
    ipcRenderer.invoke("home.updateScratchpad", input),

  // Unified To-dos
  listTodos: (input: ListTodosInput): Promise<UnifiedTodoItem[]> =>
    ipcRenderer.invoke("todos.list", input),
  addTodo: (input: AddTodoInput): Promise<UnifiedTodoItem> =>
    ipcRenderer.invoke("todos.add", input),
  removeTodo: (id: string): Promise<void> =>
    ipcRenderer.invoke("todos.remove", id),
  updateTodos: (input: UpdateTodosInput): Promise<UnifiedTodoItem[]> =>
    ipcRenderer.invoke("todos.update", input),
  markTodoProcessed: (id: string): Promise<void> =>
    ipcRenderer.invoke("todos.markProcessed", id),

  // Git sync
  syncProjectToGitHub: (input: GitSyncInput): Promise<GitSyncResult> =>
    ipcRenderer.invoke("projects.syncGitHub", input),
  readProjectDiffStats: (projectId: string): Promise<DiffStats | null> =>
    ipcRenderer.invoke("projects.diffStats", projectId),

  // Skills
  listSkills: (): Promise<Skill[]> =>
    ipcRenderer.invoke("skills.list"),
  downloadSkill: (input: DownloadSkillInput): Promise<Skill> =>
    ipcRenderer.invoke("skills.download", input),
  installSkillCatalogItem: (input: InstallSkillCatalogInput): Promise<Skill> =>
    ipcRenderer.invoke("skills.installCatalog", input),
  convertSkill: (input: ConvertSkillInput): Promise<Skill> =>
    ipcRenderer.invoke("skills.convert", input),
  deleteSkill: (id: string): Promise<void> =>
    ipcRenderer.invoke("skills.delete", id),
  readSkill: (id: string): Promise<Skill | null> =>
    ipcRenderer.invoke("skills.read", id),
  runPlaywrightTest: (input: PlaywrightRunInput): Promise<PlaywrightRunResult> =>
    ipcRenderer.invoke("skills.runPlaywright", input),

  // Skill attachment
  attachSkillToProject: (input: AttachSkillInput): Promise<Project> =>
    ipcRenderer.invoke("projects.attachSkill", input),

  pickMaterialFiles: (): Promise<{ canceled: boolean; paths: string[] }> =>
    ipcRenderer.invoke("system.pickMaterialFiles"),

  pickDirectory: (mode: DirectoryPickMode): Promise<DirectoryPickResult> =>
    ipcRenderer.invoke("system.pickDirectory", mode),
  pickContextPaths: (projectId: string): Promise<ContextPathPickResult> =>
    ipcRenderer.invoke("system.pickContextPaths", projectId),
  resolveDroppedFilePaths: (files: File[]): string[] =>
    files
      .map((file) => webUtils.getPathForFile(file))
      .filter((path): path is string => Boolean(path)),
  resolveDroppedContextPaths: (input: ResolveDroppedContextPathsInput): Promise<DroppedContextPathResult> =>
    ipcRenderer.invoke("system.resolveDroppedContextPaths", input),
  openExternal: (target: string): Promise<void> => ipcRenderer.invoke("system.openExternal", target),

  onEvent: (listener: (event: AppEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on("app.event", wrapped);
    return () => {
      ipcRenderer.removeListener("app.event", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("programs", api);

declare global {
  interface Window {
    programs: typeof api;
  }
}
