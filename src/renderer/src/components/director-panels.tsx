import { useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { getDirectorMetadata, type DirectorFlowLink } from "@shared/director-metadata";
import { ConceptOverview } from "./core-details";
import { StatusChip } from "./ui-primitives";
import { ExecutionReportPanel } from "./execution-panels";
import { ErrorBoundaryPanel } from "./hard-memory-report";
import {
  resolveModelOptions,
  fallbackCodexModelLabel,
  fallbackClaudeModelLabel,
  labelForModel,
  labelForAgentProvider,
  formatDirectorFocusModeLabel,
  formatDate,
  labelForReasoningEffort,
  labelForPlanningMode,
  labelForToddSimplificationMode,
  labelForToddUpdateKind,
  providerLabel,
  labelForDirectorStageStatus,
} from "../lib/formatting";
import {
  getDirectorProfileMeta,
  getDirectorFocusModes,
  describeDirectorFocusMode,
  buildDirectorLiveContextItems,
  getDirectorProjectNotes,
  getConfirmedConcept,
  getDanConflictQuestionCount,
  getDanConflictQuestions,
  getWorkingConcept,
} from "../lib/session-helpers";
import type {
  DirectorId,
  DirectorFocusMode,
  DirectorSettingsOverride,
  AgentSession,
  Settings,
  ModelCatalog,
  CodexModel,
  ClaudeModel,
  ReasoningEffort,
  PlanningMode,
  VersionPlan,
  VersionUpdate,
  JeffExecutionReport,
} from "@shared/types";
import { DIRECTOR_NAMES } from "@shared/types";

export function DirectorFlowLinkPill({
  link,
  onNavigateToDirector,
}: {
  link: DirectorFlowLink;
  onNavigateToDirector: (directorId: DirectorId) => void;
}) {
  if (link.kind === "director") {
    return (
      <button
        type="button"
        className="agentFlowPill agentFlowPill-button"
        onClick={() => onNavigateToDirector(link.directorId)}
      >
        {link.label}
      </button>
    );
  }

  return <span className="agentFlowPill">{link.label}</span>;
}

export function DirectorSummaryPanel({
  directorId,
  session,
  projectId,
  settings,
  modelCatalog,
  onNavigateToDirector,
  onUpdateAgentDefaults,
  onSessionUpdate,
  pushToast,
  onExpandedChange,
}: {
  directorId: DirectorId;
  session: AgentSession | null;
  projectId: string | null;
  settings: Settings;
  modelCatalog: ModelCatalog;
  onNavigateToDirector: (directorId: DirectorId) => void;
  onUpdateAgentDefaults: (advancedDefaults: Partial<Settings["advancedDefaults"]>) => Promise<void>;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const metadata = getDirectorMetadata(directorId);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [informationChainOpen, setInformationChainOpen] = useState(false);
  const [projectNotesOpen, setProjectNotesOpen] = useState(false);
  const directorOverrides = session?.directorSettingsOverrides?.[directorId];
  const codexModelOptions = useMemo(
    () => resolveModelOptions(settings.advancedDefaults.model, modelCatalog.codex, fallbackCodexModelLabel),
    [modelCatalog.codex, settings.advancedDefaults.model],
  );
  const claudeModelOptions = useMemo(
    () => resolveModelOptions(settings.advancedDefaults.claudeModel, modelCatalog.claude, fallbackClaudeModelLabel),
    [modelCatalog.claude, settings.advancedDefaults.claudeModel],
  );
  const notes = getDirectorProjectNotes(directorId, session);
  const liveContextItems = buildDirectorLiveContextItems(directorId, session);
  const effectiveModel = directorOverrides?.model ?? settings.advancedDefaults.model;
  const effectiveClaudeModel = directorOverrides?.claudeModel ?? settings.advancedDefaults.claudeModel;
  const effectiveReasoning = directorOverrides?.reasoningEffort ?? metadata.runtimeDefaults.reasoningEffort;
  const effectivePlanning = directorOverrides?.planningMode ?? metadata.runtimeDefaults.planningMode;
  const activeModelLabel =
    settings.advancedDefaults.provider === "claude"
      ? labelForModel(effectiveClaudeModel, claudeModelOptions, fallbackClaudeModelLabel)
      : labelForModel(effectiveModel, codexModelOptions, fallbackCodexModelLabel);
  const focusModes = getDirectorFocusModes(directorId);

  useLayoutEffect(() => {
    setInformationChainOpen(false);
    setProjectNotesOpen(false);
    onExpandedChange?.(false);
  }, [directorId, onExpandedChange]);

  useLayoutEffect(() => {
    onExpandedChange?.(informationChainOpen || projectNotesOpen);
  }, [informationChainOpen, onExpandedChange, projectNotesOpen]);

  const handleDefaultChange = async (
    advancedDefaults: Partial<Settings["advancedDefaults"]>,
  ) => {
    setIsSavingDefaults(true);
    try {
      await onUpdateAgentDefaults(advancedDefaults);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to update the agent defaults.", "error");
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleDirectorOverride = async (overrides: DirectorSettingsOverride) => {
    if (!projectId) return;
    setIsSavingDefaults(true);
    try {
      const updated = await window.programs.updateDirectorSettings(projectId, directorId, overrides);
      onSessionUpdate(updated);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Failed to update director settings.", "error");
    } finally {
      setIsSavingDefaults(false);
    }
  };

  return (
    <div className="agentInfoPanel agentSummaryPanel">
      <div className="agentSummaryGrid">
        <section className="agentSummaryCard">
          <div className="agentSummaryHeader">
            <span className="agentSummaryEyebrow">Agent Defaults</span>
            <span className="usagePreviewLabel">{`Using ${labelForAgentProvider(settings.advancedDefaults.provider)}`}</span>
          </div>
          <div className="agentRuntimeMeta">
            <div className="agentRuntimeMetaRow">
              <span className="pmStatusLabel">Active Provider</span>
              <strong>{labelForAgentProvider(settings.advancedDefaults.provider)}</strong>
            </div>
            <div className="agentRuntimeMetaRow">
              <span className="pmStatusLabel">Active Model</span>
              <strong>{activeModelLabel}</strong>
            </div>
          </div>

          <label className="agentRuntimeField">
            <span className="pmStatusLabel">GPT Model</span>
            <select
              value={effectiveModel}
              disabled={isSavingDefaults || !projectId}
              onChange={(event) => void handleDirectorOverride({ model: event.target.value as CodexModel })}
            >
              {codexModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <label className="agentRuntimeField">
            <span className="pmStatusLabel">Claude Model</span>
            <select
              value={effectiveClaudeModel}
              disabled={isSavingDefaults || !projectId}
              onChange={(event) => void handleDirectorOverride({ claudeModel: event.target.value as ClaudeModel })}
            >
              {claudeModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <label className="agentRuntimeField">
            <span className="pmStatusLabel">Thinking</span>
            <select
              value={effectiveReasoning}
              disabled={isSavingDefaults || !projectId}
              onChange={(event) => void handleDirectorOverride({ reasoningEffort: event.target.value as ReasoningEffort })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra High</option>
            </select>
          </label>

          <label className="agentRuntimeField">
            <span className="pmStatusLabel">Planning</span>
            <select
              value={effectivePlanning}
              disabled={isSavingDefaults || !projectId}
              onChange={(event) => void handleDirectorOverride({ planningMode: event.target.value as PlanningMode })}
            >
              <option value="none">None</option>
              <option value="review">Review</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <p className="helperText">These defaults apply across the agent workflows for this project.</p>
        </section>

        <section className="agentSummaryCard">
          <div className="agentSummaryHeader">
            <span className="agentSummaryEyebrow">Agent Function</span>
            <strong>{metadata.label}</strong>
          </div>
          <p className="agentSummaryDescription">{metadata.shortDescription}</p>

          {focusModes.length > 0 ? (
            <div className="agentInfoPanelSection">
              <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Modes</h5>
              <div className="directorModeReferenceGrid">
                {focusModes.map((mode) => (
                  <div key={mode} className="directorModeReferenceItem">
                    <span className="directorModeReferenceLabel">{formatDirectorFocusModeLabel(mode)}</span>
                    <span className="directorModeReferenceDescription">{describeDirectorFocusMode(directorId, mode)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <details
            className="agentSummaryDetails"
            open={informationChainOpen}
            onToggle={(event) => setInformationChainOpen(event.currentTarget.open)}
          >
            <summary>Information chain</summary>
            <div className="agentSummaryDetailsBody">
              <div className="agentSummaryFlowSection">
                <span className="pmStatusLabel">Receives From</span>
                <div className="agentFlowPills">
                  {metadata.receivesFrom.map((link, index) => (
                    <DirectorFlowLinkPill
                      key={`${link.label}-${index}`}
                      link={link}
                      onNavigateToDirector={onNavigateToDirector}
                    />
                  ))}
                </div>
              </div>

              <div className="agentSummaryFlowSection">
                <span className="pmStatusLabel">Sends To</span>
                <div className="agentFlowPills">
                  {metadata.sendsTo.map((link, index) => (
                    <DirectorFlowLinkPill
                      key={`${link.label}-${index}`}
                      link={link}
                      onNavigateToDirector={onNavigateToDirector}
                    />
                  ))}
                </div>
              </div>

              <div className="agentSummaryLists">
                <div>
                  <span className="pmStatusLabel">Can Access</span>
                  <ul className="agentSummaryList">
                    {metadata.accessOverview.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="pmStatusLabel">Project Context Right Now</span>
                  <ul className="agentSummaryList">
                    {liveContextItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </details>

          <details
            className="agentSummaryDetails"
            open={projectNotesOpen}
            onToggle={(event) => setProjectNotesOpen(event.currentTarget.open)}
          >
            <summary>{notes.length > 0 ? `Project notes (${notes.length})` : "Project notes"}</summary>
            <div className="agentSummaryDetailsBody">
              {notes.length > 0 ? (
                <ul className="agentSummaryList">
                  {notes.map((note, index) => (
                    <li key={`${directorId}-note-${index}`}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="coreDetailEmpty">No saved notes for this agent on the selected project yet.</p>
              )}
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

export function DirectorInfoPanel({
  directorId,
  focusMode,
  session,
  projectId,
  settings,
  modelCatalog,
  onSessionUpdate,
  onUpdateAgentDefaults,
  onNavigateToDirector,
  pushToast,
}: {
  directorId: DirectorId;
  focusMode: DirectorFocusMode | null;
  session: AgentSession | null;
  projectId: string;
  settings: Settings;
  modelCatalog: ModelCatalog;
  onSessionUpdate: (session: AgentSession) => void;
  onUpdateAgentDefaults: (advancedDefaults: Partial<Settings["advancedDefaults"]>) => Promise<void>;
  onNavigateToDirector: (directorId: DirectorId) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  if (!session) return null;
  const confirmedConcept = getConfirmedConcept(session);
  const workingConcept = getWorkingConcept(session);
  const toddMemory = session.toddMemory;
  const pingMemory = session.pingMemory;

  const summaryPanel = (
    <DirectorSummaryPanel
      directorId={directorId}
      session={session}
      projectId={projectId}
      settings={settings}
      modelCatalog={modelCatalog}
      onNavigateToDirector={onNavigateToDirector}
      onUpdateAgentDefaults={onUpdateAgentDefaults}
      onSessionUpdate={onSessionUpdate}
      pushToast={pushToast}
    />
  );

  switch (directorId) {
    case "project-manager":
      return (
        <>
          {summaryPanel}
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Project Status Overview</h5>
            <div className="pmStatusGrid">
              <div className="pmStatusCard">
                <span className="pmStatusLabel">Dan — Creative</span>
                <span className={`pmStatusValue${confirmedConcept ? " pmStatusDone" : ""}`}>
                  {confirmedConcept ? "Locked" : "In Progress"}
                </span>
              </div>
              <div className="pmStatusCard">
                <span className="pmStatusLabel">Todd — R&D</span>
                <span className={`pmStatusValue${toddMemory.futureUpdatePlan.length > 0 ? " pmStatusDone" : ""}`}>
                  {toddMemory.futureUpdatePlan.length > 0 ? `${toddMemory.futureUpdatePlan.length} updates` : "Pending"}
                </span>
              </div>
              <div className="pmStatusCard">
                <span className="pmStatusLabel">Ping — Programming</span>
                <span className="pmStatusValue">
                  {toddMemory.futureUpdatePlan.filter((u) => u.status === "completed").length}/{toddMemory.futureUpdatePlan.length} updates
                </span>
              </div>
              <div className="pmStatusCard">
                <span className="pmStatusLabel">Pong — Validation</span>
                <span className="pmStatusValue">
                  {session.validationResults.length > 0 ? `${session.validationResults.length} results` : "None yet"}
                </span>
              </div>
            </div>
          </div>
        </>
      );

    case "creative-director": {
      return (
        <>
          {summaryPanel}
          <div className="agentInfoPanel">
            <ConceptOverview
              concept={workingConcept}
              emptyLabel="Dan has not locked in the concept yet."
            />
            {session.danMemory.notes.length > 0 ? (
              <div className="conceptNotesBlock">
                <span className="pmStatusLabel">Conversation Notes</span>
                <ul className="agentSummaryList">
                  {session.danMemory.notes.map((note, index) => (
                    <li key={`dan-concept-note-${index}`}>{typeof note === "string" ? note : note.content}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {confirmedConcept ? (
              <button className="primaryButton" style={{ marginTop: 12, fontSize: "0.8rem" }} onClick={() => onNavigateToDirector("rd-director")}>
                Proceed to R&D
              </button>
            ) : null}
          </div>
        </>
      );
    }

    case "rd-director": {
      if (focusMode === "research" || !focusMode) {
        return (
          <>
            {summaryPanel}
            <div className="agentInfoPanel">
              <ConceptOverview
                concept={toddMemory.confirmedConcept}
                title="Confirmed Concept"
                emptyLabel="Todd is waiting for Dan to lock the concept."
              />
              <div className="agentInfoPanelSection">
                <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Current Codebase Index</h5>
                {toddMemory.codebaseIndexedMap ? (
                  <div className="codebaseIndexPanel">
                    <p className="coreDetailValue">{toddMemory.codebaseIndexedMap.summary ?? "No codebase summary yet."}</p>
                    {toddMemory.codebaseIndexedMap.featureAreas.length > 0 ? (
                      <div className="flowStepPillars">
                        {toddMemory.codebaseIndexedMap.featureAreas.map((area) => (
                          <span key={area} className="flowStepPillarTag">{area}</span>
                        ))}
                      </div>
                    ) : null}
                    {toddMemory.codebaseIndexedMap.repoNotes.length > 0 ? (
                      <ul className="agentSummaryList">
                        {toddMemory.codebaseIndexedMap.repoNotes.map((note, index) => (
                          <li key={`repo-note-${index}`}>{note}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="helperText">Indexed {formatDate(toddMemory.codebaseIndexedMap.indexedAt)}</p>
                  </div>
                ) : (
                  <em className="coreDetailEmpty">Todd has not indexed the codebase yet.</em>
                )}
              </div>
            </div>
          </>
        );
      }

      if (focusMode === "version-planning") {
        const roadmapVersions = [toddMemory.versionPlan.v1, toddMemory.versionPlan.v2, toddMemory.versionPlan.v3].filter(
          (version): version is VersionPlan => Boolean(version),
        );
        return (
          <>
            {summaryPanel}
            <div className="agentInfoPanel">
              <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Roadmap</h5>
              {roadmapVersions.length > 0 ? (
                <div className="versionTimeline">
                  {roadmapVersions.sort((a, b) => a.order - b.order).map((v) => (
                    <div key={v.id} className="versionCard">
                      <div className="versionHeader">
                        <span className={`versionLabel${v.status === "assumed" ? " assumedText" : ""}`}>{v.label}</span>
                        <StatusChip tone={v.status === "confirmed" ? "confirmed" : v.status === "assumed" ? "action_required" : "info"}>{v.status}</StatusChip>
                      </div>
                      <p className={v.status === "assumed" ? "assumedText" : ""}>{v.description}</p>
                        <ul className="versionGoals">
                          {v.goals.map((g, i) => <li key={i}>{g}</li>)}
                        </ul>
                    </div>
                  ))}
                </div>
              ) : <em className="coreDetailEmpty">Todd has not outlined V1-V3 yet.</em>}
            </div>
          </>
        );
      }

      const groupedByVersion: Record<string, VersionUpdate[]> = {};
      for (const u of toddMemory.futureUpdatePlan) {
        const v = [toddMemory.versionPlan.v1, toddMemory.versionPlan.v2, toddMemory.versionPlan.v3]
          .filter((version): version is VersionPlan => Boolean(version))
          .find((ver) => ver.id === u.versionId);
        const label = v?.label ?? "Unassigned";
        if (!groupedByVersion[label]) groupedByVersion[label] = [];
        groupedByVersion[label].push(u);
      }
      return (
        <>
          {summaryPanel}
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Future Update Plan</h5>
            {toddMemory.futureUpdatePlan.length > 0 ? (
              <div className="updatePlanList">
                {Object.entries(groupedByVersion).map(([versionLabel, updates]) => (
                  <div key={versionLabel} className="updatePlanGroup">
                    <h6 className="updatePlanGroupLabel">{versionLabel}</h6>
                    {updates.sort((a, b) => a.order - b.order).map((u, idx) => (
                      <div key={u.id} className="agentPlannedUpdateItem">
                        <span className="orderBadge">{idx + 1}</span>
                        <div className="updateContent">
                          <div className="updateTitle">{u.title}</div>
                          <div className="updateDescription">{u.description}</div>
                          {u.updateKind || u.simplificationMode ? (
                            <div className="flowStepPillars" style={{ marginTop: 8 }}>
                              {labelForToddUpdateKind(u.updateKind) ? (
                                <span className="flowStepPillarTag">{labelForToddUpdateKind(u.updateKind)}</span>
                              ) : null}
                              {labelForToddSimplificationMode(u.simplificationMode) ? (
                                <span className="flowStepPillarTag">{labelForToddSimplificationMode(u.simplificationMode)}</span>
                              ) : null}
                            </div>
                          ) : null}
                          {u.structuralReason ? (
                            <p className="helperText" style={{ marginTop: 8 }}>{u.structuralReason}</p>
                          ) : null}
                          {u.supportsNextStep ? (
                            <p className="helperText" style={{ marginTop: 4 }}>Supports next: {u.supportsNextStep}</p>
                          ) : null}
                          {u.skillsNeeded.length > 0 ? (
                            <div className="flowStepPillars" style={{ marginTop: 8 }}>
                              {u.skillsNeeded.map((skill) => (
                                <span key={`${u.id}-${skill}`} className="flowStepPillarTag">{skill}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <StatusChip tone={u.status === "completed" ? "confirmed" : u.status === "failed" ? "action_required" : u.status === "in_progress" ? "info" : "neutral"}>{u.status}</StatusChip>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : <em className="coreDetailEmpty">No updates planned yet. Todd has not written the future update plan.</em>}
            <div className="agentInfoPanelSection">
              <h5 style={{ margin: "12px 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Previous Update Log</h5>
              {toddMemory.previousUpdateLog.length > 0 ? (
                <div className="validationResultsList">
                  {toddMemory.previousUpdateLog.slice().reverse().map((entry) => (
                    <div key={entry.id} className={`validationResultCard validationResultCard--${entry.status === "success" || entry.status === "no_changes" ? "pass" : "fail"}`}>
                      <span className="validationResultType">{entry.goal}</span>
                      <span className={`validationResultStatus${entry.status === "success" || entry.status === "no_changes" ? " pmStatusDone" : ""}`}>
                        {entry.status.replace(/_/g, " ")}
                      </span>
                      <p>{entry.outcome}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <em className="coreDetailEmpty">No completed execution entries yet.</em>
              )}
            </div>
            <div className="agentInfoPanelSection">
              <h5 style={{ margin: "12px 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Trouble Log</h5>
              {toddMemory.troubleLog.length > 0 ? (
                <div className="validationResultsList">
                  {toddMemory.troubleLog.map((entry) => (
                    <div key={entry.id} className="validationResultCard validationResultCard--fail">
                      <span className="validationResultType">{entry.title}</span>
                      <span className="validationResultStatus">{entry.priority}</span>
                      <p>{entry.details}</p>
                      <p className="helperText">Seen {entry.occurrences} time(s). Last seen {formatDate(entry.lastSeenAt)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <em className="coreDetailEmpty">No recurring issues logged.</em>
              )}
            </div>
          </div>
        </>
      );
    }

    case "programming-director":
      return (
        <>
          {summaryPanel}
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Programming Queue</h5>
            {toddMemory.futureUpdatePlan.filter((u) => u.status === "pending" || u.status === "in_progress").length > 0 ? (
              <div className="programmingQueue">
                {toddMemory.futureUpdatePlan.filter((u) => u.status === "pending" || u.status === "in_progress").map((u) => (
                  <div key={u.id} className="agentPlannedUpdateItem">
                    <div className="updateContent">
                      <div className="updateTitle">{u.title}</div>
                      <div className="updateDescription">{u.description}</div>
                      {u.skillsNeeded.length > 0 ? (
                        <div className="flowStepPillars" style={{ marginTop: 8 }}>
                          {u.skillsNeeded.map((skill) => (
                            <span key={`${u.id}-${skill}`} className="flowStepPillarTag">{skill}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <StatusChip tone={u.status === "in_progress" ? "info" : "neutral"}>{u.status}</StatusChip>
                  </div>
                ))}
              </div>
            ) : <em className="coreDetailEmpty">No updates in the programming queue.</em>}
            <p className="coreDetailValue" style={{ marginTop: 12 }}>
              {pingMemory.activeTask
                ? `Active task: ${pingMemory.activeTask}`
                : "Ping is waiting for the next confirmed implementation task."}
            </p>
            {pingMemory.context ? (
              <p className="coreDetailValue" style={{ marginTop: 8 }}>{pingMemory.context}</p>
            ) : null}
            {pingMemory.codebaseMapSummary ? (
              <p className="helperText" style={{ marginTop: 8 }}>{pingMemory.codebaseMapSummary}</p>
            ) : null}
            {pingMemory.latestRawReport ? (
              <div className="validationResultCard validationResultCard--pass" style={{ marginTop: 12 }}>
                <span className="validationResultType">Latest execution</span>
                <span className="validationResultStatus">{pingMemory.latestRawReport.status.replace(/_/g, " ")}</span>
                <p>{pingMemory.latestRawReport.summary}</p>
              </div>
            ) : null}
          </div>
        </>
      );

    case "validation-director": {
      // Pong: mode-dependent panel
      if (focusMode === "identify-goal") {
        return (
          <>
            {summaryPanel}
            <div className="agentInfoPanel">
              <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Identify Goal</h5>
              <p className="coreDetailValue">Reviewing the confirmed concept and creative references for the most recent update.</p>
            </div>
          </>
        );
      }

      if (focusMode === "test-current-state") {
        return (
          <>
            {summaryPanel}
            <div className="agentInfoPanel">
              <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Test Current-State</h5>
              {session.validationResults.length > 0 ? (
                <div className="validationResultsList">
                  {session.validationResults.slice(-5).map((r) => (
                    <div key={r.id} className={`validationResultCard validationResultCard--${r.passed ? "pass" : "fail"}`}>
                      <span className="validationResultType">{r.validationType}</span>
                      <span className={`validationResultStatus${r.passed ? " pmStatusDone" : ""}`}>{r.passed ? "PASS" : "FAIL"}</span>
                      <p>{r.summary}</p>
                    </div>
                  ))}
                </div>
              ) : <em className="coreDetailEmpty">No test results yet.</em>}
            </div>
          </>
        );
      }

      // compare mode (default)
      return (
        <>
          {summaryPanel}
          <div className="agentInfoPanel">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Compare</h5>
            <div className="validationFrequencyRow">
              <span className="pillarDetailLabel">Frequency:</span>
              <select
                className="plannerSelect"
                value={session.validationFrequency}
                onChange={(e) => void window.programs.setValidationFrequency({ projectId, frequency: e.target.value as "every-update" | "every-version" | "manual" }).then(onSessionUpdate)}
              >
                <option value="manual">Manual</option>
                <option value="every-update">Every Update</option>
                <option value="every-version">Every Version</option>
              </select>
            </div>
            {session.validationResults.length > 0 ? (
              <div className="validationResultsList">
                {session.validationResults.map((r) => (
                  <div key={r.id} className={`validationResultCard validationResultCard--${r.passed ? "pass" : "fail"}`}>
                    <span className="validationResultType">{r.validationType}</span>
                    <span className={`validationResultStatus${r.passed ? " pmStatusDone" : ""}`}>{r.passed ? "PASS" : "FAIL"}</span>
                    <p>{r.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      );
    }

    default:
      return null;
  }
}

export function DirectorFunctionsPanel({
  directorId,
  session: _session,
  projectId: _projectId,
  onNavigateToDirector,
  onSessionUpdate: _onSessionUpdate,
}: {
  directorId: DirectorId;
  session: AgentSession | null;
  projectId: string | null;
  onNavigateToDirector: (directorId: DirectorId) => void;
  onSessionUpdate: (session: AgentSession) => void;
}) {
  const metadata = getDirectorMetadata(directorId);
  const focusModes = getDirectorFocusModes(directorId);

  return (
    <div className="agentInfoPanel agentSummaryPanel">
      <div className="agentSummaryGrid">
        <section className="agentSummaryCard">
          <div className="agentSummaryHeader">
            <span className="agentSummaryEyebrow">Function</span>
            <strong>{metadata.label}</strong>
          </div>
          <p className="agentSummaryDescription">{metadata.shortDescription}</p>

          <div className="agentInfoPanelSection">
            <h5 style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "var(--text-muted)" }}>Model Behavior</h5>
            <p className="coreDetailValue">{metadata.modelBehaviorNote}</p>
          </div>

          {focusModes.length > 0 ? (
            <details className="agentSummaryDetails">
              <summary>Modes</summary>
              <div className="agentSummaryDetailsBody">
                <div className="directorModeReferenceGrid">
                  {focusModes.map((mode) => (
                    <div key={mode} className="directorModeReferenceItem">
                      <span className="directorModeReferenceLabel">{formatDirectorFocusModeLabel(mode)}</span>
                      <span className="directorModeReferenceDescription">{describeDirectorFocusMode(directorId, mode)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          ) : null}

          <details className="agentSummaryDetails">
            <summary>Information Chain</summary>
            <div className="agentSummaryDetailsBody">
              <div className="agentSummaryFlowSection">
                <span className="pmStatusLabel">Receives From</span>
                <div className="agentFlowPills">
                  {metadata.receivesFrom.map((link, index) => (
                    <DirectorFlowLinkPill
                      key={`${link.label}-${index}`}
                      link={link}
                      onNavigateToDirector={onNavigateToDirector}
                    />
                  ))}
                </div>
              </div>

              <div className="agentSummaryFlowSection">
                <span className="pmStatusLabel">Sends To</span>
                <div className="agentFlowPills">
                  {metadata.sendsTo.map((link, index) => (
                    <DirectorFlowLinkPill
                      key={`${link.label}-${index}`}
                      link={link}
                      onNavigateToDirector={onNavigateToDirector}
                    />
                  ))}
                </div>
              </div>

              <div>
                <span className="pmStatusLabel">Can Access</span>
                <ul className="agentSummaryList">
                  {metadata.accessOverview.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

export function DirectorMemoryPanel({
  directorId,
  session,
  projectId,
  onSessionUpdate,
  pushToast,
  onViewExecutionReport,
}: {
  directorId: DirectorId;
  session: AgentSession | null;
  projectId?: string | null;
  onSessionUpdate?: (session: AgentSession) => void;
  pushToast?: (message: string, level: "info" | "success" | "error") => void;
  onViewExecutionReport?: (report: JeffExecutionReport) => void;
}) {
  if (!session) return null;

  if (directorId === "creative-director") {
    const danMemory = session.danMemory;
    const confirmedConcept = danMemory.confirmedConcept;
    const discussedConcept = danMemory.draftConcept;
    const derivedConcept = danMemory.derivedConcept;
    const hasCreativeNotes = danMemory.notes.length > 0;
    const hasDerivedNotes = danMemory.derivedNotes.length > 0;
    const hasHandoffNotes = (danMemory.toddHandoffNotes ?? []).length > 0;
    const hasRawMemories = (danMemory.rawMemories ?? []).length > 0;
    const hasForgotten = (danMemory.forgottenMemories ?? []).length > 0;
    const conflictQuestions = getDanConflictQuestions(session);
    const conflictCount = getDanConflictQuestionCount(session);
    const hasSoftMemory = Boolean(discussedConcept || derivedConcept || hasCreativeNotes || hasDerivedNotes || hasHandoffNotes);
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard">
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">Memory</span>
            </div>
            <details className="agentSummaryDetails" open>
              <summary>Soft-Memory</summary>
              <div className="agentSummaryDetailsBody">
                {conflictCount > 0 ? (
                  <div className="memoryQuestionCard">
                    <span className="pmStatusLabel">
                      Dan Question <span className="memoryHandoffBadge memoryHandoffBadge--question">Question</span>
                    </span>
                    <p className="helperText" style={{ marginTop: 6 }}>
                      Dan needs to reconcile {conflictCount} question(s) before hard-memory confirmation.
                    </p>
                    <ul className="agentSummaryList">
                      {conflictQuestions.slice(0, 3).map((question, index) => <li key={`dan-conflict-${index}`}>{question}</li>)}
                    </ul>
                  </div>
                ) : null}
                {discussedConcept ? (
                  <ConceptOverview
                    concept={discussedConcept}
                    title="Discussed Core-Details"
                    emptyLabel="No discussed core-details yet."
                  />
                ) : null}
                {derivedConcept ? (
                  <div style={{ marginTop: discussedConcept ? 14 : 0 }}>
                    <ConceptOverview
                      concept={derivedConcept}
                      title="Derived Core-Details"
                      emptyLabel="No derived core-details yet."
                    />
                    {danMemory.derivedUpdatedAt ? (
                      <p className="helperText" style={{ marginTop: 6 }}>
                        Derived from refresh {formatDate(danMemory.derivedUpdatedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {hasCreativeNotes ? (
                  <div style={{ marginTop: discussedConcept || derivedConcept ? 14 : 0 }}>
                    <span className="pmStatusLabel">Discussed Support Notes</span>
                    <ul className="agentSummaryList">
                      {danMemory.notes.map((note, i) => <li key={`dan-soft-${i}`}>{typeof note === "string" ? note : note.content}</li>)}
                    </ul>
                  </div>
                ) : null}
                {hasDerivedNotes ? (
                  <div style={{ marginTop: hasCreativeNotes || discussedConcept || derivedConcept ? 10 : 0 }}>
                    <span className="pmStatusLabel">Derived Support Notes</span>
                    <ul className="agentSummaryList">
                      {danMemory.derivedNotes.map((note, i) => <li key={`dan-derived-${i}`}>{typeof note === "string" ? note : note.content}</li>)}
                    </ul>
                  </div>
                ) : null}
                {hasHandoffNotes ? (
                  <div style={{ marginTop: hasCreativeNotes || hasDerivedNotes || discussedConcept || derivedConcept ? 10 : 0 }}>
                    <span className="pmStatusLabel">
                      Todd-Bound Notes <span className="memoryHandoffBadge memoryHandoffBadge--handoff">Handoff</span>
                    </span>
                    <ul className="agentSummaryList">
                      {danMemory.toddHandoffNotes.map((note, i) => <li key={`dan-handoff-${i}`}>{typeof note === "string" ? note : note.content}</li>)}
                    </ul>
                  </div>
                ) : null}
                {!hasSoftMemory ? (
                  <p className="coreDetailEmpty">No active session notes.</p>
                ) : null}
              </div>
            </details>
            <details className="agentSummaryDetails">
              <summary>Hard-Memory</summary>
              <div className="agentSummaryDetailsBody">
                <ConceptOverview
                  concept={confirmedConcept}
                  title="Core-Details"
                  emptyLabel="No confirmed concept yet."
                />
              </div>
            </details>
            <details className="agentSummaryDetails">
              <summary>Backup Memory</summary>
              <div className="agentSummaryDetailsBody">
                {hasRawMemories ? (
                  <div>
                    <span className="pmStatusLabel">Raw Memories ({danMemory.rawMemories.length})</span>
                    <ul className="agentSummaryList">
                      {danMemory.rawMemories.slice(-5).map((rm, i) => (
                        <li key={`dan-raw-${i}`}>{rm.content}</li>
                      ))}
                      {danMemory.rawMemories.length > 5 ? (
                        <li className="helperText">...and {danMemory.rawMemories.length - 5} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
                {hasForgotten ? (
                  <div style={{ marginTop: hasRawMemories ? 10 : 0 }}>
                    <span className="pmStatusLabel">Forgotten Memories ({danMemory.forgottenMemories.length})</span>
                    <ul className="agentSummaryList">
                      {danMemory.forgottenMemories.slice(-5).map((fm, i) => (
                        <li key={`dan-forgotten-${i}`}>{fm}</li>
                      ))}
                      {danMemory.forgottenMemories.length > 5 ? (
                        <li className="helperText">...and {danMemory.forgottenMemories.length - 5} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
                {!hasRawMemories && !hasForgotten ? (
                  <p className="coreDetailEmpty">No backup memory stored.</p>
                ) : null}
              </div>
            </details>
          </section>
        </div>
      </div>
    );
  }

  if (directorId === "rd-director") {
    const toddMemory = session.toddMemory;
    const hasNotes = (toddMemory.notes ?? []).length > 0;
    const hasPendingHandoff = Boolean(toddMemory.pendingHandoff);
    const hasBackup = (toddMemory.backupNotes ?? []).length > 0;
    const roadmapVersions = [toddMemory.versionPlan.v1, toddMemory.versionPlan.v2, toddMemory.versionPlan.v3].filter(Boolean);
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard">
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">Memory</span>
            </div>
            <details className="agentSummaryDetails" open>
              <summary>Soft-Memory</summary>
              <div className="agentSummaryDetailsBody">
                {hasPendingHandoff ? (
                  <div className="memoryPendingHandoffCard">
                    <span className="pmStatusLabel">
                      <span className="memoryHandoffBadge memoryHandoffBadge--dan">From Dan</span>
                    </span>
                    <p className="coreDetailValue" style={{ marginTop: 4 }}>{toddMemory.pendingHandoff!.summary}</p>
                    {toddMemory.pendingHandoff!.context ? (
                      <p className="helperText" style={{ marginTop: 4 }}>{toddMemory.pendingHandoff!.context}</p>
                    ) : null}
                    <p className="helperText" style={{ marginTop: 2 }}>
                      Received {toddMemory.pendingHandoff!.receivedAt.split("T")[0]}
                    </p>
                  </div>
                ) : null}
                {hasNotes ? (
                  <div style={{ marginTop: hasPendingHandoff ? 10 : 0 }}>
                    <span className="pmStatusLabel">Planning Notes</span>
                    <ul className="agentSummaryList">
                      {toddMemory.notes.map((note, i) => <li key={`todd-note-${i}`}>{typeof note === "string" ? note : note.content}</li>)}
                    </ul>
                  </div>
                ) : null}
                {!hasNotes && !hasPendingHandoff ? (
                  <p className="coreDetailEmpty">No active planning notes.</p>
                ) : null}
              </div>
            </details>
            <details className="agentSummaryDetails">
              <summary>Hard-Memory</summary>
              <div className="agentSummaryDetailsBody">
                {toddMemory.confirmedConcept ? (
                  <div>
                    <span className="pmStatusLabel">Core-Details</span>
                    <p className="coreDetailValue">
                      {toddMemory.confirmedConcept.function?.summary ?? "Function TBD"}
                    </p>
                  </div>
                ) : (
                  <p className="coreDetailEmpty">Waiting for Dan to lock the concept.</p>
                )}
                {roadmapVersions.length > 0 ? (
                  <div style={{ marginTop: 8 }}>
                    <span className="pmStatusLabel">Version Roadmap</span>
                    <div className="flowStepPillars" style={{ marginTop: 4 }}>
                      {roadmapVersions.map((v) => (
                        <span key={v!.id} className="flowStepPillarTag">{v!.label}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {toddMemory.futureUpdatePlan.length > 0 ? (
                  <p className="helperText" style={{ marginTop: 6 }}>
                    {toddMemory.futureUpdatePlan.length} update(s) planned
                  </p>
                ) : null}
              </div>
            </details>
            <details className="agentSummaryDetails">
              <summary>Backup Memory</summary>
              <div className="agentSummaryDetailsBody">
                {hasBackup ? (
                  <div>
                    <span className="pmStatusLabel">Archived Planning Notes ({toddMemory.backupNotes.length})</span>
                    <ul className="agentSummaryList">
                      {toddMemory.backupNotes.slice(-5).map((note, i) => (
                        <li key={`todd-backup-${i}`}>{typeof note === "string" ? note : note.content}</li>
                      ))}
                      {toddMemory.backupNotes.length > 5 ? (
                        <li className="helperText">...and {toddMemory.backupNotes.length - 5} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : (
                  <p className="coreDetailEmpty">No backup notes stored.</p>
                )}
              </div>
            </details>
          </section>
        </div>
      </div>
    );
  }

  if (directorId === "programming-director") {
    const pingMemory = session.pingMemory;
    const queuedUpdates = session.toddMemory.futureUpdatePlan.filter((update) => update.status === "pending" || update.status === "in_progress");
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard">
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">Memory</span>
            </div>
            <details className="agentSummaryDetails" open>
              <summary>Programming Queue</summary>
              <div className="agentSummaryDetailsBody">
                {queuedUpdates.length > 0 ? (
                  <div className="programmingQueue">
                    {queuedUpdates.map((update) => (
                      <div key={update.id} className="agentPlannedUpdateItem">
                        <div className="updateContent">
                          <div className="updateTitle">{update.title}</div>
                          <div className="updateDescription">{update.description}</div>
                        </div>
                        <StatusChip tone={update.status === "in_progress" ? "info" : "neutral"}>
                          {update.status.replace(/_/g, " ")}
                        </StatusChip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="coreDetailEmpty">No updates are waiting for Ping.</p>
                )}
              </div>
            </details>
            <details className="agentSummaryDetails">
              <summary>Execution Context</summary>
              <div className="agentSummaryDetailsBody">
                <p className="coreDetailValue">
                  {pingMemory.activeTask
                    ? `Active task: ${pingMemory.activeTask}`
                    : "Ping is waiting for the next Todd-approved update."}
                </p>
                {pingMemory.context ? (
                  <p className="coreDetailValue" style={{ marginTop: 8 }}>{pingMemory.context}</p>
                ) : null}
                {pingMemory.codebaseMapSummary ? (
                  <p className="helperText" style={{ marginTop: 8 }}>{pingMemory.codebaseMapSummary}</p>
                ) : null}
              </div>
            </details>
            <details className="agentSummaryDetails">
              <summary>Latest Update Report</summary>
              <div className="agentSummaryDetailsBody">
                {pingMemory.latestRawReport ? (
                  <div className="validationResultCard validationResultCard--pass">
                    <span className="validationResultType">Latest execution</span>
                    <span className="validationResultStatus">{pingMemory.latestRawReport.status.replace(/_/g, " ")}</span>
                    <p>{pingMemory.latestRawReport.summary}</p>
                  </div>
                ) : (
                  <p className="coreDetailEmpty">No update report recorded yet.</p>
                )}
                {pingMemory.latestJeffReport && onViewExecutionReport ? (
                  <button
                    type="button"
                    className="agentChatViewMoreButton"
                    style={{ marginTop: 12 }}
                    onClick={() => onViewExecutionReport(pingMemory.latestJeffReport!)}
                  >
                    View Project Status Report
                  </button>
                ) : null}
              </div>
            </details>
          </section>
        </div>
      </div>
    );
  }

  if (directorId === "validation-director") {
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard">
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">Memory</span>
            </div>
            <details className="agentSummaryDetails" open>
              <summary>Validation State</summary>
              <div className="agentSummaryDetailsBody">
                <p className="coreDetailValue">Frequency: {session.validationFrequency}</p>
                {session.validationResults.length > 0 ? (
                  <div className="validationResultsList" style={{ marginTop: 12 }}>
                    {session.validationResults.map((result) => (
                      <div key={result.id} className={`validationResultCard validationResultCard--${result.passed ? "pass" : "fail"}`}>
                        <span className="validationResultType">{result.validationType}</span>
                        <span className={`validationResultStatus${result.passed ? " pmStatusDone" : ""}`}>{result.passed ? "PASS" : "FAIL"}</span>
                        <p>{result.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="coreDetailEmpty">No validation results yet.</p>
                )}
              </div>
            </details>
          </section>
        </div>
      </div>
    );
  }

  if (directorId === "project-manager") {
    const stateEntries = Object.entries(session.directorStateMap ?? {}).filter(([, state]) => Boolean(state));
    const pendingReports = session.jeffMemory.pendingReports ?? [];
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard">
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">Memory</span>
            </div>
            <details className="agentSummaryDetails" open>
              <summary>Coordination State</summary>
              <div className="agentSummaryDetailsBody">
                <p className="coreDetailValue">
                  {`${session.pendingApprovals.length} pending approval(s) and ${stateEntries.length} tracked director state snapshot(s).`}
                </p>
                {stateEntries.length > 0 ? (
                  <ul className="agentSummaryList" style={{ marginTop: 10 }}>
                    {stateEntries.map(([id, state]) => (
                      <li key={id}>
                        {DIRECTOR_NAMES[id as DirectorId]}: {state?.currentState ?? state?.idealState ?? "State tracked"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {pendingReports.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <span className="pmStatusLabel">Execution Reports Awaiting Jeff Decision</span>
                    <div className="validationResultsList" style={{ marginTop: 8 }}>
                      {pendingReports.map((report) => (
                        <div
                          key={report.id}
                          className={`validationResultCard validationResultCard--${(report.toddRecommendedDecision ?? report.decision) === "failure" ? "fail" : "pass"}`}
                        >
                          <span className="validationResultType">{report.title}</span>
                          <span className="validationResultStatus">
                            {report.toddRecommendedDecision
                              ? `Todd recommends ${report.toddRecommendedDecision.replace(/[-_]/g, " ")}`
                              : report.decision
                                ? report.decision.replace(/[-_]/g, " ")
                                : "awaiting decision"}
                          </span>
                          <p style={{ gridColumn: "1 / -1" }}>{report.summary}</p>
                          {onViewExecutionReport ? (
                            <button
                              type="button"
                              className="agentChatViewMoreButton"
                              style={{ marginTop: 8 }}
                              onClick={() => onViewExecutionReport(report)}
                            >
                              Review Report
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="coreDetailEmpty" style={{ marginTop: 12 }}>
                    Jeff does not have any execution reports waiting on a decision.
                  </p>
                )}
              </div>
            </details>
          </section>
        </div>
      </div>
    );
  }

  return null;
}

export function DirectorProfilePanel({
  directorId,
  session,
  projectId,
  settings: _settings,
  modelCatalog: _modelCatalog,
  onNavigateToDirector,
  onUpdateAgentDefaults: _onUpdateAgentDefaults,
  onSessionUpdate,
  pushToast: _pushToast,
}: {
  directorId: DirectorId;
  session: AgentSession | null;
  projectId: string | null;
  settings: Settings;
  modelCatalog: ModelCatalog;
  onNavigateToDirector: (directorId: DirectorId) => void;
  onUpdateAgentDefaults: (advancedDefaults: Partial<Settings["advancedDefaults"]>) => Promise<void>;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const profile = getDirectorProfileMeta(directorId);
  const [executionReport, setExecutionReport] = useState<JeffExecutionReport | null>(null);

  return (
    <div className="directorProfilePanel directorProfilePanel--scrollable">
      <div className="directorProfilePanelContent">
        <div
          className="directorProfileCard"
          style={{ "--director-profile-color": profile.color } as CSSProperties}
        >
          <div className="directorProfileAvatar" aria-hidden="true" />
          <div className="directorProfileName">{profile.name}</div>
          <span
            className="agentActiveLabel directorProfileFunction"
            style={{ borderColor: profile.color, color: profile.color }}
          >
            {profile.functionLabel}
          </span>
        </div>

        <div className="directorProfileLowerGrid">
          <DirectorFunctionsPanel
            directorId={directorId}
            session={session}
            projectId={projectId}
            onNavigateToDirector={onNavigateToDirector}
            onSessionUpdate={onSessionUpdate}
          />
          <DirectorMemoryPanel
            directorId={directorId}
            session={session}
            projectId={projectId}
            onSessionUpdate={onSessionUpdate}
            pushToast={_pushToast}
            onViewExecutionReport={setExecutionReport}
          />
        </div>
        {executionReport ? (
          <ErrorBoundaryPanel onClose={() => setExecutionReport(null)}>
            <ExecutionReportPanel
              report={executionReport}
              projectId={projectId}
              session={session}
              onSessionUpdate={onSessionUpdate}
              pushToast={_pushToast}
              onClose={() => setExecutionReport(null)}
            />
          </ErrorBoundaryPanel>
        ) : null}
      </div>
    </div>
  );
}
