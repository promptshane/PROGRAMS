import { relative } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import { isSubPath } from "@main/utils/fs";
import type { ProgramsBackend } from "@main/backend";
import type {
  ApprovePlanInput,
  DirectoryPickMode,
  GenerateFlowchartInput,
  GenerateProjectOutlineReportInput,
  PlanningChatInput,
  ProjectAttachInput,
  ProjectCreateInput,
  ProjectEnableSyncInput,
  RenameProjectInput,
  RetrySyncInput,
  SavePlannedUpdateInput,
  SettingsUpdateInput,
  StartPlanInput,
  UpdateProjectInput,
  WriteProjectEnvFileInput,
} from "@shared/types";

export const registerIpc = (backend: ProgramsBackend): void => {
  ipcMain.handle("bootstrap.read", () => backend.bootstrap());
  ipcMain.handle("appUpdate.read", () => backend.readAppUpdateStatus());
  ipcMain.handle("appUpdate.install", () => backend.installAppUpdate());
  ipcMain.handle("setup.read", () => backend.readSetup());
  ipcMain.handle("setup.refresh", () => backend.refreshSetup());
  ipcMain.handle("setup.installGit", () => backend.installGit());
  ipcMain.handle("setup.codex", () => backend.setupCodex());
  ipcMain.handle("setup.claude", () => backend.setupClaude());
  ipcMain.handle("setup.dismiss", () => backend.dismissSetup());
  ipcMain.handle("settings.read", () => backend.readSettings());
  ipcMain.handle("settings.update", (_event, input: SettingsUpdateInput) => backend.updateSettings(input));

  ipcMain.handle("auth.codex.status", () => backend.getCodexStatus());
  ipcMain.handle("auth.codex.login", () => backend.loginCodex());
  ipcMain.handle("auth.codex.logout", () => backend.logoutCodex());

  ipcMain.handle("auth.claude.status", () => backend.getClaudeStatus());
  ipcMain.handle("auth.claude.login", () => backend.loginClaude());

  ipcMain.handle("auth.github.status", () => backend.getGitHubStatus());
  ipcMain.handle("auth.github.inspectAttachPath", (_event, localPath: string) => backend.inspectAttachPath(localPath));
  ipcMain.handle("auth.github.login", () => backend.loginGitHub());
  ipcMain.handle("auth.github.logout", () => backend.logoutGitHub());
  ipcMain.handle("usage.read", () => backend.readUsage());

  ipcMain.handle("projects.list", () => backend.listProjects());
  ipcMain.handle("projects.read", (_event, projectId: string) => backend.readProject(projectId));
  ipcMain.handle("projects.create", (_event, input: ProjectCreateInput) => backend.createProject(input));
  ipcMain.handle("projects.attach", (_event, input: ProjectAttachInput) => backend.attachProject(input));
  ipcMain.handle("projects.enableSync", (_event, input: ProjectEnableSyncInput) => backend.enableProjectSync(input));
  ipcMain.handle("projects.rename", (_event, input: RenameProjectInput) => backend.renameProject(input));
  ipcMain.handle("projects.update", (_event, input: UpdateProjectInput) => backend.updateProject(input));
  ipcMain.handle("projects.unlink", (_event, projectId: string) => backend.unlinkProject(projectId));
  ipcMain.handle("projects.planView", (_event, projectId: string) => backend.readPlanView(projectId));
  ipcMain.handle("projects.readHistory", (_event, projectId: string) => backend.readHistory(projectId));
  ipcMain.handle("projects.readOutlineReport", (_event, projectId: string) => backend.readOutlineReport(projectId));
  ipcMain.handle("projects.generateOutlineReport", (_event, input: GenerateProjectOutlineReportInput) =>
    backend.generateOutlineReport(input));
  ipcMain.handle("projects.readEnvFile", (_event, projectId: string) => backend.readEnvFile(projectId));
  ipcMain.handle("projects.writeEnvFile", (_event, input: WriteProjectEnvFileInput) => backend.writeEnvFile(input));
  ipcMain.handle("projects.run", (_event, projectId: string) => backend.runProject(projectId));
  ipcMain.handle("projects.kill", (_event, projectId: string) => backend.killProject(projectId));
  ipcMain.handle("projects.open", (_event, projectId: string) => backend.openProject(projectId));

  ipcMain.handle("updates.startPlan", (_event, input: StartPlanInput) => backend.startPlan(input));
  ipcMain.handle("updates.revisePlan", (_event, input: StartPlanInput) => backend.revisePlan(input));
  ipcMain.handle("updates.cancelPlan", (_event, projectId: string) => backend.cancelPlan(projectId));
  ipcMain.handle("updates.approvePlan", (_event, input: ApprovePlanInput) => backend.approvePlan(input));
  ipcMain.handle("updates.undoUpdate", (_event, projectId: string, updateId: string) =>
    backend.undoUpdate(projectId, updateId),
  );
  ipcMain.handle("updates.retrySync", (_event, input: RetrySyncInput) => backend.retrySync(input));

  ipcMain.handle("projects.generateFlowchart", (_event, input: GenerateFlowchartInput) =>
    backend.generateFlowchart(input));
  ipcMain.handle("planning.chat", (_event, input: PlanningChatInput) =>
    backend.planningChat(input));
  ipcMain.handle("planning.saveUpdate", (_event, input: SavePlannedUpdateInput) =>
    backend.savePlannedUpdate(input));
  ipcMain.handle("planning.getPending", (_event, projectId: string) =>
    backend.getPendingUpdate(projectId));
  ipcMain.handle("planning.applyUpdate", (_event, projectId: string) =>
    backend.applyPlannedUpdate(projectId));

  ipcMain.handle("system.pickDirectory", async (_event, mode: DirectoryPickMode = "attach") => {
    const result = await dialog.showOpenDialog({
      buttonLabel: mode === "attach" ? "Choose folder" : "Choose location",
      properties: mode === "attach" ? ["openDirectory"] : ["openDirectory", "createDirectory"],
    });

    return {
      canceled: result.canceled,
      path: result.canceled ? null : result.filePaths[0] ?? null,
    };
  });

  ipcMain.handle("system.pickContextPaths", async (_event, projectId: string) => {
    const detail = await backend.readProject(projectId);
    const projectRoot = detail.project.localPath;
    const result = await dialog.showOpenDialog({
      buttonLabel: "Add to context",
      defaultPath: projectRoot,
      properties: ["openFile", "openDirectory", "multiSelections"],
    });

    if (result.canceled) {
      return {
        canceled: true,
        paths: [],
      };
    }

    const paths = Array.from(
      new Set(
        result.filePaths
          .filter((path) => isSubPath(projectRoot, path))
          .map((path) => relative(projectRoot, path) || "."),
      ),
    ).sort();

    return {
      canceled: false,
      paths,
    };
  });

  ipcMain.handle("system.openExternal", (_event, target: string) => shell.openExternal(target));
};
