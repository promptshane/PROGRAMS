import type {
  AiProvider,
  Project,
  ProviderUsage,
  UsageSnapshot,
  UsageWindow,
} from "@shared/types";
import { Modal } from "./ui-primitives";
import {
  formatUsageDateTimeWithoutYear,
  formatUsageReset,
} from "../lib/formatting";
import { USAGE_SCHEDULE_TOLERANCE } from "../lib/constants";
import {
  computeExpectedPercent,
  getUsageScheduleTone,
  type UsageScheduleTone,
} from "../lib/session-helpers";

export function UsageOverviewSheet({
  provider,
  usage,
  projects,
  automationPriorityProjectIds,
  providerBusy,
  onProviderChange,
  onClose,
}: {
  provider: AiProvider;
  usage: UsageSnapshot;
  projects: Project[];
  automationPriorityProjectIds: Record<string, boolean>;
  providerBusy: boolean;
  onProviderChange: (provider: AiProvider) => void;
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
  const prioritizedProjects = projects.filter((project) => automationPriorityProjectIds[project.id]);

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
                className={provider === "claude" ? "usageProviderOption active" : "usageProviderOption"}
                onClick={() => onProviderChange("claude")}
                disabled={providerBusy}
              >
                Use Claude
              </button>
              <button
                type="button"
                className={provider === "codex" ? "usageProviderOption active" : "usageProviderOption"}
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
          <div className="usageAutomationCopy">
            <h4>Automation</h4>
            <p>Projects currently pinned for automation.</p>
          </div>
          {prioritizedProjects.length > 0 ? (
            <>
              <ul className="agentSummaryList">
                {prioritizedProjects.map((project) => (
                  <li key={project.id}>{project.name}</li>
                ))}
              </ul>
              <p className="coreDetailEmpty">Use the star icon on the Projects page to pin or unpin projects for automation.</p>
            </>
          ) : (
            <p className="coreDetailEmpty">No projects are pinned yet. Use the star icon on a project tile to add one.</p>
          )}
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
