import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Modal, StatusChip } from "./ui-primitives";
import { DirectorProfilePanel } from "./director-panels";
import { ConceptOverview } from "./core-details";
import { formatDate } from "../lib/formatting";
import {
  getConfirmedConcept,
  buildAgentProjectDescription,
  buildDisplayedUpdatePlan,
} from "../lib/session-helpers";
import {
  AGENT_DETAILS_RANGE_OPTIONS,
  AGENT_DETAILS_DIRECTOR_FLOW,
} from "../lib/constants";
import type { AgentDetailsRange } from "../lib/constants";
import { sortPillarsByOrder } from "@shared/pillar-flow";
import {
  DIRECTOR_COLORS,
  DIRECTOR_LABELS,
  DIRECTOR_NAMES,
  type AgentSession,
  type AutomationConstraints,
  type AutomationTargetCandidate,
  type CorePillar,
  type DirectorId,
  type ModelCatalog,
  type Project,
  type Settings,
} from "@shared/types";

export type DetailsView =
  | { type: "main" }
  | { type: "concept" }
  | { type: "history" }
  | { type: "history-day"; date: string }
  | { type: "planned" }
  | { type: "agents" }
  | { type: "director"; directorId: DirectorId };

export function AgentProjectDetailsModal({
  project,
  session,
  settings,
  modelCatalog,
  onUpdateAgentDefaults,
  onSessionUpdate,
  pushToast,
  onClose,
  initialView,
  hasGithubConnection = false,
  isProjectRunning = false,
  githubDownloadBusy = false,
  backupCheckBusy = false,
  backupRestoreBusy = false,
  onDownloadFromGithub,
  onRequestRestoreBackup,
}: {
  project: Project;
  session: AgentSession | null;
  settings: Settings;
  modelCatalog: ModelCatalog;
  onUpdateAgentDefaults: (advancedDefaults: Partial<Settings["advancedDefaults"]>) => Promise<void>;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
  onClose: () => void;
  initialView?: DetailsView;
  hasGithubConnection?: boolean;
  isProjectRunning?: boolean;
  githubDownloadBusy?: boolean;
  backupCheckBusy?: boolean;
  backupRestoreBusy?: boolean;
  onDownloadFromGithub?: () => void | Promise<void>;
  onRequestRestoreBackup?: () => void | Promise<void>;
}) {
  const [currentView, setCurrentView] = useState<DetailsView>(initialView ?? { type: "main" });
  const [summaryRange, setSummaryRange] = useState<AgentDetailsRange>("daily");
  const [forecastRange, setForecastRange] = useState<AgentDetailsRange>("daily");
  const [automationTargets, setAutomationTargets] = useState<{
    source: "none" | "confirmed" | "draft";
    currentVersionId: string | null;
    currentVersionLabel: string | null;
    draftApprovalId: string | null;
    candidates: AutomationTargetCandidate[];
  }>({
    source: "none",
    currentVersionId: null,
    currentVersionLabel: null,
    draftApprovalId: null,
    candidates: [],
  });
  const [loadingAutomationTargets, setLoadingAutomationTargets] = useState(false);
  const [automationBusy, setAutomationBusy] = useState<"start" | "pause" | "resume" | "stop" | "recovery" | null>(null);
  const [selectedAutomationTargetId, setSelectedAutomationTargetId] = useState<string | null>(session?.automation.selectedTargetUpdateId ?? null);
  const [automationConstraints, setAutomationConstraints] = useState<AutomationConstraints>(
    session?.automation.constraints ?? {
      allowedHours: null,
      codexMaxUsedPercent: null,
      claudeMaxUsedPercent: null,
    },
  );
  const description = buildAgentProjectDescription(session);
  const concept = getConfirmedConcept(session);
  const displayedPlan = useMemo(
    () => buildDisplayedUpdatePlan(session),
    [session],
  );
  const selectedAutomationTarget = useMemo(
    () => automationTargets.candidates.find((candidate) => candidate.updateId === selectedAutomationTargetId) ?? null,
    [automationTargets.candidates, selectedAutomationTargetId],
  );
  const shouldShowRecoverySection = Boolean(onDownloadFromGithub || onRequestRestoreBackup);
  const backupActionBusy = backupCheckBusy || backupRestoreBusy;
  const backupActionDisabled = !onRequestRestoreBackup || isProjectRunning || backupActionBusy;
  const downloadActionDisabled = !onDownloadFromGithub || !hasGithubConnection || githubDownloadBusy;

  useEffect(() => {
    setAutomationConstraints(
      session?.automation.constraints ?? {
        allowedHours: null,
        codexMaxUsedPercent: null,
        claudeMaxUsedPercent: null,
      },
    );
  }, [session?.automation.constraints]);

  useEffect(() => {
    if (currentView.type !== "planned") {
      return;
    }
    let cancelled = false;
    setLoadingAutomationTargets(true);
    void window.programs.listAutomationTargets({ projectId: project.id })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setAutomationTargets(response);
        setSelectedAutomationTargetId((current) => {
          if (current && response.candidates.some((candidate) => candidate.updateId === current)) {
            return current;
          }
          if (
            session?.automation.selectedTargetUpdateId
            && response.candidates.some((candidate) => candidate.updateId === session.automation.selectedTargetUpdateId)
          ) {
            return session.automation.selectedTargetUpdateId;
          }
          return response.candidates[0]?.updateId ?? null;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          pushToast(error instanceof Error ? error.message : "Could not load automation targets.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAutomationTargets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentView.type, project.id, pushToast, session?.automation.selectedTargetUpdateId, session?.updatedAt]);

  const headerLeading = (() => {
    if (currentView.type === "director") {
      return (
        <button
          type="button"
          className="textButton"
          onClick={() => setCurrentView({ type: "agents" })}
        >
          View Agent Team
        </button>
      );
    }
    if (currentView.type === "history-day") {
      return (
        <button
          type="button"
          className="textButton"
          onClick={() => setCurrentView({ type: "history" })}
        >
          View History Log
        </button>
      );
    }
    if (currentView.type !== "main") {
      return (
        <button
          type="button"
          className="textButton"
          onClick={() => setCurrentView({ type: "main" })}
        >
          View Project Details
        </button>
      );
    }
    return undefined;
  })();

  const title = currentView.type === "main" ? `${project.name} Details` : "";

  const handleAutomationAction = async (
    action: "start" | "pause" | "resume" | "stop" | "recovery",
  ) => {
    setAutomationBusy(action);
    try {
      let updatedSession: AgentSession;
      if (action === "start") {
        if (!selectedAutomationTargetId) {
          throw new Error("Select a target update first.");
        }
        updatedSession = await window.programs.startAutomationRun({
          projectId: project.id,
          targetUpdateId: selectedAutomationTargetId,
          constraints: automationConstraints,
        });
      } else if (action === "pause") {
        updatedSession = await window.programs.pauseAutomationRun({
          projectId: project.id,
          summary: "Automation paused by the user.",
        });
      } else if (action === "resume") {
        updatedSession = await window.programs.resumeAutomationRun(project.id);
      } else if (action === "stop") {
        updatedSession = await window.programs.stopAutomationRun({
          projectId: project.id,
          summary: "Automation stopped by the user.",
        });
      } else {
        updatedSession = await window.programs.requestAutomationFailureRecovery({
          projectId: project.id,
        });
      }
      onSessionUpdate(updatedSession);
      pushToast(
        action === "start"
          ? "Automation started."
          : action === "pause"
            ? "Automation paused."
            : action === "resume"
              ? "Automation resumed."
              : action === "stop"
                ? "Automation stopped."
                : "Failure recovery queued for confirmation.",
        action === "stop" ? "info" : "success",
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not update automation.", "error");
    } finally {
      setAutomationBusy(null);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      fullscreen
      headerLeading={headerLeading}
    >
      {currentView.type === "main" ? (
        <div className="detailsScrollContent agentDetailsModalContent agentDetailsModalContent-static">
          <section className="agentDetailsSection">
            <div className="agentDetailsSectionHeader">
              <h4>Project Description</h4>
            </div>
            <div className="agentDetailsCard">
              <p className="agentDetailsDescription">{description}</p>
              <button
                type="button"
                className="textButton agentDetailsToggle"
                onClick={() => setCurrentView({ type: "concept" })}
              >
                View full concept
              </button>
            </div>
          </section>

          {shouldShowRecoverySection ? (
            <section className="agentDetailsSection">
              <div className="agentDetailsSectionHeader">
                <h4>Backups</h4>
              </div>
              <div className="agentDetailsCard agentDetailsRecoveryCard">
                <div className="agentDetailsRecoveryCopy">
                  <strong>Restore a local backup or pull the latest GitHub version.</strong>
                  <span>
                    PROGRAMS creates a backup before replacing project files, so these actions stay grouped with project recovery.
                  </span>
                </div>
                <div className="agentDetailsRecoveryActions">
                  {onRequestRestoreBackup ? (
                    <button
                      type="button"
                      className="secondaryButton smallButton"
                      onClick={() => void onRequestRestoreBackup()}
                      disabled={backupActionDisabled}
                    >
                      {backupCheckBusy ? "Checking..." : backupRestoreBusy ? "Restoring..." : "Backups"}
                    </button>
                  ) : null}
                  {onDownloadFromGithub ? (
                    <button
                      type="button"
                      className="secondaryButton smallButton"
                      onClick={() => void onDownloadFromGithub()}
                      disabled={downloadActionDisabled}
                    >
                      {githubDownloadBusy ? "Downloading..." : "Download from GitHub"}
                    </button>
                  ) : null}
                </div>
                {!hasGithubConnection && onDownloadFromGithub ? (
                  <span className="agentDetailsRecoveryHint">Connect this project to GitHub to enable downloads.</span>
                ) : null}
                {isProjectRunning && onRequestRestoreBackup ? (
                  <span className="agentDetailsRecoveryHint">Stop the running project before restoring a backup.</span>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="agentDetailsSection">
            <div className="agentDetailsSectionHeader">
              <h4>Progress</h4>
            </div>
            <div className="agentDetailsProgressGrid">
              <article className="agentDetailsCard agentDetailsProgressCard">
                <div className="agentDetailsSubsectionHead">
                  <h5>Summary</h5>
                  <AgentDetailsRangeToggle value={summaryRange} onChange={setSummaryRange} />
                </div>
                <div className="agentDetailsProgressCardBody">
                  <AgentDetailsSummaryPanel session={session} range={summaryRange} />
                </div>
                <div className="agentDetailsProgressCardFooter">
                  <button
                    type="button"
                    className="textButton agentDetailsToggle"
                    onClick={() => setCurrentView({ type: "history" })}
                  >
                    View History Log
                  </button>
                </div>
              </article>
              <article className="agentDetailsCard agentDetailsProgressCard">
                <div className="agentDetailsSubsectionHead">
                  <h5>Forecast</h5>
                  <AgentDetailsRangeToggle value={forecastRange} onChange={setForecastRange} />
                </div>
                <div className="agentDetailsProgressCardBody">
                  <AgentDetailsForecastPanel session={session} range={forecastRange} />
                </div>
                <div className="agentDetailsProgressCardFooter">
                  <button
                    type="button"
                    className="textButton agentDetailsToggle"
                    onClick={() => setCurrentView({ type: "planned" })}
                  >
                    View Planned Updates
                  </button>
                </div>
              </article>
            </div>
          </section>

          <div style={{ display: "flex", justifyContent: "center", paddingTop: 16 }}>
            <button
              type="button"
              className="textButton"
              onClick={() => setCurrentView({ type: "agents" })}
            >
              View Agents
            </button>
          </div>
        </div>
      ) : null}

      {currentView.type === "concept" ? (
        <div className="detailsScrollContent">
          <div className="conceptDetailsPanel">
            <ConceptOverview
              concept={concept}
              emptyLabel="The concept has not been confirmed yet."
            />
          </div>
        </div>
      ) : null}

      {currentView.type === "history" ? (
        <div className="detailsScrollContent">
          {(() => {
            const log = session?.toddMemory?.previousUpdateLog ?? [];
            if (log.length === 0) {
              return (
                <div className="agentDetailsCard">
                  <p style={{ color: "var(--muted)" }}>No history logs recorded yet.</p>
                </div>
              );
            }
            const byDate: Record<string, typeof log> = {};
            for (const entry of log) {
              const d = entry.createdAt.slice(0, 10);
              if (!byDate[d]) byDate[d] = [];
              byDate[d].push(entry);
            }
            const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
            return (
              <div className="agentDetailsCard" style={{ padding: 0, overflow: "hidden" }}>
                {dates.map((date, i) => {
                  const entries = byDate[date];
                  const label = formatDate(date + "T00:00:00.000Z");
                  return (
                    <button
                      key={date}
                      type="button"
                      className="historyLogDayRow"
                      style={{ borderTop: i === 0 ? "none" : undefined }}
                      onClick={() => setCurrentView({ type: "history-day", date })}
                    >
                      <span className="historyLogDayLabel">{label}</span>
                      <span className="historyLogDayCount">{entries.length} update{entries.length !== 1 ? "s" : ""}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ) : null}

      {currentView.type === "history-day" ? (
        <div className="detailsScrollContent">
          {(() => {
            const date = currentView.date;
            const allLog = session?.toddMemory?.previousUpdateLog ?? [];
            const dayEntries = allLog
              .filter((e) => e.createdAt.slice(0, 10) === date)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const danHistory = (session?.danMemory?.creativeHistory ?? [])
              .filter((e) => e.createdAt.slice(0, 10) === date)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const firstEntry = dayEntries[0];
            const lastEntry = dayEntries.length > 1 ? dayEntries[dayEntries.length - 1] : null;
            return (
              <>
                <div className="agentDetailsCard" style={{ marginBottom: 12 }}>
                  <h5 style={{ margin: "0 0 4px", fontSize: 13 }}>{formatDate(date + "T00:00:00.000Z")}</h5>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                    {dayEntries.length} update{dayEntries.length !== 1 ? "s" : ""} recorded
                    {danHistory.length > 0 ? `, ${danHistory.length} creative change${danHistory.length !== 1 ? "s" : ""}` : ""}
                  </p>
                </div>

                {firstEntry ? (
                  <div className="agentDetailsCard" style={{ marginBottom: 12 }}>
                    <h5 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Beginning of Day</h5>
                    <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>{firstEntry.goal}</p>
                    {firstEntry.outcome ? <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>{firstEntry.outcome}</p> : null}
                  </div>
                ) : null}

                {lastEntry ? (
                  <div className="agentDetailsCard" style={{ marginBottom: 12 }}>
                    <h5 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>End of Day</h5>
                    <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>{lastEntry.goal}</p>
                    {lastEntry.outcome ? <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>{lastEntry.outcome}</p> : null}
                    <span className={`validationResultStatus${lastEntry.status === "success" || lastEntry.status === "no_changes" ? " pmStatusDone" : ""}`} style={{ fontSize: 11 }}>
                      {lastEntry.status.replace("_", " ")}
                    </span>
                  </div>
                ) : null}

                {dayEntries.length > 0 ? (
                  <div className="agentDetailsCard" style={{ marginBottom: 12 }}>
                    <h5 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>All Updates</h5>
                    <div className="validationResultsList">
                      {dayEntries.map((entry) => (
                        <div key={entry.id} className={`validationResultCard validationResultCard--${entry.status === "success" || entry.status === "no_changes" ? "pass" : "fail"}`}>
                          <span className="validationResultType">{entry.goal}</span>
                          <span className={`validationResultStatus${entry.status === "success" || entry.status === "no_changes" ? " pmStatusDone" : ""}`}>
                            {entry.status.replace("_", " ")}
                          </span>
                          {entry.outcome ? <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)", gridColumn: "1 / -1" }}>{entry.outcome}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {danHistory.length > 0 ? (
                  <div className="agentDetailsCard">
                    <h5 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Dan — Creative Activity</h5>
                    <div className="validationResultsList">
                      {danHistory.map((entry) => (
                        <div key={entry.id} className="validationResultCard validationResultCard--pass">
                          <span className="validationResultType">{entry.action}</span>
                          {entry.summary ? <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)", gridColumn: "1 / -1" }}>{entry.summary}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : null}

      {currentView.type === "planned" ? (
        <div className="detailsScrollContent">
          {(() => {
            const versions = displayedPlan.versions;
            const updates = displayedPlan.updates;
            if (versions.length === 0 && updates.length === 0) {
              return (
                <div className="agentDetailsCard">
                  <p style={{ color: "var(--muted)" }}>No planned updates yet.</p>
                </div>
              );
            }
            const updatesByVersion: Record<string, import("@shared/types").VersionUpdate[]> = {};
            for (const u of updates) {
              const key = u.versionId ?? "__unassigned__";
              if (!updatesByVersion[key]) updatesByVersion[key] = [];
              updatesByVersion[key].push(u);
            }
            const selectedPathUpdates = selectedAutomationTarget
              ? updates
                .filter((update) => selectedAutomationTarget.pathUpdateIds.includes(update.id))
                .slice()
                .sort((left, right) => left.order - right.order)
              : [];
            return (
              <>
                <div className="agentDetailsCard" style={{ marginBottom: 12 }}>
                  <div className="agentDetailsSubsectionHead">
                    <h5 style={{ margin: 0 }}>Automation Target</h5>
                    <StatusChip tone={
                      displayedPlan.source === "draft"
                        ? "action_required"
                        : session?.automation.status === "running"
                          ? "info"
                          : session?.automation.status === "completed"
                            ? "confirmed"
                            : "neutral"
                    }>
                      {displayedPlan.source === "draft"
                        ? "Draft plan"
                        : session?.automation.status ?? "idle"}
                    </StatusChip>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    {automationTargets.currentVersionLabel
                      ? `Current version: ${automationTargets.currentVersionLabel}`
                      : displayedPlan.source === "draft"
                        ? displayedPlan.supersedesConfirmedPlan
                          ? "Todd has a superseding structural replan draft that must be confirmed before automation continues."
                          : "Todd has a live draft update plan that still needs confirmation."
                        : "No current version is ready for automation yet."}
                  </p>
                  {loadingAutomationTargets ? (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>Loading available targets...</p>
                  ) : automationTargets.candidates.length > 0 ? (
                    <div className="validationResultsList" style={{ marginTop: 12 }}>
                      {automationTargets.candidates.map((candidate) => (
                        <label key={candidate.updateId} className="validationResultCard validationResultCard--pass" style={{ cursor: "pointer" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="radio"
                              name="automation-target"
                              checked={selectedAutomationTargetId === candidate.updateId}
                              onChange={() => setSelectedAutomationTargetId(candidate.updateId)}
                            />
                            <span className="validationResultType">{candidate.title}</span>
                            <span className={`validationResultStatus${candidate.status === "in_progress" ? " pmStatusDone" : ""}`}>
                              {candidate.status.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p style={{ gridColumn: "1 / -1", margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
                            {candidate.description}
                          </p>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                      {displayedPlan.source === "draft"
                        ? displayedPlan.supersedesConfirmedPlan
                          ? "Confirm Todd's structural replan to resume target selection."
                          : "Confirm Todd's update plan to enable target selection."
                        : "No selectable future targets are available in the current version."}
                    </p>
                  )}
                  {selectedPathUpdates.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <span className="pmStatusLabel">Path To Selected Target</span>
                      <div className="updatePlanList" style={{ marginTop: 8 }}>
                        {selectedPathUpdates.map((update, index) => (
                          <div key={update.id} className="agentPlannedUpdateItem">
                            <span className="orderBadge">{index + 1}</span>
                            <div className="updateContent">
                              <div className="updateTitle">{update.title}</div>
                              <div className="updateDescription">{update.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="proposalActions" style={{ marginTop: 12, alignItems: "center" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      Start Hour
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="plannerSelect"
                        value={automationConstraints.allowedHours?.startHour ?? ""}
                        onChange={(event) => {
                          const next = event.target.value === "" ? null : Math.max(0, Math.min(23, Number(event.target.value)));
                          setAutomationConstraints((current) => ({
                            ...current,
                            allowedHours: next == null
                              ? null
                              : {
                                startHour: next,
                                endHour: current.allowedHours?.endHour ?? 23,
                              },
                          }));
                        }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      End Hour
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="plannerSelect"
                        value={automationConstraints.allowedHours?.endHour ?? ""}
                        onChange={(event) => {
                          const next = event.target.value === "" ? null : Math.max(0, Math.min(23, Number(event.target.value)));
                          setAutomationConstraints((current) => ({
                            ...current,
                            allowedHours: next == null
                              ? null
                              : {
                                startHour: current.allowedHours?.startHour ?? 0,
                                endHour: next,
                              },
                          }));
                        }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      Codex Max %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="plannerSelect"
                        value={automationConstraints.codexMaxUsedPercent ?? ""}
                        onChange={(event) => setAutomationConstraints((current) => ({
                          ...current,
                          codexMaxUsedPercent: event.target.value === "" ? null : Math.max(0, Math.min(100, Number(event.target.value))),
                        }))}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      Claude Max %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="plannerSelect"
                        value={automationConstraints.claudeMaxUsedPercent ?? ""}
                        onChange={(event) => setAutomationConstraints((current) => ({
                          ...current,
                          claudeMaxUsedPercent: event.target.value === "" ? null : Math.max(0, Math.min(100, Number(event.target.value))),
                        }))}
                      />
                    </label>
                  </div>
                  <div className="proposalActions" style={{ marginTop: 12 }}>
                    <button
                      className="primaryButton"
                      disabled={automationBusy !== null || displayedPlan.source === "draft" || !selectedAutomationTargetId}
                      onClick={() => void handleAutomationAction("start")}
                    >
                      Start Toward Target
                    </button>
                    <button
                      className="secondaryButton"
                      disabled={automationBusy !== null || session?.automation.status !== "running"}
                      onClick={() => void handleAutomationAction("pause")}
                    >
                      Pause
                    </button>
                    <button
                      className="secondaryButton"
                      disabled={automationBusy !== null || (session?.automation.status !== "paused" && session?.automation.status !== "stopped")}
                      onClick={() => void handleAutomationAction("resume")}
                    >
                      Resume
                    </button>
                    <button
                      className="secondaryButton"
                      disabled={automationBusy !== null || (session?.automation.status !== "running" && session?.automation.status !== "paused")}
                      onClick={() => void handleAutomationAction("stop")}
                    >
                      Stop
                    </button>
                    {session?.automation.pendingRevertCommitSha ? (
                      <button
                        className="secondaryButton"
                        disabled={automationBusy !== null}
                        onClick={() => void handleAutomationAction("recovery")}
                      >
                        Queue Recovery Revert
                      </button>
                    ) : null}
                  </div>
                  {session?.automation.stopSummary ? (
                    <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>{session.automation.stopSummary}</p>
                  ) : null}
                </div>
                {versions.map((v) => {
                  const vUpdates = (updatesByVersion[v.id] ?? []).slice().sort((a, b) => a.order - b.order);
                  return (
                    <div key={v.id} className="agentDetailsCard" style={{ marginBottom: 12 }}>
                      <h5 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>{v.label}</h5>
                      {v.description ? <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>{v.description}</p> : null}
                      {v.goals.length > 0 ? (
                        <ul style={{ margin: "0 0 10px", paddingLeft: 16 }}>
                          {v.goals.map((g, gi) => (
                            <li key={gi} style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{g}</li>
                          ))}
                        </ul>
                      ) : null}
                      {vUpdates.length > 0 ? (
                        <div className="updatePlanList">
                          {vUpdates.map((u) => (
                            <div key={u.id} className="agentPlannedUpdateItem">
                              <div className="updateContent">
                                <div className="updateTitle">{u.title}</div>
                                {u.description ? <div className="updateDescription">{u.description}</div> : null}
                              </div>
                              <span className={`updatePlanStatusBadge updatePlanStatusBadge--${u.status === "completed" ? "premium" : u.status === "in_progress" ? "standard" : "basic"}`}>
                                {u.status.replace("_", " ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {updatesByVersion["__unassigned__"] ? (
                  <div className="agentDetailsCard">
                    <h5 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>Unassigned</h5>
                    <div className="updatePlanList">
                      {(updatesByVersion["__unassigned__"]).slice().sort((a, b) => a.order - b.order).map((u) => (
                        <div key={u.id} className="agentPlannedUpdateItem">
                          <div className="updateContent">
                            <div className="updateTitle">{u.title}</div>
                            {u.description ? <div className="updateDescription">{u.description}</div> : null}
                          </div>
                          <span className={`updatePlanStatusBadge updatePlanStatusBadge--${u.status === "completed" ? "premium" : u.status === "in_progress" ? "standard" : "basic"}`}>
                            {u.status.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : null}

      {currentView.type === "agents" ? (
        <div className="directorProfilePanel directorProfilePanel--scrollable">
          <div className="directorProfilePanelContent">
            <div className="agentDetailsCard agentDetailsAgentFlow">
              {AGENT_DETAILS_DIRECTOR_FLOW.map((directorId, index) => (
                <Fragment key={directorId}>
                  <button
                    type="button"
                    className="agentDetailsAgentNode"
                    style={{ "--agent-details-color": DIRECTOR_COLORS[directorId] } as CSSProperties}
                    onClick={() => setCurrentView({ type: "director", directorId })}
                  >
                    <span className="agentDetailsAgentRole">{DIRECTOR_LABELS[directorId]}</span>
                    <span className="agentDetailsAgentName">{DIRECTOR_NAMES[directorId]}</span>
                  </button>
                  {index < AGENT_DETAILS_DIRECTOR_FLOW.length - 1 ? (
                    <div className="agentDetailsAgentArrow" aria-hidden="true" />
                  ) : null}
                </Fragment>
              ))}
            </div>

            {/* Director State Map */}
            {session && Object.keys(session.directorStateMap ?? {}).length > 0 ? (
              <div className="agentDetailsCard" style={{ marginTop: 12 }}>
                <h5 style={{ marginBottom: 8, fontSize: 13, color: "var(--text)" }}>Director State</h5>
                {Object.entries(session.directorStateMap ?? {}).map(([dId, ds]) => {
                  if (!ds) return null;
                  const dirId = dId as DirectorId;
                  return (
                    <div key={dId} className="directorStateSection">
                      <div className="directorStateLabel">{DIRECTOR_NAMES[dirId]}</div>
                      {ds.currentState ? (
                        <div className="directorStateContent"><strong>Current:</strong> {ds.currentState}</div>
                      ) : null}
                      {ds.idealState ? (
                        <div className="directorStateContent"><strong>Ideal:</strong> {ds.idealState}</div>
                      ) : null}
                      {ds.assumptions.length > 0 ? (
                        <div className="directorStateContent" style={{ color: "var(--muted)" }}>
                          {ds.assumptions.length} assumption(s)
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

          </div>
        </div>
      ) : null}

      {currentView.type === "director" ? (
        <DirectorProfilePanel
          key={currentView.directorId}
          directorId={currentView.directorId}
          session={session}
          projectId={project.id}
          settings={settings}
          modelCatalog={modelCatalog}
          onNavigateToDirector={(id) => setCurrentView({ type: "director", directorId: id })}
          onUpdateAgentDefaults={onUpdateAgentDefaults}
          onSessionUpdate={onSessionUpdate}
          pushToast={pushToast}
        />
      ) : null}
    </Modal>
  );
}

export function AgentDetailsRangeToggle({
  value,
  onChange,
}: {
  value: AgentDetailsRange;
  onChange: (value: AgentDetailsRange) => void;
}) {
  return (
    <div className="agentDetailsSegmentedControl" role="tablist" aria-label="Project detail range">
      {AGENT_DETAILS_RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "agentDetailsSegment active" : "agentDetailsSegment"}
          onClick={() => onChange(option)}
        >
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function AgentDetailsPlaceholderPanel({
  label,
  range,
}: {
  label: "Summary" | "Forecast";
  range: AgentDetailsRange;
}) {
  const rangeLabel = range.charAt(0).toUpperCase() + range.slice(1);

  return (
    <div className="agentDetailsPlaceholder">
      <div className="agentDetailsPlaceholderBars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="agentDetailsPlaceholderCopy">{`${rangeLabel} ${label.toLowerCase()} placeholder.`}</p>
    </div>
  );
}

export function AgentDetailsSummaryPanel({
  session,
  range,
}: {
  session: AgentSession | null;
  range: AgentDetailsRange;
}) {
  const log = session?.toddMemory?.previousUpdateLog ?? [];
  const now = new Date();
  const cutoff = new Date(now);
  if (range === "daily") {
    cutoff.setHours(0, 0, 0, 0);
  } else if (range === "weekly") {
    cutoff.setDate(now.getDate() - 7);
  } else {
    cutoff.setDate(now.getDate() - 30);
  }
  const entries = log.filter((e) => new Date(e.createdAt) >= cutoff);

  if (entries.length === 0) {
    const label = range === "daily" ? "today" : range === "weekly" ? "the past 7 days" : "the past 30 days";
    return (
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No activity recorded for {label}.</p>
    );
  }

  const succeeded = entries.filter((e) => e.status === "success" || e.status === "no_changes").length;
  const failed = entries.length - succeeded;
  const latest = entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const rangeLabel = range === "daily" ? "Today" : range === "weekly" ? "This week" : "This month";

  return (
    <div style={{ fontSize: 12 }}>
      <p style={{ margin: "0 0 6px" }}>
        <strong>{rangeLabel}:</strong> {entries.length} update{entries.length !== 1 ? "s" : ""} run
        {failed > 0 ? `, ${succeeded} succeeded, ${failed} blocked/failed` : ", all succeeded"}.
      </p>
      {latest.outcome ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>{latest.outcome}</p>
      ) : null}
    </div>
  );
}

export function AgentDetailsForecastPanel({
  session,
  range,
}: {
  session: AgentSession | null;
  range: AgentDetailsRange;
}) {
  const pending = (session?.toddMemory?.futureUpdatePlan ?? [])
    .filter((u) => u.status === "pending")
    .slice()
    .sort((a, b) => a.order - b.order);

  if (range === "daily") {
    const next = pending[0];
    if (!next) {
      return <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No information available yet.</p>;
    }
    return (
      <div style={{ fontSize: 12 }}>
        <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{next.title}</p>
        {next.description ? <p style={{ margin: 0, color: "var(--muted)" }}>{next.description}</p> : null}
      </div>
    );
  }

  if (range === "weekly") {
    const next = pending.slice(0, 3);
    if (next.length === 0) {
      return <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No information available yet.</p>;
    }
    return (
      <div style={{ fontSize: 12 }}>
        {next.map((u) => (
          <div key={u.id} style={{ marginBottom: 8 }}>
            <p style={{ margin: "0 0 2px", fontWeight: 600 }}>{u.title}</p>
            {u.description ? <p style={{ margin: 0, color: "var(--muted)" }}>{u.description}</p> : null}
          </div>
        ))}
      </div>
    );
  }

  // monthly — show success chain overview
  const successChain = (session?.toddMemory?.successChain ?? []).slice().sort((a, b) => a.order - b.order);
  if (successChain.length === 0) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No information available yet.</p>;
  }
  return (
    <div style={{ fontSize: 12 }}>
      {successChain.map((step, idx) => (
        <div key={step.id} style={{ marginBottom: 8 }}>
          <p style={{ margin: "0 0 2px", fontWeight: 600 }}>{idx + 1}. {step.title}</p>
          {step.description ? <p style={{ margin: 0, color: "var(--muted)" }}>{step.description}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function AgentDetailsPillarTree({
  pillar,
  depth = 0,
}: {
  pillar: CorePillar;
  depth?: number;
}) {
  const statusDotClass = pillar.pillarType === "tbd"
    ? "pillarStatusDot pillarStatusDot--tbd"
    : pillar.pillarType === "hard-stop"
      ? "pillarStatusDot pillarStatusDot--hard-stop"
      : null;

  return (
    <div className="corePillarExpanded agentDetailsPillarExpanded" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="agentDetailsPillarHeading">
        {statusDotClass ? <span className={statusDotClass} /> : null}
        {pillar.name}
        {pillar.function?.status === "assumed" ? (
          <span className="pillarStatusBadge pillarStatusBadge--assumed">assumed</span>
        ) : null}
      </div>
      <div className="pillarDetailRow">
        <span className="pillarDetailLabel">Function:</span>
        <span>{pillar.function?.summary ?? "Not defined"}</span>
      </div>
      <div className="pillarDetailRow">
        <span className="pillarDetailLabel">Thesis:</span>
        <span>{pillar.thesis?.summary ?? "Not defined"}</span>
      </div>
      {pillar.assumptionText ? (
        <div className={`pillarAssumptionText${pillar.assumptionSource === "dan" ? " pillarAssumptionText--dan" : ""}`}>
          {pillar.assumptionSource === "dan" ? "Dan assumes: " : "Direction: "}{pillar.assumptionText}
        </div>
      ) : null}
      {pillar.pillarType === "hard-stop" ? (
        <div className="pillarAssumptionText" style={{ color: "#DC2626" }}>Hard end — nothing beyond this point</div>
      ) : null}
      {pillar.corePillars.length > 0 ? (
        <div className="pillarChildren agentDetailsPillarChildren">
          {sortPillarsByOrder(pillar.corePillars).map((child) => (
            <AgentDetailsPillarTree key={child.id} pillar={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
