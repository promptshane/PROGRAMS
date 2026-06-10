import type { Project, RuntimeState } from "@shared/types";
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


export function HomepageComposer() {
  return (
    <section className="homepageComposer">
      <div className="chatViewportDivider pageChromeDivider" aria-hidden="true" />
      <div className="homepageMainArea" style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
        <span style={{ color: "var(--color-text-tertiary, #888)" }}>TBD</span>
      </div>
    </section>
  );
}
