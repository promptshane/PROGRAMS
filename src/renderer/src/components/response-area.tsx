import { useEffect, useState } from "react";
import type { ReasoningEffort, UpdateStageStatus } from "@shared/types";
import { AgentChatMarkdown } from "../lib/agent-chat-markdown";
import { labelForReasoningEffort } from "../lib/formatting";

// ---------------------------------------------------------------------------
// A "Response area" is the unified block produced by one user message: it shows
// (conditionally) a progress bar, a to-do list, the AI's thinking/response in a
// named box, and a button to open the full plan in a side drawer. The data is a
// subset of the real `PlanDraft` so live data can drop in later unchanged.
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "in_progress" | "completed";

export interface ProgressStep {
  step: string;
  status: StepStatus;
}

export interface ResponsePlan {
  summary: string | null;
  impact: string | null;
  diff: string | null;
}

export type ResponseProvider = "claude" | "codex";
export type ResponseMode = "ask" | "plan" | "auto";
export type ResponseStatus = "running" | "awaiting_approval" | "completed" | "failed";

export interface UserTurn {
  id: string;
  role: "user";
  content: string;
  createdAt: Date;
}

export interface AssistantTurn {
  id: string;
  role: "assistant";
  createdAt: Date;
  provider: ResponseProvider;
  mode: ResponseMode;
  model: string; // display label of the model that produced this turn
  reasoningEffort: ReasoningEffort;
  status: ResponseStatus;
  thinkingStatus: UpdateStageStatus;
  planningStatus: UpdateStageStatus;
  buildingStatus: UpdateStageStatus;
  verifyingStatus: UpdateStageStatus;
  thought: string; // accumulated thinking transcript (newline-separated)
  steps: ProgressStep[];
  plan: ResponsePlan | null;
  finalText: string | null;
  durationSec: number | null; // how long the model worked before finishing
}

export type ChatTurn = UserTurn | AssistantTurn;

export const providerDisplayName = (provider: ResponseProvider): string =>
  provider === "claude" ? "Claude" : "GPT-Codex";

// ---------------------------------------------------------------------------
// Progress math (shared with the phase bar)
// ---------------------------------------------------------------------------

type MacroState = "pending" | "active" | "done" | "failed";

const macroState = (a: UpdateStageStatus, b: UpdateStageStatus): MacroState => {
  const done = (s: UpdateStageStatus) => s === "completed" || s === "skipped";
  if (a === "failed" || b === "failed") return "failed";
  if (done(a) && done(b)) return "done";
  if (a === "in_progress" || b === "in_progress" || done(a) || done(b)) return "active";
  return "pending";
};

const hasProgressed = (turn: AssistantTurn): boolean =>
  turn.thinkingStatus !== "pending" ||
  turn.planningStatus !== "pending" ||
  turn.buildingStatus !== "pending" ||
  turn.verifyingStatus !== "pending";

const planHasContent = (plan: ResponsePlan | null): plan is ResponsePlan =>
  Boolean(plan && (plan.summary || plan.diff || plan.impact));

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

// Once a turn is no longer running, no stage should read as "in progress" — a
// terminal/awaiting turn that left a stage at in_progress (a race, or a reloaded
// old chat) would otherwise keep its dot blinking forever. Settle it to done.
const settleStage = (status: UpdateStageStatus, live: boolean): UpdateStageStatus =>
  !live && status === "in_progress" ? "completed" : status;

function PhaseBar({ turn }: { turn: AssistantTurn }) {
  const live = turn.status === "running";
  const planning = macroState(settleStage(turn.thinkingStatus, live), settleStage(turn.planningStatus, live));
  const coding = macroState(settleStage(turn.buildingStatus, live), settleStage(turn.verifyingStatus, live));

  return (
    <div className="projectProgressPhase">
      <div className="projectProgressPhaseLabels">
        <span className={`projectProgressPhaseNode projectProgressPhaseNode--${planning}`}>
          <span className="projectProgressPhaseDot" />
          Planning
        </span>
        <span className={`projectProgressPhaseNode projectProgressPhaseNode--${coding}`}>
          <span className="projectProgressPhaseDot" />
          Coding
        </span>
      </div>
    </div>
  );
}

function TodoList({ steps, live }: { steps: ProgressStep[]; live: boolean }) {
  // When the turn is finished, a still-"in_progress" step is stale — show it done.
  const settled = steps.map((s) => ({
    ...s,
    status: !live && s.status === "in_progress" ? ("completed" as StepStatus) : s.status,
  }));
  const done = settled.filter((s) => s.status === "completed").length;
  return (
    <div className="projectProgressTodos">
      <span className="projectProgressTodosLabel">
        To-do · {done}/{settled.length}
      </span>
      <ul className="projectProgressTodoList">
        {settled.map((step) => (
          <li key={step.step} className={`projectProgressTodo projectProgressTodo--${step.status}`}>
            <span className="projectProgressTodoDot" />
            <span className="projectProgressTodoText">{step.step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const formatWorkedFor = (durationSec: number | null): string => {
  if (durationSec == null) return "Thought";
  if (durationSec < 1) return "Worked for <1s";
  if (durationSec < 60) return `Worked for ${durationSec}s`;
  const m = Math.floor(durationSec / 60);
  const s = durationSec % 60;
  return s > 0 ? `Worked for ${m}m ${s}s` : `Worked for ${m}m`;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="responseCopyButton"
      aria-label={copied ? "Copied" : "Copy response"}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ThoughtBox({ turn }: { turn: AssistantTurn }) {
  const [expanded, setExpanded] = useState(false);
  const label = providerDisplayName(turn.provider);
  const running = turn.status === "running";
  const hasResponse = Boolean(turn.finalText);
  // Collapsed thinking shows live status while running, then "Worked for Ns".
  const metaLabel = running ? "Thinking…" : formatWorkedFor(turn.durationSec);
  // Traceability badge: which model + thinking level produced this turn.
  const badge = [turn.model, labelForReasoningEffort(turn.reasoningEffort)].filter(Boolean).join(" · ");

  return (
    <div className="responseAreaThought">
      <button
        type="button"
        className="responseAreaThoughtHeader"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="responseAreaThoughtLabel">{label}</span>
        {running ? <span className="responseAreaWorking" aria-label="Working" /> : null}
        {badge ? <span className="responseAreaBadge">{badge}</span> : null}
        <span className="responseAreaThoughtMeta">{metaLabel}</span>
        <span className="responseAreaThoughtChevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div className="responseAreaThoughtTranscript">
          {turn.thought ? (
            <AgentChatMarkdown text={turn.thought} />
          ) : (
            <span className="responseAreaThoughtIdle">No thoughts captured yet.</span>
          )}
        </div>
      ) : null}

      {hasResponse ? (
        <div className="responseAreaResponse">
          <AgentChatMarkdown text={turn.finalText as string} />
          <CopyButton text={turn.finalText as string} />
        </div>
      ) : running && turn.thought ? (
        // Before the final answer arrives, show the live stream so it feels alive.
        <div className="responseAreaResponse responseAreaResponse--streaming">
          <AgentChatMarkdown text={turn.thought} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Response area
// ---------------------------------------------------------------------------

export interface ResponseAreaProps {
  turn: AssistantTurn;
  onOpenPlan: (turnId: string) => void;
  onApprove?: (turnId: string) => void;
}

export function ResponseArea({ turn, onOpenPlan, onApprove }: ResponseAreaProps) {
  const showProgress = turn.mode !== "ask" && hasProgressed(turn);
  const showTodos = turn.steps.length > 0;
  const showPlan = planHasContent(turn.plan);
  const awaitingApproval = turn.status === "awaiting_approval";

  return (
    <div className={`responseArea responseArea--${turn.provider}`}>
      {showProgress ? <PhaseBar turn={turn} /> : null}
      {showTodos ? <TodoList steps={turn.steps} live={turn.status === "running"} /> : null}
      <ThoughtBox turn={turn} />
      {showPlan || awaitingApproval ? (
        <div className="responseAreaFooter">
          {showPlan ? (
            <button type="button" className="responseViewPlan" onClick={() => onOpenPlan(turn.id)}>
              View plan
            </button>
          ) : null}
          {awaitingApproval && onApprove ? (
            <button type="button" className="responseApprove" onClick={() => onApprove(turn.id)}>
              Approve &amp; build
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ResponseArea;

// ---------------------------------------------------------------------------
// Right-side plan drawer
// ---------------------------------------------------------------------------

export interface PlanDrawerProps {
  plan: ResponsePlan;
  onClose: () => void;
  onApprove?: () => void;
}

export function PlanDrawer({ plan, onClose, onApprove }: PlanDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="planDrawerOverlay" onClick={onClose}>
      <div
        className="planDrawerPanel"
        role="dialog"
        aria-label="Plan"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="planDrawerHeader">
          <h3>Plan</h3>
          <div className="planDrawerHeaderActions">
            {onApprove ? (
              <button
                type="button"
                className="responseApprove"
                onClick={() => {
                  onApprove();
                  onClose();
                }}
              >
                Approve &amp; build
              </button>
            ) : null}
            <button type="button" className="planDrawerClose" aria-label="Close plan" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="planDrawerBody">
          {plan.summary ? (
            <section className="planDrawerSection">
              <h4>Summary</h4>
              <AgentChatMarkdown text={plan.summary} />
            </section>
          ) : null}
          {plan.impact ? (
            <section className="planDrawerSection">
              <h4>Impact</h4>
              <AgentChatMarkdown text={plan.impact} />
            </section>
          ) : null}
          {plan.diff ? (
            <section className="planDrawerSection">
              <h4>Changes</h4>
              <pre className="updateStageCodeBlock">{plan.diff}</pre>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
