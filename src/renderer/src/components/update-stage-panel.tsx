import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DIRECTOR_NAMES,
  type AgentCoreDetails,
  type AgentSession,
  type DirectorId,
  type HardMemoryReportMetadata,
  type HardMemoryReportUpdate,
  type PendingApproval,
  type PlanDraft,
  type UpdateStageStatus,
  type VersionPlan,
  type VersionUpdate,
} from "@shared/types";
import { StatusChip } from "./ui-primitives";
import { TypewriterText } from "./icons";
import { CoreDetailsReport } from "./core-details";
import { labelForPlanStatus } from "../lib/labels";
import {
  findHardMemoryReportMetadata,
  collectHardMemoryRoadmapVersions,
  resolveHardMemoryReportArea,
} from "../lib/session-helpers";
import { resolveDanHardMemoryReportDraft } from "../lib/hard-memory-report";

const labelForPendingApprovalKind = (kind: PendingApproval["kind"]): string => {
  switch (kind) {
    case "handoff":
      return "Handoff";
    case "internet-research":
      return "Internet Research";
    case "codebase-scan":
      return "Codebase Scan";
    case "store-data":
      return "Store Details";
    case "plan":
      return "Plan Run";
    case "agent-update":
      return "Agent Update";
    case "validation":
      return "Validation";
    case "outcome-decision":
      return "Outcome Decision";
  }
};

const buildHardMemoryReportFromApproval = (
  session: AgentSession | null,
  approval: PendingApproval,
): HardMemoryReportMetadata | null => {
  const liveReport = findHardMemoryReportMetadata(session, approval.id);
  if (liveReport) {
    return liveReport;
  }

  const payload = approval.draftPayload;
  if (!payload || payload.action !== "applyStoredData") {
    return null;
  }

  const createdAt = approval.updatedAt ?? approval.createdAt;

  if (payload.dataType === "danDraftCoreDetails" && payload.draftCoreDetails) {
    return {
      type: "hard-memory-report",
      dataType: "danDraftCoreDetails",
      directorId: "creative-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: typeof payload.currentState === "string" ? payload.currentState : null,
      idealState: typeof payload.idealState === "string" ? payload.idealState : null,
      changeSummary: Array.isArray(payload.draftChangeSummary)
        ? payload.draftChangeSummary.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
      draftCoreDetails: payload.draftCoreDetails as AgentCoreDetails,
      roadmapVersions: null,
      versionUpdates: null,
      createdAt,
    };
  }

  if (payload.dataType === "versions" && Array.isArray(payload.versions)) {
    return {
      type: "hard-memory-report",
      dataType: "versions",
      directorId: "rd-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: typeof payload.currentState === "string" ? payload.currentState : null,
      idealState: typeof payload.idealState === "string" ? payload.idealState : null,
      changeSummary: [],
      draftCoreDetails: null,
      roadmapVersions: payload.versions as VersionPlan[],
      versionUpdates: null,
      createdAt,
    };
  }

  if (payload.dataType === "versionUpdates" && Array.isArray(payload.updates)) {
    const roadmapVersions = collectHardMemoryRoadmapVersions(session);
    return {
      type: "hard-memory-report",
      dataType: "versionUpdates",
      directorId: "rd-director",
      approvalId: approval.id,
      reportStage: "hard",
      summary: approval.draftMessage ?? approval.summary,
      currentState: typeof payload.currentState === "string" ? payload.currentState : null,
      idealState: typeof payload.idealState === "string" ? payload.idealState : null,
      changeSummary: [],
      draftCoreDetails: null,
      roadmapVersions,
      versionUpdates: (payload.updates as VersionUpdate[]).map((update) => ({
        id: update.id,
        title: update.title,
        description: update.description,
        versionLabel: roadmapVersions.find((version) => version.id === update.versionId)?.label ?? "Unassigned",
        dependencies: Array.isArray(update.dependencies) ? update.dependencies : [],
        area: resolveHardMemoryReportArea(session, Array.isArray(update.pillarIds) ? update.pillarIds : []),
        skillsNeeded: Array.isArray(update.skillsNeeded) ? update.skillsNeeded : [],
      })),
      createdAt,
    };
  }

  return null;
};

function HardMemoryReportSections({
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

export { HardMemoryReportSections, labelForPendingApprovalKind, buildHardMemoryReportFromApproval };

export function PendingApprovalsPanel({
  projectId,
  session,
  onSessionUpdate,
  pushToast,
}: {
  projectId: string | null;
  session: AgentSession | null;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const approvals = session?.pendingApprovals ?? [];
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const [draftSummary, setDraftSummary] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [draftPayloadText, setDraftPayloadText] = useState("");
  const [draftTargetDirectorId, setDraftTargetDirectorId] = useState<DirectorId | "">("");
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);

  useEffect(() => {
    if (!editingApprovalId) {
      return;
    }

    if (!approvals.some((approval) => approval.id === editingApprovalId)) {
      setEditingApprovalId(null);
      setBusyApprovalId((current) => (current === editingApprovalId ? null : current));
    }
  }, [approvals, editingApprovalId]);

  if (!projectId || approvals.length === 0) {
    return null;
  }

  const openEditor = (approval: PendingApproval) => {
    setEditingApprovalId(approval.id);
    setDraftSummary(approval.summary);
    setDraftMessage(approval.draftMessage ?? "");
    setDraftPayloadText(approval.draftPayload ? JSON.stringify(approval.draftPayload, null, 2) : "");
    setDraftTargetDirectorId(approval.targetDirectorId ?? "");
  };

  const saveEdits = async (approvalId: string) => {
    if (!projectId) return;
    setBusyApprovalId(approvalId);
    try {
      const updated = await window.programs.revisePendingApproval({
        projectId,
        approvalId,
        summary: draftSummary,
        draftMessage,
        draftPayloadText,
        targetDirectorId: draftTargetDirectorId || null,
      });
      onSessionUpdate(updated);
      setEditingApprovalId(null);
      pushToast("Approval draft updated.", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not update the approval draft.", "error");
    } finally {
      setBusyApprovalId(null);
    }
  };

  const confirmApproval = async (approval: PendingApproval) => {
    if (!projectId) return;
    setBusyApprovalId(approval.id);
    try {
      if (editingApprovalId === approval.id) {
        const revised = await window.programs.revisePendingApproval({
          projectId,
          approvalId: approval.id,
          summary: draftSummary,
          draftMessage,
          draftPayloadText,
          targetDirectorId: draftTargetDirectorId || null,
        });
        onSessionUpdate(revised);
        setEditingApprovalId(null);
      }
      const updated = await window.programs.approvePendingApproval({
        projectId,
        approvalId: approval.id,
      });
      onSessionUpdate(updated);
      pushToast("Approval confirmed.", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not confirm the approval.", "error");
    } finally {
      setBusyApprovalId(null);
    }
  };

  const moveApprovalLater = async (approvalId: string) => {
    if (!projectId) return;
    setBusyApprovalId(approvalId);
    try {
      const updated = await window.programs.deferPendingApproval({ projectId, approvalId });
      onSessionUpdate(updated);
      setEditingApprovalId(null);
      pushToast("Approval saved for later.", "info");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not defer the approval.", "error");
    } finally {
      setBusyApprovalId(null);
    }
  };

  const dismissApproval = async (approvalId: string) => {
    if (!projectId) return;
    setBusyApprovalId(approvalId);
    try {
      const updated = await window.programs.dismissPendingApproval({ projectId, approvalId });
      onSessionUpdate(updated);
      setEditingApprovalId(null);
      pushToast("Approval dismissed.", "info");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not dismiss the approval.", "error");
    } finally {
      setBusyApprovalId(null);
    }
  };

  return (
    <div className="pendingApprovalsPanel">
      <div className="pendingApprovalsHeader">
        <div>
          <h4>Approvals</h4>
          <p>High-impact actions stay here until you confirm, revise, or dismiss them.</p>
        </div>
        <span className="pendingApprovalsCount">{approvals.length}</span>
      </div>
      <div className="pendingApprovalsList">
        {approvals.map((approval) => {
          const isEditing = editingApprovalId === approval.id;
          const isBusy = busyApprovalId === approval.id;
          const hardMemoryReport = approval.kind === "store-data"
            ? buildHardMemoryReportFromApproval(session, approval)
            : null;
          return (
            <div key={approval.id} className="pendingApprovalCard">
              <div className="pendingApprovalCardHead">
                <div>
                  <div className="pendingApprovalTitle">{approval.summary}</div>
                  <div className="pendingApprovalMeta">
                    <span>{labelForPendingApprovalKind(approval.kind)}</span>
                    <span>{approval.status === "later" ? "Later" : "Pending"}</span>
                    {approval.requestedByDirectorId ? <span>From {DIRECTOR_NAMES[approval.requestedByDirectorId]}</span> : null}
                    {approval.targetDirectorId ? <span>To {DIRECTOR_NAMES[approval.targetDirectorId]}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="textButton"
                  onClick={() => isEditing ? setEditingApprovalId(null) : openEditor(approval)}
                  disabled={isBusy}
                >
                  {isEditing ? "Cancel Edit" : "Edit"}
                </button>
              </div>
              {approval.draftMessage ? (
                <p className="pendingApprovalCopy">{approval.draftMessage}</p>
              ) : null}
              {isEditing ? (
                <div className="pendingApprovalEditor">
                  <label>
                    Summary
                    <textarea
                      value={draftSummary}
                      onChange={(event) => setDraftSummary(event.target.value)}
                      rows={2}
                    />
                  </label>
                  <label>
                    Draft Message
                    <textarea
                      value={draftMessage}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      rows={4}
                    />
                  </label>
                  {approval.targetDirectorId ? (
                    <label>
                      Target Director
                      <select
                        className="plannerSelect"
                        value={draftTargetDirectorId}
                        onChange={(event) => setDraftTargetDirectorId((event.target.value as DirectorId) || "")}
                      >
                        <option value="">None</option>
                        {(Object.keys(DIRECTOR_NAMES) as DirectorId[]).map((directorId) => (
                          <option key={directorId} value={directorId}>{DIRECTOR_NAMES[directorId]}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    Draft Payload (JSON)
                    <textarea
                      value={draftPayloadText}
                      onChange={(event) => setDraftPayloadText(event.target.value)}
                      rows={8}
                    />
                  </label>
                </div>
              ) : hardMemoryReport ? (
                <HardMemoryReportSections report={hardMemoryReport} session={session} />
              ) : approval.draftPayload ? (
                <pre className="pendingApprovalPayload">{JSON.stringify(approval.draftPayload, null, 2)}</pre>
              ) : null}
              <div className="pendingApprovalActions">
                {isEditing ? (
                  <button className="secondaryButton" onClick={() => void saveEdits(approval.id)} disabled={isBusy}>
                    Save Edit
                  </button>
                ) : null}
                <button className="primaryButton" onClick={() => void confirmApproval(approval)} disabled={isBusy}>
                  Confirm
                </button>
                <button className="secondaryButton" onClick={() => void moveApprovalLater(approval.id)} disabled={isBusy}>
                  Later
                </button>
                <button className="secondaryButton" onClick={() => void dismissApproval(approval.id)} disabled={isBusy}>
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type UpdateStageKey = "thinking" | "planning" | "building" | "verifying";

export function UpdateStagePanel({
  plan,
  canConfirmPlan,
  confirmBusy,
  onConfirm,
}: {
  plan: PlanDraft | null;
  canConfirmPlan: boolean;
  confirmBusy: boolean;
  onConfirm: () => void;
}) {
  const [openStage, setOpenStage] = useState<UpdateStageKey | null>(null);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const autoOpenedRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!plan || plan.status === "completed" || plan.status === "failed") {
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [plan?.status, plan?.prompt]);

  useEffect(() => {
    if (!plan) {
      setOpenStage(null);
      autoOpenedRequestKeyRef.current = null;
      return;
    }

    const requestKey = `${plan.provider}:${plan.prompt}:${plan.turnId ?? "pending"}`;
    if (autoOpenedRequestKeyRef.current === requestKey) {
      return;
    }

    const preferredStage =
      ([
        ["thinking", plan.thinkingStatus],
        ["planning", plan.planningStatus],
        ["building", plan.buildingStatus],
        ["verifying", plan.verifyingStatus],
      ] as const).find(([, status]) => status === "failed")?.[0] ??
      ([
        ["thinking", plan.thinkingStatus],
        ["planning", plan.planningStatus],
        ["building", plan.buildingStatus],
        ["verifying", plan.verifyingStatus],
      ] as const).find(([, status]) => status === "in_progress")?.[0] ??
      "thinking";

    autoOpenedRequestKeyRef.current = requestKey;
    setOpenStage(preferredStage);
  }, [
    plan,
    plan?.prompt,
    plan?.provider,
    plan?.turnId,
  ]);

  if (!plan) {
    return null;
  }

  const stageItems: Array<{
    key: UpdateStageKey;
    label: string;
    status: UpdateStageStatus;
  }> = [
    { key: "thinking", label: "Thinking", status: plan.thinkingStatus },
    { key: "planning", label: "Planning", status: plan.planningStatus },
    { key: "building", label: "Building", status: plan.buildingStatus },
    { key: "verifying", label: "Verifying", status: plan.verifyingStatus },
  ];

  const detail =
    openStage === "thinking" ? (
      <div className="updateStageDetailBlock">
        <p><TypewriterText text={plan.explanation || "The model has not shared any thinking details yet."} /></p>
      </div>
    ) : openStage === "planning" ? (
      <div className="updateStageDetailBlock">
        {plan.planningMode === "none" ? <p>Skipped by request.</p> : null}
        {plan.steps.length ? (
          <ol className="planList">
            {plan.steps.map((step) => (
              <li key={step.step}>
                <span className={`stepPill step-${step.status}`}>{step.status.replace("_", " ")}</span>
                {step.step}
              </li>
            ))}
          </ol>
        ) : null}
        <div className="planMetaGrid">
          {plan.summary ? (
            <div>
              <strong>Summary</strong>
              <p><TypewriterText text={plan.summary} /></p>
            </div>
          ) : null}
          {plan.impact ? (
            <div>
              <strong>Impact</strong>
              <p><TypewriterText text={plan.impact} /></p>
            </div>
          ) : null}
        </div>
        {plan.contextPaths.length ? (
          <div className="planMetaGrid">
            <div>
              <strong>Priority context</strong>
              <p>{plan.contextPaths.join(", ")}</p>
            </div>
          </div>
        ) : null}
      </div>
    ) : openStage === "building" ? (
      <div className="updateStageDetailBlock">
        {plan.diff ? (
          <pre className="updateStageCodeBlock">{plan.diff}</pre>
        ) : plan.diffStats ? (
          <p>
            Current diff: +{plan.diffStats.added.toLocaleString()} / -{plan.diffStats.removed.toLocaleString()}
          </p>
        ) : (
          <p>Waiting for file changes.</p>
        )}
      </div>
    ) : openStage === "verifying" ? (
      <div className="updateStageDetailBlock">
        <p>
          <TypewriterText text={plan.verificationDetails ??
            (plan.verifyingStatus === "completed"
              ? "Verification finished."
              : plan.verifyingStatus === "failed"
                ? "Verification needs attention."
                : "Waiting for verification.")} />
        </p>
        {plan.errorMessage ? <div className="errorBanner">{plan.errorMessage}</div> : null}
      </div>
    ) : null;

  return (
    <div className="updateStatusShelf">
      <div className="updateStageHeader">
        <div className="updateStageTitleRow">
          <button
            className="updateStageTitleButton"
            onClick={() => setShowFullPrompt((prev) => !prev)}
            title="Click to view full update request"
          >
            {plan.prompt.length > 50
              ? plan.prompt.slice(0, 47).trim() + "..."
              : plan.prompt.charAt(0).toUpperCase() + plan.prompt.slice(1)}
          </button>
          <span className="updateStageStatusBadge">{labelForPlanStatus(plan.status)}</span>
          {elapsed > 0 && plan.status !== "completed" && plan.status !== "failed" ? (
            <span className="updateStageElapsed">{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</span>
          ) : null}
        </div>
        {plan.diffStats ? (
          <div className="updateStageDiffStats" aria-label="Changed lines">
            <span className="updateStageDiffStats-added">+{plan.diffStats.added.toLocaleString()}</span>
            <span className="updateStageDiffStats-removed">-{plan.diffStats.removed.toLocaleString()}</span>
          </div>
        ) : null}
      </div>
      {showFullPrompt ? (
        <div className="updateStageFullPrompt">
          <p>{plan.prompt}</p>
        </div>
      ) : null}

      {detail ? <div className="updateStageDetails">{detail}</div> : null}

      {canConfirmPlan ? (
        <div className="approvalActions updateStageActions">
          <button className="primaryButton" onClick={onConfirm} disabled={confirmBusy}>
            Confirm
          </button>
        </div>
      ) : null}

      <div className="updateStageStrip">
        {stageItems.map((stage) => (
          <button
            key={stage.key}
            type="button"
            className={openStage === stage.key ? "updateStageButton active" : "updateStageButton"}
            onClick={() => setOpenStage((current) => (current === stage.key ? null : stage.key))}
          >
            <span className={`updateStageDot updateStageDot-${stage.status}`} aria-hidden="true" />
            <span>{stage.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
