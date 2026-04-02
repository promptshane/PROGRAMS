import { Component, useState, type ReactNode } from "react";
import { CoreDetailsReport } from "./core-details";
import { StatusChip } from "./ui-primitives";
import { resolveDanHardMemoryReportDraft } from "../lib/hard-memory-report";
import {
  HARD_MEMORY_REPORT_TITLES,
  getHardMemoryReportDirectorName,
  getHardMemoryReportScopeLabel,
} from "../lib/session-helpers";
import type {
  HardMemoryReportMetadata,
  HardMemoryReportUpdate,
  AgentSession,
  PendingApproval,
  AgentCoreDetails,
  VersionPlan,
} from "@shared/types";

export function HardMemoryReportSections({
  report,
  session,
}: {
  report: HardMemoryReportMetadata;
  session: AgentSession | null;
}) {
  const danDraftCoreDetails = resolveDanHardMemoryReportDraft(report, session);
  const hasStateInfo = Boolean(report.currentState || report.idealState);
  const versionGroups = report.dataType === "versionUpdates" && report.versionUpdates
    ? report.versionUpdates.reduce<Record<string, HardMemoryReportUpdate[]>>((groups, update) => {
      const label = update.versionLabel || "Unassigned";
      if (!groups[label]) {
        groups[label] = [];
      }
      groups[label].push(update);
      return groups;
    }, {})
    : null;
  const orderedGroupLabels = versionGroups && report.roadmapVersions
    ? [
      ...report.roadmapVersions.map((version) => version.label),
      ...Object.keys(versionGroups).filter((label) => !report.roadmapVersions?.some((version) => version.label === label)).sort(),
    ]
    : versionGroups
    ? Object.keys(versionGroups).sort()
    : [];

  return (
    <div className="hardMemoryReportSections">
      {hasStateInfo ? (
        <div className="pendingProposalCard">
          <h5>State</h5>
          {report.currentState ? (
            <div className="proposalField">
              <div className="proposalFieldLabel">Current</div>
              <div className="proposalFieldValue">{report.currentState}</div>
            </div>
          ) : null}
          {report.idealState ? (
            <div className="proposalField">
              <div className="proposalFieldLabel">Ideal</div>
              <div className="proposalFieldValue">{report.idealState}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {report.dataType === "danDraftCoreDetails" ? (
        <>
          {report.changeSummary.length > 0 ? (
            <div className="pendingProposalCard">
              <h5>Change Summary</h5>
              <ul className="agentSummaryList">
                {report.changeSummary.map((item, index) => (
                  <li key={`${report.approvalId ?? report.createdAt}-change-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.reportStage === "soft" && session ? (
            <div className="pendingProposalCard">
              <h5>Takeaway Notes</h5>
              {(session.danMemory?.notes ?? []).length > 0 ? (
                <ul className="agentSummaryList">
                  {(session.danMemory?.notes ?? []).map((note) => (
                    <li key={note.id}>{note.content}</li>
                  ))}
                </ul>
              ) : (
                <p className="emptyFieldText">No notes yet.</p>
              )}
            </div>
          ) : (
            <CoreDetailsReport coreDetails={danDraftCoreDetails} />
          )}
        </>
      ) : null}

      {report.dataType === "versions" ? (
        <div className="pendingProposalCard">
          <h5>Roadmap</h5>
          {report.roadmapVersions && report.roadmapVersions.length > 0 ? (
            <div className="versionTimeline">
              {report.roadmapVersions.slice().sort((a, b) => a.order - b.order).map((version) => (
                <div key={version.id} className="versionCard">
                  <div className="versionHeader">
                    <span className={`versionLabel${version.status === "assumed" ? " assumedText" : ""}`}>{version.label}</span>
                    <StatusChip tone={version.status === "confirmed" ? "confirmed" : version.status === "assumed" ? "action_required" : "info"}>{version.status}</StatusChip>
                  </div>
                  <p className={version.status === "assumed" ? "assumedText" : ""}>{version.description}</p>
                  {version.goals.length > 0 ? (
                    <ul className="versionGoals">
                      {version.goals.map((goal, index) => <li key={`${version.id}-goal-${index}`}>{goal}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <em className="coreDetailEmpty">No roadmap versions have been captured yet.</em>
          )}
        </div>
      ) : null}

      {report.dataType === "versionUpdates" ? (
        <div className="pendingProposalCard">
          <h5>Grouped Updates</h5>
          {report.versionUpdates && report.versionUpdates.length > 0 ? (
            <div className="updatePlanList">
              {orderedGroupLabels.map((versionLabel) => {
                const updates = versionGroups?.[versionLabel] ?? [];
                return (
                  <div key={versionLabel} className="updatePlanGroup">
                    <h6 className="updatePlanGroupLabel">{versionLabel}</h6>
                    {updates.map((update, index) => (
                      <div key={update.id} className="agentPlannedUpdateItem">
                        <span className="orderBadge">{index + 1}</span>
                        <div className="updateContent">
                          <div className="updateTitle">{update.title}</div>
                          <div className="updateDescription">{update.description}</div>
                          {update.area ? (
                            <div className="pillarDetailRow" style={{ marginTop: 8 }}>
                              <span className="pillarDetailLabel">Area</span>
                              <span>{update.area}</span>
                            </div>
                          ) : null}
                          {update.dependencies.length > 0 ? (
                            <div className="flowStepPillars" style={{ marginTop: 8 }}>
                              {update.dependencies.map((dependency) => (
                                <span key={`${update.id}-${dependency}`} className="flowStepPillarTag">{dependency}</span>
                              ))}
                            </div>
                          ) : null}
                          {update.skillsNeeded.length > 0 ? (
                            <div className="flowStepPillars" style={{ marginTop: 8 }}>
                              {update.skillsNeeded.map((skill) => (
                                <span key={`${update.id}-${skill}`} className="flowStepPillarTag">{skill}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <em className="coreDetailEmpty">No grouped updates have been captured yet.</em>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function HardMemoryReportPanel({
  report,
  liveApproval,
  session,
  projectId,
  onSessionUpdate,
  onClose,
  pushToast,
}: {
  report: HardMemoryReportMetadata;
  liveApproval: PendingApproval | null;
  session: AgentSession | null;
  projectId: string | null;
  onSessionUpdate: (session: AgentSession) => void;
  onClose: () => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [busyAction, setBusyAction] = useState<"confirm" | "later" | "dismiss" | null>(null);

  const handleApprovalAction = async (action: "confirm" | "later" | "dismiss") => {
    if (!projectId || !liveApproval) {
      return;
    }

    setBusyAction(action);
    try {
      let updatedSession: AgentSession;
      if (action === "confirm") {
        updatedSession = await window.programs.approvePendingApproval({
          projectId,
          approvalId: liveApproval.id,
        });
      } else if (action === "later") {
        updatedSession = await window.programs.deferPendingApproval({
          projectId,
          approvalId: liveApproval.id,
        });
      } else {
        updatedSession = await window.programs.dismissPendingApproval({
          projectId,
          approvalId: liveApproval.id,
        });
      }

      onSessionUpdate(updatedSession);
      if (action !== "later" || !updatedSession.pendingApprovals.some((approval) => approval.id === liveApproval.id)) {
        onClose();
      }
      pushToast(
        action === "confirm"
          ? "Approval confirmed."
          : action === "later"
            ? "Approval saved for later."
            : "Approval dismissed.",
        action === "confirm" ? "success" : "info",
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not update the approval.", "error");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="agentChatPanel hardMemoryReportPanel">
      <div className="agentChatPanelHeader hardMemoryReportPanelHeader">
        <div className="hardMemoryReportPanelHeaderText">
          <h3>{HARD_MEMORY_REPORT_TITLES[report.dataType]}</h3>
          <p>{report.summary}</p>
          <div className="hardMemoryReportPanelMeta">
            <span>{getHardMemoryReportDirectorName(report)}</span>
            <span>{getHardMemoryReportScopeLabel(report)}</span>
            {liveApproval ? <span>Approval live</span> : <span>Archived</span>}
          </div>
        </div>
        <button className="secondaryButton" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="agentChatPanelBody hardMemoryReportPanelBody">
        <HardMemoryReportSections report={report} session={session} />
        {liveApproval ? (
          <div className="proposalActions hardMemoryReportActions">
            <button className="primaryButton" onClick={() => void handleApprovalAction("confirm")} disabled={busyAction !== null}>
              Confirm
            </button>
            <button className="secondaryButton" onClick={() => void handleApprovalAction("later")} disabled={busyAction !== null}>
              Later
            </button>
            <button className="secondaryButton" onClick={() => void handleApprovalAction("dismiss")} disabled={busyAction !== null}>
              Dismiss
            </button>
          </div>
        ) : (
          <p className="hardMemoryReportArchivedCopy">This report is archived. There is no live approval attached anymore.</p>
        )}
      </div>
    </div>
  );
}

export class ErrorBoundaryPanel extends Component<
  { onClose: () => void; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { onClose: () => void; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="agentChatPanel">
          <div className="agentChatPanelHeader">
            <h3>Error</h3>
            <button className="secondaryButton" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={this.props.onClose}>
              Close
            </button>
          </div>
          <div className="agentChatPanelBody">
            <p>Something went wrong loading this report. Close and try again.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
