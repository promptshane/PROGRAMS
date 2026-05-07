import { useEffect, useState } from "react";
import type { Project } from "@shared/types";
import { Modal } from "./ui-primitives";

type SuggestState =
  | { phase: "idle" }
  | { phase: "confirming" } // waiting for user to confirm token cost
  | { phase: "asking" } // Claude in flight
  | { phase: "failed"; message: string };

type RepairState =
  | { phase: "idle" }
  | { phase: "confirming" }
  | { phase: "preparing" }
  | { phase: "failed"; message: string };

export function RunCommandModal({
  project,
  onConfirm,
  onPrepareRepair,
  onDismiss,
}: {
  project: Project;
  onConfirm: (runCommand: string) => Promise<void>;
  onPrepareRepair: () => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [command, setCommand] = useState(project.runtimeConfig.runCommand ?? "");
  const [isConfirming, setIsConfirming] = useState(false);
  const [packageScripts, setPackageScripts] = useState<string[]>([]);
  const [readmeSuggestions, setReadmeSuggestions] = useState<string[]>([]);
  const [suggestState, setSuggestState] = useState<SuggestState>({ phase: "idle" });
  const [repairState, setRepairState] = useState<RepairState>({ phase: "idle" });

  useEffect(() => {
    setCommand(project.runtimeConfig.runCommand ?? "");
  }, [project.id, project.runtimeConfig.runCommand]);

  // Load Tier 1/2 suggestions on mount
  useEffect(() => {
    window.programs.getRunCommandSuggestions(project.id).then((s) => {
      setPackageScripts(s.packageScripts);
      setReadmeSuggestions(s.readmeSuggestions);
    }).catch(() => {
      // silently ignore — suggestions are best-effort
    });
  }, [project.id]);

  const handleConfirm = async () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setIsConfirming(true);
    try {
      await onConfirm(trimmed);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleAskClaude = async () => {
    setSuggestState({ phase: "asking" });
    try {
      const suggested = await window.programs.suggestRunCommand(project.id);
      if (suggested) {
        setCommand(suggested);
        setSuggestState({ phase: "idle" });
      } else {
        setSuggestState({
          phase: "failed",
          message: "Claude couldn't determine a run command from the project files. Enter it manually below.",
        });
      }
    } catch (err) {
      setSuggestState({
        phase: "failed",
        message: err instanceof Error ? err.message : "Claude couldn't complete the request.",
      });
    }
  };

  const handlePrepareRepair = async () => {
    setRepairState({ phase: "preparing" });
    try {
      const shouldClose = await onPrepareRepair();
      if (shouldClose) {
        onDismiss();
      } else {
        setRepairState({ phase: "idle" });
      }
    } catch (err) {
      setRepairState({
        phase: "failed",
        message: err instanceof Error ? err.message : "PROGRAMS could not prepare a repair copy.",
      });
    }
  };

  const hasAutoSuggestions = packageScripts.length > 0 || readmeSuggestions.length > 0;

  return (
    <Modal title="Run command" onClose={onDismiss} compact>
      <div className="formGrid">
        {/* Tier 1: package.json scripts */}
        {packageScripts.length > 0 && (
          <div className="spanTwo">
            <p className="fieldLabel">Scripts found in package.json — click to use:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {packageScripts.map((name) => (
                <button
                  key={name}
                  className="secondaryButton smallButton"
                  onClick={() => setCommand(`npm run ${name}`)}
                  disabled={isConfirming}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tier 2: README suggestions */}
        {readmeSuggestions.length > 0 && (
          <div className="spanTwo">
            <p className="fieldLabel">Found in README — click to use:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {readmeSuggestions.map((cmd) => (
                <button
                  key={cmd}
                  className="secondaryButton smallButton"
                  onClick={() => setCommand(cmd)}
                  disabled={isConfirming}
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tier 3: Ask Claude */}
        {suggestState.phase === "confirming" ? (
          <div className="spanTwo dangerCard">
            <strong>This will use Claude tokens.</strong>
            <p>
              Claude will read this project&apos;s file list, package.json, and README to suggest a
              run command. Proceed?
            </p>
            <div className="modalActions">
              <button
                className="secondaryButton"
                onClick={() => setSuggestState({ phase: "idle" })}
              >
                Cancel
              </button>
              <button className="primaryButton" onClick={() => void handleAskClaude()}>
                Ask Claude
              </button>
            </div>
          </div>
        ) : suggestState.phase === "asking" ? (
          <p className="spanTwo fieldLabel">Asking Claude...</p>
        ) : suggestState.phase === "failed" ? (
          <p className="spanTwo fieldLabel">{suggestState.message}</p>
        ) : (
          <div className="spanTwo">
            <button
              className="secondaryButton"
              onClick={() => setSuggestState({ phase: "confirming" })}
              disabled={isConfirming}
            >
              Ask Claude to detect it
            </button>
          </div>
        )}

        {repairState.phase === "confirming" ? (
          <div className="spanTwo dangerCard">
            <strong>This will create a PROGRAMS-managed repair copy.</strong>
            <p>
              PROGRAMS will copy this project into its own workspace so any repairs stay off the
              original attached folder. Proceed?
            </p>
            <div className="modalActions">
              <button
                className="secondaryButton"
                onClick={() => setRepairState({ phase: "idle" })}
                disabled={false}
              >
                Cancel
              </button>
              <button className="primaryButton" onClick={() => void handlePrepareRepair()}>
                Prepare copy
              </button>
            </div>
          </div>
        ) : repairState.phase === "preparing" ? (
          <p className="spanTwo fieldLabel">Preparing a repair copy...</p>
        ) : repairState.phase === "failed" ? (
          <p className="spanTwo fieldLabel">{repairState.message}</p>
        ) : (
          <div className="spanTwo">
            <button
              className="secondaryButton"
              onClick={() => setRepairState({ phase: "confirming" })}
              disabled={isConfirming}
            >
              Prepare repair copy
            </button>
          </div>
        )}

        {/* Manual input — always shown */}
        <label className="spanTwo">
          {hasAutoSuggestions || suggestState.phase !== "idle"
            ? "Or enter it manually:"
            : `PROGRAMS couldn\u2019t detect a run command for ${project.name}. Enter the command you use to start it \u2014 it\u2019ll be saved for next time.`}
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConfirm();
            }}
            placeholder="e.g. npm start, python3 app.py, go run ."
            autoFocus={!hasAutoSuggestions}
          />
        </label>

        <div className="modalActions spanTwo">
          <button className="secondaryButton" onClick={onDismiss} disabled={isConfirming}>
            Cancel
          </button>
          <button
            className="primaryButton"
            onClick={() => void handleConfirm()}
            disabled={!command.trim() || isConfirming}
          >
            {isConfirming ? "Saving..." : "Save & Run"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
