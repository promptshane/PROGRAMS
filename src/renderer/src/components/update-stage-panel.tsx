import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DIRECTOR_NAMES,
  type AgentSession,
  type HardMemoryReportMetadata,
  type PendingApproval,
  type PlanDraft,
  type UpdateStageStatus,
  type VersionUpdate,
} from "@shared/types";
import { TypewriterText } from "./icons";
import { labelForPlanStatus } from "../lib/labels";
import {
  buildHardMemoryReportFromApproval,
  getLivePendingApprovals,
  getToddUpdatePlanDraftMeta,
} from "../lib/session-helpers";
import { HardMemoryReportSections } from "./hard-memory-report";

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

export { labelForPendingApprovalKind, buildHardMemoryReportFromApproval };

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
  const approvals = getLivePendingApprovals(session);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);

  if (!projectId || approvals.length === 0) {
    return null;
  }

  const confirmApproval = async (approval: PendingApproval) => {
    if (!projectId) return;
    setBusyApprovalId(approval.id);
    try {
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

  const cancelApproval = async (approvalId: string) => {
    if (!projectId) return;
    setBusyApprovalId(approvalId);
    try {
      const updated = await window.programs.dismissPendingApproval({ projectId, approvalId });
      onSessionUpdate(updated);
      pushToast("Action cancelled.", "info");
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
          <p>Actions stay here until you confirm or cancel them.</p>
        </div>
        <span className="pendingApprovalsCount">{approvals.length}</span>
      </div>
      <div className="pendingApprovalsList">
        {approvals.map((approval) => {
          const isBusy = busyApprovalId === approval.id;
          const hardMemoryReport = approval.kind === "store-data"
            ? buildHardMemoryReportFromApproval(session, approval)
            : null;
          const approvalDraftMeta = hardMemoryReport ? getToddUpdatePlanDraftMeta(approval) : null;
          return (
            <div key={approval.id} className="pendingApprovalCard">
              <div className="pendingApprovalCardHead">
                <div>
                  <div className="pendingApprovalTitle">{approval.summary}</div>
                  <div className="pendingApprovalMeta">
                    <span>{labelForPendingApprovalKind(approval.kind)}</span>
                    {approval.requestedByDirectorId ? <span>From {DIRECTOR_NAMES[approval.requestedByDirectorId]}</span> : null}
                    {approval.targetDirectorId ? <span>To {DIRECTOR_NAMES[approval.targetDirectorId]}</span> : null}
                  </div>
                </div>
              </div>
              {hardMemoryReport ? (
                <HardMemoryReportSections report={hardMemoryReport} session={session} draftMeta={approvalDraftMeta} />
              ) : (
                <p className="pendingApprovalCopy">
                  {approval.draftMessage
                    ? approval.draftMessage
                    : `Allow ${approval.requestedByDirectorId ? DIRECTOR_NAMES[approval.requestedByDirectorId] : "the system"} to ${approval.summary.toLowerCase()}?`}
                </p>
              )}
              <div className="pendingApprovalActions">
                <button className="primaryButton" onClick={() => void confirmApproval(approval)} disabled={isBusy}>
                  Confirm
                </button>
                <button className="secondaryButton" onClick={() => void cancelApproval(approval.id)} disabled={isBusy}>
                  Cancel
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
