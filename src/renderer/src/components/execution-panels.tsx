import { useEffect, useState } from "react";
import { AgentChatMarkdown } from "../lib/agent-chat-markdown";
import { providerLabel, labelForReasoningEffort, labelForPlanningMode } from "../lib/formatting";
import { humanizeSnakeCase } from "../lib/labels";
import type {
  JeffExecutionReport,
  JeffOutcomeDecision,
  PingTaskSnapshot,
  PingPlanSnapshot,
  PingExecutionReportSnapshot,
  PingRawReport,
  AgentSession,
  AgentStage,
  AgentStageConfirmation,
  CorePillar,
  CascadeProposal,
  AgentChatMessage,
} from "@shared/types";
import { AGENT_STAGE_LABELS } from "@shared/types";

export function ExecutionReportPanel({
  report,
  projectId,
  session,
  onSessionUpdate,
  pushToast,
  onClose,
}: {
  report: JeffExecutionReport;
  projectId: string | null;
  session: AgentSession | null;
  onSessionUpdate: (session: AgentSession) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
  onClose: () => void;
}) {
  const [decisionSummary, setDecisionSummary] = useState(report.summary);
  const [busyAction, setBusyAction] = useState<"successful" | "partially-successful" | "failure" | "pong" | null>(null);
  const isPending = session?.jeffMemory.pendingReports.some((pendingReport) => pendingReport.id === report.id) ?? false;

  useEffect(() => {
    setDecisionSummary(report.summary);
  }, [report.id, report.summary]);

  const handleJeffDecision = async (decision: JeffOutcomeDecision) => {
    if (!projectId) {
      return;
    }
    setBusyAction(decision);
    try {
      await window.programs.recordJeffOutcome({
        projectId,
        reportId: report.id,
        decision,
        summary: decisionSummary.trim() || report.summary,
      });
      const refreshed = await window.programs.getAgentSession(projectId);
      if (refreshed) {
        onSessionUpdate(refreshed);
      }
      pushToast(`Jeff marked the update as ${decision}.`, decision === "failure" ? "error" : "success");
      onClose();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not record Jeff's outcome.", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendToPong = async () => {
    if (!projectId) {
      return;
    }
    setBusyAction("pong");
    try {
      await window.programs.assignPongValidation({
        projectId,
        instruction: decisionSummary.trim() || report.summary,
        updateId: report.updateId,
      });
      const refreshed = await window.programs.getAgentSession(projectId);
      if (refreshed) {
        onSessionUpdate(refreshed);
      }
      pushToast("Jeff handed the report to Pong for validation.", "info");
      onClose();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not send the report to Pong.", "error");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="agentChatPanel">
      <div className="agentChatPanelHeader">
        <h3>{report.title}</h3>
        <button className="secondaryButton" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="agentChatPanelBody">
        <section>
          <h4>Summary</h4>
          <p>{report.summary}</p>
        </section>
        <section>
          <h4>Outcome</h4>
          <p>{report.outcome}</p>
        </section>
        {report.rawReport ? (
          <section>
            <h4>Update Details</h4>
            <p>Status: {report.rawReport.status?.replace(/_/g, " ") ?? "unknown"}</p>
            <p>{report.rawReport.summary}</p>
            {report.rawReport.changedFiles?.length > 0 ? (
              <>
                <h4>Changed Files</h4>
                <ul className="agentChatUpdateList">
                  {report.rawReport.changedFiles.map((filePath) => (
                    <li key={filePath}>{filePath}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.rawReport.blocker ? (
              <>
                <h4>Blocker</h4>
                <p>{report.rawReport.blocker}</p>
              </>
            ) : null}
            {report.rawReport.unexpectedNotes?.length > 0 ? (
              <>
                <h4>Unexpected Notes</h4>
                <ul className="agentChatUpdateList">
                  {report.rawReport.unexpectedNotes.map((item, index) => (
                    <li key={`${report.id}-unexpected-${index}`}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : (
          <section>
            <h4>Update Details</h4>
            <p className="helperText">Report data is unavailable.</p>
          </section>
        )}
        <section>
          <h4>Todd Follow-Up</h4>
          <p>
            {report.toddFollowUpNeeded
              ? report.toddFollowUpReason ?? "Jeff referred Todd for follow-up planning."
              : "No Todd follow-up needed."}
          </p>
        </section>
        <section>
          <h4>Jeff's Assessment</h4>
          <textarea
            className="composerInput"
            style={{ minHeight: 110 }}
            value={decisionSummary}
            onChange={(event) => setDecisionSummary(event.target.value)}
            placeholder="Jeff's review summary..."
          />
          {isPending ? (
            <div className="proposalActions" style={{ marginTop: 12 }}>
              <button className="primaryButton" onClick={() => void handleJeffDecision("successful")} disabled={busyAction !== null}>
                Successful
              </button>
              <button className="secondaryButton" onClick={() => void handleJeffDecision("partially-successful")} disabled={busyAction !== null}>
                Partially-successful
              </button>
              <button className="secondaryButton" onClick={() => void handleJeffDecision("failure")} disabled={busyAction !== null}>
                Failure
              </button>
              <button className="secondaryButton" onClick={() => void handleSendToPong()} disabled={busyAction !== null}>
                Send to Pong
              </button>
            </div>
          ) : (
            <p className="helperText" style={{ marginTop: 8 }}>
              Jeff already reviewed this report.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function PingTaskPanel({
  task,
  onClose,
}: {
  task: PingTaskSnapshot;
  onClose: () => void;
}) {
  return (
    <div className="agentChatPanel">
      <div className="agentChatPanelHeader">
        <h3>Ping's Update Task</h3>
        <button className="secondaryButton" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="agentChatPanelBody">
        <section>
          <h4>Source</h4>
          <p>{task.source === "todd-approved-update" ? "Todd-approved update" : "Direct Ping request"}</p>
        </section>
        <section>
          <h4>Original Request</h4>
          <AgentChatMarkdown text={task.originalUserRequest} />
        </section>
        {task.updateTitle || task.updateDescription ? (
          <section>
            <h4>Todd Update Context</h4>
            {task.updateTitle ? <p><strong>{task.updateTitle}</strong></p> : null}
            {task.updateDescription ? <AgentChatMarkdown text={task.updateDescription} /> : null}
          </section>
        ) : null}
        {task.toddExplanation ? (
          <section>
            <h4>Todd Explanation</h4>
            <AgentChatMarkdown text={task.toddExplanation} />
          </section>
        ) : null}
        {task.relevantPillarIds.length > 0 ? (
          <section>
            <h4>Relevant Pillars</h4>
            <ul className="agentChatUpdateList">
              {task.relevantPillarIds.map((pillarId) => (
                <li key={pillarId}>{pillarId}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {task.toddCodebaseMapSummary ? (
          <section>
            <h4>Todd's Codebase Map</h4>
            <AgentChatMarkdown text={task.toddCodebaseMapSummary} />
          </section>
        ) : null}
        {task.coreDetailsContext ? (
          <section>
            <h4>Core Details Context</h4>
            <pre className="updateStageCodeBlock">{task.coreDetailsContext}</pre>
          </section>
        ) : null}
        <section>
          <h4>Runtime</h4>
          <ul className="agentChatUpdateList">
            <li>Provider: {providerLabel(task.runtime.provider)}</li>
            <li>Model: {task.runtime.provider === "claude" ? task.runtime.claudeModel : task.runtime.model}</li>
            <li>Reasoning: {labelForReasoningEffort(task.runtime.reasoningEffort)}</li>
            <li>Planning: {labelForPlanningMode(task.runtime.planningMode)}</li>
          </ul>
          {task.runtime.contextPaths.length > 0 ? (
            <>
              <h4>Context Paths</h4>
              <ul className="agentChatUpdateList">
                {task.runtime.contextPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section>
          <h4>Exact Planning Prompt</h4>
          <pre className="updateStageCodeBlock">{task.planPrompt || "No planning prompt was captured."}</pre>
        </section>
      </div>
    </div>
  );
}

export function PingPlanPanel({
  plan,
  summary,
  onClose,
}: {
  plan: PingPlanSnapshot | null;
  summary: string;
  onClose: () => void;
}) {
  return (
    <div className="agentChatPanel">
      <div className="agentChatPanelHeader">
        <h3>Ping's Plan</h3>
        <button className="secondaryButton" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="agentChatPanelBody">
        <section>
          <h4>Summary</h4>
          <AgentChatMarkdown text={summary} />
        </section>
        {plan ? (
          <>
            <section>
              <h4>Status</h4>
              <ul className="agentChatUpdateList">
                <li>Overall: {humanizeSnakeCase(plan.status)}</li>
                <li>Thinking: {humanizeSnakeCase(plan.thinkingStatus)}</li>
                <li>Planning: {humanizeSnakeCase(plan.planningStatus)}</li>
                <li>Building: {humanizeSnakeCase(plan.buildingStatus)}</li>
                <li>Verifying: {humanizeSnakeCase(plan.verifyingStatus)}</li>
              </ul>
            </section>
            {plan.explanation ? (
              <section>
                <h4>Explanation</h4>
                <AgentChatMarkdown text={plan.explanation} />
              </section>
            ) : null}
            {plan.steps.length > 0 ? (
              <section>
                <h4>Steps</h4>
                <ol className="planList">
                  {plan.steps.map((step) => (
                    <li key={step.step}>
                      <span className={`stepPill step-${step.status}`}>{humanizeSnakeCase(step.status)}</span>
                      {step.step}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {plan.impact ? (
              <section>
                <h4>Impact</h4>
                <AgentChatMarkdown text={plan.impact} />
              </section>
            ) : null}
            <section>
              <h4>Runtime</h4>
              <ul className="agentChatUpdateList">
                <li>Provider: {providerLabel(plan.provider)}</li>
                <li>Model: {plan.provider === "claude" ? plan.claudeModel : plan.model}</li>
                <li>Reasoning: {labelForReasoningEffort(plan.reasoningEffort)}</li>
                <li>Planning: {labelForPlanningMode(plan.planningMode)}</li>
              </ul>
              {plan.contextPaths.length > 0 ? (
                <>
                  <h4>Context Paths</h4>
                  <ul className="agentChatUpdateList">
                    {plan.contextPaths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function PingUpdateReportPanel({
  report,
  fallbackRawReport,
  onClose,
}: {
  report: PingExecutionReportSnapshot | null;
  fallbackRawReport: PingRawReport;
  onClose: () => void;
}) {
  const rawReport = report?.rawReport ?? fallbackRawReport;

  return (
    <div className="agentChatPanel">
      <div className="agentChatPanelHeader">
        <h3>Ping's Update Report</h3>
        <button className="secondaryButton" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="agentChatPanelBody">
        <section>
          <h4>Status</h4>
          <p>{humanizeSnakeCase(rawReport.status)}</p>
        </section>
        <section>
          <h4>Summary</h4>
          <AgentChatMarkdown text={rawReport.summary} />
        </section>
        {rawReport.changedFiles.length > 0 ? (
          <section>
            <h4>Changed Files</h4>
            <ul className="agentChatUpdateList">
              {rawReport.changedFiles.map((filePath) => (
                <li key={filePath}>{filePath}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {rawReport.blocker ? (
          <section>
            <h4>Blocker</h4>
            <AgentChatMarkdown text={rawReport.blocker} />
          </section>
        ) : null}
        {rawReport.unexpectedNotes.length > 0 ? (
          <section>
            <h4>Unexpected Notes</h4>
            <ul className="agentChatUpdateList">
              {rawReport.unexpectedNotes.map((item, index) => (
                <li key={`unexpected-${index}`}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {report ? (
          <section>
            <h4>Saved Output</h4>
            <ul className="agentChatUpdateList">
              {report.historyUpdateId ? <li>History update: {report.historyUpdateId}</li> : null}
              {report.commitSha ? <li>Commit SHA: {report.commitSha}</li> : null}
              {report.jeffReportId ? <li>Jeff report: {report.jeffReportId}</li> : null}
            </ul>
            {report.jeffSummary ? (
              <>
                <h4>Jeff Summary</h4>
                <AgentChatMarkdown text={report.jeffSummary} />
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function SimpleFlowchart({
  pillars,
  confirmation,
  selectedNodeId,
  onSelectNode,
}: {
  pillars: CorePillar[];
  confirmation: AgentStageConfirmation | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  const defaultText = confirmation?.flowchartParagraph ?? confirmation?.summary ?? null;
  const nodeDescriptions = confirmation?.nodeDescriptions ?? {};

  const selectedDescription = selectedNodeId ? nodeDescriptions[selectedNodeId] ?? null : null;

  return (
    <div className="simpleFlowchart">
      <div className="simpleFlowchartNodes">
        {pillars.map((pillar, idx) => (
          <div key={pillar.id} className="simpleFlowchartNodeGroup">
            {idx > 0 && <div className="simpleFlowchartArrow">&rarr;</div>}
            <button
              className={`simpleFlowchartNode${selectedNodeId === pillar.id ? " selected" : ""}`}
              onClick={() => onSelectNode(pillar.id)}
              title={pillar.name}
            >
              {pillar.name}
            </button>
          </div>
        ))}
      </div>
      <div className="simpleFlowchartDescription">
        {selectedDescription ?? defaultText ?? <em className="coreDetailEmpty">No flow description yet</em>}
      </div>
    </div>
  );
}

export function CascadeCard({
  cascade,
  onAccept,
  onReject,
}: {
  cascade: CascadeProposal;
  onAccept: (acceptedStages: AgentStage[], editedSummaries?: Record<string, string>) => void;
  onReject: () => void;
}) {
  const [checkedStages, setCheckedStages] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const u of cascade.proposedUpdates) init[u.stage] = true;
    return init;
  });
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const u of cascade.proposedUpdates) init[u.stage] = u.updatedSummary;
    return init;
  });

  const handleToggle = (stage: string) => {
    setCheckedStages((prev) => ({ ...prev, [stage]: !prev[stage] }));
  };

  const handleAccept = () => {
    const accepted = cascade.proposedUpdates
      .filter((u) => checkedStages[u.stage])
      .map((u) => u.stage);
    const edited: Record<string, string> = {};
    for (const u of cascade.proposedUpdates) {
      if (checkedStages[u.stage] && editedTexts[u.stage] !== u.updatedSummary) {
        edited[u.stage] = editedTexts[u.stage];
      }
    }
    onAccept(accepted, Object.keys(edited).length > 0 ? edited : undefined);
  };

  return (
    <div className="cascadeCard">
      <h5 className="cascadeCardTitle">Cascade Updates</h5>
      <p className="cascadeCardSubtitle">
        Updating <strong>{AGENT_STAGE_LABELS[cascade.triggeredByStage]}</strong> may affect these sections:
      </p>
      <div className="cascadeItems">
        {cascade.proposedUpdates.map((update) => (
          <div key={update.stage} className="cascadeItem">
            <label className="cascadeItemHeader">
              <input
                type="checkbox"
                checked={checkedStages[update.stage] ?? false}
                onChange={() => handleToggle(update.stage)}
              />
              <span className="cascadeItemLabel">{AGENT_STAGE_LABELS[update.stage]}</span>
            </label>
            <textarea
              className="cascadeItemText"
              value={editedTexts[update.stage] ?? ""}
              onChange={(e) => setEditedTexts((prev) => ({ ...prev, [update.stage]: e.target.value }))}
              disabled={!checkedStages[update.stage]}
            />
          </div>
        ))}
      </div>
      <div className="cascadeActions">
        <button className="primaryButton" onClick={handleAccept}>
          Accept Selected
        </button>
        <button className="secondaryButton" onClick={onReject}>
          Reject All
        </button>
      </div>
    </div>
  );
}

export function PingTranslationMessage({
  zhText,
  enText,
}: {
  zhText: string;
  enText: string;
}) {
  const [phase, setPhase] = useState<"zh" | "swipe" | "en">("zh");

  useEffect(() => {
    setPhase("zh");
    const swipeTimer = window.setTimeout(() => setPhase("swipe"), 900);
    const englishTimer = window.setTimeout(() => setPhase("en"), 1400);
    return () => {
      window.clearTimeout(swipeTimer);
      window.clearTimeout(englishTimer);
    };
  }, [enText, zhText]);

  return (
    <div className={`pingTranslationMessage pingTranslationMessage--${phase}`}>
      <div className="pingTranslationText">{phase === "en" ? enText : zhText}</div>
      {phase === "swipe" ? <span className="pingTranslationSwipe" aria-hidden="true" /> : null}
    </div>
  );
}

export function renderPingAwareMessageContent(message: Pick<AgentChatMessage, "content" | "metadata">) {
  return message.metadata?.type === "ping-translation" ? (
    <PingTranslationMessage
      zhText={message.metadata.zhResponse}
      enText={message.metadata.enTranslation}
    />
  ) : (
    <AgentChatMarkdown text={message.content} />
  );
}
