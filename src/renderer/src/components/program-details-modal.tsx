import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AgentSession,
  AuthSnapshot,
  DiffStats,
  EnvFileSnapshot,
  EnvVariableEntry,
  Project,
  ProjectOutlineReport,
  RuntimeState,
  StoredDataNode,
  UpdateRecord,
} from "@shared/types";
import { Modal, StatusChip } from "./ui-primitives";
import { CoreDetailsContent } from "./core-details";
import { ArrowDownIcon, GithubIcon } from "./icons";
import { formatDate, labelForRuntimeSource } from "../lib/formatting";

type ProgramDetailsTab = "ideal" | "current" | "planned" | "history" | "github";

export function ProgramDetailsModal({
  project,
  updates,
  agentSession,
  auth,
  busyKey,
  onClose,
  onUndo,
  onConnectGithub,
  onDisconnectGithub,
  onPublishToGithub,
  onSaveToGithub,
  onDownloadFromGithub,
}: {
  project: Project;
  updates: UpdateRecord[];
  agentSession: AgentSession | null;
  auth: AuthSnapshot;
  busyKey: string | null;
  onClose: () => void;
  onUndo: (update: UpdateRecord) => void;
  onConnectGithub: () => void;
  onDisconnectGithub: () => void;
  onPublishToGithub: (input: { projectId: string; repoName: string; isPrivate: boolean }) => void;
  onSaveToGithub: (projectId: string) => void;
  onDownloadFromGithub: (projectId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProgramDetailsTab>("ideal");
  const [githubDiffStats, setGithubDiffStats] = useState<DiffStats | null | "loading">(null);

  const savedUpdates = useMemo(
    () => [...updates].filter((u) => u.kind === "update" && (u.status === "saved" || u.status === "reverted")).reverse(),
    [updates],
  );
  const hasHistory = savedUpdates.length > 0;
  const hasPlanned = (agentSession?.plannedUpdates.length ?? 0) > 0;
  const tabAvailability: Record<ProgramDetailsTab, boolean> = {
    ideal: true,
    current: true,
    planned: hasPlanned,
    history: hasHistory,
    github: true,
  };
  const tabOptions: Array<{ id: ProgramDetailsTab; label: string }> = [
    { id: "ideal", label: "Ideal" },
    { id: "current", label: "Current" },
    { id: "planned", label: "Planned" },
    { id: "history", label: "History" },
    { id: "github", label: "GitHub" },
  ];

  useEffect(() => {
    const activeTabAvailable =
      activeTab === "history" ? hasHistory : activeTab === "planned" ? hasPlanned : true;
    if (!activeTabAvailable) {
      setActiveTab("ideal");
    }
  }, [activeTab, hasHistory, hasPlanned]);

  // When the GitHub tab opens, auto-detect remote and load diff stats
  useEffect(() => {
    if (activeTab !== "github") {
      return;
    }

    // Auto-detect an existing GitHub remote if no connection is stored
    if (!project.githubConnection) {
      void window.programs.detectAndSyncGithubRemote(project.id).catch(() => undefined);
    }

    // Load diff stats if we have a GitHub save/download baseline
    const sha = project.githubConnection?.lastPushedCommitSha ?? project.githubConnection?.lastDownloadedCommitSha;
    if (!sha) {
      setGithubDiffStats(null);
      return;
    }

    setGithubDiffStats("loading");
    void window.programs.readProjectGithubDiffStats(project.id).then((stats) => {
      setGithubDiffStats(stats);
    }).catch(() => {
      setGithubDiffStats(null);
    });
  }, [
    activeTab,
    project.id,
    project.githubConnection?.lastPushedCommitSha,
    project.githubConnection?.lastDownloadedCommitSha,
    project.githubConnection,
  ]);

  return (
    <Modal title="" onClose={onClose} fullscreen>
      <div className="detailsTabBar" role="tablist" aria-label={`${project.name} system details sections`}>
        {tabOptions.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "tabOption active" : "tabOption"}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            disabled={!tabAvailability[tab.id]}
          >
            {tab.id === "github" ? (
              <span className="tabOptionWithIcon">
                <GithubIcon />
                {tab.label}
              </span>
            ) : tab.label}
          </button>
        ))}
      </div>
      <div className="detailsScrollContent">
      {activeTab === "ideal" ? (
        <div className="detailsPanel">
          <CoreDetailsContent agentSession={agentSession} />
        </div>
      ) : null}

      {activeTab === "current" ? (
        <div className="detailsPanel">
          <div className="detailsPlaceholderGrid">
            <div className="detailsPlaceholderCard">
              <span className="fieldLabel">Run Command</span>
              <p className="helperText">{project.runtimeConfig.runCommand ?? "Not detected yet."}</p>
            </div>
            <div className="detailsPlaceholderCard">
              <span className="fieldLabel">Open URL</span>
              <p className="helperText">{project.runtimeConfig.openUrl ?? "Not detected yet."}</p>
            </div>
            <div className="detailsPlaceholderCard">
              <span className="fieldLabel">Launch Provenance</span>
              <p className="helperText">
                {project.runtimeConfig.launch
                  ? `${project.runtimeConfig.launch.origin} · ${project.runtimeConfig.launch.confidence} confidence${project.runtimeConfig.launch.locked ? " · locked" : ""}`
                  : "No launch metadata yet."}
              </p>
              {project.runtimeConfig.launch?.workspacePath ? (
                <p className="helperText">Workspace: {project.runtimeConfig.launch.workspacePath}</p>
              ) : null}
              {project.runtimeConfig.launch?.wrapperPath ? (
                <p className="helperText">Wrapper: {project.runtimeConfig.launch.wrapperPath}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "planned" ? (
        <div className="detailsPanel">
          {agentSession && agentSession.plannedUpdates.length > 0 ? (
            <div className="agentPlannedUpdatesList">
              {agentSession.plannedUpdates
                .sort((a, b) => a.order - b.order)
                .map((update, idx) => (
                  <div key={update.id} className="agentPlannedUpdateItem">
                    <span className="orderBadge">{idx + 1}</span>
                    <div className="updateContent">
                      <div className="updateTitle">{update.title}</div>
                      <div className="updateDescription">{update.description}</div>
                    </div>
                    <div className="updateActions">
                      <StatusChip
                        tone={update.status === "completed" ? "confirmed" : update.status === "failed" ? "action_required" : update.status === "in_progress" ? "info" : "neutral"}
                      >{update.status}</StatusChip>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="placeholderPanel">
              <h4>No planned updates</h4>
              <p>Planned updates will appear here once a roadmap has been defined.</p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div className="detailsPanel">
          <div className="historyStack">
            {savedUpdates.length === 0 ? (
              <div className="placeholderPanel">
                <h4>No updates yet</h4>
                <p>Saved updates will show up here once PROGRAMS has applied changes to this project.</p>
              </div>
            ) : (
              <div className="historyListDetailed">
                {savedUpdates.map((update, index) => (
                  <div key={update.id} className="historyDetailItem">
                    <div className="historyDetailTopRow">
                      <span className="historyVersionTag">v{index + 1}</span>
                      <strong className="historyDetailSummary">{update.summary}</strong>
                      <span className="helperText">{formatDate(update.createdAt)}</span>
                    </div>
                    <p className="historyDetailDescription">{update.prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "github" ? (
        <div className="detailsPanel">
          <GithubTabContent
            project={project}
            githubAuth={auth.github}
            diffStats={githubDiffStats}
            busyKey={busyKey}
            onConnect={onConnectGithub}
            onDisconnect={onDisconnectGithub}
            onPublish={onPublishToGithub}
            onSave={onSaveToGithub}
            onDownload={onDownloadFromGithub}
          />
        </div>
      ) : null}
      </div>
    </Modal>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function GithubTabContent({
  project,
  githubAuth,
  diffStats,
  busyKey,
  onConnect,
  onDisconnect,
  onPublish,
  onSave,
  onDownload,
}: {
  project: Project;
  githubAuth: AuthSnapshot["github"];
  diffStats: DiffStats | null | "loading";
  busyKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onPublish: (input: { projectId: string; repoName: string; isPrivate: boolean }) => void;
  onSave: (projectId: string) => void;
  onDownload: (projectId: string) => void;
}) {
  const [repoName, setRepoName] = useState(() => slugify(project.name) || "my-project");
  const [isPrivate, setIsPrivate] = useState(true);

  const connection = project.githubConnection;
  const isPublishing = busyKey === `github.publish.${project.id}`;
  const isConnecting = busyKey === "auth.github";
  const githubAuthError = githubAuth.errorMessage?.trim() || null;

  const handleOpenRepo = useCallback(() => {
    if (connection?.repoUrl) {
      void window.programs.openExternal(connection.repoUrl);
    }
  }, [connection?.repoUrl]);

  // State 1: gh not installed
  if (!githubAuth.available) {
    return (
      <div className="placeholderPanel">
        <div className="githubIcon">
          <GithubIcon />
        </div>
        <h4>GitHub CLI not found</h4>
        <p>{githubAuthError ?? "Install the GitHub CLI to save and download projects with GitHub."}</p>
        <button
          className="secondaryButton"
          onClick={() => void window.programs.openExternal("https://cli.github.com/")}
        >
          Download GitHub CLI
        </button>
      </div>
    );
  }

  // State 2: Installed but not logged in
  if (!githubAuth.loggedIn) {
    return (
      <div className="placeholderPanel">
        <div className="githubIcon">
          <GithubIcon />
        </div>
        <h4>{githubAuthError ? "GitHub needs attention" : "Connect your GitHub account"}</h4>
        <p>{githubAuthError ?? "Sign in with GitHub to save and download projects directly from PROGRAMS."}</p>
        <button className="primaryButton" onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Connect GitHub"}
        </button>
      </div>
    );
  }

  // State 3: Logged in but no remote configured
  if (!connection?.repoUrl) {
    return (
      <div className="detailsPanel">
        <div className="detailsHeading">
          <div>
            <span className="fieldLabel">GitHub · {githubAuth.username}</span>
            <h4>Publish to GitHub</h4>
          </div>
          <button className="textButton smallButton" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>

        <p className="helperText">
          Create a new GitHub repository and save this project to it.
        </p>

        <div className="detailsPlaceholderGrid">
          <div className="detailsPlaceholderCard">
            <label className="fieldLabel" htmlFor="github-repo-name">Repository name</label>
            <input
              id="github-repo-name"
              className="textInput"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="my-project"
              spellCheck={false}
            />
          </div>

          <div className="detailsPlaceholderCard">
            <span className="fieldLabel">Visibility</span>
            <div className="githubVisibilityToggle">
              <button
                className={isPrivate ? "toggleOption active" : "toggleOption"}
                onClick={() => setIsPrivate(true)}
              >
                Private
              </button>
              <button
                className={!isPrivate ? "toggleOption active" : "toggleOption"}
                onClick={() => setIsPrivate(false)}
              >
                Public
              </button>
            </div>
          </div>
        </div>

        <div className="modalActions">
          <button
            className="primaryButton"
            onClick={() => onPublish({ projectId: project.id, repoName: repoName.trim(), isPrivate })}
            disabled={isPublishing || !repoName.trim()}
          >
            {isPublishing ? "Publishing..." : "Publish to GitHub"}
          </button>
        </div>
      </div>
    );
  }

  // State 4: Connected with a remote — show status and save/download buttons
  const diffLabel = (() => {
    if (diffStats === "loading") {
      return "Calculating...";
    }
    if (!diffStats || (diffStats.added === 0 && diffStats.removed === 0)) {
      return "Up to date";
    }
    return `+${diffStats.added} / -${diffStats.removed} lines since last GitHub action`;
  })();
  const lastGithubActionLabel = (() => {
    const pushedAt = connection.lastPushedAt ? Date.parse(connection.lastPushedAt) : 0;
    const downloadedAt = connection.lastDownloadedAt ? Date.parse(connection.lastDownloadedAt) : 0;
    if (connection.lastDownloadedAt && downloadedAt > pushedAt) {
      return `Downloaded ${formatDate(connection.lastDownloadedAt)}`;
    }
    if (connection.lastPushedAt) {
      return `Saved ${formatDate(connection.lastPushedAt)}`;
    }
    return "No GitHub action yet";
  })();

  return (
    <div className="detailsPanel">
      <div className="detailsHeading">
        <div>
          <span className="fieldLabel">GitHub · {githubAuth.username}</span>
          <h4>Repository</h4>
        </div>
        <button className="textButton smallButton" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>

      <div className="detailsPlaceholderGrid">
        <div className="detailsPlaceholderCard">
          <span className="fieldLabel">Repository</span>
          <button className="textButton repoLinkButton" onClick={handleOpenRepo}>
            {connection.repoUrl.replace("https://github.com/", "")}
          </button>
        </div>

        <div className="detailsPlaceholderCard">
          <span className="fieldLabel">Last GitHub action</span>
          <p className="helperText">{lastGithubActionLabel}</p>
        </div>

        <div className="detailsPlaceholderCard">
          <span className="fieldLabel">Changes since last GitHub action</span>
          <p className="helperText">{diffLabel}</p>
        </div>
      </div>

      <div className="modalActions">
        <button
          className="primaryButton"
          onClick={() => onSave(project.id)}
        >
          <GithubIcon />
          Save to GitHub
        </button>
        <button
          className="secondaryButton"
          onClick={() => onDownload(project.id)}
        >
          <ArrowDownIcon />
          Download from GitHub
        </button>
      </div>
    </div>
  );
}

export function StoredDataModal({
  project,
  report,
  busy,
  onClose,
  onGenerateReport,
}: {
  project: Project;
  report: ProjectOutlineReport | null | undefined;
  busy: boolean;
  onClose: () => void;
  onGenerateReport: () => void;
}) {
  return (
    <Modal title={`${project.name} stored data`} onClose={onClose} wide>
      <div className="detailsPanel">
        {report === undefined ? (
          <div className="placeholderPanel">
            <h4>Loading stored data</h4>
            <p>PROGRAMS is reading the latest stored-data report for this project.</p>
          </div>
        ) : report === null ? (
          <div className="outlineEmptyState">
            <div className="placeholderPanel">
              <h4>No stored data report yet</h4>
              <p>Generate a report to explain what information the project stores in plain English.</p>
            </div>
            <button className="primaryButton" onClick={onGenerateReport} disabled={busy}>
              {busy ? "Queueing..." : "Request report scan"}
            </button>
          </div>
        ) : (
          <>
            <div className="detailsHeading">
              <div>
                <span className="fieldLabel">Generated</span>
                <h4>Stored data overview</h4>
              </div>
              <span className="helperText">{formatDate(report.generatedAt)}</span>
            </div>
            {report.storedData.length === 0 ? (
              <div className="placeholderPanel">
                <h4>No stored data detected</h4>
                <p>The current report did not find any clear soft-coded or user-facing stored data in this project.</p>
              </div>
            ) : (
              <ul className="storedDataTree">
                {report.storedData.map((node) => (
                  <StoredDataTreeNode key={`${node.label}-${node.description ?? ""}`} node={node} depth={0} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function StoredDataTreeNode({ node, depth }: { node: StoredDataNode; depth: number }) {
  const hasChildren = node.children.length > 0;

  return (
    <li className="storedDataTreeItem">
      {hasChildren ? (
        <details className="storedDataDetails" open={depth === 0}>
          <summary>
            <span className="storedDataLabel">{node.label}</span>
          </summary>
          {node.description ? <p className="helperText storedDataDescription">{node.description}</p> : null}
          <ul className="storedDataChildren">
            {node.children.map((child) => (
              <StoredDataTreeNode key={`${child.label}-${child.description ?? ""}`} node={child} depth={depth + 1} />
            ))}
          </ul>
        </details>
      ) : (
        <div className="storedDataLeaf">
          <span className="storedDataLabel">{node.label}</span>
          {node.description ? <p className="helperText storedDataDescription">{node.description}</p> : null}
        </div>
      )}
    </li>
  );
}

export function ConnectionsModal({
  project,
  report,
  envSnapshot,
  reportBusy,
  envBusy,
  onClose,
  onGenerateReport,
  onSaveEnv,
}: {
  project: Project;
  report: ProjectOutlineReport | null | undefined;
  envSnapshot: EnvFileSnapshot | undefined;
  reportBusy: boolean;
  envBusy: boolean;
  onClose: () => void;
  onGenerateReport: () => void;
  onSaveEnv: (entries: EnvVariableEntry[]) => Promise<void>;
}) {
  const [draftEntries, setDraftEntries] = useState<EnvVariableEntry[]>([]);
  const [keysVisible, setKeysVisible] = useState(false);

  useEffect(() => {
    setDraftEntries(envSnapshot?.entries.map((entry) => ({ ...entry })) ?? []);
    setKeysVisible(false);
  }, [envSnapshot]);

  const handleEntryChange = (index: number, field: keyof EnvVariableEntry, value: string) => {
    setDraftEntries((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleAddEntry = () => {
    setDraftEntries((current) => [...current, { key: "", value: "" }]);
  };

  const handleDeleteEntry = (index: number) => {
    setDraftEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  };

  const toggleKeysVisible = () => {
    if (keysVisible) {
      setKeysVisible(false);
      return;
    }

    const confirmed = window.confirm("Reveal and edit the environment variable values for this project?");
    if (confirmed) {
      setKeysVisible(true);
    }
  };

  return (
    <Modal title={`${project.name} connections`} onClose={onClose} wide>
      <div className="detailsPanel">
        <section className="outlineSectionCard">
          <div className="outlineSectionHead">
            <div>
              <span className="fieldLabel">Connected services</span>
              <h4>APIs and services</h4>
            </div>
            {report === null ? (
              <button className="secondaryButton smallButton" onClick={onGenerateReport} disabled={reportBusy}>
                {reportBusy ? "Queueing..." : "Request report scan"}
              </button>
            ) : null}
          </div>

          {report === undefined ? (
            <p className="helperText">Loading the connections report for this project.</p>
          ) : report === null ? (
            <p className="helperText">Generate a report to surface likely services, APIs, and cost notes for this project.</p>
          ) : report.connections.length === 0 ? (
            <p className="helperText">No connected services were detected in the current report.</p>
          ) : (
            <div className="outlineCardGrid">
              {report.connections.map((connection) => (
                <div key={`${connection.name}-${connection.kind}`} className="outlineInfoCard">
                  <div className="outlineInfoHead">
                    <strong>{connection.name}</strong>
                    <span className="statusChip statusChip-info">{connection.kind}</span>
                  </div>
                  <p className="helperText">{connection.description}</p>
                  {connection.envKeys.length ? (
                    <div className="pillList">
                      {connection.envKeys.map((envKey) => (
                        <span key={envKey} className="outlinePill">
                          {envKey}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="outlineSectionCard">
          <div className="outlineSectionHead">
            <div>
              <span className="fieldLabel">Costs</span>
              <h4>Usage and spend notes</h4>
            </div>
          </div>

          {report === undefined ? (
            <p className="helperText">Loading cost notes.</p>
          ) : report === null ? (
            <p className="helperText">Generate a report to add rough cost guidance for the detected services.</p>
          ) : report.costs.length === 0 ? (
            <p className="helperText">No specific paid-service cost notes were detected in the current report.</p>
          ) : (
            <div className="outlineCardGrid">
              {report.costs.map((cost) => (
                <div key={cost.label} className="outlineInfoCard">
                  <div className="outlineInfoHead">
                    <strong>{cost.label}</strong>
                    {cost.amount ? <span className="statusChip statusChip-neutral">{cost.amount}</span> : null}
                  </div>
                  <p className="helperText">{cost.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="outlineSectionCard">
          <div className="outlineSectionHead">
            <div>
              <span className="fieldLabel">Environment</span>
              <h4>Root .env file</h4>
            </div>
            <div className="outlineActionRow">
              <button className="secondaryButton smallButton" onClick={toggleKeysVisible} disabled={envSnapshot === undefined}>
                {keysVisible ? "Hide Keys" : "View Keys"}
              </button>
              <button className="secondaryButton smallButton" onClick={handleAddEntry} disabled={envSnapshot === undefined}>
                Add Key
              </button>
            </div>
          </div>

          <p className="helperText">
            {envSnapshot
              ? envSnapshot.exists
                ? `Editing ${envSnapshot.path}`
                : `No .env file exists yet. Saving here will create ${envSnapshot.path}.`
              : "Loading the project environment file."}
          </p>

          {report && report.referencedEnvKeys.length ? (
            <div className="pillList">
              {report.referencedEnvKeys.map((envKey) => (
                <span key={envKey} className="outlinePill">
                  {envKey}
                </span>
              ))}
            </div>
          ) : null}

          {envSnapshot === undefined ? (
            <p className="helperText">Loading environment variables.</p>
          ) : draftEntries.length === 0 ? (
            <div className="placeholderPanel">
              <h4>No environment variables yet</h4>
              <p>Add a key to create the project&apos;s root .env file.</p>
            </div>
          ) : (
            <div className="envEditorList">
              {draftEntries.map((entry, index) => (
                <div key={`${index}-${entry.key}`} className="envEditorRow">
                  <input
                    value={entry.key}
                    onChange={(event) => handleEntryChange(index, "key", event.target.value)}
                    placeholder="API_KEY"
                  />
                  {keysVisible ? (
                    <input
                      value={entry.value}
                      onChange={(event) => handleEntryChange(index, "value", event.target.value)}
                      placeholder="Value"
                    />
                  ) : (
                    <div className="envMaskedValue">Hidden until you choose View Keys</div>
                  )}
                  <button className="textButton envDeleteButton" onClick={() => handleDeleteEntry(index)}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="envWarningCard">
            <strong>Save Updates writes directly to the project&apos;s root .env file.</strong>
            <p className="helperText">Review the keys carefully before saving. These values affect how the app runs locally.</p>
          </div>

          <div className="modalActions">
            <button className="secondaryButton" onClick={onClose}>
              Close
            </button>
            <button
              className="primaryButton"
              onClick={() => void onSaveEnv(draftEntries)}
              disabled={envBusy || envSnapshot === undefined}
            >
              {envBusy ? "Saving..." : "Save Updates"}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function RuntimeModal({
  project,
  runtime,
  onClose,
}: {
  project: Project;
  runtime: RuntimeState | null;
  onClose: () => void;
}) {
  const liveUrl = runtime?.url ?? null;
  const fallbackUrl = project.runtimeConfig.lastRunUrl ?? project.runtimeConfig.openUrl ?? null;
  const runtimeRows = [
    {
      label: "Status",
      value: runtime?.running ? "Running" : "Not running",
    },
    {
      label: "Runtime",
      value: labelForRuntimeSource(runtime?.source ?? "none"),
    },
    ...(liveUrl ? [{ label: "Live URL", value: liveUrl }] : fallbackUrl ? [{ label: "Last URL", value: fallbackUrl }] : []),
    ...(runtime?.startedAt ? [{ label: "Started", value: formatDate(runtime.startedAt) }] : []),
    ...(runtime?.pid ? [{ label: "PID", value: String(runtime.pid) }] : []),
    ...(project.runtimeConfig.runCommand ? [{ label: "Run command", value: project.runtimeConfig.runCommand }] : []),
    ...(project.runtimeConfig.openUrl ? [{ label: "Configured URL", value: project.runtimeConfig.openUrl }] : []),
  ];

  return (
    <Modal title={`${project.name} Runtime`} onClose={onClose} wide>
      <div className="detailsPanel">
        <div className="detailsHeading">
          <div>
            <span className="fieldLabel">Runtime</span>
            <h4>Current local run state</h4>
          </div>
          <span className="helperText">{runtime?.running ? "Live" : "Idle"}</span>
        </div>

        {runtimeRows.length ? (
          <div className="outlineCardGrid">
            {runtimeRows.map((row) => (
              <div key={row.label} className="outlineInfoCard">
                <span className="fieldLabel">{row.label}</span>
                <strong className="runtimeInfoValue">{row.value}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="placeholderPanel">
            <h4>No runtime data yet</h4>
            <p>Run this project once and PROGRAMS will store local runtime details here.</p>
          </div>
        )}

        {runtime?.logs.length ? (
          <section className="outlineSectionCard">
            <div className="outlineSectionHead">
              <div>
                <span className="fieldLabel">Logs</span>
                <h4>Recent runtime output</h4>
              </div>
            </div>
            <pre className="runtimeLog runtimeLogExpanded">{runtime.logs.join("\n")}</pre>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
