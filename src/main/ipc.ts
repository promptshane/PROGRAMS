import { relative } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import { isSubPath } from "@main/utils/fs";
import { collectSystemHealth } from "@main/services/system-health-service";
import type { ProgramsBackend } from "@main/backend";
import type {
  ConfirmAutomationFailureRecoveryInput,
  ApprovePlanInput,
  ApprovePendingApprovalInput,
  ConfirmAgentDataInput,
  ConfirmHomeDeliveriesInput,
  HomeChatInput,
  DirectorChatInput,
  DirectorFocusMode,
  DirectorId,
  AgentChatInput,
  DeleteAgentMessagesInput,
  DirectorSettingsOverride,
  DirectoryPickMode,
  GenerateProjectOutlineReportInput,
  ListAutomationTargetsInput,
  ListPendingApprovalsInput,
  PauseAutomationRunInput,
  GithubPublishInput,
  ProjectAttachInput,
  ProjectCreateInput,
  RequestAutomationFailureRecoveryInput,
  RenameProjectInput,
  RevisePendingApprovalInput,
  ResolveDroppedContextPathsInput,
  RouteUpdateToProgrammingInput,
  ProjectChatInput,
  RunValidationInput,
  SetValidationFrequencyInput,
  SettingsUpdateInput,
  StartAutomationRunInput,
  StartPingDirectUpdateInput,
  StartPlanInput,
  StopAutomationRunInput,
  UpdatePendingApprovalStatusInput,
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
  ipcMain.handle("settings.read", () => backend.readSettings());
  ipcMain.handle("settings.update", (_event, input: SettingsUpdateInput) => backend.updateSettings(input));

  ipcMain.handle("auth.codex.status", () => backend.getCodexStatus());
  ipcMain.handle("auth.codex.login", () => backend.loginCodex());
  ipcMain.handle("auth.codex.logout", () => backend.logoutCodex());

  ipcMain.handle("auth.claude.status", () => backend.getClaudeStatus());
  ipcMain.handle("auth.claude.login", () => backend.loginClaude());
  ipcMain.handle("auth.claude.logout", () => backend.logoutClaude());
  ipcMain.handle("auth.claude.test", () => backend.testClaudeConnection());
  ipcMain.handle("auth.claude.submitLoginCode", (_event, code: string) => backend.submitClaudeLoginCode(code));

  ipcMain.handle("auth.github.status", () => backend.getGithubStatus());
  ipcMain.handle("auth.github.login", () => backend.loginGithub());
  ipcMain.handle("auth.github.logout", () => backend.logoutGithub());

  ipcMain.handle("projects.github.publish", (_event, input: GithubPublishInput) => backend.publishProjectToGithub(input));
  ipcMain.handle("projects.github.push", (_event, input: { projectId: string }) => backend.pushProjectToGithub(input));
  ipcMain.handle("projects.github.diffStats", (_event, projectId: string) => backend.readProjectGithubDiffStats(projectId));
  ipcMain.handle("projects.github.detectRemote", (_event, projectId: string) => backend.detectAndSyncGithubRemote(projectId));
  ipcMain.handle("projects.github.save", (_event, projectId: string) => backend.saveToGithub(projectId));
  ipcMain.handle("projects.github.download", (_event, projectId: string) => backend.downloadFromGithub(projectId));
  ipcMain.handle("usage.read", () => backend.readUsage());
  ipcMain.handle("automation.basic.status", () => backend.readBasicAutomationStatus());

  ipcMain.handle("projects.list", () => backend.listProjects());
  ipcMain.handle("projects.read", (_event, projectId: string) => backend.readProject(projectId));
  ipcMain.handle("projects.refreshDetails", (_event, projectId: string) => backend.refreshProjectDetails(projectId));
  ipcMain.handle("projects.refreshRelationships", () => backend.refreshProjectRelationships());
  ipcMain.handle("projects.create", (_event, input: ProjectCreateInput) => backend.createProject(input));
  ipcMain.handle("projects.attach", (_event, input: ProjectAttachInput) => backend.attachProject(input));
  ipcMain.handle("projects.inspectAttachPath", (_event, localPath: string) => backend.inspectAttachPath(localPath));
  ipcMain.handle("projects.rename", (_event, input: RenameProjectInput) => backend.renameProject(input));
  ipcMain.handle("projects.update", (_event, input: UpdateProjectInput) => backend.updateProject(input));
  ipcMain.handle("projects.unlink", (_event, projectId: string) => backend.unlinkProject(projectId));
  ipcMain.handle("projects.readHistory", (_event, projectId: string) => backend.readHistory(projectId));
  ipcMain.handle("projects.previewCommit", (_event, projectId: string, commitSha: string) =>
    backend.previewCommit(projectId, commitSha));
  ipcMain.handle("projects.restoreFromPreview", (_event, projectId: string) =>
    backend.restoreFromPreview(projectId));
  ipcMain.handle("projects.readOutlineReport", (_event, projectId: string) => backend.readOutlineReport(projectId));
  ipcMain.handle("projects.generateOutlineReport", (_event, input: GenerateProjectOutlineReportInput) =>
    backend.generateOutlineReport(input));
  ipcMain.handle("projects.safetyState", (_event, projectId: string) => backend.readProjectSafetyState(projectId));
  ipcMain.handle("projects.backups.latest", (_event, projectId: string) => backend.readLastProjectBackup(projectId));
  ipcMain.handle("projects.backups.restoreLast", (_event, projectId: string) => backend.restoreLastProjectBackup(projectId));
  ipcMain.handle("projects.readEnvFile", (_event, projectId: string) => backend.readEnvFile(projectId));
  ipcMain.handle("projects.writeEnvFile", (_event, input: WriteProjectEnvFileInput) => backend.writeEnvFile(input));
  ipcMain.handle("projects.run", (_event, projectId: string) => backend.runProject(projectId));
  ipcMain.handle("projects.prepareLaunchRepair", (_event, projectId: string) =>
    backend.prepareLaunchRepair(projectId));
  ipcMain.handle("projects.setRunCommand", (_event, projectId: string, runCommand: string) =>
    backend.setRunCommand(projectId, runCommand));
  ipcMain.handle("projects.getRunCommandSuggestions", (_event, projectId: string) =>
    backend.getRunCommandSuggestions(projectId));
  ipcMain.handle("projects.suggestRunCommand", (_event, projectId: string) =>
    backend.suggestRunCommand(projectId));
  ipcMain.handle("projects.kill", (_event, projectId: string) => backend.killProject(projectId));
  ipcMain.handle("projects.restart", (_event, projectId: string) => backend.restartProject(projectId));
  ipcMain.handle("projects.open", (_event, projectId: string) => backend.openProject(projectId));

  ipcMain.handle("updates.startPlan", (_event, input: StartPlanInput) => backend.startPlan(input));
  ipcMain.handle("updates.revisePlan", (_event, input: StartPlanInput) => backend.revisePlan(input));
  ipcMain.handle("updates.cancelPlan", (_event, projectId: string) => backend.cancelPlan(projectId));
  ipcMain.handle("updates.approvePlan", (_event, input: ApprovePlanInput) => backend.approvePlan(input));
  ipcMain.handle("projectChat.start", (_event, input: ProjectChatInput) => backend.startProjectChat(input));
  ipcMain.handle("projectChat.cancel", (_event, projectId: string) => backend.cancelProjectChat(projectId));
  ipcMain.handle("updates.undoUpdate", (_event, projectId: string, updateId: string) =>
    backend.undoUpdate(projectId, updateId),
  );

  ipcMain.handle("agents.getSession", (_event, projectId: string) =>
    backend.getAgentSession(projectId));

  // Homepage agent (cross-project concierge)
  ipcMain.handle("home.session", () => backend.getHomeSession());
  ipcMain.handle("home.chat", (_event, input: HomeChatInput) => backend.homeChat(input));
  ipcMain.handle("home.confirm", (_event, input: ConfirmHomeDeliveriesInput) =>
    backend.confirmHomeDeliveries(input));

  // Director system
  ipcMain.handle("directors.chat", (_event, input: DirectorChatInput) =>
    backend.directorChat(input));
  ipcMain.handle("directors.ping.start", (_event, input: StartPingDirectUpdateInput) =>
    backend.startPingDirectUpdate(input));
  ipcMain.handle("agents.chat", (_event, input: AgentChatInput) =>
    backend.agentChat(input));
  ipcMain.handle("agents.stopWorkingMessages", (_event, projectId: string) =>
    backend.finalizeWorkingAgentMessages(projectId));
  ipcMain.handle("approvals.list", (_event, input: ListPendingApprovalsInput) =>
    backend.listPendingApprovals(input));
  ipcMain.handle("approvals.approve", (_event, input: ApprovePendingApprovalInput) =>
    backend.approvePendingApproval(input));
  ipcMain.handle("approvals.revise", (_event, input: RevisePendingApprovalInput) =>
    backend.revisePendingApproval(input));
  ipcMain.handle("approvals.defer", (_event, input: UpdatePendingApprovalStatusInput) =>
    backend.deferPendingApproval(input));
  ipcMain.handle("approvals.dismiss", (_event, input: UpdatePendingApprovalStatusInput) =>
    backend.dismissPendingApproval(input));
  ipcMain.handle("agents.deleteMessages", (_event, input: DeleteAgentMessagesInput) =>
    backend.deleteAgentMessages(input));
  ipcMain.handle("agents.clearMessages", (_event, projectId: string) =>
    backend.clearAgentMessages(projectId));
  ipcMain.handle("agents.refreshProject", (_event, input: import("@shared/types").RefreshProjectInput) =>
    backend.refreshProject(input));
  ipcMain.handle("slack.refreshProject", (_event, input: import("@shared/types").RefreshProjectInput) =>
    backend.refreshProject(input));
  ipcMain.handle("agents.regenerateToddPlan", (_event, input: import("@shared/types").RegenerateToddPlanInput) =>
    backend.regenerateToddPlan(input));
  ipcMain.handle("automation.targets", (_event, input: ListAutomationTargetsInput) =>
    backend.listAutomationTargets(input));
  ipcMain.handle("automation.start", (_event, input: StartAutomationRunInput) =>
    backend.startAutomationRun(input));
  ipcMain.handle("automation.pause", (_event, input: PauseAutomationRunInput) =>
    backend.pauseAutomationRun(input));
  ipcMain.handle("automation.resume", (_event, projectId: string) =>
    backend.resumeAutomationRun(projectId));
  ipcMain.handle("automation.stop", (_event, input: StopAutomationRunInput) =>
    backend.stopAutomationRun(input));
  ipcMain.handle("automation.recovery.request", (_event, input: RequestAutomationFailureRecoveryInput) =>
    backend.requestAutomationFailureRecovery(input));
  ipcMain.handle("automation.recovery.confirm", (_event, input: ConfirmAutomationFailureRecoveryInput) =>
    backend.confirmAutomationFailureRecovery(input));
  ipcMain.handle("directors.setFocusMode", (_event, projectId: string, directorId: DirectorId, focusMode: DirectorFocusMode) =>
    backend.setDirectorFocusMode(projectId, directorId, focusMode));
  ipcMain.handle("directors.updateSettings", (_event, projectId: string, directorId: DirectorId, overrides: DirectorSettingsOverride) =>
    backend.updateDirectorSettings(projectId, directorId, overrides));
  ipcMain.handle("directors.updateState", (_event, projectId: string, directorId: DirectorId, state: Partial<import("@shared/types").DirectorStateSnapshot>) =>
    backend.updateDirectorState(projectId, directorId, state));
  ipcMain.handle("projects.deriveCategory", (_event, projectId: string) =>
    backend.deriveProjectCategory(projectId));
  ipcMain.handle("agents.confirmData", (_event, input: ConfirmAgentDataInput) =>
    backend.confirmAgentData(input));
  ipcMain.handle("agents.routeUpdate", (_event, input: RouteUpdateToProgrammingInput) =>
    backend.routeUpdateToProgramming(input));
  ipcMain.handle("agents.runValidation", (_event, input: RunValidationInput) =>
    backend.runValidation(input));
  ipcMain.handle("agents.setValidationFrequency", (_event, input: SetValidationFrequencyInput) =>
    backend.setValidationFrequency(input));
  ipcMain.handle("jeff.recordOutcome", (_event, input: { projectId: string; reportId: string; decision: string; summary: string }) =>
    backend.recordJeffOutcome(input as { projectId: string; reportId: string; decision: import("@shared/types").JeffOutcomeDecision; summary: string }));
  ipcMain.handle("pong.assignValidation", (_event, input: { projectId: string; instruction: string; updateId?: string | null }) =>
    backend.assignPongValidation(input));

  ipcMain.handle("projects.diffStats", (_event, projectId: string) => backend.readProjectDiffStats(projectId));


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

  ipcMain.handle("system.resolveDroppedContextPaths", async (_event, input: ResolveDroppedContextPathsInput) => {
    const detail = await backend.readProject(input.projectId);
    const projectRoot = detail.project.localPath;
    let rejectedCount = 0;
    const paths = Array.from(
      new Set(
        input.paths.flatMap((path) => {
          if (!path || !isSubPath(projectRoot, path)) {
            rejectedCount += 1;
            return [];
          }

          return [relative(projectRoot, path) || "."];
        }),
      ),
    ).sort();

    return {
      paths,
      rejectedCount,
    };
  });

  ipcMain.handle("system.openExternal", (_event, target: string) => shell.openExternal(target));
  ipcMain.handle("system.health", () => collectSystemHealth());
};
