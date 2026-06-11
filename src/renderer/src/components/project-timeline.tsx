import { useMemo, useState } from "react";
import type { AuthSnapshot, DiffStats, Project, UpdateRecord } from "@shared/types";
import { ArrowDownIcon, GithubIcon } from "./icons";
import { formatDate } from "../lib/formatting";

const DEFAULT_VISIBLE = 10;

export function ProjectTimeline({
  project,
  updates,
  diffStats,
  previewingCommitSha,
  busyKey,
  githubAuth,
  onPreviewCommit,
  onRestoreFromPreview,
  onUndo,
  onSaveToGithub,
  onDownloadFromGithub,
}: {
  project: Project;
  updates: UpdateRecord[];
  diffStats: DiffStats | null | "loading";
  previewingCommitSha: string | null;
  busyKey: string | null;
  githubAuth: AuthSnapshot["github"];
  onPreviewCommit: (update: UpdateRecord) => void;
  onRestoreFromPreview: () => void;
  onUndo: (update: UpdateRecord) => void;
  onSaveToGithub: (projectId: string) => void;
  onDownloadFromGithub: (projectId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const hasDirtyNode = useMemo(() => {
    if (!diffStats || diffStats === "loading") return false;
    return diffStats.added > 0 || diffStats.removed > 0;
  }, [diffStats]);

  const dirtyLabel = useMemo(() => {
    if (!diffStats || diffStats === "loading") return "";
    return `+${diffStats.added} / -${diffStats.removed} lines`;
  }, [diffStats]);

  const displayedUpdates = showAll ? updates : updates.slice(-DEFAULT_VISIBLE);
  const hiddenCount = updates.length - DEFAULT_VISIBLE;

  const previewingUpdate = useMemo(
    () => (previewingCommitSha ? updates.find((u) => u.commitSha === previewingCommitSha) ?? null : null),
    [previewingCommitSha, updates],
  );
  const previewingVersionLabel = previewingUpdate
    ? `v${updates.indexOf(previewingUpdate) + 1}`
    : null;

  const isBusy = busyKey !== null;
  const hasGithubRemote = !!project.githubConnection?.repoUrl;
  const isGithubConnected = githubAuth.loggedIn;

  return (
    <div className="timelineRoot">
      {previewingCommitSha && (
        <div className="timelinePreviewBanner">
          <span className="timelinePreviewBannerText">
            Previewing {previewingVersionLabel}
            {previewingUpdate?.summary ? ` — ${previewingUpdate.summary}` : ""}
          </span>
          <button
            className="primaryButton smallButton"
            onClick={onRestoreFromPreview}
            disabled={isBusy}
          >
            Return to current state
          </button>
        </div>
      )}

      <div className="timelineNodes">
        {!showAll && hiddenCount > 0 && (
          <button
            className="textButton smallButton timelineShowAllToggle"
            onClick={() => setShowAll(true)}
          >
            Show all ({updates.length})
          </button>
        )}

        {displayedUpdates.map((update) => {
          const versionIndex = updates.indexOf(update);
          const versionLabel = `v${versionIndex + 1}`;
          const isPreviewing = update.commitSha === previewingCommitSha;
          const isExpanded = expandedId === update.id;
          const canPreview = !!update.commitSha && !isBusy && !previewingCommitSha;
          const isFirst = update === displayedUpdates[0];

          return (
            <div
              key={update.id}
              className={`timelineNode${isPreviewing ? " timelineNode--previewing" : ""}`}
            >
              <div className="timelineConnectorCol">
                {!isFirst && <div className="timelineConnectorLine" />}
                <div className="timelineDot" />
                <div className="timelineConnectorLine timelineConnectorLine--grow" />
              </div>
              <div
                className="timelineNodeBody"
                onClick={() => setExpandedId(isExpanded ? null : update.id)}
              >
                <div className="timelineNodeHeader">
                  <span className="historyVersionTag">{versionLabel}</span>
                  <span className="timelineNodeSummary">{update.summary || "Update"}</span>
                  {update.status === "reverted" && (
                    <span className="statusChip statusChip-info timelineRevertedChip">reverted</span>
                  )}
                  <span className="timelineExpandChevron">{isExpanded ? "▲" : "▼"}</span>
                </div>

                {isExpanded && (
                  <div className="timelineNodeExpanded">
                    {update.prompt && (
                      <div>
                        <span className="fieldLabel">Prompt</span>
                        <p className="helperText timelinePromptText">{update.prompt}</p>
                      </div>
                    )}
                    <div>
                      <span className="fieldLabel">Saved</span>
                      <p className="helperText">{formatDate(update.createdAt)}</p>
                    </div>
                    <div className="timelineNodeActions">
                      <button
                        className="secondaryButton smallButton"
                        onClick={(e) => { e.stopPropagation(); onPreviewCommit(update); }}
                        disabled={!canPreview}
                        title={!update.commitSha ? "No commit SHA available for this version" : undefined}
                      >
                        Preview this version
                      </button>
                      <button
                        className="textButton smallButton"
                        onClick={(e) => { e.stopPropagation(); onUndo(update); }}
                        disabled={isBusy || update.status === "reverted"}
                      >
                        Undo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {showAll && hiddenCount > 0 && (
          <button
            className="textButton smallButton timelineShowAllToggle"
            onClick={() => setShowAll(false)}
          >
            Show less
          </button>
        )}

        {hasDirtyNode && (
          <div className="timelineNode timelineNode--dirty">
            <div className="timelineConnectorCol">
              <div className="timelineConnectorLine" />
              <div className="timelineDot timelineDot--dirty" />
            </div>
            <div className="timelineNodeBody timelineNodeBody--dirty">
              <div className="timelineNodeHeader">
                <span className="timelineDirtyLabel">Unsaved changes</span>
                <span className="timelineDirtyStats">{dirtyLabel}</span>
              </div>
              <p className="helperText timelineDirtyHint">Save to GitHub to back up your current work.</p>
            </div>
          </div>
        )}
      </div>

      {hasGithubRemote && isGithubConnected && (
        <div className="timelineGithubRow">
          <button
            className="primaryButton"
            onClick={() => onSaveToGithub(project.id)}
            disabled={isBusy}
          >
            <GithubIcon />
            Save to GitHub
          </button>
          <button
            className="secondaryButton"
            onClick={() => onDownloadFromGithub(project.id)}
            disabled={isBusy}
          >
            <ArrowDownIcon />
            Download from GitHub
          </button>
        </div>
      )}
    </div>
  );
}
