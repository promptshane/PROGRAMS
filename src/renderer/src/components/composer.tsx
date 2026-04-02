import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ClaudeModel,
  CodexModel,
  ModelCatalog,
  ModelOption,
  PlanningMode,
  SpeedMode,
  AiProvider,
  Settings,
} from "@shared/types";
import { ChevronDownIcon, PlusIcon, ArrowUpIcon, StopIcon, CheckIcon } from "./icons";
import {
  fallbackCodexModelLabel,
  fallbackClaudeModelLabel,
  labelForModel,
  labelForComposerModel,
  labelForReasoningEffort,
  labelForPlanningMode,
} from "../lib/formatting";
import type { ComposerOptions } from "../lib/constants";

export type ComposerMenuKey = "model" | "speed" | "thinking" | "plan";

export function ComposerControlBar({
  options,
  modelCatalog,
  addFilesBusy,
  sendBusy,
  isRunning,
  hideAddFilesButton,
  hideModelMenu,
  hideThinkingMenu,
  hidePlanningMenu,
  hideSpeedMenu,
  onCodexModelChange,
  onClaudeModelChange,
  onReasoningChange,
  onSpeedChange,
  onPlanningModeChange,
  onAddFiles,
  onSubmit,
  onStop,
  submitLabel,
}: {
  options: ComposerOptions;
  modelCatalog: ModelCatalog;
  addFilesBusy: boolean;
  sendBusy: boolean;
  isRunning: boolean;
  hideAddFilesButton?: boolean;
  hideModelMenu?: boolean;
  hideThinkingMenu?: boolean;
  hidePlanningMenu?: boolean;
  hideSpeedMenu?: boolean;
  onCodexModelChange: (model: CodexModel) => void;
  onClaudeModelChange: (model: ClaudeModel) => void;
  onReasoningChange: (reasoningEffort: ComposerOptions["reasoningEffort"]) => void;
  onSpeedChange: (speed: SpeedMode) => void;
  onPlanningModeChange: (planningMode: PlanningMode) => void;
  onAddFiles: () => void;
  onSubmit: () => void;
  onStop: () => void;
  submitLabel: string;
}) {
  const [openMenu, setOpenMenu] = useState<ComposerMenuKey | null>(null);
  const closeMenus = () => setOpenMenu(null);
  const codexModelOptions = useMemo(() => {
    if (modelCatalog.codex.some((option) => option.id === options.model)) {
      return modelCatalog.codex;
    }

    return [
      {
        id: options.model,
        label: labelForModel(options.model, modelCatalog.codex, fallbackCodexModelLabel),
        detail: null,
      },
      ...modelCatalog.codex,
    ];
  }, [modelCatalog.codex, options.model]);
  const claudeModelOptions = useMemo(() => {
    if (modelCatalog.claude.some((option) => option.id === options.claudeModel)) {
      return modelCatalog.claude;
    }

    return [
      {
        id: options.claudeModel,
        label: labelForModel(options.claudeModel, modelCatalog.claude, fallbackClaudeModelLabel),
        detail: null,
      },
      ...modelCatalog.claude,
    ];
  }, [modelCatalog.claude, options.claudeModel]);

  return (
    <div className="composerControlRow">
      <div className="composerControlCluster">
        {!hideAddFilesButton ? (
          <button
            className="secondaryButton composerIconButton"
            onClick={() => {
              closeMenus();
              onAddFiles();
            }}
            disabled={addFilesBusy}
            aria-label="Add files"
          >
            <PlusIcon />
          </button>
        ) : null}

        {!hideModelMenu ? (
          <ComposerMenu
            label={labelForComposerModel(options, modelCatalog)}
            open={openMenu === "model"}
            onToggle={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
            onClose={closeMenus}
          >
              <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">GPT models</span>
              {codexModelOptions.map((model) => (
                <ComposerMenuOption
                  key={model.id}
                  label={model.label}
                  detail={model.detail ?? undefined}
                  active={options.provider === "codex" && options.model === model.id}
                  onClick={() => {
                    onCodexModelChange(model.id);
                    closeMenus();
                  }}
                />
              ))}
            </div>

            <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">Claude models</span>
              {claudeModelOptions.map((model) => (
                <ComposerMenuOption
                  key={model.id}
                  label={model.label}
                  detail={model.detail ?? undefined}
                  active={options.provider === "claude" && options.claudeModel === model.id}
                  onClick={() => {
                    onClaudeModelChange(model.id);
                    closeMenus();
                  }}
                />
              ))}
            </div>
          </ComposerMenu>
        ) : null}

        {!hideSpeedMenu && options.provider === "codex" ? (
          <ComposerMenu
            label={`Speed: ${options.speed === "fast" ? "Fast" : "Normal"}`}
            open={openMenu === "speed"}
            onToggle={() => setOpenMenu((current) => (current === "speed" ? null : "speed"))}
            onClose={closeMenus}
          >
            <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">Speed</span>
              <ComposerMenuOption
                label="Normal"
                active={options.speed === "normal"}
                onClick={() => {
                  onSpeedChange("normal");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="Fast"
                active={options.speed === "fast"}
                onClick={() => {
                  onSpeedChange("fast");
                  closeMenus();
                }}
              />
            </div>
          </ComposerMenu>
        ) : null}

        {!hideThinkingMenu ? (
          <ComposerMenu
            label={`Thinking: ${labelForReasoningEffort(options.reasoningEffort)}`}
            open={openMenu === "thinking"}
            onToggle={() => setOpenMenu((current) => (current === "thinking" ? null : "thinking"))}
            onClose={closeMenus}
          >
            <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">Thinking depth</span>
              <ComposerMenuOption
                label="Low"
                active={options.reasoningEffort === "low"}
                onClick={() => {
                  onReasoningChange("low");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="Normal"
                active={options.reasoningEffort === "medium"}
                onClick={() => {
                  onReasoningChange("medium");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="High"
                active={options.reasoningEffort === "high"}
                onClick={() => {
                  onReasoningChange("high");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="Extra high"
                active={options.reasoningEffort === "xhigh"}
                onClick={() => {
                  onReasoningChange("xhigh");
                  closeMenus();
                }}
              />
            </div>
          </ComposerMenu>
        ) : null}

        {!hidePlanningMenu && (
          <ComposerMenu
            label={`Planning: ${labelForPlanningMode(options.planningMode)}`}
            open={openMenu === "plan"}
            onToggle={() => setOpenMenu((current) => (current === "plan" ? null : "plan"))}
            onClose={closeMenus}
            align="end"
          >
            <div className="composerMenuSection">
              <span className="composerMenuSectionTitle">Planning mode</span>
              <ComposerMenuOption
                label="Review plan"
                detail="Pause after the draft so you can confirm it."
                active={options.planningMode === "review"}
                onClick={() => {
                  onPlanningModeChange("review");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="Auto-accept plan"
                detail="Apply the update as soon as the plan is ready."
                active={options.planningMode === "auto"}
                onClick={() => {
                  onPlanningModeChange("auto");
                  closeMenus();
                }}
              />
              <ComposerMenuOption
                label="No plan"
                detail="Skip drafting and start building immediately."
                active={options.planningMode === "none"}
                onClick={() => {
                  onPlanningModeChange("none");
                  closeMenus();
                }}
              />
            </div>
            <p className="composerMenuNote">
              Review pauses for approval, Auto applies the draft immediately, and No Plan skips the draft entirely.
            </p>
          </ComposerMenu>
        )}
      </div>

      {isRunning ? (
        <button
          className="composerSubmitButton composerStopButton"
          onClick={() => {
            closeMenus();
            onStop();
          }}
          aria-label="Stop update"
          title="Stop update"
        >
          <StopIcon />
        </button>
      ) : (
        <button
          className="primaryButton composerSubmitButton"
          onClick={() => {
            closeMenus();
            onSubmit();
          }}
          disabled={sendBusy}
          aria-label={submitLabel}
          title={submitLabel}
        >
          <ArrowUpIcon />
        </button>
      )}
    </div>
  );
}

export function ComposerMenu({
  label,
  open,
  onToggle,
  onClose,
  align = "start",
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const updatePanelPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const spaceAbove = rect.top - 20;
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      const nextPlacement = spaceAbove >= 260 || spaceAbove >= spaceBelow ? "above" : "below";
      const availableSpace = nextPlacement === "above" ? spaceAbove : spaceBelow;
      setPlacement(nextPlacement);
      setMaxHeight(Math.min(420, Math.max(0, Math.floor(availableSpace))));
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    updatePanelPosition();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, onClose]);

  return (
    <div ref={menuRef} className="composerMenu">
      <button
        type="button"
        ref={triggerRef}
        className={open ? "composerMenuTrigger active" : "composerMenuTrigger"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div
          className={`composerMenuPanel composerMenuPanel-${placement} composerMenuPanel-${align}`}
          style={maxHeight !== undefined ? { maxHeight } : undefined}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ComposerMenuOption({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "composerMenuItem active" : "composerMenuItem"}
      onClick={onClick}
    >
      <span className="composerMenuItemCopy">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </span>
      <span className="composerMenuItemCheck" aria-hidden="true">
        {active ? <CheckIcon /> : null}
      </span>
    </button>
  );
}
