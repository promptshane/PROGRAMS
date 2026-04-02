import { useEffect, useState } from "react";
import type { AgentSession, Project } from "@shared/types";
import { Modal } from "./ui-primitives";
import { DEFAULT_ICON_COLORS } from "../lib/constants";

export function ProjectOptionsSheet({
  project,
  onClose,
  onSave,
  onUnlink,
}: {
  project: Project;
  onClose: () => void;
  onSave: (name: string, iconColor: string) => Promise<void>;
  onUnlink: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [iconColor, setIconColor] = useState(project.iconColor);
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [activeTab, setActiveTab] = useState<"function" | "thesis">("function");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void window.programs.getAgentSession(project.id).then(setAgentSession);
  }, [project.id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(name, iconColor);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal title={project.name} onClose={onClose} fullscreen>
      <div className="projectOptionsContent">
        <div className="projectOptionsSection">
          <div className="agentInfoTabs">
            <button
              className={`agentInfoTabBtn${activeTab === "function" ? " active" : ""}`}
              onClick={() => setActiveTab("function")}
            >
              Function
            </button>
            <button
              className={`agentInfoTabBtn${activeTab === "thesis" ? " active" : ""}`}
              onClick={() => setActiveTab("thesis")}
            >
              Thesis
            </button>
          </div>
          <div className="agentInfoTabContent">
            {activeTab === "function" ? (
              <p className="coreDetailValue">
                {agentSession?.stages.function.confirmed?.summary ?? <em className="coreDetailEmpty">Not yet defined</em>}
              </p>
            ) : (
              <p className="coreDetailValue">
                {agentSession?.stages.thesis.confirmed?.summary ?? <em className="coreDetailEmpty">Not yet defined</em>}
              </p>
            )}
          </div>
        </div>

        <div className="projectOptionsSection">
          <label className="projectOptionsLabel">
            Name
            <input
              className="projectOptionsNameInput"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>

        <div className="projectOptionsSection">
          <span className="projectOptionsLabel">Color</span>
          <div className="colorSwatchGrid">
            {DEFAULT_ICON_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={iconColor === color ? "colorSwatch active" : "colorSwatch"}
                style={{ background: color }}
                aria-label={`Set project color ${color}`}
                onClick={() => setIconColor(color)}
              />
            ))}
          </div>
          <label className="colorField">
            Custom color
            <input
              type="color"
              value={iconColor}
              onChange={(e) => setIconColor(e.target.value)}
            />
          </label>
        </div>

        <div className="projectOptionsActions">
          <button className="primaryButton" onClick={() => void handleSave()} disabled={isSaving}>
            Save
          </button>
          <button className="projectOptionButton projectOptionButton-danger" onClick={onUnlink}>
            Unlink project
          </button>
        </div>
      </div>
    </Modal>
  );
}
