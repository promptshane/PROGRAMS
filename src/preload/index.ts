import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppUpdateStatus,
  AppEvent,
  ApprovePlanInput,
  AttachPathInspection,
  BootstrapPayload,
  ContextPathPickResult,
  DroppedContextPathResult,
  DirectoryPickMode,
  DirectoryPickResult,
  EnvFileSnapshot,
  GenerateFlowchartInput,
  GenerateFlowchartResult,
  GenerateProjectOutlineReportInput,
  PendingPlannedUpdate,
  PlanningChatInput,
  PlanningChatResponse,
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

  getGitHubStatus: () => ipcRenderer.invoke("auth.github.status"),
  inspectAttachPath: (localPath: string): Promise<AttachPathInspection> =>
    ipcRenderer.invoke("auth.github.inspectAttachPath", localPath),
  loginGitHub: () => ipcRenderer.invoke("auth.github.login"),
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
