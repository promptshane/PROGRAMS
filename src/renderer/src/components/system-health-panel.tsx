import { useRef, useState } from "react";
import type { SystemHealthSnapshot, SystemHealthSeverity } from "@shared/types";
import { Modal } from "./ui-primitives";

// ── color helpers ─────────────────────────────────────────────────────────────

type DotColor = "green" | "yellow" | "orange" | "red";

function cpuDotColor(pct: number | null): DotColor {
  if (pct === null) return "green";
  if (pct > 90) return "red";
  if (pct > 75) return "orange";
  if (pct > 50) return "yellow";
  return "green";
}

function memDotColor(pressure: SystemHealthSnapshot["memoryPressureLevel"]): DotColor {
  if (pressure === "critical") return "red";
  if (pressure === "warning") return "yellow";
  return "green";
}

function thermalDotColor(state: SystemHealthSnapshot["thermalState"]): DotColor {
  if (state === "critical") return "red";
  if (state === "serious") return "orange";
  if (state === "fair") return "yellow";
  return "green";
}

const DOT_COLOR_CLASS: Record<DotColor, string> = {
  green: "sysHealthDot--green",
  yellow: "sysHealthDot--yellow",
  orange: "sysHealthDot--orange",
  red: "sysHealthDot--red",
};

const SEVERITY_LABEL_CLASS: Record<SystemHealthSeverity, string> = {
  Normal: "sysHealthSeverity--normal",
  Moderate: "sysHealthSeverity--moderate",
  Heavy: "sysHealthSeverity--heavy",
  Severe: "sysHealthSeverity--severe",
};

const THERMAL_LABEL: Record<string, string> = {
  nominal: "Nominal",
  fair: "Fair",
  serious: "Serious",
  critical: "Critical",
};

const PRESSURE_LABEL: Record<string, string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
};

function fmt(val: number | null, suffix = "%"): string {
  return val !== null ? `${Math.round(val)}${suffix}` : "—";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── sparkline with hover crosshair ────────────────────────────────────────────

const W = 320;
const H = 52;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function Sparkline({
  history,
  getValue,
  color,
}: {
  history: SystemHealthSnapshot[];
  getValue: (s: SystemHealthSnapshot) => number | null;
  color: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Only show last 5 minutes
  const cutoff = Date.now() - FIVE_MINUTES_MS;
  const recent = history.filter((s) => new Date(s.collectedAt).getTime() >= cutoff);
  const vals = recent.map(getValue).filter((v): v is number => v !== null);

  if (vals.length < 2) {
    return <p className="sysHealthSparklineEmpty">Collecting data…</p>;
  }

  const minV = Math.min(...vals);
  const maxV = Math.max(...vals, minV + 1);
  const range = maxV - minV;

  const toX = (i: number) => (i / (vals.length - 1)) * W;
  const toY = (v: number) => H - ((v - minV) / range) * (H - 6) - 3;

  const pts = vals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");

  const hoverSnap = hoverIdx !== null ? recent[hoverIdx] : null;
  const hoverVal = hoverIdx !== null ? vals[hoverIdx] : null;
  const hoverX = hoverIdx !== null ? toX(hoverIdx) : null;
  // tooltip left as % of SVG width so it stays inside
  const tooltipLeftPct = hoverIdx !== null ? (hoverIdx / (vals.length - 1)) * 100 : null;
  const tooltipOnRight = tooltipLeftPct !== null && tooltipLeftPct > 60;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(relX * (vals.length - 1)));
  };

  return (
    <div className="sysHealthSparklineWrap">
      <div className="sysHealthSparklineSvgArea">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="sysHealthSparklineSvg"
          aria-hidden="true"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <polyline
            points={pts}
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {hoverX !== null && (
            <line
              x1={hoverX} y1={0} x2={hoverX} y2={H}
              stroke="var(--muted)"
              strokeWidth="1"
              strokeDasharray="3,3"
              strokeOpacity="0.7"
            />
          )}
          {hoverX !== null && hoverVal !== null && (
            <circle
              cx={hoverX}
              cy={toY(hoverVal)}
              r="3"
              fill={color}
              stroke="var(--panel-strong)"
              strokeWidth="1.5"
            />
          )}
        </svg>

        {hoverSnap !== null && hoverVal !== null && tooltipLeftPct !== null && (
          <div
            className={`sysHealthTooltip${tooltipOnRight ? " sysHealthTooltip--right" : ""}`}
            style={tooltipOnRight
              ? { right: `${100 - tooltipLeftPct}%` }
              : { left: `${tooltipLeftPct}%` }
            }
          >
            <span className="sysHealthTooltipValue" style={{ color }}>{Math.round(hoverVal)}%</span>
            <span className="sysHealthTooltipTime">{fmtTime(hoverSnap.collectedAt)}</span>
          </div>
        )}
      </div>

      <div className="sysHealthSparklineMeta">
        <span className="sysHealthSparklineRange">{Math.round(maxV)}%</span>
        <span className="sysHealthSparklineCurrent" style={{ color }}>
          {hoverVal !== null ? `${Math.round(hoverVal)}%` : `${Math.round(vals[vals.length - 1])}% now`}
        </span>
        <span className="sysHealthSparklineRange">{Math.round(minV)}%</span>
      </div>
    </div>
  );
}

// ── compact top-bar button ────────────────────────────────────────────────────

export function SystemHealthButton({
  health,
  onClick,
}: {
  health: SystemHealthSnapshot;
  onClick: () => void;
}) {
  const dots: DotColor[] = [
    cpuDotColor(health.cpuPercent),
    memDotColor(health.memoryPressureLevel),
    thermalDotColor(health.thermalState),
  ];

  return (
    <button
      type="button"
      className="sysHealthTrigger projectBrowseBadge projectBrowseBadgeClickable"
      onClick={onClick}
      aria-label="Open system health"
    >
      <span className="sysHealthTriggerDots">
        {dots.map((color, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <span
            key={i}
            className={`sysHealthDot sysHealthDot--diamond ${DOT_COLOR_CLASS[color]}`}
            aria-hidden="true"
          />
        ))}
      </span>
    </button>
  );
}

// ── full-detail modal ─────────────────────────────────────────────────────────

export function SystemHealthModal({
  health,
  history,
  onFastPollChange,
  onClose,
}: {
  health: SystemHealthSnapshot;
  history: SystemHealthSnapshot[];
  onFastPollChange: (fast: boolean) => void;
  onClose: () => void;
}) {
  const [expandedMetric, setExpandedMetric] = useState<"cpu" | "memory" | null>(null);

  const toggleMetric = (metric: "cpu" | "memory") => {
    setExpandedMetric((current) => {
      const next = current === metric ? null : metric;
      onFastPollChange(next !== null);
      return next;
    });
  };

  const cpuColor = `var(--sysHealth-${cpuDotColor(health.cpuPercent)})`;
  const memColor = `var(--sysHealth-${memDotColor(health.memoryPressureLevel)})`;

  return (
    <Modal title="System Health" onClose={onClose}>
      <div className="sysHealthModalBody">
        <div className="sysHealthModalSection">
          <p className="sysHealthModalSectionTitle">Overview</p>
          <div className="sysHealthModalGrid">
            <SystemHealthMetricCard
              label="CPU Usage"
              value={fmt(health.cpuPercent)}
              dotColor={cpuDotColor(health.cpuPercent)}
              expandable
              expanded={expandedMetric === "cpu"}
              onClick={() => toggleMetric("cpu")}
            />
            <SystemHealthMetricCard
              label="Memory Used"
              value={fmt(health.memoryUsedPercent)}
              dotColor={memDotColor(health.memoryPressureLevel)}
              expandable
              expanded={expandedMetric === "memory"}
              onClick={() => toggleMetric("memory")}
            />
            <SystemHealthMetricCard
              label="Mem Pressure"
              value={health.memoryPressureLevel ? PRESSURE_LABEL[health.memoryPressureLevel] : "—"}
              dotColor={memDotColor(health.memoryPressureLevel)}
            />
            <SystemHealthMetricCard
              label="Thermal"
              value={THERMAL_LABEL[health.thermalState]}
              dotColor={thermalDotColor(health.thermalState)}
            />
            {health.swapUsedMb !== null && (
              <SystemHealthMetricCard
                label="Swap Used"
                value={`${fmt(health.swapUsedMb, "")} MB${health.swapTotalMb ? ` / ${fmt(health.swapTotalMb, "")}` : ""}`}
                dotColor={health.swapUsedMb > 0 ? "yellow" : "green"}
              />
            )}
            <SystemHealthMetricCard
              label="Severity"
              value={health.severity}
              dotColor={
                health.severity === "Severe" ? "red"
                  : health.severity === "Heavy" ? "orange"
                  : health.severity === "Moderate" ? "yellow"
                  : "green"
              }
              className={SEVERITY_LABEL_CLASS[health.severity]}
            />
          </div>

          {expandedMetric === "cpu" && (
            <Sparkline history={history} getValue={(s) => s.cpuPercent} color={cpuColor} />
          )}
          {expandedMetric === "memory" && (
            <Sparkline history={history} getValue={(s) => s.memoryUsedPercent} color={memColor} />
          )}
        </div>

        {health.topProcesses.length > 0 && (
          <div className="sysHealthModalSection">
            <p className="sysHealthModalSectionTitle">Top Processes</p>
            <div className="sysHealthProcessTable">
              <div className="sysHealthProcessHeader">
                <span>Process</span>
                <span>PID</span>
                <span>CPU</span>
                <span>MEM</span>
              </div>
              {health.topProcesses.map((proc) => (
                <div key={proc.pid} className="sysHealthProcessRow">
                  <span className="sysHealthProcessNameCell">
                    {proc.iconDataUrl ? (
                      <img src={proc.iconDataUrl} alt="" className="sysHealthProcessIcon" aria-hidden="true" />
                    ) : (
                      <span className="sysHealthProcessIconPlaceholder" aria-hidden="true" />
                    )}
                    <span className="sysHealthProcessName" title={proc.displayName}>
                      {proc.displayName}
                    </span>
                  </span>
                  <span className="sysHealthProcessMeta">{proc.pid}</span>
                  <span className="sysHealthProcessMeta">{fmt(proc.cpu)}</span>
                  <span className="sysHealthProcessMeta">{fmt(proc.mem)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="sysHealthUpdatedAt">
          Updated {new Date(health.collectedAt).toLocaleTimeString()} · {expandedMetric ? "1s" : "5s"} refresh
        </p>
      </div>
    </Modal>
  );
}

function SystemHealthMetricCard({
  label,
  value,
  dotColor,
  className = "",
  expandable = false,
  expanded = false,
  onClick,
}: {
  label: string;
  value: string;
  dotColor: DotColor;
  className?: string;
  expandable?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  const Tag = expandable ? "button" : "div";
  return (
    <Tag
      className={`sysHealthMetricCard${expandable ? " sysHealthMetricCard--clickable" : ""}${expanded ? " sysHealthMetricCard--expanded" : ""}`}
      {...(expandable && onClick ? { onClick, type: "button" as const } : {})}
    >
      <span className={`sysHealthDot ${DOT_COLOR_CLASS[dotColor]}`} aria-hidden="true" />
      <div className="sysHealthMetricCardBody">
        <span className="sysHealthMetricCardLabel">
          {label}
          {expandable && (
            <span className="sysHealthMetricCardChevron" aria-hidden="true">{expanded ? "▲" : "▼"}</span>
          )}
        </span>
        <span className={`sysHealthMetricCardValue ${className}`}>{value}</span>
      </div>
    </Tag>
  );
}
