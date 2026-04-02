import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentSession,
  ClaudeConnectionTestResult,
  ConfirmAgentDataInput,
  DirectorChatInput,
  DirectorChatResponse,
  DirectorFocusMode,
  DirectorId,
  AgentChatInput,
  AgentChatResponse,
  PendingApproval,
  ApprovePendingApprovalInput,
  RevisePendingApprovalInput,
  UpdatePendingApprovalStatusInput,
  DeleteAgentMessagesInput,
  DirectorSettingsOverride,
  ProjectCategory,
  RouteUpdateToProgrammingInput,
  RunValidationInput,
  SetValidationFrequencyInput,
  ValidationResult,
  AppUpdateStatus,
  ConfirmAutomationFailureRecoveryInput,
  AppEvent,
  ApprovePlanInput,
  ListAutomationTargetsInput,
  ListAutomationTargetsResponse,
  AttachPathInspection,
  BootstrapPayload,
  ContextPathPickResult,
  DiffStats,
  ListPendingApprovalsInput,
  DroppedContextPathResult,
  DirectoryPickMode,
  DirectoryPickResult,
  EnvFileSnapshot,
  GenerateProjectOutlineReportInput,
  Project,
  ProjectAttachInput,
  ProjectCreateInput,
  ProjectDetail,
  ProjectOutlineReport,
  RenameProjectInput,
  ResolveDroppedContextPathsInput,
  Settings,
  SettingsUpdateInput,
  SetupSnapshot,
  StartAutomationRunInput,
  StartPingDirectUpdateInput,
  PauseAutomationRunInput,
  StopAutomationRunInput,
  RequestAutomationFailureRecoveryInput,
  StartPlanInput,
  UpdateProjectInput,
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

  inspectAttachPath: (localPath: string): Promise<AttachPathInspection> =>
    ipcRenderer.invoke("projects.inspectAttachPath", localPath),
  readUsage: (): Promise<UsageSnapshot> => ipcRenderer.invoke("usage.read"),

  readAppUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("appUpdate.read"),
  installAppUpdate: (): Promise<{ started: true }> => ipcRenderer.invoke("appUpdate.install"),

  listProjects: () => ipcRenderer.invoke("projects.list"),
  readProject: (projectId: string): Promise<ProjectDetail> => ipcRenderer.invoke("projects.read", projectId),
  createProject: (input: ProjectCreateInput) => ipcRenderer.invoke("projects.create", input),
  attachProject: (input: ProjectAttachInput) => ipcRenderer.invoke("projects.attach", input),
  renameProject: (input: RenameProjectInput) => ipcRenderer.invoke("projects.rename", input),
  updateProject: (input: UpdateProjectInput) => ipcRenderer.invoke("projects.update", input),
  unlinkProject: (projectId: string) => ipcRenderer.invoke("projects.unlink", projectId),
  readHistory: (projectId: string) => ipcRenderer.invoke("projects.readHistory", projectId),
  readOutlineReport: (projectId: string): Promise<ProjectOutlineReport | null> =>
    ipcRenderer.invoke("projects.readOutlineReport", projectId),
  generateOutlineReport: (input: GenerateProjectOutlineReportInput): Promise<ProjectOutlineReport | null> =>
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

  getAgentSession: (projectId: string): Promise<AgentSession | null> =>
    ipcRenderer.invoke("agents.getSession", projectId),

  // Director system
  directorChat: (input: DirectorChatInput): Promise<DirectorChatResponse> =>
    ipcRenderer.invoke("directors.chat", input),
  startPingDirectUpdate: (input: StartPingDirectUpdateInput): Promise<{ started: true }> =>
    ipcRenderer.invoke("directors.ping.start", input),
  agentChat: (input: AgentChatInput): Promise<AgentChatResponse> =>
    ipcRenderer.invoke("agents.chat", input),
  slackChat: (input: AgentChatInput): Promise<AgentChatResponse> =>
    ipcRenderer.invoke("slack.chat", input),
  listPendingApprovals: (input: ListPendingApprovalsInput): Promise<PendingApproval[]> =>
    ipcRenderer.invoke("approvals.list", input),
  approvePendingApproval: (input: ApprovePendingApprovalInput): Promise<AgentSession> =>
    ipcRenderer.invoke("approvals.approve", input),
  revisePendingApproval: (input: RevisePendingApprovalInput): Promise<AgentSession> =>
    ipcRenderer.invoke("approvals.revise", input),
  deferPendingApproval: (input: UpdatePendingApprovalStatusInput): Promise<AgentSession> =>
    ipcRenderer.invoke("approvals.defer", input),
  dismissPendingApproval: (input: UpdatePendingApprovalStatusInput): Promise<AgentSession> =>
    ipcRenderer.invoke("approvals.dismiss", input),
  deleteAgentMessages: (input: DeleteAgentMessagesInput): Promise<void> =>
    ipcRenderer.invoke("agents.deleteMessages", input),
  deleteSlackMessages: (input: DeleteAgentMessagesInput): Promise<void> =>
    ipcRenderer.invoke("slack.deleteMessages", input),
  clearAgentMessages: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("agents.clearMessages", projectId),
  clearSlackMessages: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("slack.clearAll", projectId),
  refreshAgentProject: (input: import("@shared/types").RefreshProjectInput): Promise<void> =>
    ipcRenderer.invoke("agents.refreshProject", input),
  refreshProject: (input: import("@shared/types").RefreshProjectInput): Promise<void> =>
    ipcRenderer.invoke("slack.refreshProject", input),
  listAutomationTargets: (input: ListAutomationTargetsInput): Promise<ListAutomationTargetsResponse> =>
    ipcRenderer.invoke("automation.targets", input),
  startAutomationRun: (input: StartAutomationRunInput): Promise<AgentSession> =>
    ipcRenderer.invoke("automation.start", input),
  pauseAutomationRun: (input: PauseAutomationRunInput): Promise<AgentSession> =>
    ipcRenderer.invoke("automation.pause", input),
  resumeAutomationRun: (projectId: string): Promise<AgentSession> =>
    ipcRenderer.invoke("automation.resume", projectId),
  stopAutomationRun: (input: StopAutomationRunInput): Promise<AgentSession> =>
    ipcRenderer.invoke("automation.stop", input),
  requestAutomationFailureRecovery: (input: RequestAutomationFailureRecoveryInput): Promise<AgentSession> =>
    ipcRenderer.invoke("automation.recovery.request", input),
  confirmAutomationFailureRecovery: (input: ConfirmAutomationFailureRecoveryInput): Promise<AgentSession> =>
    ipcRenderer.invoke("automation.recovery.confirm", input),
  setDirectorFocusMode: (projectId: string, directorId: DirectorId, focusMode: DirectorFocusMode): Promise<AgentSession> =>
    ipcRenderer.invoke("directors.setFocusMode", projectId, directorId, focusMode),
  updateDirectorSettings: (projectId: string, directorId: DirectorId, overrides: DirectorSettingsOverride): Promise<AgentSession> =>
    ipcRenderer.invoke("directors.updateSettings", projectId, directorId, overrides),
  updateDirectorState: (projectId: string, directorId: DirectorId, state: Partial<import("@shared/types").DirectorStateSnapshot>): Promise<AgentSession> =>
    ipcRenderer.invoke("directors.updateState", projectId, directorId, state),
  deriveProjectCategory: (projectId: string): Promise<ProjectCategory> =>
    ipcRenderer.invoke("projects.deriveCategory", projectId),

  confirmAgentData: (input: ConfirmAgentDataInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.confirmData", input),
  routeUpdateToProgramming: (input: RouteUpdateToProgrammingInput): Promise<{ started: true }> =>
    ipcRenderer.invoke("agents.routeUpdate", input),
  runValidation: (input: RunValidationInput): Promise<ValidationResult | null> =>
    ipcRenderer.invoke("agents.runValidation", input),
  setValidationFrequency: (input: SetValidationFrequencyInput): Promise<AgentSession> =>
    ipcRenderer.invoke("agents.setValidationFrequency", input),
  recordJeffOutcome: (input: { projectId: string; reportId: string; decision: string; summary: string }): Promise<void> =>
    ipcRenderer.invoke("jeff.recordOutcome", input),
  assignPongValidation: (input: { projectId: string; instruction: string; updateId?: string | null }): Promise<void> =>
    ipcRenderer.invoke("pong.assignValidation", input),
  readProjectDiffStats: (projectId: string): Promise<DiffStats | null> =>
    ipcRenderer.invoke("projects.diffStats", projectId),


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
