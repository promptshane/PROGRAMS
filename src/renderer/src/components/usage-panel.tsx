import { useEffect, useMemo, useState } from "react";
import type {
  AiProvider,
  BasicAutomationStatus,
  ModelCatalog,
  Project,
  ProviderUsage,
  ReasoningEffort,
  Settings,
  UsageSnapshot,
  UsageWindow,
} from "@shared/types";
import { maxReasoningEffortForModel, reasoningEffortsForModel } from "@shared/reasoning-levels";
import { Modal } from "./ui-primitives";
import {
  fallbackClaudeModelLabel,
  fallbackCodexModelLabel,
  formatUsageDateTimeWithoutYear,
  formatUsageReset,
  labelForModel,
  labelForReasoningEffort,
  providerLabel,
  resolveModelOptions,
} from "../lib/formatting";
import { USAGE_SCHEDULE_TOLERANCE } from "../lib/constants";
import {
  computeExpectedPercent,
  getUsageScheduleTone,
  type UsageScheduleTone,
} from "../lib/session-helpers";

export function UsageOverviewSheet({
  provider,
  settings,
  modelCatalog,
  usage,
  projects,
  automationStatus,
  automationPriorityProjectIds,
  providerBusy,
  onProviderChange,
  onAutomationSettingsChange,
  onToggleAutomationProject,
  onClose,
}: {
  provider: AiProvider;
  settings: Settings;
  modelCatalog: ModelCatalog;
  usage: UsageSnapshot;
  projects: Project[];
  automationStatus: BasicAutomationStatus;
  automationPriorityProjectIds: Record<string, boolean>;
  providerBusy: boolean;
  onProviderChange: (provider: AiProvider) => void;
  onAutomationSettingsChange: (automation: Partial<Settings["automation"]>) => void;
  onToggleAutomationProject: (projectId: string) => void;
  onClose: () => void;
}) {
  type UsageCard = {
    key: "codex" | "claude";
    name: string;
    windows: ProviderUsage["windows"];
    note: string | null;
    loading: boolean;
  };

  const isUsageLoading = !usage.updatedAt;
  const updatedAt = usage.updatedAt ? new Date(usage.updatedAt) : null;
  const lastUpdatedLabel =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? `Last updated at ${formatUsageDateTimeWithoutYear(updatedAt)}`
      : null;
  const cards: UsageCard[] = [
    {
      key: "claude",
      name: "Claude",
      windows: usage.claude.windows,
      note: isUsageLoading ? null : usage.claude.note,
      loading: isUsageLoading,
    },
    {
      key: "codex",
      name: "Codex",
      windows: usage.codex.windows,
      note: isUsageLoading ? null : usage.codex.note,
      loading: isUsageLoading,
    },
  ];
  const automation = settings.automation;
  const [automationNoteDraft, setAutomationNoteDraft] = useState(automation.note);
  useEffect(() => {
    setAutomationNoteDraft(automation.note);
  }, [automation.note]);

  const prioritizedProjects = projects.filter((project) => automationPriorityProjectIds[project.id]);
  const currentAutomationProject = automationStatus.currentProjectId
    ? projects.find((project) => project.id === automationStatus.currentProjectId) ?? null
    : null;
  const pausedUntil = automationStatus.pausedUntil ? new Date(automationStatus.pausedUntil) : null;
  const pausedUntilLabel = pausedUntil && !Number.isNaN(pausedUntil.getTime())
    ? formatUsageDateTimeWithoutYear(pausedUntil)
    : null;
  const automationStateLabel = (() => {
    switch (automationStatus.state) {
      case "off":
        return "Off";
      case "idle":
        return "Idle";
      case "running":
        return "Running";
      case "waiting_for_usage":
        return "Waiting for usage reset";
      case "paused":
        return "Paused";
      case "blocked":
        return "Blocked";
    }
  })();
  const automationModelOptions = useMemo(() => (
    automation.provider === "claude"
      ? resolveModelOptions(automation.claudeModel, modelCatalog.claude, fallbackClaudeModelLabel)
      : resolveModelOptions(automation.model, modelCatalog.codex, fallbackCodexModelLabel)
  ), [automation.claudeModel, automation.model, automation.provider, modelCatalog.claude, modelCatalog.codex]);
  const automationReasoningOptions = useMemo(() => {
    const supported = reasoningEffortsForModel(
      automation.provider,
      automation.provider === "claude" ? automation.claudeModel : "",
    );
    return supported.includes(automation.reasoningEffort)
      ? supported
      : [...supported, automation.reasoningEffort];
  }, [automation.claudeModel, automation.provider, automation.reasoningEffort]);
  const commitAutomationNote = () => {
    const nextNote = automationNoteDraft.trim();
    if (nextNote !== automation.note) {
      onAutomationSettingsChange({ note: nextNote });
    }
  };
  const handleAutomationProviderChange = (nextProvider: AiProvider) => {
    const claudeModel = automation.claudeModel || "opus";
    onAutomationSettingsChange({
      provider: nextProvider,
      reasoningEffort: maxReasoningEffortForModel(nextProvider, nextProvider === "claude" ? claudeModel : ""),
    });
  };
  const handleAutomationModelChange = (nextModel: string) => {
    if (automation.provider === "claude") {
      onAutomationSettingsChange({
        claudeModel: nextModel,
        reasoningEffort: maxReasoningEffortForModel("claude", nextModel),
      });
      return;
    }

    onAutomationSettingsChange({
      model: nextModel,
      reasoningEffort: maxReasoningEffortForModel("codex", ""),
    });
  };

  return (
    <Modal title="Usage" onClose={onClose} fullscreen>
      <div className="usageOverviewLayout">
        <section className="usagePanelSection usageProviderSection">
          <div className="usageProviderHeader">
            <div className="usageProviderCopy">
              <h4>Agent Provider</h4>
              <p>Choose which provider agent workflows use by default.</p>
            </div>
            <div className="usageProviderToggle" role="tablist" aria-label="Agent provider">
              <button
                type="button"
                className={`usageProviderOption usageProviderOption--claude${provider === "claude" ? " active" : ""}`}
                onClick={() => onProviderChange("claude")}
                disabled={providerBusy}
              >
                Use Claude
              </button>
              <button
                type="button"
                className={`usageProviderOption usageProviderOption--gpt${provider === "codex" ? " active" : ""}`}
                onClick={() => onProviderChange("codex")}
                disabled={providerBusy}
              >
                Use GPT
              </button>
            </div>
          </div>
        </section>

        <div className="usageCardGrid">
          {cards.map((card) => {
            const isSelected = card.key === provider;

            return (
              <button
                key={card.key}
                className={`usageCard usageCard-${card.key}${isSelected ? " usageCard-selected" : ""}${card.loading ? " usageCard-loading" : ""}`}
                type="button"
                aria-pressed={isSelected}
                aria-busy={card.loading}
                disabled={providerBusy}
                onClick={() => onProviderChange(card.key)}
              >
                <div className="usageCardHead">
                  <h4>{card.name}</h4>
                  {card.loading ? (
                    <span className="usagePreviewLabel usagePreviewLabelPlaceholder" aria-hidden="true" />
                  ) : (
                    <span className="usagePreviewLabel usagePreviewLabelTimestamp">{lastUpdatedLabel ?? "Last updated"}</span>
                  )}
                </div>
                <div className="usageCardBody">
                  {card.loading ? (
                    <div className="usageMetricList usageMetricList-loading" aria-hidden="true">
                      <UsageMetricBar loading loadingIndex={0} />
                      <UsageMetricBar loading loadingIndex={1} />
                    </div>
                  ) : card.windows.length > 0 ? (
                    <div className="usageMetricList">
                      {(() => {
                        const weeklyFull = card.windows.some(
                          (w) => typeof w.usedPercent === "number" && w.usedPercent >= 100 && (w.windowDurationMins ?? 0) >= 10080,
                        );
                        return card.windows.map((win) => {
                          const isShortWindow = (win.windowDurationMins ?? Infinity) < 10080;
                          return (
                            <UsageMetricBar
                              key={`${card.key}-${win.label}`}
                              window={win}
                              dimmed={weeklyFull && isShortWindow}
                            />
                          );
                        });
                      })()}
                    </div>
                  ) : card.note ? (
                    <p className="usageNote usageCardEmptyCopy">{card.note}</p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <section className="usagePanelSection usageAutomationSection">
          <div className="usageAutomationHeader">
            <div className="usageAutomationCopy">
              <h4>Automation</h4>
              <p>Run basic plan/edit updates overnight without the agent workflow.</p>
            </div>
            <button
              type="button"
              className={`usageAutomationSwitch${automation.enabled ? " active" : ""}`}
              aria-pressed={automation.enabled}
              onClick={() => {
                onAutomationSettingsChange({
                  enabled: !automation.enabled,
                  note: automationNoteDraft.trim(),
                });
              }}
            >
              {automation.enabled ? "On" : "Off"}
            </button>
          </div>

          <div className={`usageAutomationStatus usageAutomationStatus-${automationStatus.state}`}>
            <span>{automationStateLabel}</span>
            <strong>
              {currentAutomationProject
                ? currentAutomationProject.name
                : pausedUntilLabel
                  ? `Resumes after ${pausedUntilLabel}`
                  : automationStatus.lastRunSummary ?? `${prioritizedProjects.length} project${prioritizedProjects.length === 1 ? "" : "s"} selected`}
            </strong>
            {automationStatus.lastRunSummary ? <p>{automationStatus.lastRunSummary}</p> : null}
          </div>

          <label className="usageAutomationField usageAutomationField-full">
            <span>Automation note</span>
            <textarea
              className="usageAutomationTextarea"
              value={automationNoteDraft}
              rows={4}
              placeholder="Work on the highest-impact small updates, then move through the selected projects."
              onChange={(event) => setAutomationNoteDraft(event.currentTarget.value)}
              onBlur={commitAutomationNote}
            />
          </label>

          <div className="usageAutomationControlsGrid">
            <label className="usageAutomationField">
              <span>Provider</span>
              <select
                value={automation.provider}
                onChange={(event) => handleAutomationProviderChange(event.currentTarget.value as AiProvider)}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </label>

            <label className="usageAutomationField">
              <span>Model</span>
              <select
                value={automation.provider === "claude" ? automation.claudeModel : automation.model}
                onChange={(event) => handleAutomationModelChange(event.currentTarget.value)}
              >
                {automationModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {labelForModel(
                      option.id,
                      automation.provider === "claude" ? modelCatalog.claude : modelCatalog.codex,
                      automation.provider === "claude" ? fallbackClaudeModelLabel : fallbackCodexModelLabel,
                    )}
                  </option>
                ))}
              </select>
            </label>

            <label className="usageAutomationField">
              <span>Reasoning</span>
              <select
                value={automation.reasoningEffort}
                onChange={(event) => onAutomationSettingsChange({ reasoningEffort: event.currentTarget.value as ReasoningEffort })}
              >
                {automationReasoningOptions.map((effort) => (
                  <option key={effort} value={effort}>
                    {labelForReasoningEffort(effort)}
                  </option>
                ))}
              </select>
            </label>

            <label className="usageAutomationField">
              <span>Pause at usage %</span>
              <input
                type="number"
                min={50}
                max={100}
                step={1}
                value={automation.usagePausePercent}
                onChange={(event) => onAutomationSettingsChange({
                  usagePausePercent: Number(event.currentTarget.value),
                })}
              />
            </label>
          </div>

          <div className="usageAutomationProjects">
            <div className="usageAutomationProjectsHead">
              <strong>Included projects</strong>
              <span>{prioritizedProjects.length} selected</span>
            </div>
          {prioritizedProjects.length > 0 ? (
            <>
              <div className="usageAutomationProjectList">
                {prioritizedProjects.map((project) => (
                  <label key={project.id} className="usageAutomationProjectRow">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => onToggleAutomationProject(project.id)}
                    />
                    <span>{project.name}</span>
                  </label>
                ))}
              </div>
              <p className="coreDetailEmpty">Use the star icon on the Projects page to pin or unpin projects for automation.</p>
            </>
          ) : (
            <p className="coreDetailEmpty">No projects are pinned yet. Use the star icon on a project tile to add one.</p>
          )}
          </div>

          {automationStatus.skippedProjects.length > 0 ? (
            <div className="usageAutomationSkipped">
              <strong>Skipped this pass</strong>
              <ul className="agentSummaryList">
                {automationStatus.skippedProjects.map((item) => {
                  const project = projects.find((candidate) => candidate.id === item.projectId);
                  return (
                    <li key={`${item.projectId}-${item.reason}`}>
                      {(project?.name ?? item.projectId)}: {item.detail ?? item.reason}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <p className="usageAutomationFootnote">
            Current runtime defaults to {providerLabel(automation.provider)} with auto planning, one project at a time.
          </p>
        </section>
      </div>
    </Modal>
  );
}

export function UsageMetricBar({
  window,
  dimmed = false,
  loading = false,
  loadingIndex = 0,
}: {
  window?: UsageWindow;
  dimmed?: boolean;
  loading?: boolean;
  loadingIndex?: number;
}) {
  if (loading || !window) {
    return (
      <div className="usageMetric usageMetric-static usageMetric-loading" aria-hidden="true">
        <div className="usageMetricHead">
          <span
            className={`usageSkeleton usageSkeletonLabel ${loadingIndex === 0 ? "usageSkeletonLabel-short" : "usageSkeletonLabel-long"}`}
          />
          <strong
            className={`usageSkeleton usageSkeletonValue ${loadingIndex === 0 ? "usageSkeletonValue-short" : "usageSkeletonValue-long"}`}
          />
        </div>
        <div className="usageBar usageBar-loading">
          <span
            className={`usageBarWhite usageBarWhite-loading ${loadingIndex === 0 ? "usageBarWhite-loading-short" : "usageBarWhite-loading-long"}`}
          />
        </div>
        <p className="usageResetLabel">
          <span
            className={`usageSkeleton usageSkeletonDetail ${loadingIndex === 0 ? "usageSkeletonDetail-short" : "usageSkeletonDetail-long"}`}
          />
        </p>
      </div>
    );
  }

  const hasProgress = typeof window.usedPercent === "number";
  const tone = hasProgress ? getUsageScheduleTone(window) : "onTrack";
  const metricLabel = window.valueLabel ?? `${window.usedPercent ?? 0}% used`;
  const metricDetail = window.detail ?? formatUsageReset(window);

  const actual = window.usedPercent ?? 0;
  const expected = computeExpectedPercent(window);
  const hasPaceData = expected !== null && hasProgress;

  let whiteWidth = 0;
  let scheduleWidth = 0;
  let isOver = false;

  if (hasPaceData) {
    const clampedActual = Math.min(100, actual);
    const clampedExpected = Math.min(100, expected!);
    if (actual < expected! - USAGE_SCHEDULE_TOLERANCE) {
      whiteWidth = clampedActual;
      scheduleWidth = Math.max(0, clampedExpected - clampedActual);
    } else if (actual > expected! + USAGE_SCHEDULE_TOLERANCE) {
      whiteWidth = clampedExpected;
      scheduleWidth = Math.max(0, clampedActual - clampedExpected);
      isOver = true;
    } else {
      whiteWidth = clampedActual;
    }
  } else if (hasProgress) {
    whiteWidth = Math.min(100, actual);
  }

  const showSchedule = scheduleWidth >= 1;

  return (
    <div className={`usageMetric usageMetric-${hasProgress ? tone : "static"}${dimmed ? " usageMetric-dimmed" : ""}`}>
      <div className="usageMetricHead">
        <span>{window.label}</span>
        <strong>{metricLabel}</strong>
      </div>
      {hasProgress ? (
        <div className="usageBar" aria-hidden="true">
          <span className="usageBarWhite" style={{ width: `${whiteWidth}%` }} />
          {showSchedule && (
            <span
              className={`usageBarSchedule usageBarSchedule-${isOver ? "over" : "under"}`}
              style={{ width: `${scheduleWidth}%` }}
            />
          )}
        </div>
      ) : null}
      <p className="usageResetLabel">{metricDetail}</p>
    </div>
  );
}
