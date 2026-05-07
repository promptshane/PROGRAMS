import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROJECT_ICON_COLORS, collectUsedProjectIconColors, normalizeProjectIconColor } from "@shared/project-colors";
import type { Project } from "@shared/types";
import { Modal } from "./ui-primitives";
import { createProjectColorSwatchStyle } from "../lib/project-helpers";

export function ProjectOptionsSheet({
  project,
  projects,
  onClose,
  onSave,
  onUnlink,
}: {
  project: Project;
  projects: Project[];
  onClose: () => void;
  onSave: (name: string, iconColor: string) => Promise<void>;
  onUnlink: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [iconColor, setIconColor] = useState(project.iconColor);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(project.name);
    setIconColor(project.iconColor);
    setIsSaving(false);
  }, [project.iconColor, project.id, project.name]);

  const trimmedName = name.trim();
  const normalizedIconColor = normalizeProjectIconColor(iconColor);
  const unavailableColors = useMemo(
    () => collectUsedProjectIconColors(projects, project.id),
    [project.id, projects],
  );
  const colorError =
    !normalizedIconColor
      ? "Choose a valid project color."
      : unavailableColors.has(normalizedIconColor)
      ? "That color is already assigned to another project."
      : null;

  const handleSave = async () => {
    if (!trimmedName || !normalizedIconColor || colorError) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(trimmedName, normalizedIconColor);
      onClose();
    } catch {
      // Errors are surfaced by the caller so the sheet can stay open for correction.
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal title={project.name} onClose={onClose} fullscreen>
      <div className="projectOptionsContent">
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
          <p className="projectOptionsHint">Each project color stays unique across the dashboard.</p>
          <div className="colorSwatchGrid">
            {DEFAULT_PROJECT_ICON_COLORS.map((color) => {
              const isActive = normalizedIconColor === color;
              const isUnavailable = unavailableColors.has(color) && !isActive;

              return (
                <button
                  key={color}
                  type="button"
                  className={`colorSwatch${isActive ? " active" : ""}${isUnavailable ? " disabled" : ""}`}
                  style={createProjectColorSwatchStyle(color)}
                  aria-label={isUnavailable ? `Project color ${color} already in use` : `Set project color ${color}`}
                  title={isUnavailable ? "Already in use" : color}
                  onClick={() => setIconColor(color)}
                  disabled={isUnavailable}
                />
              );
            })}
          </div>
          <label className="colorField">
            Custom color
            <input
              type="color"
              value={normalizedIconColor ?? DEFAULT_PROJECT_ICON_COLORS[0]}
              onChange={(e) => setIconColor(e.target.value)}
            />
          </label>
          {colorError ? <p className="projectOptionsHint projectOptionsHint-error">{colorError}</p> : null}
        </div>

        <div className="projectOptionsActions">
          <button
            className="primaryButton"
            onClick={() => void handleSave()}
            disabled={isSaving || !trimmedName || Boolean(colorError)}
          >
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
