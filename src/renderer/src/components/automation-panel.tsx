import { useEffect, useMemo, useState } from "react";
import type {
  AiProvider,
  BasicAutomationStatus,
  ModelCatalog,
  Project,
  ReasoningEffort,
  Settings,
} from "@shared/types";
import { maxReasoningEffortForModel, reasoningEffortsForModel } from "@shared/reasoning-levels";
import {
  fallbackClaudeModelLabel,
  fallbackCodexModelLabel,
  formatUsageDateTimeWithoutYear,
  labelForModel,
  labelForReasoningEffort,
  providerLabel,
  resolveModelOptions,
} from "../lib/formatting";
import { Modal } from "./ui-primitives";

export function AutomationOverviewSheet({
  settings,
  modelCatalog,
  projects,
  automationStatus,
  automationPriorityProjectIds,
  onAutomationSettingsChange,
  onToggleAutomationProject,
  onClose,
}: {
  settings: Settings;
  modelCatalog: ModelCatalog;
  projects: Project[];
  automationStatus: BasicAutomationStatus;
  automationPriorityProjectIds: Record<string, boolean>;
  onAutomationSettingsChange: (automation: Partial<Settings["automation"]>) => void;
  onToggleAutomationProject: (projectId: string) => void;
  onClose: () => void;
}) {
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
    <Modal title="Automation" onClose={onClose} fullscreen>
      <div className="automationOverviewLayout">
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
