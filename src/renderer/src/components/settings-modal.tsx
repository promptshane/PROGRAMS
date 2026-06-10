import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  AppUpdateStatus,
  AuthSnapshot,
  ModelCatalog,
  Settings,
  SetupCheck,
  SetupSnapshot,
  StatusTone,
  Theme,
} from "@shared/types";
import { Modal, StatusChip } from "./ui-primitives";
import { formatDate } from "../lib/formatting";
import { labelForSetupStatus } from "../lib/labels";

export function SettingsModal({
  settings,
  modelCatalog,
  auth,
  setup,
  appUpdate,
  isPackagedBuild,
  busyKey,
  theme,
  onPreviewTheme,
  onBrowseAppSourcePath,
  onClose,
  onSave,
  onConnectCodex,
  onConnectClaude,
  onDisconnectCodex,
  onDisconnectClaude,
  onReconnectCodex,
  onReconnectClaude,
  onTestClaude,
  onSetupCodex,
  onSetupClaude,
  onSetupAction,
  onConnectGithub,
  onDisconnectGithub,
  claudeAuthCodePrompt,
  claudeAuthCodeInput,
  onClaudeAuthCodeChange,
  onSubmitClaudeAuthCode,
  onCancelClaudeAuthCode,
}: {
  settings: Settings;
  modelCatalog: ModelCatalog;
  auth: AuthSnapshot;
  setup: SetupSnapshot;
  appUpdate: AppUpdateStatus;
  isPackagedBuild: boolean;
  busyKey: string | null;
  theme: Theme;
  onPreviewTheme: (theme: Theme) => void;
  onBrowseAppSourcePath: () => Promise<string | null>;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onConnectCodex: () => void;
  onConnectClaude: () => void;
  onDisconnectCodex: () => void;
  onDisconnectClaude: () => void;
  onReconnectCodex: () => void;
  onReconnectClaude: () => void;
  onTestClaude: () => void;
  onSetupCodex: () => void;
  onSetupClaude: () => void;
  onSetupAction: (check: SetupCheck) => void;
  onConnectGithub: () => void;
  onDisconnectGithub: () => void;
  claudeAuthCodePrompt: string | null;
  claudeAuthCodeInput: string;
  onClaudeAuthCodeChange: (value: string) => void;
  onSubmitClaudeAuthCode: () => void;
  onCancelClaudeAuthCode: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const gitInstallCheck = setup.checks.find((check) => check.id === "gitInstall") ?? null;
  const codexTone = auth.codex.loggedIn ? "confirmed" : auth.codex.available ? "info" : "action_required";
  const githubTone: StatusTone = auth.github.loggedIn
    ? "confirmed"
    : auth.github.available && !auth.github.errorMessage
      ? "info"
      : "action_required";
  const githubDetail = auth.github.loggedIn
    ? `Connected as ${auth.github.username ?? "unknown"}. Projects can be saved to GitHub.`
    : auth.github.errorMessage
      ? `GitHub needs attention: ${auth.github.errorMessage}`
      : auth.github.available
        ? "Log in to save projects to GitHub."
        : "Install the GitHub CLI to save projects to GitHub.";
  const claudeTone: StatusTone = !auth.claude.available
    ? "action_required"
    : auth.claude.loggedIn
      ? auth.claude.ready
        ? auth.claude.canConnect
          ? "confirmed"
          : "info"
        : "action_required"
      : auth.claude.canConnect
        ? "info"
        : "action_required";
  const claudeIdentity = auth.claude.email || auth.claude.displayName || "Connected.";
  const claudeConnectedDetail = auth.claude.planType ? `${claudeIdentity} · ${auth.claude.planType}` : claudeIdentity;
  const claudeNeedsUpdateForConnect = auth.claude.loggedIn && auth.claude.ready && !auth.claude.canConnect;
  const claudeDetail = auth.claude.loggedIn
    ? auth.claude.ready
      ? claudeNeedsUpdateForConnect
        ? `${claudeConnectedDetail}. Update Claude Code to keep in-app sign-in compatible.`
        : claudeConnectedDetail
      : `${claudeConnectedDetail}. ${auth.claude.runtimeErrorMessage ?? "Claude needs attention before it can run in PROGRAMS."}`
    : auth.claude.available
      ? auth.claude.canConnect
        ? "Installed. Connect it to use Claude for updates."
        : auth.claude.connectErrorMessage ?? "Update Claude Code to connect it in PROGRAMS."
      : "Install and connect Claude Code in one step.";
  const claudeActionLabel = !auth.claude.available
    ? "Install & Connect"
    : auth.claude.loggedIn
      ? auth.claude.ready
        ? claudeNeedsUpdateForConnect
          ? "Update Claude"
          : null
        : "Repair"
      : auth.claude.canConnect
        ? "Connect"
        : "Update Claude";
  const claudeAction = !auth.claude.available || claudeNeedsUpdateForConnect || (auth.claude.loggedIn && !auth.claude.ready)
    ? onSetupClaude
    : !auth.claude.loggedIn && auth.claude.canConnect
      ? onConnectClaude
      : undefined;
  const appUpdateTone: StatusTone =
    appUpdate.buildState === "failed"
      ? "action_required"
      : appUpdate.action !== "none"
        ? "confirmed"
        : appUpdate.buildState === "packaging" || appUpdate.supported
          ? "info"
          : "neutral";
  const appUpdateLabel =
    appUpdate.buildState === "failed"
      ? "Issue"
      : appUpdate.buildState === "packaging"
        ? "Preparing"
        : appUpdate.action !== "none"
          ? "Ready"
          : appUpdate.supported
            ? "Watching"
            : "Unavailable";
  const formatRendererAssetMeta = (assetName: string | null, updatedAt: string | null): ReactNode => {
    if (!assetName) {
      return "Unavailable";
    }

    return (
      <>
        <code className="appUpdateMetaCode">{assetName}</code>
        {updatedAt ? <span className="appUpdateMetaDetail">{formatDate(updatedAt)}</span> : null}
      </>
    );
  };
  const rendererMatchLabel =
    appUpdate.rendererAssetMatch === null
      ? "Unavailable"
      : appUpdate.rendererAssetMatch
        ? "Installed app matches the packaged renderer"
        : "Installed app differs from the packaged renderer";

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <Modal title="Settings" onClose={onClose} fullscreen>
      <div className="settingsStack">
        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>Appearance</h4>
            <StatusChip tone="info">{theme === "dark" ? "Dark default" : "Light active"}</StatusChip>
          </div>
          <div className="speedToggle">
            <button
              className={draft.theme === "dark" ? "toggleOption active" : "toggleOption"}
              onClick={() => {
                setDraft({ ...draft, theme: "dark" });
                onPreviewTheme("dark");
              }}
            >
              Dark
            </button>
            <button
              className={draft.theme === "light" ? "toggleOption active" : "toggleOption"}
              onClick={() => {
                setDraft({ ...draft, theme: "light" });
                onPreviewTheme("light");
              }}
            >
              Light
            </button>
          </div>
        </section>

        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>App Updates</h4>
            <StatusChip tone={appUpdateTone}>{appUpdateLabel}</StatusChip>
          </div>

          <label>
            Source workspace
            <div className="settingsPathRow">
              <input
                value={draft.appSourcePath ?? ""}
                onChange={(event) => setDraft({ ...draft, appSourcePath: event.target.value || null })}
                placeholder="/Users/kc/Desktop/PROGRAMS"
              />
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  void onBrowseAppSourcePath().then((path) => {
                    if (!path) {
                      return;
                    }

                    setDraft((current) => ({
                      ...current,
                      appSourcePath: path,
                    }));
                  });
                }}
              >
                Browse
              </button>
            </div>
          </label>

          <p className="helperText">
            PROGRAMS watches this local checkout, packages a fresh macOS app when the source is newer, then offers one in-app update action.
          </p>

          <div className="appUpdateMetaGrid">
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Status</span>
              <p>{appUpdate.reason ?? "PROGRAMS is waiting for the next packaged build."}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Running App</span>
              <p>{appUpdate.currentAppPath ?? "Unavailable"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Workspace</span>
              <p>{appUpdate.workspacePath ?? "Not configured"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Packaged Build</span>
              <p>{appUpdate.candidateAppPath ?? "Not built yet"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Source Updated</span>
              <p>{appUpdate.sourceUpdatedAt ? formatDate(appUpdate.sourceUpdatedAt) : "Unavailable"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Launched Build</span>
              <p>{appUpdate.launchedAppUpdatedAt ? formatDate(appUpdate.launchedAppUpdatedAt) : "Unavailable"}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Installed Renderer</span>
              <p>{formatRendererAssetMeta(appUpdate.currentRendererAssetName, appUpdate.currentRendererAssetUpdatedAt)}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Packaged Renderer</span>
              <p>{formatRendererAssetMeta(appUpdate.candidateRendererAssetName, appUpdate.candidateRendererAssetUpdatedAt)}</p>
            </div>
            <div className="appUpdateMetaCard">
              <span className="fieldLabel">Renderer Match</span>
              <p>{rendererMatchLabel}</p>
            </div>
          </div>

          {appUpdate.buildError ? <div className="errorBanner">{appUpdate.buildError}</div> : null}
        </section>

        <section className="settingsSection">
          <div className="settingsSectionHead">
            <h4>Connections</h4>
          </div>
          <div className="connectionList">
            <ConnectionRow
              title="Codex"
              tone={codexTone}
              detail={
                auth.codex.loggedIn
                  ? auth.codex.email || "Connected."
                  : auth.codex.available
                    ? "Installed. Connect it to plan and apply changes."
                    : "Install and connect Codex in one step."
              }
              actionLabel={!auth.codex.available ? "Install & Connect" : !auth.codex.loggedIn ? "Connect" : null}
              onAction={!auth.codex.available ? onSetupCodex : !auth.codex.loggedIn ? onConnectCodex : undefined}
              reconnectLabel={auth.codex.loggedIn ? "Reconnect" : null}
              onReconnect={auth.codex.loggedIn ? onReconnectCodex : undefined}
              disconnectLabel={auth.codex.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.codex.loggedIn ? onDisconnectCodex : undefined}
              disabled={busyKey === "auth.codex"}
            />

            <ConnectionRow
              title="Claude"
              tone={claudeTone}
              detail={claudeDetail}
              extraActionLabel={auth.claude.loggedIn && auth.claude.ready ? "Test" : null}
              onExtraAction={auth.claude.loggedIn && auth.claude.ready ? onTestClaude : undefined}
              actionLabel={claudeActionLabel}
              onAction={claudeAction}
              reconnectLabel={auth.claude.loggedIn ? "Reconnect" : null}
              onReconnect={auth.claude.loggedIn ? onReconnectClaude : undefined}
              disconnectLabel={auth.claude.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.claude.loggedIn ? onDisconnectClaude : undefined}
              disabled={busyKey === "auth.claude" || busyKey === "auth.claude.test"}
            />
            {claudeAuthCodePrompt ? (
              <div className="claudeAuthCodePrompt">
                <p className="claudeAuthCodePromptText">Claude is asking for an authorization code from your browser.</p>
                <div className="claudeAuthCodePromptRow">
                  <input
                    className="claudeAuthCodeInput"
                    type="text"
                    placeholder="Paste auth code here"
                    value={claudeAuthCodeInput}
                    onChange={(e) => onClaudeAuthCodeChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && claudeAuthCodeInput.trim()) {
                        onSubmitClaudeAuthCode();
                      }
                    }}
                    autoFocus
                  />
                  <button
                    className="primaryButton"
                    disabled={!claudeAuthCodeInput.trim()}
                    onClick={onSubmitClaudeAuthCode}
                  >Submit Code</button>
                  <button
                    className="secondaryButton"
                    onClick={onCancelClaudeAuthCode}
                  >Cancel</button>
                </div>
              </div>
            ) : null}

            <ConnectionRow
              title="GitHub"
              tone={githubTone}
              detail={githubDetail}
              actionLabel={auth.github.loggedIn ? null : auth.github.available ? "Log In" : "Download"}
              onAction={
                auth.github.loggedIn
                  ? undefined
                  : auth.github.available
                    ? onConnectGithub
                    : () => void window.programs.openExternal("https://cli.github.com/")
              }
              disconnectLabel={auth.github.loggedIn ? "Disconnect" : null}
              onDisconnect={auth.github.loggedIn ? onDisconnectGithub : undefined}
              disabled={busyKey === "auth.github"}
            />

            <ConnectionRow
              title="Git"
              tone={gitInstallCheck?.status ?? "info"}
              detail={
                gitInstallCheck?.status === "confirmed"
                  ? gitInstallCheck.version || "Installed."
                  : "Install Git so PROGRAMS can save local update history and run projects."
              }
              actionLabel={gitInstallCheck?.status === "action_required" ? "Install" : null}
              onAction={gitInstallCheck?.status === "action_required" ? () => onSetupAction(gitInstallCheck) : undefined}
              disabled={busyKey?.startsWith("setup-") ?? false}
            />
          </div>
        </section>

      </div>

      <div className="modalActions">
        <button className="secondaryButton" onClick={onClose}>
          Cancel
        </button>
        <button className="primaryButton" onClick={() => onSave(draft)}>
          Save Settings
        </button>
      </div>
    </Modal>
  );
}

export function ConnectionRow({
  title,
  tone,
  detail,
  extraActionLabel,
  onExtraAction,
  actionLabel,
  onAction,
  disconnectLabel,
  onDisconnect,
  reconnectLabel,
  onReconnect,
  disabled = false,
}: {
  title: string;
  tone: StatusTone;
  detail: string;
  extraActionLabel?: string | null;
  onExtraAction?: () => void;
  actionLabel: string | null;
  onAction?: () => void;
  disconnectLabel?: string | null;
  onDisconnect?: () => void;
  reconnectLabel?: string | null;
  onReconnect?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="connectionRow">
      <div className="connectionCopy">
        <div className="connectionTitleRow">
          <strong>{title}</strong>
          <StatusChip tone={tone}>{labelForSetupStatus(tone)}</StatusChip>
        </div>
        <p className="helperText">{detail}</p>
      </div>
      <div className="connectionActions">
        {extraActionLabel && onExtraAction ? (
          <button className="secondaryButton" onClick={onExtraAction} disabled={disabled}>
            {extraActionLabel}
          </button>
        ) : null}
        {reconnectLabel && onReconnect ? (
          <button className="secondaryButton" onClick={onReconnect} disabled={disabled}>
            {reconnectLabel}
          </button>
        ) : null}
        {actionLabel && onAction ? (
          <button className="secondaryButton" onClick={onAction} disabled={disabled}>
            {actionLabel}
          </button>
        ) : null}
        {disconnectLabel && onDisconnect ? (
          <button className="secondaryButton dangerButton" onClick={onDisconnect} disabled={disabled}>
            {disconnectLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
