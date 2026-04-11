import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { getDirectorMetadata, type DirectorFlowLink } from "@shared/director-metadata";
import { ConceptOverview } from "./core-details";
import { StatusChip } from "./ui-primitives";
import { ExecutionReportPanel } from "./execution-panels";
import { ErrorBoundaryPanel, HardMemoryReportSections } from "./hard-memory-report";
import { ExclamationIcon } from "./icons";
import { AgentChatMarkdown } from "../lib/agent-chat-markdown";
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
  buildDirectorSharedMemorySources,
  buildDirectorExportedMemoryTargets,
  buildDirectorReportStream,
  collectToddRoadmapReportHistory,
  collectToddResearchReportHistory,
  getLivePendingApprovals,
  getDirectorProjectNotes,
  getConfirmedConcept,
  getDanConflictQuestionCount,
  getDanConflictQuestions,
  getWorkingConcept,
  type DirectorSharedMemorySource,
} from "../lib/session-helpers";
import {
  buildToddHardMemoryViewModel,
  type ToddHardMemorySectionKey,
} from "../lib/todd-hard-memory";
import type {
  DirectorId,
  DirectorFocusMode,
  DirectorSettingsOverride,
  AgentSession,
  CorePillar,
  Settings,
  ModelCatalog,
  CodexModel,
  ClaudeModel,
  ReasoningEffort,
  PlanningMode,
  VersionUpdate,
  JeffExecutionReport,
  HardMemoryReportMetadata,
} from "@shared/types";
import { DIRECTOR_COLORS, DIRECTOR_NAMES } from "@shared/types";

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

const TODD_HARD_MEMORY_SECTIONS: Array<{
  key: ToddHardMemorySectionKey;
  title: string;
  style: "continuous" | "node";
}> = [
  { key: "history", title: "History", style: "continuous" },
  { key: "current-state", title: "Current State", style: "node" },
  { key: "priority-update", title: "Priority Update", style: "node" },
  { key: "success-chain", title: "Success Chain", style: "continuous" },
  { key: "end-state", title: "End State", style: "node" },
];

const createToddHardMemoryOpenState = (): Record<ToddHardMemorySectionKey, boolean> => ({
  history: false,
  "current-state": false,
  "priority-update": false,
  "success-chain": false,
  "end-state": false,
});

const formatToddHistorySummary = (
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>,
): { value: string; summary: string; alert: string | null } => {
  if (viewModel.history.updateCount === 0 && viewModel.history.troubleCount === 0) {
    return {
      value: "Nothing recorded",
      summary: "No completed updates or trouble reports yet.",
      alert: null,
    };
  }

  return {
    value: `${viewModel.history.updateCount} update${viewModel.history.updateCount === 1 ? "" : "s"}`,
    summary: viewModel.history.latestGoal ?? "Completed update history is available below.",
    alert: viewModel.history.troubleCount > 0
      ? `${viewModel.history.troubleCount} trouble item${viewModel.history.troubleCount === 1 ? "" : "s"}`
      : null,
  };
};

const formatToddCurrentStateSummary = (
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>,
): { value: string; summary: string } => ({
  value: viewModel.currentState.summary ? "Mapped" : "Missing",
  summary: viewModel.currentState.summary ?? "No current-state summary is stored yet.",
});

const formatToddPriorityUpdateSummary = (
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>,
): { value: string; summary: string } => ({
  value: viewModel.priorityUpdate?.title ?? "Needs mapping",
  summary: viewModel.priorityUpdate?.description
    ?? viewModel.sectionStatus["priority-update"].reason
    ?? "Todd has not selected the next update yet.",
});

const formatToddSuccessChainSummary = (
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>,
): { value: string; summary: string } => {
  if (viewModel.successChain.trackedCount === 0) {
    return {
      value: "No chain yet",
      summary: "No ordered success chain has been defined yet.",
    };
  }

  return {
    value: viewModel.successChain.remainingCount > 0
      ? `${viewModel.successChain.remainingCount} remaining`
      : "No remaining steps",
    summary: viewModel.successChain.nextPendingTitle
      ? `Next step: ${viewModel.successChain.nextPendingTitle}`
      : "No remaining future steps are currently mapped.",
  };
};

const formatToddEndStateSummary = (
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>,
): { value: string; summary: string } => ({
  value: viewModel.endState.summary ? "Target locked" : "Missing",
  summary: viewModel.endState.summary ?? "No end-state summary is stored yet.",
});

type ToddMemorySectionProps = {
  sectionKey: ToddHardMemorySectionKey;
  title: string;
  open: boolean;
  selected: boolean;
  incomplete: boolean;
  incompleteReason: string | null;
  sectionRef: (node: HTMLDetailsElement | null) => void;
  onToggle: (sectionKey: ToddHardMemorySectionKey, open: boolean) => void;
  onTriggerAlert: (sectionKey: ToddHardMemorySectionKey) => void;
  showAlertButton?: boolean;
  children: ReactNode;
};

function ToddMemorySection({
  sectionKey,
  title,
  open,
  selected,
  incomplete,
  incompleteReason,
  sectionRef,
  onToggle,
  onTriggerAlert,
  showAlertButton = true,
  children,
}: ToddMemorySectionProps) {
  return (
    <details
      ref={sectionRef}
      className={`agentSummaryDetails${selected ? " agentSummaryDetails--selected" : ""}`}
      open={open}
      onToggle={(event) => onToggle(sectionKey, event.currentTarget.open)}
      data-todd-section={sectionKey}
    >
      <summary>
        <span>{title}</span>
        {showAlertButton && incomplete ? (
          <button
            type="button"
            className="memoryAlertButton"
            aria-label={`Regenerate Todd plan for ${title}`}
            title={incompleteReason ?? "Regenerate Todd plan"}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onTriggerAlert(sectionKey);
            }}
          >
            <ExclamationIcon />
          </button>
        ) : null}
      </summary>
      <div className="agentSummaryDetailsBody">
        {children}
      </div>
    </details>
  );
}

function ToddRoadmapSummary({
  viewModel,
  selectedSection,
  onSelectSection,
}: {
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>;
  selectedSection: ToddHardMemorySectionKey | null;
  onSelectSection: (sectionKey: ToddHardMemorySectionKey) => void;
}) {
  return (
    <section className="toddRoadmapSummaryPanel">
      <div className="toddRoadmapSummaryHeader">
        <span className="pmStatusLabel">Roadmap</span>
      </div>

      <div className="toddRoadmapSummaryRail">
        {TODD_HARD_MEMORY_SECTIONS.map((section) => {
          const content = section.key === "history"
            ? formatToddHistorySummary(viewModel)
            : section.key === "current-state"
              ? formatToddCurrentStateSummary(viewModel)
              : section.key === "priority-update"
                ? formatToddPriorityUpdateSummary(viewModel)
                : section.key === "success-chain"
                  ? formatToddSuccessChainSummary(viewModel)
                  : formatToddEndStateSummary(viewModel);

          const historyAlert = section.key === "history"
            ? formatToddHistorySummary(viewModel).alert
            : null;

          return (
            <button
              key={section.key}
              type="button"
              className={`toddRoadmapSummarySegment toddRoadmapSummarySegment--${section.style}${selectedSection === section.key ? " is-active" : ""}`}
              aria-pressed={selectedSection === section.key}
              onClick={() => onSelectSection(section.key)}
            >
              <span className={`toddRoadmapSummaryMarker toddRoadmapSummaryMarker--${section.style}`} aria-hidden="true" />
              <span className="toddRoadmapSummaryLabel">{section.title}</span>
              <strong className="toddRoadmapSummaryValue">{content.value}</strong>
              <span className="toddRoadmapSummaryText">{content.summary}</span>
              {historyAlert ? (
                <span className="toddRoadmapSummaryTroubleLane">{historyAlert}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ToddMemoryAccordion({
  toddMemory,
  viewModel,
  openSections,
  selectedSection,
  sectionRefs,
  onToggleSection,
  onTriggerAlert,
  showAlertButton = true,
  showHistoricalCurrentStateReports = false,
  roadmapReports,
}: {
  toddMemory: AgentSession["toddMemory"];
  viewModel: ReturnType<typeof buildToddHardMemoryViewModel>;
  openSections: Record<ToddHardMemorySectionKey, boolean>;
  selectedSection: ToddHardMemorySectionKey | null;
  sectionRefs: MutableRefObject<Partial<Record<ToddHardMemorySectionKey, HTMLDetailsElement | null>>>;
  onToggleSection: (sectionKey: ToddHardMemorySectionKey, open: boolean) => void;
  onTriggerAlert: (sectionKey: ToddHardMemorySectionKey) => void;
  showAlertButton?: boolean;
  showHistoricalCurrentStateReports?: boolean;
  roadmapReports?: ReturnType<typeof collectToddRoadmapReportHistory>;
}) {
  const codebaseIndex = toddMemory.codebaseIndexedMap ?? null;
  const historicalRoadmapReports: ReturnType<typeof collectToddRoadmapReportHistory> = roadmapReports ?? [];
  const shouldShowHistoricalCurrentStateReports = showHistoricalCurrentStateReports && historicalRoadmapReports.length > 0;

  return (
    <>
      <ToddMemorySection
        sectionKey="history"
        title="History"
        open={openSections.history}
        selected={selectedSection === "history"}
        incomplete={viewModel.sectionStatus.history.incomplete}
        incompleteReason={viewModel.sectionStatus.history.reason}
        sectionRef={(node) => {
          sectionRefs.current.history = node;
        }}
        onToggle={onToggleSection}
        onTriggerAlert={onTriggerAlert}
        showAlertButton={showAlertButton}
      >
        {viewModel.history.previousUpdateLog.length > 0 ? (
          <div className="toddMemorySectionSubblock">
            <span className="pmStatusLabel">Completed Updates</span>
            <div className="validationResultsList">
              {viewModel.history.previousUpdateLog.map((entry) => (
                <div
                  key={entry.id}
                  className={`validationResultCard validationResultCard--${entry.status === "success" || entry.status === "no_changes" ? "pass" : "fail"}`}
                >
                  <span className="validationResultType">{entry.goal}</span>
                  <span className={`validationResultStatus${entry.status === "success" || entry.status === "no_changes" ? " pmStatusDone" : ""}`}>
                    {entry.status.replace(/_/g, " ")}
                  </span>
                  <p>{entry.outcome}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="coreDetailEmpty">No completed execution log entries yet.</p>
        )}

        <div className="toddMemorySectionSubblock toddMemorySectionSubblock--danger">
          <span className="pmStatusLabel">Trouble Lane</span>
          {viewModel.history.troubleLog.length > 0 ? (
            <div className="validationResultsList">
              {viewModel.history.troubleLog.map((entry) => (
                <div key={entry.id} className="validationResultCard validationResultCard--fail">
                  <span className="validationResultType">{entry.title}</span>
                  <span className="validationResultStatus">{entry.priority}</span>
                  <p>{entry.details}</p>
                  <p className="helperText">
                    Seen {entry.occurrences} time(s). Last seen {formatDate(entry.lastSeenAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="coreDetailEmpty">No trouble log entries yet.</p>
          )}
        </div>
      </ToddMemorySection>

      <ToddMemorySection
        sectionKey="current-state"
        title="Current State"
        open={openSections["current-state"]}
        selected={selectedSection === "current-state"}
        incomplete={viewModel.sectionStatus["current-state"].incomplete}
        incompleteReason={viewModel.sectionStatus["current-state"].reason}
        sectionRef={(node) => {
          sectionRefs.current["current-state"] = node;
        }}
        onToggle={onToggleSection}
        onTriggerAlert={onTriggerAlert}
        showAlertButton={showAlertButton}
      >
        {shouldShowHistoricalCurrentStateReports ? (
          <>
            {historicalRoadmapReports.map((report) => {
              const currentStateSummary = report.message.metadata.currentState?.trim() ?? null;
              const currentStateItems = report.message.metadata.roadmap?.currentState ?? [];

              return (
                <details key={report.id} className="agentSummaryDetails">
                  <summary>
                    <span>{report.createdAtLabel}</span>
                  </summary>
                  <div className="agentSummaryDetailsBody">
                    <div className="toddMemorySectionSubblock">
                      <span className="pmStatusLabel">Current Summary</span>
                      {currentStateSummary ? (
                        <p className="coreDetailValue">{currentStateSummary}</p>
                      ) : (
                        <p className="coreDetailEmpty">Current-state summary unavailable.</p>
                      )}
                    </div>

                    <div className="toddMemorySectionSubblock">
                      <span className="pmStatusLabel">Roadmap State Items</span>
                      {currentStateItems.length > 0 ? (
                        <div className="updatePlanList">
                          {currentStateItems.map((item) => (
                            <div key={item.id} className="agentPlannedUpdateItem">
                              <div className="updateContent">
                                <div className="updateTitle">{item.title}</div>
                                <div className="updateDescription">{item.description}</div>
                              </div>
                              <StatusChip tone={item.itemStatus === "done" ? "confirmed" : "neutral"}>
                                {item.itemStatus}
                              </StatusChip>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="coreDetailEmpty">No roadmap current-state items were captured in this report.</p>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </>
        ) : (
          <>
            {viewModel.currentState.summary ? (
              <div className="toddMemorySectionSubblock">
                <span className="pmStatusLabel">Current Summary</span>
                <p className="coreDetailValue">{viewModel.currentState.summary}</p>
              </div>
            ) : (
              <p className="coreDetailEmpty">No current-state summary is stored yet.</p>
            )}

            <div className="toddMemorySectionSubblock">
              <span className="pmStatusLabel">Roadmap State Items</span>
              {viewModel.currentState.items.length > 0 ? (
                <div className="updatePlanList">
                  {viewModel.currentState.items.map((item) => (
                    <div key={item.id} className="agentPlannedUpdateItem">
                      <div className="updateContent">
                        <div className="updateTitle">{item.title}</div>
                        <div className="updateDescription">{item.description}</div>
                      </div>
                      <StatusChip tone={item.itemStatus === "done" ? "confirmed" : "neutral"}>
                        {item.itemStatus}
                      </StatusChip>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="coreDetailEmpty">No roadmap current-state items are stored yet.</p>
              )}
            </div>
          </>
        )}

        <div className="toddMemorySectionSubblock">
          <span className="pmStatusLabel">Codebase Index</span>
          {codebaseIndex ? (
            <>
              <p className="coreDetailValue">{codebaseIndex.summary ?? "No codebase summary yet."}</p>
              {codebaseIndex.featureAreas.length > 0 ? (
                <div className="flowStepPillars" style={{ marginTop: 8 }}>
                  {codebaseIndex.featureAreas.map((area) => (
                    <span key={area} className="flowStepPillarTag">{area}</span>
                  ))}
                </div>
              ) : null}
              {codebaseIndex.repoNotes.length > 0 ? (
                <ul className="agentSummaryList" style={{ marginTop: 8 }}>
                  {codebaseIndex.repoNotes.map((note, index) => (
                    <li key={`codebase-note-${index}`}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <p className="helperText" style={{ marginTop: 6 }}>
                Indexed {formatDate(codebaseIndex.indexedAt)}
              </p>
            </>
          ) : (
            <p className="coreDetailEmpty">Todd has not indexed the codebase yet.</p>
          )}
        </div>
      </ToddMemorySection>

      <ToddMemorySection
        sectionKey="priority-update"
        title="Priority Update"
        open={openSections["priority-update"]}
        selected={selectedSection === "priority-update"}
        incomplete={viewModel.sectionStatus["priority-update"].incomplete}
        incompleteReason={viewModel.sectionStatus["priority-update"].reason}
        sectionRef={(node) => {
          sectionRefs.current["priority-update"] = node;
        }}
        onToggle={onToggleSection}
        onTriggerAlert={onTriggerAlert}
        showAlertButton={showAlertButton}
      >
        {viewModel.priorityUpdate ? (() => {
          const priorityUpdate = viewModel.priorityUpdate;
          return (
            <>
              <div className="agentPlannedUpdateItem">
                <div className="updateContent">
                  <div className="updateTitle">{priorityUpdate.title}</div>
                  <div className="updateDescription">{priorityUpdate.description}</div>
                  <div className="flowStepPillars" style={{ marginTop: 8 }}>
                    {priorityUpdate.updateKind ? (
                      <span className="flowStepPillarTag">{labelForToddUpdateKind(priorityUpdate.updateKind)}</span>
                    ) : null}
                    {priorityUpdate.simplificationMode ? (
                      <span className="flowStepPillarTag">{labelForToddSimplificationMode(priorityUpdate.simplificationMode)}</span>
                    ) : null}
                    {priorityUpdate.pillarNames.map((name) => (
                      <span key={`${priorityUpdate.id}-${name}`} className="flowStepPillarTag">{name}</span>
                    ))}
                  </div>
                </div>
                <StatusChip tone={priorityUpdate.source === "live" ? "info" : "neutral"}>
                  {priorityUpdate.source === "live" ? "live" : "roadmap"}
                </StatusChip>
              </div>

              <div className="toddMemorySectionSubblock">
                <span className="pmStatusLabel">Ping Contract</span>
                {priorityUpdate.currentStateContext ? (
                  <p className="helperText">Current-state context: {priorityUpdate.currentStateContext}</p>
                ) : (
                  <p className="coreDetailEmpty">Current-state context has not been mapped yet.</p>
                )}
                {priorityUpdate.successDefinition ? (
                  <p className="helperText">Success: {priorityUpdate.successDefinition}</p>
                ) : (
                  <p className="coreDetailEmpty">Success definition is missing.</p>
                )}
                {priorityUpdate.partialSuccessDefinition ? (
                  <p className="helperText">Partial success: {priorityUpdate.partialSuccessDefinition}</p>
                ) : (
                  <p className="coreDetailEmpty">Partial-success definition is missing.</p>
                )}
                {priorityUpdate.partialFailureDefinition ? (
                  <p className="helperText">Partial failure: {priorityUpdate.partialFailureDefinition}</p>
                ) : (
                  <p className="coreDetailEmpty">Partial-failure definition is missing.</p>
                )}
                {priorityUpdate.failureDefinition ? (
                  <p className="helperText">Failure: {priorityUpdate.failureDefinition}</p>
                ) : (
                  <p className="coreDetailEmpty">Failure definition is missing.</p>
                )}
              </div>

              <div className="toddMemorySectionSubblock">
                <span className="pmStatusLabel">Execution Framing</span>
                {priorityUpdate.structuralReason ? (
                  <p className="helperText">Structural reason: {priorityUpdate.structuralReason}</p>
                ) : null}
                {priorityUpdate.supportsNextStep ? (
                  <p className="helperText">Supports next: {priorityUpdate.supportsNextStep}</p>
                ) : null}
                {priorityUpdate.dependencies.length > 0 ? (
                  <p className="helperText">Depends on: {priorityUpdate.dependencies.join(", ")}</p>
                ) : (
                  <p className="coreDetailEmpty">No explicit dependencies are stored.</p>
                )}
                {priorityUpdate.skillsNeeded.length > 0 ? (
                  <div className="flowStepPillars">
                    {priorityUpdate.skillsNeeded.map((skill) => (
                      <span key={`${priorityUpdate.id}-${skill}`} className="flowStepPillarTag">{skill}</span>
                    ))}
                  </div>
                ) : (
                  <p className="coreDetailEmpty">No explicit skills are stored for this step.</p>
                )}
              </div>
            </>
          );
        })() : (
          <p className="coreDetailEmpty">No priority update is selected yet.</p>
        )}
      </ToddMemorySection>

      <ToddMemorySection
        sectionKey="success-chain"
        title="Success Chain"
        open={openSections["success-chain"]}
        selected={selectedSection === "success-chain"}
        incomplete={viewModel.sectionStatus["success-chain"].incomplete}
        incompleteReason={viewModel.sectionStatus["success-chain"].reason}
        sectionRef={(node) => {
          sectionRefs.current["success-chain"] = node;
        }}
        onToggle={onToggleSection}
        onTriggerAlert={onTriggerAlert}
        showAlertButton={showAlertButton}
      >
        {viewModel.successChain.steps.length > 0 ? (
          <div className="updatePlanList">
            {viewModel.successChain.steps.map((step, index) => (
              <div key={step.id} className="agentPlannedUpdateItem">
                <div className="updateContent">
                  <div className="updateTitle">{step.title}</div>
                  <div className="updateDescription">{step.description}</div>
                  <p className="helperText" style={{ marginTop: 6 }}>
                    Step {index + 1}{step.satisfiedAt ? ` · satisfied ${formatDate(step.satisfiedAt)}` : ""}
                  </p>
                </div>
                <StatusChip tone={step.satisfied ? "confirmed" : "neutral"}>
                  {step.satisfied ? "done" : "pending"}
                </StatusChip>
              </div>
            ))}
          </div>
        ) : viewModel.successChain.trackedCount > 0 ? (
          <p className="coreDetailEmpty">No remaining future steps are currently mapped beyond the current state.</p>
        ) : (
          <p className="coreDetailEmpty">No success chain steps have been defined yet.</p>
        )}

        <div className="toddMemorySectionSubblock">
          <span className="pmStatusLabel">Supporting Queue</span>
          {viewModel.successChain.supportingQueuedUpdates.length > 0 ? (
            <div className="programmingQueue">
              {viewModel.successChain.supportingQueuedUpdates.map((update) => (
                <div key={update.id} className="agentPlannedUpdateItem">
                  <div className="updateContent">
                    <div className="updateTitle">{update.title}</div>
                    <div className="updateDescription">{update.description}</div>
                    <div className="flowStepPillars" style={{ marginTop: 8 }}>
                      {update.updateKind ? (
                        <span className="flowStepPillarTag">{labelForToddUpdateKind(update.updateKind)}</span>
                      ) : null}
                      {update.simplificationMode ? (
                        <span className="flowStepPillarTag">{labelForToddSimplificationMode(update.simplificationMode)}</span>
                      ) : null}
                    </div>
                  </div>
                  <StatusChip
                    tone={update.status === "in_progress"
                      ? "info"
                      : update.status === "completed"
                        ? "confirmed"
                        : update.status === "failed"
                          ? "action_required"
                          : "neutral"}
                  >
                    {update.status.replace(/_/g, " ")}
                  </StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="coreDetailEmpty">No remaining queued updates beyond the priority update.</p>
          )}
        </div>
      </ToddMemorySection>

      <ToddMemorySection
        sectionKey="end-state"
        title="End State"
        open={openSections["end-state"]}
        selected={selectedSection === "end-state"}
        incomplete={viewModel.sectionStatus["end-state"].incomplete}
        incompleteReason={viewModel.sectionStatus["end-state"].reason}
        sectionRef={(node) => {
          sectionRefs.current["end-state"] = node;
        }}
        onToggle={onToggleSection}
        onTriggerAlert={onTriggerAlert}
        showAlertButton={showAlertButton}
      >
        {viewModel.endState.summary ? (
          <div className="toddMemorySectionSubblock">
            <span className="pmStatusLabel">End-State Summary</span>
            <p className="coreDetailValue">{viewModel.endState.summary}</p>
          </div>
        ) : (
          <p className="coreDetailEmpty">No end-state summary is stored yet.</p>
        )}

        <div className="toddMemorySectionSubblock">
          <span className="pmStatusLabel">Roadmap End-State Items</span>
          {viewModel.endState.items.length > 0 ? (
            <div className="updatePlanList">
              {viewModel.endState.items.map((item) => (
                <div key={item.id} className="agentPlannedUpdateItem">
                  <div className="updateContent">
                    <div className="updateTitle">{item.title}</div>
                    <div className="updateDescription">{item.description}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="coreDetailEmpty">No roadmap end-state items are stored yet.</p>
          )}
        </div>
      </ToddMemorySection>
    </>
  );
}

function ToddHardMemoryPanel({
  toddMemory,
  corePillars,
  onRegeneratePlan,
}: {
  toddMemory: AgentSession["toddMemory"];
  corePillars: CorePillar[];
  onRegeneratePlan: () => void;
}) {
  const viewModel = useMemo(
    () => buildToddHardMemoryViewModel(toddMemory, corePillars),
    [corePillars, toddMemory],
  );
  const [openSections, setOpenSections] = useState<Record<ToddHardMemorySectionKey, boolean>>(createToddHardMemoryOpenState);
  const [selectedSection, setSelectedSection] = useState<ToddHardMemorySectionKey | null>(null);
  const sectionRefs = useRef<Partial<Record<ToddHardMemorySectionKey, HTMLDetailsElement | null>>>({});

  const handleToggleSection = (sectionKey: ToddHardMemorySectionKey, open: boolean) => {
    setOpenSections((current) => ({ ...current, [sectionKey]: open }));
  };

  const handleSelectSection = (sectionKey: ToddHardMemorySectionKey) => {
    setSelectedSection(sectionKey);
    setOpenSections((current) => ({ ...current, [sectionKey]: true }));

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        sectionRefs.current[sectionKey]?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    });
  };

  const handleTriggerAlert = (sectionKey: ToddHardMemorySectionKey) => {
    setSelectedSection(sectionKey);
    setOpenSections((current) => ({ ...current, [sectionKey]: true }));
    onRegeneratePlan();
  };

  return (
    <>
      <ToddRoadmapSummary
        viewModel={viewModel}
        selectedSection={selectedSection}
        onSelectSection={handleSelectSection}
      />
      <ToddMemoryAccordion
        toddMemory={toddMemory}
        viewModel={viewModel}
        openSections={openSections}
        selectedSection={selectedSection}
        sectionRefs={sectionRefs}
        onToggleSection={handleToggleSection}
        onTriggerAlert={handleTriggerAlert}
      />
    </>
  );
}

const createToddRoadmapReportOpenState = (): Record<ToddHardMemorySectionKey, boolean> => ({
  history: true,
  "current-state": true,
  "priority-update": true,
  "success-chain": true,
  "end-state": true,
});

function ToddRoadmapReportSections({
  toddMemory,
  corePillars,
  roadmapReports,
}: {
  toddMemory: AgentSession["toddMemory"];
  corePillars: CorePillar[];
  roadmapReports: ReturnType<typeof collectToddRoadmapReportHistory>;
}) {
  const viewModel = useMemo(
    () => buildToddHardMemoryViewModel(toddMemory, corePillars),
    [corePillars, toddMemory],
  );
  const openSections = useMemo(createToddRoadmapReportOpenState, []);
  const sectionRefs = useRef<Partial<Record<ToddHardMemorySectionKey, HTMLDetailsElement | null>>>({});

  return (
    <ToddMemoryAccordion
      toddMemory={toddMemory}
      viewModel={viewModel}
      openSections={openSections}
      selectedSection={null}
      sectionRefs={sectionRefs}
      onToggleSection={() => {}}
      onTriggerAlert={() => {}}
      showAlertButton={false}
      roadmapReports={roadmapReports}
      showHistoricalCurrentStateReports
    />
  );
}

function ToddResearchReportSection({
  researchReports,
}: {
  researchReports: ReturnType<typeof collectToddResearchReportHistory>;
}) {
  if (researchReports.length === 0) {
    return <p className="coreDetailEmpty">No Todd research report has been captured yet.</p>;
  }

  return (
    <>
      {researchReports.map((report) => {
        const researchPrompt = report.message.metadata.researchPrompt?.trim() || null;

        return (
          <details key={report.id} className="agentSummaryDetails">
            <summary>
              <span>{report.createdAtLabel}</span>
            </summary>
            <div className="agentSummaryDetailsBody">
              <div className="toddMemorySectionSubblock">
                <span className="pmStatusLabel">Research Prompt</span>
                {researchPrompt ? (
                  <p className="coreDetailValue">{researchPrompt}</p>
                ) : (
                  <p className="coreDetailEmpty">Research prompt unavailable.</p>
                )}
              </div>
              <div className="toddMemorySectionSubblock">
                <span className="pmStatusLabel">General Findings</span>
                <AgentChatMarkdown text={report.message.metadata.generalSummary} />
              </div>
              <div className="toddMemorySectionSubblock">
                <span className="pmStatusLabel">Project-Specific Findings</span>
                <AgentChatMarkdown text={report.message.metadata.projectSummary} />
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}

function ToddReportsPanel({
  session,
}: {
  session: AgentSession;
}) {
  const roadmapReports = useMemo(() => collectToddRoadmapReportHistory(session), [session]);
  const researchReports = useMemo(() => collectToddResearchReportHistory(session), [session]);

  return (
    <section
      className="agentSummaryCard agentSummaryCard--personal"
      style={{ "--memory-accent": DIRECTOR_COLORS["rd-director"] } as CSSProperties}
    >
      <div className="agentSummaryHeader">
        <span className="agentSummaryEyebrow">Todd Reports</span>
        <span className="usagePreviewLabel">{roadmapReports.length + researchReports.length}</span>
      </div>
      <div className="agentSummarySharedBody">
        <details className="agentSummaryDetails" open>
          <summary>Roadmap</summary>
          <div className="agentSummaryDetailsBody">
            <ToddRoadmapReportSections
              toddMemory={session.toddMemory}
              corePillars={session.corePillars}
              roadmapReports={roadmapReports}
            />
          </div>
        </details>

        <details className="agentSummaryDetails" open>
          <summary>Research</summary>
          <div className="agentSummaryDetailsBody">
            <ToddResearchReportSection researchReports={researchReports} />
          </div>
        </details>
      </div>
    </section>
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
            {confirmedConcept && toddMemory.roadmap && confirmedConcept.corePillars.some((pillar) =>
              (toddMemory.roadmap?.pathway ?? []).some((item) => item.pillarIds.includes(pillar.id))
              || (toddMemory.roadmap?.currentState ?? []).some((item) => item.pillarIds.includes(pillar.id))
              || (toddMemory.roadmap?.endState ?? []).some((item) => item.pillarIds.includes(pillar.id))
            ) ? (
              <div className="conceptNotesBlock" style={{ marginTop: 12 }}>
                <span className="pmStatusLabel">Roadmap Connections</span>
                {confirmedConcept.corePillars.map((pillar) => {
                  const road = toddMemory.roadmap!;
                  const csItems = road.currentState.filter((i) => i.pillarIds.includes(pillar.id));
                  const pathItems = road.pathway.filter((i) => i.pillarIds.includes(pillar.id));
                  const esItems = road.endState.filter((i) => i.pillarIds.includes(pillar.id));
                  if (!csItems.length && !pathItems.length && !esItems.length) return null;
                  return (
                    <div key={pillar.id} className="roadmapPillarConnectionBlock">
                      <strong className="roadmapPillarConnectionName">{pillar.name}</strong>
                      {csItems.map((item) => (
                        <div key={item.id} className="roadmapConnectionRow">
                          <span className="roadmapConnectionKind">Current</span>
                          <span className="roadmapConnectionTitle">{item.title}</span>
                          <StatusChip tone={item.itemStatus === "done" ? "confirmed" : "neutral"}>{item.itemStatus}</StatusChip>
                        </div>
                      ))}
                      {pathItems.map((item) => (
                        <div key={item.id} className="roadmapConnectionRow">
                          <span className="roadmapConnectionKind">{item.updateKind === "create" ? "Create" : item.updateKind === "expand" ? "Expand" : "Refine"}</span>
                          <span className="roadmapConnectionTitle">{item.title}</span>
                        </div>
                      ))}
                      {esItems.map((item) => (
                        <div key={item.id} className="roadmapConnectionRow">
                          <span className="roadmapConnectionKind">End State</span>
                          <span className="roadmapConnectionTitle">{item.title}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
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

      return (
        <>
          {summaryPanel}
          <div className="agentInfoPanel">
            <ToddHardMemoryPanel
              toddMemory={toddMemory}
              corePillars={session.corePillars}
              onRegeneratePlan={() => {
                void window.programs.regenerateToddPlan({
                  projectId,
                  provider: settings.advancedDefaults.provider,
                  model: settings.advancedDefaults.model,
                  claudeModel: settings.advancedDefaults.claudeModel,
                }).then(() => window.programs.getAgentSession(projectId)).then((refreshed) => {
                  if (refreshed) {
                    onSessionUpdate(refreshed);
                  }
                }).catch((error) => {
                  pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
                });
              }}
            />
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

type MemoryView = "soft" | "hard" | "backup";
type SharedMemoryView = DirectorSharedMemorySource["kind"];

function renderSharedMemorySourceContent({
  source,
  session,
  onViewExecutionReport,
}: {
  source: DirectorSharedMemorySource;
  session: AgentSession;
  onViewExecutionReport?: (report: JeffExecutionReport) => void;
}): ReactNode {
  const renderSummaryCard = (
    title: string,
    statusText: string,
    tone: "action_required" | "confirmed" | "info" | "neutral",
    summary: string,
    extra?: ReactNode,
  ) => (
    <article className="agentDetailsCard">
      <div className="agentDetailsSubsectionHead">
        <h5 style={{ margin: 0 }}>{title}</h5>
        <StatusChip tone={tone}>{statusText}</StatusChip>
      </div>
      <p className="agentDetailsDescription">{summary}</p>
      {extra}
    </article>
  );

  switch (source.kind) {
    case "dan-core-details":
      return (
        <ConceptOverview
          concept={getConfirmedConcept(session)}
          emptyLabel="No confirmed core-details yet."
        />
      );
    case "todd-update-context": {
      const queuedUpdates = session.toddMemory.futureUpdatePlan.filter((update) =>
        update.status === "pending" || update.status === "in_progress",
      );

      return (
        <>
          <details className="agentSummaryDetails">
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
                {session.pingMemory.activeTask
                  ? `Active task: ${session.pingMemory.activeTask}`
                  : "Ping is waiting for the next Todd-approved update."}
              </p>
              {session.pingMemory.context ? (
                <p className="coreDetailValue" style={{ marginTop: 8 }}>{session.pingMemory.context}</p>
              ) : null}
              {session.pingMemory.codebaseMapSummary ? (
                <p className="helperText" style={{ marginTop: 8 }}>{session.pingMemory.codebaseMapSummary}</p>
              ) : null}
              {session.pingMemory.latestRawReport ? (
                <div className="validationResultCard validationResultCard--pass" style={{ marginTop: 12 }}>
                  <span className="validationResultType">Latest execution</span>
                  <span className="validationResultStatus">{session.pingMemory.latestRawReport.status.replace(/_/g, " ")}</span>
                  <p>{session.pingMemory.latestRawReport.summary}</p>
                </div>
              ) : null}
            </div>
          </details>
        </>
      );
    }
    case "jeff-latest-report": {
      const report = session.pingMemory.latestJeffReport;
      return report ? (
        renderSummaryCard(
          report.title,
          report.decision ?? report.toddRecommendedDecision ?? report.rawReport.status.replace(/_/g, " "),
          report.decision === "successful" || report.rawReport.status === "success" || report.rawReport.status === "no_changes"
            ? "confirmed"
            : report.decision === "failure" || report.rawReport.status === "blocked"
              ? "action_required"
              : "info",
          report.summary,
          onViewExecutionReport ? (
            <button
              type="button"
              className="agentChatViewMoreButton"
              style={{ marginTop: 12 }}
              onClick={() => onViewExecutionReport(report)}
            >
              View Project Status Report
            </button>
          ) : null
        )
      ) : (
        <p className="coreDetailEmpty">No latest Jeff report yet.</p>
      );
    }
    case "todd-validation-request": {
      const validationRequest = session.pongMemory.validationRequest ?? null;
      const currentTask = session.pongTaskContext?.currentTask ?? null;
      const relevantPillars = session.pongTaskContext?.relevantPillarIds ?? validationRequest?.relevantPillarIds ?? [];
      const pillarNames = relevantPillars
        .map((pillarId) => session.corePillars.find((pillar) => pillar.id === pillarId)?.name ?? pillarId)
        .filter((value, index, values) => values.indexOf(value) === index);
      const instruction = validationRequest?.instruction ?? session.pongMemory.jeffInstruction ?? null;

      return instruction ? (
        <>
          <details className="agentSummaryDetails">
            <summary>Validation Request</summary>
            <div className="agentSummaryDetailsBody">
              <p className="coreDetailValue">{instruction}</p>
              {currentTask ? (
                <p className="helperText" style={{ marginTop: 8 }}>Task: {currentTask}</p>
              ) : null}
              {validationRequest?.updateId ? (
                <p className="helperText">Update ID: {validationRequest.updateId}</p>
              ) : null}
              {pillarNames.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <span className="pmStatusLabel">Relevant Pillars</span>
                  <ul className="agentSummaryList">
                    {pillarNames.map((name) => <li key={name}>{name}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : (
        <p className="coreDetailEmpty">No validation request recorded yet.</p>
      );
    }
    case "pong-validation-history": {
      const previousReports = session.pongMemory.previousValidationReports;
      const validationResults = session.validationResults;
      const pendingValidations = session.jeffMemory.pendingValidations;

      return (
        <>
          <details className="agentSummaryDetails">
            <summary>Recent Validation Reports</summary>
            <div className="agentSummaryDetailsBody">
              {previousReports.length > 0 ? (
                <div className="validationResultsList">
                  {previousReports.slice(-5).reverse().map((report) => (
                    <article key={report.id} className="agentDetailsCard">
                      <div className="agentDetailsSubsectionHead">
                        <h5 style={{ margin: 0 }}>Validation Report</h5>
                        <StatusChip tone={report.passed === false ? "action_required" : report.passed === true ? "confirmed" : "info"}>
                          {report.passed === null ? "pending" : report.passed ? "pass" : "fail"}
                        </StatusChip>
                      </div>
                      <p className="agentDetailsDescription">{report.summary}</p>
                      {report.details ? <p className="helperText">{report.details}</p> : null}
                    </article>
                  ))}
                </div>
              ) : validationResults.length > 0 ? (
                <div className="validationResultsList">
                  {validationResults.slice(-5).reverse().map((result) => (
                    <article key={result.id} className="agentDetailsCard">
                      <div className="agentDetailsSubsectionHead">
                        <h5 style={{ margin: 0 }}>{result.validationType}</h5>
                        <StatusChip tone={result.passed ? "confirmed" : "action_required"}>
                          {result.passed ? "PASS" : "FAIL"}
                        </StatusChip>
                      </div>
                      <p className="agentDetailsDescription">{result.summary}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="coreDetailEmpty">No validation results yet.</p>
              )}
            </div>
          </details>

          {pendingValidations.length > 0 ? (
            <details className="agentSummaryDetails">
              <summary>Pending Validations</summary>
              <div className="agentSummaryDetailsBody">
                <div className="validationResultsList">
                  {pendingValidations.slice(-5).reverse().map((report) => (
                    <article key={report.id} className="agentDetailsCard">
                      <div className="agentDetailsSubsectionHead">
                        <h5 style={{ margin: 0 }}>Pending Validation</h5>
                        <StatusChip tone="info">pending</StatusChip>
                      </div>
                      <p className="agentDetailsDescription">{report.summary}</p>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          ) : null}
        </>
      );
    }
    case "todd-roadmap-and-updates": {
      const roadmap = session.toddMemory.hardMemory ?? session.toddMemory.roadmap ?? null;
      const queuedUpdates = session.toddMemory.futureUpdatePlan.filter((update) =>
        update.status === "pending" || update.status === "in_progress",
      );
      const updateReports = session.toddMemory.previousUpdateLog;
      const troubleLog = session.toddMemory.troubleLog;

      return (
        <>
          <details className="agentSummaryDetails">
            <summary>Roadmap</summary>
            <div className="agentSummaryDetailsBody">
              {roadmap ? (
                <div className="agentInfoPanelSection">
                  <p className="coreDetailValue">
                    {roadmap.priorityUpdate
                      ? `Priority update: ${roadmap.priorityUpdate.title}`
                      : "No priority update locked in yet."}
                  </p>
                  <p className="helperText" style={{ marginTop: 8 }}>
                    {session.toddMemory.currentState ? `Current state: ${session.toddMemory.currentState}` : "Current state not set."}
                  </p>
                  <p className="helperText">
                    {session.toddMemory.endStateGoal ? `End state: ${session.toddMemory.endStateGoal}` : "End state not set."}
                  </p>
                  <p className="helperText">
                    {roadmap.currentState.length} current-state item(s), {roadmap.pathway.length} pathway item(s), {roadmap.endState.length} end-state item(s)
                  </p>
                </div>
              ) : (
                <p className="coreDetailEmpty">No roadmap has been locked yet.</p>
              )}
            </div>
          </details>

          <details className="agentSummaryDetails">
            <summary>Update Queue</summary>
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
                <p className="coreDetailEmpty">No updates are queued right now.</p>
              )}
            </div>
          </details>

          <details className="agentSummaryDetails">
            <summary>Update Reports</summary>
            <div className="agentSummaryDetailsBody">
              {updateReports.length > 0 ? (
                <div className="validationResultsList">
                  {updateReports.slice(-5).reverse().map((entry) => (
                    <article key={entry.id} className="agentDetailsCard">
                      <div className="agentDetailsSubsectionHead">
                        <h5 style={{ margin: 0 }}>{entry.goal}</h5>
                        <StatusChip tone={entry.status === "success" || entry.status === "no_changes" ? "confirmed" : "action_required"}>
                          {entry.status.replace(/_/g, " ")}
                        </StatusChip>
                      </div>
                      <p className="agentDetailsDescription">{entry.outcome}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="coreDetailEmpty">No update reports have been recorded yet.</p>
              )}
            </div>
          </details>

          {troubleLog.length > 0 ? (
            <details className="agentSummaryDetails">
              <summary>Trouble Log</summary>
              <div className="agentSummaryDetailsBody">
                <div className="validationResultsList">
                  {troubleLog.map((entry) => (
                    <article key={entry.id} className="agentDetailsCard">
                      <div className="agentDetailsSubsectionHead">
                        <h5 style={{ margin: 0 }}>{entry.title}</h5>
                        <StatusChip tone="action_required">{entry.priority}</StatusChip>
                      </div>
                      <p className="agentDetailsDescription">{entry.details}</p>
                      <p className="helperText">Seen {entry.occurrences} time(s). Last seen {formatDate(entry.lastSeenAt)}</p>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          ) : null}
        </>
      );
    }
    case "ping-execution-reports": {
      const pendingReports = session.jeffMemory.pendingReports;
      const outcomeLog = session.jeffMemory.outcomeLog;

      return (
        <>
          <details className="agentSummaryDetails">
            <summary>Pending Reports</summary>
            <div className="agentSummaryDetailsBody">
              {pendingReports.length > 0 ? (
                <div className="validationResultsList">
                  {pendingReports.slice(-5).reverse().map((report) => {
                    const statusText = report.decision ?? report.toddRecommendedDecision ?? report.rawReport.status.replace(/_/g, " ");
                    const tone = report.decision === "failure"
                      || report.rawReport.status === "blocked"
                      ? "action_required"
                      : report.decision === "successful" || report.rawReport.status === "success" || report.rawReport.status === "no_changes"
                        ? "confirmed"
                        : "info";
                    return (
                      <article key={report.id} className="agentDetailsCard">
                        <div className="agentDetailsSubsectionHead">
                          <h5 style={{ margin: 0 }}>{report.title}</h5>
                          <StatusChip tone={tone}>{statusText.replace(/_/g, " ")}</StatusChip>
                        </div>
                        <p className="agentDetailsDescription">{report.summary}</p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="coreDetailEmpty">No pending reports yet.</p>
              )}
            </div>
          </details>

          <details className="agentSummaryDetails">
            <summary>Outcome Log</summary>
            <div className="agentSummaryDetailsBody">
              {outcomeLog.length > 0 ? (
                <div className="validationResultsList">
                  {outcomeLog.slice(-5).reverse().map((entry) => (
                    <article key={entry.id} className="agentDetailsCard">
                      <div className="agentDetailsSubsectionHead">
                        <h5 style={{ margin: 0 }}>{entry.decision.replace(/_/g, " ")}</h5>
                        <StatusChip tone={entry.decision === "failure" ? "action_required" : "confirmed"}>
                          {entry.decision}
                        </StatusChip>
                      </div>
                      <p className="agentDetailsDescription">{entry.summary}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="coreDetailEmpty">No outcome log entries yet.</p>
              )}
            </div>
          </details>
        </>
      );
    }
  }

  return null;
}

const getPingUpdateReportTone = (
  metadata: Extract<NonNullable<AgentSession["slackMessages"][number]["metadata"]>, { type: "ping-update-report" }>,
): "action_required" | "confirmed" | "info" => (
  metadata.rawReport.status === "blocked"
    ? "action_required"
    : metadata.rawReport.status === "success" || metadata.rawReport.status === "no_changes"
      ? "confirmed"
      : "info"
);

const getExecutionReportTone = (
  decision: JeffExecutionReport["decision"],
  status: JeffExecutionReport["rawReport"]["status"],
): "action_required" | "confirmed" | "info" => (
  decision === "failure" || status === "blocked"
    ? "action_required"
    : decision === "successful" || status === "success" || status === "no_changes"
      ? "confirmed"
      : "info"
);

function DirectorReportsPanel({
  directorId,
  session,
  onViewExecutionReport,
}: {
  directorId: DirectorId;
  session: AgentSession;
  onViewExecutionReport?: (report: JeffExecutionReport) => void;
}) {
  const reports = useMemo(
    () => buildDirectorReportStream(directorId, session),
    [directorId, session],
  );

  if (directorId === "rd-director") {
    return (
      <div className="agentSummarySupplemental">
        <ToddReportsPanel session={session} />
      </div>
    );
  }

  return (
    <div className="agentSummarySupplemental">
      <section
        className="agentSummaryCard agentSummaryCard--personal"
        style={{ "--memory-accent": DIRECTOR_COLORS[directorId] } as CSSProperties}
      >
        <div className="agentSummaryHeader">
          <span className="agentSummaryEyebrow">{`${DIRECTOR_NAMES[directorId]} Reports`}</span>
          <span className="usagePreviewLabel">{reports.length}</span>
        </div>
        <div className="agentSummarySharedBody">
          {reports.length > 0 ? reports.map((report) => (
            <details key={report.id} className="agentSummaryDetails">
              <summary>
                <span>{report.title}</span>
                <span className="memoryReportSummaryMeta">
                  <StatusChip
                    tone={report.kind === "hard-memory-report"
                      ? "confirmed"
                      : report.kind === "ping-update-report"
                        ? getPingUpdateReportTone(report.metadata)
                        : getExecutionReportTone(report.metadata.report.decision, report.metadata.report.rawReport.status)}
                  >
                    {report.kind === "hard-memory-report"
                      ? "hard memory"
                      : report.kind === "ping-update-report"
                        ? report.metadata.rawReport.status.replace(/_/g, " ")
                        : (report.metadata.report.decision ?? report.metadata.report.rawReport.status).replace(/_/g, " ")}
                  </StatusChip>
                  <span className="helperText">{formatDate(report.createdAt)}</span>
                </span>
              </summary>
              <div className="agentSummaryDetailsBody">
                {report.kind === "hard-memory-report" ? (
                  <HardMemoryReportSections
                    report={report.metadata}
                    session={session}
                  />
                ) : null}
                {report.kind === "ping-update-report" ? (
                  <>
                    <p className="coreDetailValue">{report.summary}</p>
                    {report.metadata.report?.plan?.summary ? (
                      <p className="helperText">Plan summary: {report.metadata.report.plan.summary}</p>
                    ) : null}
                    {report.metadata.rawReport.changedFiles.length > 0 ? (
                      <div>
                        <span className="pmStatusLabel">Changed Files</span>
                        <ul className="agentSummaryList">
                          {report.metadata.rawReport.changedFiles.map((filePath) => (
                            <li key={`${report.id}-${filePath}`}>{filePath}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {report.metadata.rawReport.unexpectedNotes.length > 0 ? (
                      <div>
                        <span className="pmStatusLabel">Unexpected Notes</span>
                        <ul className="agentSummaryList">
                          {report.metadata.rawReport.unexpectedNotes.map((note, index) => (
                            <li key={`${report.id}-unexpected-${index}`}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {report.metadata.rawReport.blocker ? (
                      <div className="toddMemorySectionSubblock toddMemorySectionSubblock--danger">
                        <span className="pmStatusLabel">Blocker</span>
                        <p className="coreDetailValue">{report.metadata.rawReport.blocker}</p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {report.kind === "execution-report" ? (
                  <>
                    <p className="coreDetailValue">{report.summary}</p>
                    <p className="helperText">
                      Outcome: {(report.metadata.report.decision ?? report.metadata.report.rawReport.status).replace(/_/g, " ")}
                    </p>
                    <p className="helperText">Raw status: {report.metadata.report.rawReport.status.replace(/_/g, " ")}</p>
                    {onViewExecutionReport ? (
                      <button
                        type="button"
                        className="agentChatViewMoreButton"
                        onClick={() => onViewExecutionReport(report.metadata.report)}
                      >
                        View Project Status Report
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </details>
          )) : (
            <p className="coreDetailEmpty">No formal reports are stored for this agent yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

export function DirectorMemoryPanel({
  directorId,
  session,
  projectId,
  settings,
  onSessionUpdate,
  pushToast,
  onViewExecutionReport,
}: {
  directorId: DirectorId;
  session: AgentSession | null;
  projectId?: string | null;
  settings: Settings;
  onSessionUpdate?: (session: AgentSession) => void;
  pushToast?: (message: string, level: "info" | "success" | "error") => void;
  onViewExecutionReport?: (report: JeffExecutionReport) => void;
}) {
  const [memoryView, setMemoryView] = useState<MemoryView>("hard");
  const [importedMemoryView, setImportedMemoryView] = useState<SharedMemoryView | null>(null);
  const [exportedMemoryView, setExportedMemoryView] = useState<DirectorId | null>(null);
  const importedMemorySources = useMemo(
    () => buildDirectorSharedMemorySources(directorId, session),
    [directorId, session],
  );
  const exportedMemoryTargets = useMemo(
    () => buildDirectorExportedMemoryTargets(directorId, session),
    [directorId, session],
  );

  if (!session) return null;

  const regenerateToddPlan = async () => {
    if (!projectId || directorId !== "rd-director" || !onSessionUpdate || !pushToast) {
      return;
    }
    try {
      await window.programs.regenerateToddPlan({
        projectId,
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
      });
      const refreshed = await window.programs.getAgentSession(projectId);
      if (refreshed) {
        onSessionUpdate(refreshed);
      }
      pushToast("Todd's plan regenerated.", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Something went wrong.", "error");
    }
  };

  const personalMemoryTitle = `${DIRECTOR_NAMES[directorId]} Personal Memory`;
  const personalMemoryAccent = DIRECTOR_COLORS[directorId];
  const personalMemoryCardStyle = ({ "--memory-accent": personalMemoryAccent } as CSSProperties);
  const memorySectionTitle = (kind: "Imported" | "Exported") => `${DIRECTOR_NAMES[directorId]} ${kind} Memory`;
  const activeImportedMemorySource = importedMemorySources.find((source) => source.kind === importedMemoryView) ?? importedMemorySources[0] ?? null;
  const activeExportedMemoryTarget = exportedMemoryTargets.find((target) => target.directorId === exportedMemoryView) ?? exportedMemoryTargets[0] ?? null;
  const importedMemoryAccent = activeImportedMemorySource ? DIRECTOR_COLORS[activeImportedMemorySource.directorId] : null;
  const exportedMemoryAccent = activeExportedMemoryTarget ? DIRECTOR_COLORS[activeExportedMemoryTarget.directorId] : DIRECTOR_COLORS[directorId];
  const importedMemoryCard = activeImportedMemorySource ? (
    <section
      className="agentSummaryCard agentSummaryCard--shared"
      style={importedMemoryAccent ? ({ "--memory-accent": importedMemoryAccent } as CSSProperties) : undefined}
    >
      <div className="agentSummaryHeader">
        <span className="agentSummaryEyebrow">{memorySectionTitle("Imported")}</span>
        <div className="speedToggle memoryToggle memoryToggle--wrap">
          {importedMemorySources.map((source) => (
            <button
              key={source.kind}
              type="button"
              className={`toggleOption${activeImportedMemorySource.kind === source.kind ? " active" : ""}`}
              onClick={() => setImportedMemoryView(source.kind)}
            >
              {source.label}
            </button>
          ))}
        </div>
      </div>
      <div className="agentSummarySharedBody">
        {renderSharedMemorySourceContent({
          source: activeImportedMemorySource,
          session,
          onViewExecutionReport,
        })}
      </div>
    </section>
  ) : null;
  const exportedMemoryCard = (
    <section
      className="agentSummaryCard agentSummaryCard--shared"
      style={{ "--memory-accent": exportedMemoryAccent } as CSSProperties}
    >
      <div className="agentSummaryHeader">
        <span className="agentSummaryEyebrow">{memorySectionTitle("Exported")}</span>
        <div className="speedToggle memoryToggle memoryToggle--wrap">
          {exportedMemoryTargets.length > 0 ? (
            exportedMemoryTargets.map((target) => (
              <button
                key={target.directorId}
                type="button"
                className={`toggleOption${activeExportedMemoryTarget?.directorId === target.directorId ? " active" : ""}`}
                onClick={() => setExportedMemoryView(target.directorId)}
              >
                {target.label}
              </button>
            ))
          ) : (
            <button type="button" className="toggleOption" disabled>
              None
            </button>
          )}
        </div>
      </div>
      <div className="agentSummarySharedBody">
        {activeExportedMemoryTarget ? (
          <div className="toddMemorySectionSubblock">
            <span className="pmStatusLabel">Placeholder</span>
            <p className="coreDetailEmpty">
              Exported memory placeholder for {DIRECTOR_NAMES[directorId]} to {activeExportedMemoryTarget.label}.
            </p>
            <p className="helperText">Outbound memory data is not wired up yet.</p>
          </div>
        ) : (
          <p className="coreDetailEmpty">No exported memory targets available yet.</p>
        )}
      </div>
    </section>
  );
  const memoryRail = (
    <div className="agentSummaryMemoryRail">
      {importedMemoryCard}
      {exportedMemoryCard}
    </div>
  );

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
          <section className="agentSummaryCard agentSummaryCard--personal" style={personalMemoryCardStyle}>
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">{personalMemoryTitle}</span>
              <div className="speedToggle memoryToggle">
                <button className={`toggleOption${memoryView === "soft" ? " active" : ""}`} onClick={() => setMemoryView("soft")}>Soft</button>
                <button className={`toggleOption${memoryView === "hard" ? " active" : ""}`} onClick={() => setMemoryView("hard")}>Hard</button>
                <button className={`toggleOption${memoryView === "backup" ? " active" : ""}`} onClick={() => setMemoryView("backup")}>Backup</button>
              </div>
            </div>
            {memoryView === "soft" ? (
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
            ) : null}
            {memoryView === "hard" ? (
              <div className="agentSummaryDetailsBody">
                <ConceptOverview
                  concept={confirmedConcept}
                  title="Core-Details"
                  emptyLabel="No confirmed concept yet."
                />
              </div>
            ) : null}
            {memoryView === "backup" ? (
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
            ) : null}
          </section>
          {memoryRail}
        </div>
        <DirectorReportsPanel
          directorId={directorId}
          session={session}
          onViewExecutionReport={onViewExecutionReport}
        />
      </div>
    );
  }

  if (directorId === "rd-director") {
    const toddMemory = session.toddMemory;
    const softMemory = toddMemory.softMemory ?? toddMemory.notes ?? [];
    const handoffNotes = softMemory.filter((note) => (typeof note === "string" ? false : note.tag === "handoff-to-todd"));
    const hasNotes = softMemory.length > 0;
    return (
      <div className="agentInfoPanel agentSummaryPanel">
      <div className="agentSummaryGrid">
          <section className="agentSummaryCard agentSummaryCard--personal" style={personalMemoryCardStyle}>
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">{personalMemoryTitle}</span>
              <div className="speedToggle memoryToggle">
                <button className={`toggleOption${memoryView === "soft" ? " active" : ""}`} onClick={() => setMemoryView("soft")}>Soft</button>
                <button className={`toggleOption${memoryView === "hard" ? " active" : ""}`} onClick={() => setMemoryView("hard")}>Hard</button>
                <button className={`toggleOption${memoryView === "backup" ? " active" : ""}`} onClick={() => setMemoryView("backup")}>Backup</button>
              </div>
            </div>
            {memoryView === "soft" ? (
              <div className="agentSummaryDetailsBody">
                {handoffNotes.length > 0 ? (
                  <div className="memoryPendingHandoffCard">
                    <span className="pmStatusLabel">
                      <span className="memoryHandoffBadge memoryHandoffBadge--dan">From Dan</span>
                    </span>
                    <ul className="agentSummaryList" style={{ marginTop: 8 }}>
                      {handoffNotes.map((note) => <li key={note.id}>{typeof note === "string" ? note : note.content}</li>)}
                    </ul>
                  </div>
                ) : null}
                {hasNotes ? (
                  <div style={{ marginTop: handoffNotes.length > 0 ? 10 : 0 }}>
                    <span className="pmStatusLabel">Planning Notes</span>
                    <ul className="agentSummaryList">
                      {softMemory.map((note, i) => <li key={`todd-note-${i}`}>{typeof note === "string" ? note : note.content}</li>)}
                    </ul>
                  </div>
                ) : null}
                {!hasNotes ? (
                  <p className="coreDetailEmpty">No active planning notes.</p>
                ) : null}
              </div>
            ) : null}
            {memoryView === "hard" ? (
              <ToddHardMemoryPanel
                toddMemory={toddMemory}
                corePillars={session.corePillars}
                onRegeneratePlan={() => {
                  void regenerateToddPlan();
                }}
              />
            ) : null}
            {memoryView === "backup" ? (
              <div className="agentSummaryDetailsBody">
                {(toddMemory.backupMemory ?? toddMemory.backupNotes ?? []).length > 0 ? (
                  <div>
                    <span className="pmStatusLabel">Resolved Notes ({(toddMemory.backupMemory ?? toddMemory.backupNotes ?? []).length})</span>
                    <ul className="agentSummaryList">
                      {(toddMemory.backupMemory ?? toddMemory.backupNotes ?? []).slice(-5).map((note, i) => (
                        <li key={`todd-backup-${i}`}>{typeof note === "string" ? note : note.content}</li>
                      ))}
                      {(toddMemory.backupMemory ?? toddMemory.backupNotes ?? []).length > 5 ? (
                        <li className="helperText">...and {(toddMemory.backupMemory ?? toddMemory.backupNotes ?? []).length - 5} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : (
                  <p className="coreDetailEmpty">No backup notes stored.</p>
                )}
              </div>
            ) : null}
          </section>
          {memoryRail}
        </div>
        <DirectorReportsPanel
          directorId={directorId}
          session={session}
          onViewExecutionReport={onViewExecutionReport}
        />
      </div>
    );
  }

  if (directorId === "programming-director") {
    const pingMemory = session.pingMemory;
    const queuedUpdates = session.toddMemory.futureUpdatePlan.filter((update) => update.status === "pending" || update.status === "in_progress");
    return (
      <div className="agentInfoPanel agentSummaryPanel">
      <div className="agentSummaryGrid">
          <section className="agentSummaryCard agentSummaryCard--personal" style={personalMemoryCardStyle}>
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">{personalMemoryTitle}</span>
            </div>
            <details className="agentSummaryDetails">
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
          {memoryRail}
        </div>
        <DirectorReportsPanel
          directorId={directorId}
          session={session}
          onViewExecutionReport={onViewExecutionReport}
        />
      </div>
    );
  }

  if (directorId === "validation-director") {
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard agentSummaryCard--personal" style={personalMemoryCardStyle}>
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">{personalMemoryTitle}</span>
            </div>
            <details className="agentSummaryDetails">
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
          {memoryRail}
        </div>
        <DirectorReportsPanel
          directorId={directorId}
          session={session}
          onViewExecutionReport={onViewExecutionReport}
        />
      </div>
    );
  }

  if (directorId === "project-manager") {
    const liveApprovals = getLivePendingApprovals(session);
    const managerSummary = session.jeffMemory.managerSummary ?? session.jeffMemory.hardMemory ?? null;
    const currentProjectStatus = session.jeffMemory.currentProjectStatus ?? null;
    const projectStatusHistory = session.jeffMemory.projectStatusHistory ?? [];
    return (
      <div className="agentInfoPanel agentSummaryPanel">
        <div className="agentSummaryGrid">
          <section className="agentSummaryCard agentSummaryCard--personal" style={personalMemoryCardStyle}>
            <div className="agentSummaryHeader">
              <span className="agentSummaryEyebrow">{personalMemoryTitle}</span>
            </div>
            <details className="agentSummaryDetails">
              <summary>Coordination State</summary>
              <div className="agentSummaryDetailsBody">
                <p className="coreDetailValue">
                  {`${liveApprovals.length} pending approval(s) are visible to Jeff.`}
                </p>
                {managerSummary ? (
                  <div style={{ marginTop: 12 }}>
                    <span className="pmStatusLabel">Manager Summary</span>
                    <ul className="agentSummaryList" style={{ marginTop: 8 }}>
                      {managerSummary.danSummary ? <li>Dan: {managerSummary.danSummary}</li> : null}
                      {managerSummary.toddSummary ? <li>Todd: {managerSummary.toddSummary}</li> : null}
                      {managerSummary.currentProjectStatus ? <li>Status: {managerSummary.currentProjectStatus}</li> : null}
                    </ul>
                  </div>
                ) : null}
                {currentProjectStatus ? (
                  <div style={{ marginTop: 12 }}>
                    <span className="pmStatusLabel">Current Project Status</span>
                    <p className="coreDetailValue" style={{ marginTop: 8 }}>
                      {currentProjectStatus.status.replace(/-/g, " ")}: {currentProjectStatus.summary}
                    </p>
                  </div>
                ) : (
                  <p className="coreDetailEmpty" style={{ marginTop: 12 }}>
                    Jeff does not have a current project-status summary yet.
                  </p>
                )}
                {projectStatusHistory.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <span className="pmStatusLabel">Project Status History</span>
                    <ul className="agentSummaryList" style={{ marginTop: 8 }}>
                      {projectStatusHistory.slice(-5).reverse().map((entry) => (
                        <li key={entry.id}>{entry.status.replace(/-/g, " ")}: {entry.summary}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>
          </section>
          {memoryRail}
        </div>
        <DirectorReportsPanel
          directorId={directorId}
          session={session}
          onViewExecutionReport={onViewExecutionReport}
        />
      </div>
    );
  }

  return null;
}

export function DirectorProfilePanel({
  directorId,
  session,
  projectId,
  settings,
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
        <div className="directorProfileTopRow">
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

          <DirectorFunctionsPanel
            directorId={directorId}
            session={session}
            projectId={projectId}
            onNavigateToDirector={onNavigateToDirector}
            onSessionUpdate={onSessionUpdate}
          />
        </div>

        <DirectorMemoryPanel
          directorId={directorId}
          session={session}
          projectId={projectId}
          settings={settings}
          onSessionUpdate={onSessionUpdate}
          pushToast={_pushToast}
          onViewExecutionReport={setExecutionReport}
        />
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
