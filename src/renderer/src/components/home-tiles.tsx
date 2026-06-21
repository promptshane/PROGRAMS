import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HomeDelivery,
  HomeRoutingPlan,
  HomeSession,
  Project,
  RuntimeState,
  Settings,
} from "@shared/types";
import type { AgentAlertTone } from "../lib/agent-alert-state";
import { MoreIcon, AutomationStarIcon, ExclamationIcon } from "./icons";
import {
  createProjectTileStyle,
  createAgentLandingTileStyle,
  getHomeTileDotState,
} from "../lib/project-helpers";
import { initialsFromName } from "../lib/formatting";

export function HomeProjectTile({
  project,
  runtime,
  isLaunching,
  hasAssumedDetails,
  isAutomationPriority,
  onOpen,
  onQuickAction,
  onRestart,
  onOpenOptions,
  onToggleAutomationPriority,
}: {
  project: Project;
  runtime: RuntimeState | null;
  isLaunching: boolean;
  hasAssumedDetails?: boolean;
  isAutomationPriority: boolean;
  onOpen: () => void;
  onQuickAction: () => void;
  onRestart?: () => void;
  onOpenOptions: () => void;
  onToggleAutomationPriority: (projectId: string) => void;
}) {
  const dotState = getHomeTileDotState(project, runtime, isLaunching);
  const isRunning = Boolean(runtime?.running);
  const canStopFromDot = isRunning && !isLaunching;
  const hasBrowserTarget = Boolean(project.runtimeConfig.lastRunUrl ?? project.runtimeConfig.openUrl);
  const automationPriorityLabel = isAutomationPriority
    ? `Remove automation priority from ${project.name}`
    : `Prioritize ${project.name} for automation`;
  const quickActionLabel =
    isLaunching
      ? `Launching ${project.name}`
      : isRunning
      ? runtime?.source === "self"
        ? `Quit ${project.name}`
        : `Stop ${project.name}`
      : hasBrowserTarget
      ? `Run and open ${project.name}`
      : `Run ${project.name}`;

  return (
    <article className="projectTile projectTileGradient" style={createProjectTileStyle(project.iconColor)}>
      <button className="projectTileOpenArea" onClick={onOpen} aria-label={`Open ${project.name}`} />
      <button
        type="button"
        className={isAutomationPriority ? "projectTilePriorityToggle active" : "projectTilePriorityToggle"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          onToggleAutomationPriority(project.id);
          event.currentTarget.blur();
        }}
        aria-label={automationPriorityLabel}
        title={automationPriorityLabel}
        aria-pressed={isAutomationPriority}
      >
        <AutomationStarIcon filled={isAutomationPriority} />
      </button>
      <div className="projectTileChrome">
        <div className="projectTileTopRow">
          <div className="projectTileMenu">
            <button
              type="button"
              className="projectTileMenuToggle"
              aria-label={`Project options for ${project.name}`}
              onClick={onOpenOptions}
            >
              <MoreIcon />
            </button>
          </div>
        </div>

        <div className="projectTileBottomRow">
          <div className="tileName">
            {project.name}
            {hasAssumedDetails && <span className="tileAssumedBadge" title="Core details need review" />}
          </div>
          {isRunning && !isLaunching && runtime?.source !== "self" && onRestart && (
            <button
              type="button"
              className="projectRestartButton"
              aria-label={`Restart ${project.name}`}
              title={`Restart ${project.name}`}
              onClick={onRestart}
            >
              ↺
            </button>
          )}
          <button
            type="button"
            className={`projectStatusDot projectStatusDot-${dotState}${canStopFromDot ? " projectStatusDot-stopAction" : ""}`}
            aria-label={quickActionLabel}
            title={quickActionLabel}
            onClick={onQuickAction}
          />
        </div>
      </div>
    </article>
  );
}

export function AgentLandingCard({
  name,
  color,
  footerLabel,
  active = false,
  present = false,
  muted = false,
  disabled = false,
  onClick,
  onOpenOptions,
  alertTone = null,
  onExclamationClick,
  ariaLabel,
}: {
  name: string;
  color: string;
  footerLabel: string;
  active?: boolean;
  present?: boolean;
  muted?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onOpenOptions?: () => void;
  alertTone?: AgentAlertTone | null;
  onExclamationClick?: () => void;
  ariaLabel?: string;
}) {
  const isInteractive = Boolean(onClick && !disabled);
  return (
    <article className={`agentLandingCard${isInteractive ? " agentLandingCard--interactive" : " agentLandingCard--static"}${active ? " agentLandingCard--active" : ""}${present ? " agentLandingCard--present" : ""}${muted ? " agentLandingCard--muted" : ""}${disabled ? " agentLandingCard--disabled" : ""}`}>
      <div className="projectTile projectTileGradient agentLandingTile" style={createAgentLandingTileStyle(color, muted)}>
        {isInteractive ? (
          <button
            type="button"
            className="projectTileOpenArea"
            onClick={onClick}
            onMouseDown={(event) => event.preventDefault()}
            aria-label={ariaLabel ?? `Open ${name}`}
            aria-pressed={active}
          />
        ) : null}
        {onOpenOptions ? (
          <div className="projectTileMenu agentLandingMenu">
            <button
              type="button"
              className="projectTileMenuToggle"
              aria-label={`Open ${name} profile`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onOpenOptions();
              }}
            >
              <MoreIcon />
            </button>
          </div>
        ) : null}
        {alertTone && onExclamationClick ? (
          <div className="projectTileMenu agentLandingMenu agentLandingMenu--bottom">
            <button
              type="button"
              className={`agentLandingExclamationToggle${alertTone === "red" ? " agentLandingExclamationToggle--red" : ""}`}
              aria-label={`Alert for ${name}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onExclamationClick();
              }}
            >
              <ExclamationIcon />
            </button>
          </div>
        ) : null}
        <div className="agentLandingTileChrome">
          <div className="agentLandingTileTopRow">
            <span className="agentLandingAvatar">{initialsFromName(name)}</span>
            <span className="agentLandingName">{name}</span>
          </div>
          <div className="agentLandingFooter">{footerLabel}</div>
        </div>
      </div>
    </article>
  );
}


const natureLabel = (nature: HomeDelivery["nature"]): string =>
  nature === "creative" ? "creative · Dan" : nature === "technical" ? "technical · Todd" : "general · Jeff";

export function HomepageComposer({
  settings,
  onOpenProjectAgents,
  pushToast,
}: {
  settings: Settings;
  onOpenProjectAgents: (projectId: string) => void;
  pushToast: (message: string, level: "info" | "success" | "error") => void;
}) {
  const [session, setSession] = useState<HomeSession | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<Set<string>>(new Set());
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.programs
      .getHomeSession()
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch(() => {
        if (!cancelled) pushToast("Couldn't load the home agent.", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  const pendingPlan = session?.pendingPlan ?? null;

  // Default-select everything whenever a fresh plan becomes pending.
  useEffect(() => {
    if (!pendingPlan) {
      setSelectedDeliveryIds(new Set());
      setSelectedProposalIds(new Set());
      return;
    }
    setSelectedDeliveryIds(new Set(pendingPlan.deliveries.map((delivery) => delivery.id)));
    setSelectedProposalIds(new Set(pendingPlan.newProjectProposals.map((proposal) => proposal.id)));
  }, [pendingPlan?.id]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [session?.messages.length, sending, confirming]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setInput("");
    try {
      const response = await window.programs.homeChat({
        provider: settings.advancedDefaults.provider,
        model: settings.advancedDefaults.model,
        claudeModel: settings.advancedDefaults.claudeModel,
        message: trimmed,
      });
      setSession(response.session);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "The home agent couldn't respond.", "error");
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }, [input, sending, settings.advancedDefaults, pushToast]);

  const confirm = useCallback(async () => {
    if (!pendingPlan || confirming) return;
    setConfirming(true);
    try {
      const updated = await window.programs.confirmHomeDeliveries({
        planId: pendingPlan.id,
        approvedDeliveryIds: [...selectedDeliveryIds],
        approvedProposals: pendingPlan.newProjectProposals
          .filter((proposal) => selectedProposalIds.has(proposal.id))
          .map((proposal) => ({ id: proposal.id })),
      });
      setSession(updated);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Couldn't send those notes.", "error");
    } finally {
      setConfirming(false);
    }
  }, [pendingPlan, confirming, selectedDeliveryIds, selectedProposalIds, pushToast]);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const messages = session?.messages ?? [];
  const hasSelection = selectedDeliveryIds.size > 0 || selectedProposalIds.size > 0;

  return (
    <section className="homepageComposer">
      <div className="chatViewportDivider pageChromeDivider" aria-hidden="true" />
      <div className="homeAgentMainArea">
        <div className="homeAgentScroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="homeAgentEmpty">
              <p className="homeAgentEmptyTitle">Talk to me like a front desk.</p>
              <p className="homeAgentEmptyHint">
                Ramble or paste your daily notes. I'll figure out which project each piece belongs to,
                show you where I'm about to send it, and only deliver once you confirm.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="homeAgentRow homeAgentRow--user">
                    <div className="homeAgentBubble homeAgentBubble--user">{message.content}</div>
                  </div>
                );
              }
              if (message.role === "system") {
                return (
                  <HomeReceipt
                    key={message.id}
                    content={message.content}
                    plan={message.plan ?? null}
                    onOpenProjectAgents={onOpenProjectAgents}
                  />
                );
              }
              const isPending = Boolean(message.plan && pendingPlan && message.plan.id === pendingPlan.id);
              return (
                <div key={message.id} className="homeAgentRow homeAgentRow--agent">
                  <div className="homeAgentBubble homeAgentBubble--agent">
                    <div className="homeAgentReply">{message.content}</div>
                    {message.plan && message.plan.clarifyingQuestions.length > 0 ? (
                      <ul className="homeAgentQuestions">
                        {message.plan.clarifyingQuestions.map((question, index) => (
                          <li key={index}>{question}</li>
                        ))}
                      </ul>
                    ) : null}
                    {isPending && message.plan ? (
                      <HomePreviewCard
                        plan={message.plan}
                        selectedDeliveryIds={selectedDeliveryIds}
                        selectedProposalIds={selectedProposalIds}
                        confirming={confirming}
                        hasSelection={hasSelection}
                        onToggleDelivery={(id) => setSelectedDeliveryIds((prev) => toggle(prev, id))}
                        onToggleProposal={(id) => setSelectedProposalIds((prev) => toggle(prev, id))}
                        onConfirm={() => void confirm()}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          {sending ? (
            <div className="homeAgentRow homeAgentRow--agent">
              <div className="homeAgentBubble homeAgentBubble--agent homeAgentBubble--working">Reading your notes…</div>
            </div>
          ) : null}
        </div>
        <div className="homeAgentComposer">
          <textarea
            className="homeAgentTextarea"
            value={input}
            placeholder="Paste your daily notes or just start talking…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
          />
          <button
            type="button"
            className="homeAgentSend"
            disabled={!input.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}

function HomePreviewCard({
  plan,
  selectedDeliveryIds,
  selectedProposalIds,
  confirming,
  hasSelection,
  onToggleDelivery,
  onToggleProposal,
  onConfirm,
}: {
  plan: HomeRoutingPlan;
  selectedDeliveryIds: Set<string>;
  selectedProposalIds: Set<string>;
  confirming: boolean;
  hasSelection: boolean;
  onToggleDelivery: (id: string) => void;
  onToggleProposal: (id: string) => void;
  onConfirm: () => void;
}) {
  if (plan.deliveries.length === 0 && plan.newProjectProposals.length === 0) {
    return null;
  }
  return (
    <div className="homePreviewCard">
      <div className="homePreviewTitle">Here's where I'll send this — confirm to deliver:</div>
      {plan.newProjectProposals.length > 0 ? (
        <div className="homePreviewGroup">
          <div className="homePreviewGroupLabel">New projects</div>
          {plan.newProjectProposals.map((proposal) => (
            <label key={proposal.id} className="homePreviewItem">
              <input
                type="checkbox"
                checked={selectedProposalIds.has(proposal.id)}
                onChange={() => onToggleProposal(proposal.id)}
              />
              <span className="homePreviewItemBody">
                <span className="homePreviewItemHead">Create “{proposal.name}”</span>
                <span className="homePreviewItemReason">{proposal.reason || proposal.initialIdea}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="homePreviewGroup">
        <div className="homePreviewGroupLabel">Deliveries</div>
        {plan.deliveries.map((delivery) => (
          <label key={delivery.id} className="homePreviewItem">
            <input
              type="checkbox"
              checked={selectedDeliveryIds.has(delivery.id)}
              onChange={() => onToggleDelivery(delivery.id)}
            />
            <span className="homePreviewItemBody">
              <span className="homePreviewItemHead">
                {delivery.projectName || "New project"} · {natureLabel(delivery.nature)}
              </span>
              <span className="homePreviewItemContent">{delivery.content}</span>
            </span>
          </label>
        ))}
      </div>
      <button type="button" className="homePreviewConfirm" disabled={confirming || !hasSelection} onClick={onConfirm}>
        {confirming ? "Sending…" : "Confirm & send"}
      </button>
    </div>
  );
}

function HomeReceipt({
  content,
  plan,
  onOpenProjectAgents,
}: {
  content: string;
  plan: HomeRoutingPlan | null;
  onOpenProjectAgents: (projectId: string) => void;
}) {
  const sent = plan?.deliveries.filter((delivery) => delivery.status === "sent") ?? [];
  const failed = plan?.deliveries.filter((delivery) => delivery.status === "failed") ?? [];
  return (
    <div className="homeReceipt">
      <div className="homeReceiptHead">{content}</div>
      {sent.length > 0 ? (
        <div className="homeReceiptChips">
          {sent.map((delivery) => (
            <button
              key={delivery.id}
              type="button"
              className="homeReceiptChip"
              onClick={() => delivery.projectId && onOpenProjectAgents(delivery.projectId)}
            >
              ✓ {delivery.projectName} → Jeff ({natureLabel(delivery.nature)})
            </button>
          ))}
        </div>
      ) : null}
      {failed.length > 0 ? (
        <div className="homeReceiptChips">
          {failed.map((delivery) => (
            <span key={delivery.id} className="homeReceiptChip homeReceiptChip--failed">
              ✕ {delivery.projectName || "New project"} — {delivery.errorMessage ?? "failed"}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
