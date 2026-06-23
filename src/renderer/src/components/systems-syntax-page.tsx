import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  CREATIVE_CATEGORIES,
  getCreativeCategory,
  isCreativeCategoryId,
  type CreativeCategoryId,
} from "@shared/creative-categories";
import {
  LEGACY_SYSTEMS_SYNTAX_STORAGE_KEY,
  SYSTEMS_SYNTAX_STORAGE_KEY,
  createSystemsSyntaxBlock,
  createSystemsSyntaxProject,
  deleteSystemsSyntaxBlock,
  deleteSystemsSyntaxProject,
  getSystemsSyntaxPath,
  migrateLegacySystemsSyntaxState,
  moveSystemsSyntaxBlock,
  moveSystemsSyntaxProjectToCategory,
  parseSystemsSyntaxState,
  updateSystemsSyntaxBlock,
  updateSystemsSyntaxProject,
  type SystemsSyntaxBlock,
  type SystemsSyntaxProject,
  type SystemsSyntaxState,
} from "../lib/systems-syntax-store";
import { Modal } from "./ui-primitives";

type DropTarget =
  | { type: "inside"; blockId: string }
  | { type: "order"; parentId: string | null; index: number }
  | null;

type ProjectRenameSurface = "sidebar" | "overview" | "header";
type BlockRenameSurface = "header";
type ProjectSortMode = "priority" | "name";

type ProjectDropTarget = {
  categoryId: CreativeCategoryId;
  index: number;
} | null;

type RenameTarget =
  | { type: "project"; id: string; surface: ProjectRenameSurface }
  | { type: "block"; id: string; surface: BlockRenameSurface }
  | null;

type ProjectDialogState =
  | { mode: "create"; categoryId: CreativeCategoryId }
  | { mode: "edit"; projectId: string }
  | null;

type DeleteRequest =
  | { type: "project"; id: string; name: string }
  | { type: "block"; id: string; name: string; childCount: number }
  | null;

const createId = (prefix: "project" | "block"): string =>
  typeof crypto.randomUUID === "function"
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const categoryStyle = (color: string): CSSProperties =>
  ({ "--systems-syntax-category": color }) as CSSProperties;

const getVerticalDropIndex = (
  event: DragEvent<HTMLElement>,
  rowIndex: number,
): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? rowIndex : rowIndex + 1;
};

const SYSTEMS_SYNTAX_SORT_MODE_STORAGE_KEY =
  "programs.systems-syntax.sort-mode.v1";
const SYSTEMS_SYNTAX_COLLAPSED_KEY =
  "programs.systems-syntax.collapsed-categories.v1";

const loadState = (): SystemsSyntaxState => {
  try {
    const current = localStorage.getItem(SYSTEMS_SYNTAX_STORAGE_KEY);
    if (current !== null) return parseSystemsSyntaxState(current);
    const migrated = migrateLegacySystemsSyntaxState(
      localStorage.getItem(LEGACY_SYSTEMS_SYNTAX_STORAGE_KEY),
    );
    if (migrated.projectOrder.length > 0) {
      localStorage.setItem(SYSTEMS_SYNTAX_STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return parseSystemsSyntaxState(null);
  }
};

const loadSortMode = (): ProjectSortMode => {
  try {
    const value = localStorage.getItem(SYSTEMS_SYNTAX_SORT_MODE_STORAGE_KEY);
    return value === "name" ? "name" : "priority";
  } catch {
    return "priority";
  }
};

const loadCollapsedCategories = (): Set<CreativeCategoryId> => {
  try {
    const value = localStorage.getItem(SYSTEMS_SYNTAX_COLLAPSED_KEY);
    if (!value) return new Set();
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isCreativeCategoryId));
  } catch {
    return new Set();
  }
};

const saveState = (state: SystemsSyntaxState): void => {
  try {
    localStorage.setItem(SYSTEMS_SYNTAX_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // System Syntax remains usable in-memory if renderer storage is unavailable.
  }
};

const saveSortMode = (sortMode: ProjectSortMode): void => {
  try {
    localStorage.setItem(SYSTEMS_SYNTAX_SORT_MODE_STORAGE_KEY, sortMode);
  } catch {}
};

const saveCollapsedCategories = (collapsed: Set<CreativeCategoryId>): void => {
  try {
    localStorage.setItem(SYSTEMS_SYNTAX_COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {}
};

const countProjectBlocks = (
  state: SystemsSyntaxState,
  projectId: string,
): number =>
  Object.values(state.blocks).filter((block) => block.projectId === projectId).length;

const countBlockDescendants = (
  state: SystemsSyntaxState,
  blockId: string,
): number => {
  const visited = new Set<string>();
  const pending = [...(state.blocks[blockId]?.children ?? [])];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    const block = state.blocks[id];
    if (!block) continue;
    visited.add(id);
    pending.push(...block.children);
  }
  return visited.size;
};

const isRenameTarget = (
  target: RenameTarget,
  type: "project" | "block",
  id: string,
  surface: ProjectRenameSurface | BlockRenameSurface,
): boolean => {
  if (!target) return false;
  return target.type === type && target.id === id && target.surface === surface;
};

function InlineNameEditor({
  value,
  ariaLabel,
  onSave,
  onCancel,
}: {
  value: string;
  ariaLabel: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const cancelingRef = useRef(false);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      return;
    }
    const nextName = draft.trim();
    if (!nextName || nextName === value) {
      onCancel();
      return;
    }
    onSave(nextName);
  };

  return (
    <input
      autoFocus
      className="systemsSyntaxInlineNameInput"
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelingRef.current = true;
          onCancel();
        }
      }}
    />
  );
}

function ProjectListItem({
  project,
  active,
  meta,
  variant,
  renaming,
  dragging,
  dropBefore,
  dropAfter,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onDragStart,
  onDragEnd,
  onPriorityDragOver,
  onPriorityDrop,
}: {
  project: SystemsSyntaxProject;
  active?: boolean;
  meta: string;
  variant: "sidebar" | "overview" | "sidebar priority" | "overview priority";
  renaming: boolean;
  dragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPriorityDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onPriorityDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const isPriority = variant.includes("priority");
  return (
    <div
      className={[
        "systemsSyntaxProjectRow",
        variant,
        active ? "active" : "",
        renaming ? "renaming" : "",
        dragging ? "dragging" : "",
        dropBefore ? "dropBefore" : "",
        dropAfter ? "dropAfter" : "",
      ].filter(Boolean).join(" ")}
      draggable={isPriority}
      onDragStart={(event) => {
        if (!isPriority) return;
        if (event.target instanceof HTMLButtonElement) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", project.id);
        event.dataTransfer.setData(
          "application/x-systems-syntax-project",
          project.id,
        );
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!onPriorityDragOver) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onPriorityDragOver(event);
      }}
      onDrop={(event) => {
        if (!onPriorityDrop) return;
        event.preventDefault();
        event.stopPropagation();
        onPriorityDrop(event);
      }}
    >
      {renaming ? (
        <InlineNameEditor
          value={project.name}
          ariaLabel={`Rename ${project.name}`}
          onSave={onRename}
          onCancel={onCancelRename}
        />
      ) : (
        <button
          type="button"
          className="systemsSyntaxProjectOpenButton"
          onClick={onOpen}
        >
          <span>{project.name}</span>
        </button>
      )}
      <span className="systemsSyntaxProjectMeta">{meta}</span>
      {!renaming ? (
        <button
          type="button"
          className="systemsSyntaxInlineEditButton"
          aria-label={`Rename ${project.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onStartRename();
          }}
        >
          ✎
        </button>
      ) : null}
    </div>
  );
}

function ProjectDropZone({
  active,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={
        active
          ? "systemsSyntaxProjectDropZone active"
          : "systemsSyntaxProjectDropZone"
      }
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
    />
  );
}

function BlockTreeItem({
  block,
  state,
  openedBlockId,
  depth,
  dropTarget,
  onOpen,
  onDragStart,
  onDropInside,
  onDropTargetChange,
}: {
  block: SystemsSyntaxBlock;
  state: SystemsSyntaxState;
  openedBlockId: string | null;
  depth: number;
  dropTarget: DropTarget;
  onOpen: (blockId: string) => void;
  onDragStart: (blockId: string) => void;
  onDropInside: (blockId: string) => void;
  onDropTargetChange: (target: DropTarget) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={[
          "systemsSyntaxTreeItem",
          openedBlockId === block.id ? "active" : "",
          dropTarget?.type === "inside" && dropTarget.blockId === block.id
            ? "dropTarget"
            : "",
        ].filter(Boolean).join(" ")}
        style={{ paddingLeft: 12 + depth * 16 }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", block.id);
          onDragStart(block.id);
        }}
        onDragEnd={() => onDropTargetChange(null)}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          onDropTargetChange({ type: "inside", blockId: block.id });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            onDropTargetChange(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDropInside(block.id);
        }}
        onClick={() => onOpen(block.id)}
      >
        <span>{block.name}</span>
        {block.children.length > 0 ? (
          <span className="systemsSyntaxTreeCount">{block.children.length}</span>
        ) : null}
      </button>
      {block.children.length > 0 ? (
        <ul className="systemsSyntaxTree">
          {block.children.flatMap((childId) => {
            const child = state.blocks[childId];
            return child ? (
              <BlockTreeItem
                key={child.id}
                block={child}
                state={state}
                openedBlockId={openedBlockId}
                depth={depth + 1}
                dropTarget={dropTarget}
                onOpen={onOpen}
                onDragStart={onDragStart}
                onDropInside={onDropInside}
                onDropTargetChange={onDropTargetChange}
              />
            ) : [];
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function SystemsSyntaxPage() {
  const [state, setState] = useState<SystemsSyntaxState>(loadState);
  const [projectSortMode, setProjectSortMode] =
    useState<ProjectSortMode>(loadSortMode);
  const [collapsedCategories, setCollapsedCategories] =
    useState<Set<CreativeCategoryId>>(loadCollapsedCategories);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [openedBlockId, setOpenedBlockId] = useState<string | null>(null);
  const [newBlockName, setNewBlockName] = useState("");
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [projectDropTarget, setProjectDropTarget] =
    useState<ProjectDropTarget>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest>(null);

  useEffect(() => saveState(state), [state]);
  useEffect(() => saveSortMode(projectSortMode), [projectSortMode]);
  useEffect(() => saveCollapsedCategories(collapsedCategories), [collapsedCategories]);

  useEffect(() => {
    if (selectedProjectId && !state.projects[selectedProjectId]) {
      setSelectedProjectId(null);
      setOpenedBlockId(null);
    }
    if (openedBlockId && !state.blocks[openedBlockId]) {
      setOpenedBlockId(null);
    }
  }, [openedBlockId, selectedProjectId, state.blocks, state.projects]);

  const selectedProject = selectedProjectId
    ? state.projects[selectedProjectId] ?? null
    : null;
  const openedBlock =
    openedBlockId && state.blocks[openedBlockId]?.projectId === selectedProjectId
      ? state.blocks[openedBlockId]
      : null;
  const currentChildren = selectedProject
    ? openedBlock?.children ?? selectedProject.rootBlockIds
    : [];
  const path = useMemo(
    () => getSystemsSyntaxPath(state, openedBlock?.id ?? null),
    [openedBlock?.id, state],
  );
  const projectsByCategory = useMemo(
    () => {
      const projectsByCategory = new Map(
        CREATIVE_CATEGORIES.map((category) => {
          const projects = state.projectOrder
            .map((projectId) => state.projects[projectId])
            .filter(
              (project): project is SystemsSyntaxProject =>
                Boolean(project) && project.categoryId === category.id,
            );
          if (projectSortMode === "name") {
            projects.sort((a, b) => {
              const nameOrder = a.name.localeCompare(b.name, undefined, {
                numeric: true,
                sensitivity: "base",
              });
              return nameOrder || a.id.localeCompare(b.id);
            });
          }
          return [category.id, projects] as const;
        }),
      );
      return projectsByCategory;
    },
    [projectSortMode, state.projectOrder, state.projects],
  );

  const toggleCategoryCollapse = (categoryId: CreativeCategoryId) => {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const selectProject = (projectId: string | null) => {
    setSelectedProjectId(projectId);
    setOpenedBlockId(null);
    setNewBlockName("");
    setDraggedBlockId(null);
    setDraggedProjectId(null);
    setDropTarget(null);
    setProjectDropTarget(null);
    setRenameTarget(null);
  };

  const startProjectDrag = (projectId: string) => {
    setDraggedProjectId(projectId);
    setDraggedBlockId(null);
    setDropTarget(null);
  };

  const endProjectDrag = () => {
    setDraggedProjectId(null);
    setProjectDropTarget(null);
  };

  const moveProjectToCategory = (
    projectId: string,
    categoryId: CreativeCategoryId,
    targetIndex?: number,
  ) => {
    setState((current) =>
      moveSystemsSyntaxProjectToCategory(
        current,
        projectId,
        categoryId,
        targetIndex,
      ),
    );
    setProjectDropTarget(null);
  };

  const moveDraggedProjectToCategory = (
    categoryId: CreativeCategoryId,
    targetIndex?: number,
  ) => {
    if (!draggedProjectId) return;
    moveProjectToCategory(draggedProjectId, categoryId, targetIndex);
    endProjectDrag();
  };

  const saveProjectName = (projectId: string, name: string) => {
    setState((current) =>
      updateSystemsSyntaxProject(current, projectId, { name }),
    );
    setRenameTarget(null);
  };

  const saveBlockName = (blockId: string, name: string) => {
    setState((current) => updateSystemsSyntaxBlock(current, blockId, name));
    setRenameTarget(null);
  };

  const createBlock = (event: FormEvent) => {
    event.preventDefault();
    const name = newBlockName.trim();
    if (!name || !selectedProject) return;
    setState((current) =>
      createSystemsSyntaxBlock(
        current,
        selectedProject.id,
        name,
        openedBlock?.id ?? null,
        createId("block"),
      ),
    );
    setNewBlockName("");
  };

  const moveDraggedBlock = (parentId: string | null, index: number) => {
    if (!draggedBlockId || !selectedProject) return;
    setState((current) =>
      moveSystemsSyntaxBlock(
        current,
        draggedBlockId,
        selectedProject.id,
        parentId,
        index,
      ),
    );
    setDraggedBlockId(null);
    setDropTarget(null);
  };

  const moveDraggedInside = (blockId: string) => {
    const childCount = state.blocks[blockId]?.children.length ?? 0;
    moveDraggedBlock(blockId, childCount);
  };

  const requestDeleteBlock = (block: SystemsSyntaxBlock) => {
    setDeleteRequest({
      type: "block",
      id: block.id,
      name: block.name,
      childCount: countBlockDescendants(state, block.id),
    });
  };

  const confirmDelete = () => {
    if (!deleteRequest) return;
    if (deleteRequest.type === "project") {
      setState((current) =>
        deleteSystemsSyntaxProject(current, deleteRequest.id),
      );
      selectProject(null);
    } else {
      const target = state.blocks[deleteRequest.id];
      setState((current) =>
        deleteSystemsSyntaxBlock(current, deleteRequest.id),
      );
      setOpenedBlockId(target?.parentId ?? null);
    }
    setDeleteRequest(null);
  };

  return (
    <section className="systemsSyntaxPage" data-testid="systems-syntax-page">
      <header className="systemsSyntaxHeader">
        <div>
          <h1>System Syntax</h1>
        </div>
        <button
          type="button"
          className="systemsSyntaxNewProjectButton"
          onClick={() => setProjectDialog({ mode: "create", categoryId: "tools" })}
        >
          New project
        </button>
      </header>

      <div className="systemsSyntaxLayout">
        <aside className="systemsSyntaxFinder" aria-label="System Syntax projects">
          <button
            type="button"
            className={`systemsSyntaxOverviewButton${selectedProject ? "" : " active"}`}
            onClick={() => selectProject(null)}
          >
            <span>All projects</span>
            <span>{state.projectOrder.length}</span>
          </button>
          <div className="systemsSyntaxSortControl" aria-label="Project sort">
            <button
              type="button"
              className={projectSortMode === "name" ? "active" : ""}
              onClick={() => setProjectSortMode("name")}
            >
              Name
            </button>
            <button
              type="button"
              className={projectSortMode === "priority" ? "active" : ""}
              onClick={() => setProjectSortMode("priority")}
            >
              Priority
            </button>
          </div>

          <div className="systemsSyntaxProjectGroups">
            {CREATIVE_CATEGORIES.map((category) => {
              const projects = projectsByCategory.get(category.id) ?? [];
              const isCollapsed = collapsedCategories.has(category.id);
              const isProjectDropTarget =
                draggedProjectId !== null
                && projectDropTarget?.categoryId === category.id;
              return (
                <section
                  key={category.id}
                  className={[
                    "systemsSyntaxProjectGroup",
                    isProjectDropTarget ? "projectDropTarget" : "",
                  ].filter(Boolean).join(" ")}
                  style={categoryStyle(category.color)}
                  onDragOver={(event) => {
                    if (!draggedProjectId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setProjectDropTarget({
                      categoryId: category.id,
                      index: projects.length,
                    });
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(event.relatedTarget as Node | null)
                    ) {
                      setProjectDropTarget(null);
                    }
                  }}
                  onDrop={(event) => {
                    if (!draggedProjectId) return;
                    event.preventDefault();
                    const targetIndex =
                      projectSortMode === "priority"
                      && projectDropTarget?.categoryId === category.id
                        ? projectDropTarget.index
                        : undefined;
                    moveDraggedProjectToCategory(category.id, targetIndex);
                  }}
                >
                  <button
                    type="button"
                    className={[
                      "systemsSyntaxProjectGroupTitle",
                      isCollapsed ? "collapsed" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => toggleCategoryCollapse(category.id)}
                  >
                    <span className="systemsSyntaxCategoryDot" aria-hidden="true" />
                    <span>{category.label}</span>
                    <span className="systemsSyntaxCategoryCount">{projects.length}</span>
                    <span className="systemsSyntaxCollapseChevron" aria-hidden="true">
                      {isCollapsed ? "›" : "∨"}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    projects.length > 0 ? (
                      <div className="systemsSyntaxProjectList">
                        {projectSortMode === "priority" && draggedProjectId ? (
                          <ProjectDropZone
                            active={
                              projectDropTarget?.categoryId === category.id
                              && projectDropTarget.index === 0
                            }
                            onDragOver={() =>
                              setProjectDropTarget({
                                categoryId: category.id,
                                index: 0,
                              })
                            }
                            onDrop={() => moveDraggedProjectToCategory(category.id, 0)}
                          />
                        ) : null}
                        {projects.flatMap((project, index) => {
                          const row = (
                            <ProjectListItem
                              key={project.id}
                              project={project}
                              active={selectedProjectId === project.id}
                              meta={String(countProjectBlocks(state, project.id))}
                              variant={
                                projectSortMode === "priority"
                                  ? "sidebar priority"
                                  : "sidebar"
                              }
                              renaming={isRenameTarget(
                                renameTarget,
                                "project",
                                project.id,
                                "sidebar",
                              )}
                              dragging={draggedProjectId === project.id}
                              dropBefore={
                                projectDropTarget?.categoryId === category.id
                                && projectDropTarget.index === index
                              }
                              dropAfter={
                                projectDropTarget?.categoryId === category.id
                                && projectDropTarget.index === index + 1
                              }
                              onOpen={() => selectProject(project.id)}
                              onStartRename={() =>
                                setRenameTarget({
                                  type: "project",
                                  id: project.id,
                                  surface: "sidebar",
                                })
                              }
                              onRename={(name) => saveProjectName(project.id, name)}
                              onCancelRename={() => setRenameTarget(null)}
                              onDragStart={() => startProjectDrag(project.id)}
                              onDragEnd={endProjectDrag}
                              onPriorityDragOver={
                                projectSortMode === "priority" && draggedProjectId
                                  ? (event) =>
                                      setProjectDropTarget({
                                        categoryId: category.id,
                                        index: getVerticalDropIndex(event, index),
                                      })
                                  : undefined
                              }
                              onPriorityDrop={
                                projectSortMode === "priority" && draggedProjectId
                                  ? (event) =>
                                      moveDraggedProjectToCategory(
                                        category.id,
                                        getVerticalDropIndex(event, index),
                                      )
                                  : undefined
                              }
                            />
                          );
                          if (projectSortMode !== "priority" || !draggedProjectId) {
                            return [row];
                          }
                          return [
                            row,
                            <ProjectDropZone
                              key={`${project.id}:after`}
                              active={
                                projectDropTarget?.categoryId === category.id
                                && projectDropTarget.index === index + 1
                              }
                              onDragOver={() =>
                                setProjectDropTarget({
                                  categoryId: category.id,
                                  index: index + 1,
                                })
                              }
                              onDrop={() =>
                                moveDraggedProjectToCategory(category.id, index + 1)
                              }
                            />,
                          ];
                        })}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="systemsSyntaxEmptyCategoryButton"
                        onClick={() =>
                          setProjectDialog({ mode: "create", categoryId: category.id })
                        }
                      >
                        Add {category.singularLabel.toLowerCase()} project
                      </button>
                    )
                  ) : null}
                </section>
              );
            })}
          </div>

          {selectedProject ? (
            <section className="systemsSyntaxBlockTreeSection">
              <div className="systemsSyntaxPanelTitle">Blocks</div>
              <button
                type="button"
                className={[
                  "systemsSyntaxTreeItem",
                  openedBlock ? "" : "active",
                  dropTarget?.type === "order" && dropTarget.parentId === null
                    ? "dropTarget"
                    : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setOpenedBlockId(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget({
                    type: "order",
                    parentId: null,
                    index: selectedProject.rootBlockIds.length,
                  });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  moveDraggedBlock(null, selectedProject.rootBlockIds.length);
                }}
              >
                <span>{selectedProject.name}</span>
                <span className="systemsSyntaxTreeCount">
                  {selectedProject.rootBlockIds.length}
                </span>
              </button>
              <ul className="systemsSyntaxTree systemsSyntaxTreeRoot">
                {selectedProject.rootBlockIds.flatMap((blockId) => {
                  const block = state.blocks[blockId];
                  return block ? (
                    <BlockTreeItem
                      key={block.id}
                      block={block}
                      state={state}
                      openedBlockId={openedBlockId}
                      depth={0}
                      dropTarget={dropTarget}
                      onOpen={setOpenedBlockId}
                      onDragStart={setDraggedBlockId}
                      onDropInside={moveDraggedInside}
                      onDropTargetChange={setDropTarget}
                    />
                  ) : [];
                })}
              </ul>
            </section>
          ) : null}
        </aside>

        <main className="systemsSyntaxEditor">
          {selectedProject ? (
            <ProjectWorkspace
              state={state}
              project={selectedProject}
              openedBlock={openedBlock}
              path={path}
              currentChildren={currentChildren}
              newBlockName={newBlockName}
              draggedBlockId={draggedBlockId}
              dropTarget={dropTarget}
              renameTarget={renameTarget}
              onOpenProject={() => setOpenedBlockId(null)}
              onOpenBlock={(blockId) => {
                setOpenedBlockId(blockId);
                setRenameTarget(null);
              }}
              onEditProject={() =>
                setProjectDialog({ mode: "edit", projectId: selectedProject.id })
              }
              onStartRenameProject={(projectId, surface) =>
                setRenameTarget({ type: "project", id: projectId, surface })
              }
              onStartRenameBlock={(blockId, surface) =>
                setRenameTarget({ type: "block", id: blockId, surface })
              }
              onRenameProject={saveProjectName}
              onRenameBlock={saveBlockName}
              onCancelRename={() => setRenameTarget(null)}
              onNewBlockNameChange={setNewBlockName}
              onCreateBlock={createBlock}
              onDragStart={setDraggedBlockId}
              onDragEnd={() => {
                setDraggedBlockId(null);
                setDropTarget(null);
              }}
              onDropTargetChange={setDropTarget}
              onDropOrder={moveDraggedBlock}
              onDeleteBlock={requestDeleteBlock}
              onShowProjects={() => selectProject(null)}
            />
          ) : (
            <ProjectsOverview
              state={state}
              projectsByCategory={projectsByCategory}
              projectSortMode={projectSortMode}
              draggedProjectId={draggedProjectId}
              projectDropTarget={projectDropTarget}
              renameTarget={renameTarget}
              onOpenProject={(projectId) => selectProject(projectId)}
              onCreateProject={(categoryId) =>
                setProjectDialog({ mode: "create", categoryId })
              }
              onProjectDragStart={startProjectDrag}
              onProjectDragEnd={endProjectDrag}
              onProjectDropTargetChange={setProjectDropTarget}
              onDropProjectToCategory={moveDraggedProjectToCategory}
              onStartRenameProject={(projectId) =>
                setRenameTarget({
                  type: "project",
                  id: projectId,
                  surface: "overview",
                })
              }
              onRenameProject={saveProjectName}
              onCancelRename={() => setRenameTarget(null)}
            />
          )}
        </main>
      </div>

      {projectDialog ? (
        <ProjectDialog
          dialog={projectDialog}
          project={
            projectDialog.mode === "edit"
              ? state.projects[projectDialog.projectId] ?? null
              : null
          }
          onClose={() => setProjectDialog(null)}
          onSave={(name, categoryId) => {
            if (projectDialog.mode === "create") {
              const projectId = createId("project");
              setState((current) =>
                createSystemsSyntaxProject(current, name, categoryId, projectId),
              );
              selectProject(projectId);
            } else {
              setState((current) =>
                updateSystemsSyntaxProject(
                  current,
                  projectDialog.projectId,
                  { name, categoryId },
                ),
              );
            }
            setProjectDialog(null);
          }}
          onRequestDelete={(project) => {
            setProjectDialog(null);
            setDeleteRequest({
              type: "project",
              id: project.id,
              name: project.name,
            });
          }}
        />
      ) : null}

      {deleteRequest ? (
        <Modal
          title={deleteRequest.type === "project" ? "Delete project" : "Delete block"}
          onClose={() => setDeleteRequest(null)}
          compact
        >
          <div className="systemsSyntaxConfirmDelete">
            <div className="dangerCard">
              <strong>
                Delete "{deleteRequest.name}"?
              </strong>
              <p>
                {deleteRequest.type === "project"
                  ? "This removes the project and every block inside it from System Syntax."
                  : deleteRequest.childCount > 0
                    ? `This also removes ${deleteRequest.childCount} nested block${
                        deleteRequest.childCount === 1 ? "" : "s"
                      }.`
                    : "This removes the block from its project."}
              </p>
            </div>
            <div className="modalActions">
              <button
                type="button"
                className="secondaryButton"
                onClick={() => setDeleteRequest(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="secondaryButton dangerButton"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function ProjectsOverview({
  state,
  projectsByCategory,
  projectSortMode,
  draggedProjectId,
  projectDropTarget,
  renameTarget,
  onOpenProject,
  onCreateProject,
  onProjectDragStart,
  onProjectDragEnd,
  onProjectDropTargetChange,
  onDropProjectToCategory,
  onStartRenameProject,
  onRenameProject,
  onCancelRename,
}: {
  state: SystemsSyntaxState;
  projectsByCategory: Map<CreativeCategoryId, SystemsSyntaxProject[]>;
  projectSortMode: ProjectSortMode;
  draggedProjectId: string | null;
  projectDropTarget: ProjectDropTarget;
  renameTarget: RenameTarget;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (categoryId: CreativeCategoryId) => void;
  onProjectDragStart: (projectId: string) => void;
  onProjectDragEnd: () => void;
  onProjectDropTargetChange: (target: ProjectDropTarget) => void;
  onDropProjectToCategory: (
    categoryId: CreativeCategoryId,
    targetIndex?: number,
  ) => void;
  onStartRenameProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onCancelRename: () => void;
}) {
  return (
    <div className="systemsSyntaxCategoryGrid">
      {CREATIVE_CATEGORIES.map((category) => {
        const projects = projectsByCategory.get(category.id) ?? [];
        const isProjectDropTarget =
          draggedProjectId !== null
          && projectDropTarget?.categoryId === category.id;
        return (
          <section
            key={category.id}
            className={[
              "systemsSyntaxCategoryCard",
              isProjectDropTarget ? "projectDropTarget" : "",
            ].filter(Boolean).join(" ")}
            style={categoryStyle(category.color)}
            onDragOver={(event) => {
              if (!draggedProjectId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onProjectDropTargetChange({
                categoryId: category.id,
                index: projects.length,
              });
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                onProjectDropTargetChange(null);
              }
            }}
            onDrop={(event) => {
              if (!draggedProjectId) return;
              event.preventDefault();
              const targetIndex =
                projectSortMode === "priority"
                && projectDropTarget?.categoryId === category.id
                  ? projectDropTarget.index
                  : undefined;
              onDropProjectToCategory(category.id, targetIndex);
            }}
          >
            <div className="systemsSyntaxCategoryCardHeader">
              <div>
                <span className="systemsSyntaxCategoryDot" aria-hidden="true" />
                <h3>{category.label}</h3>
              </div>
              <span>{projects.length}</span>
            </div>
            {projects.length > 0 ? (
              <div className="systemsSyntaxOverviewProjects">
                {projectSortMode === "priority" && draggedProjectId ? (
                  <ProjectDropZone
                    active={
                      projectDropTarget?.categoryId === category.id
                      && projectDropTarget.index === 0
                    }
                    onDragOver={() =>
                      onProjectDropTargetChange({
                        categoryId: category.id,
                        index: 0,
                      })
                    }
                    onDrop={() => onDropProjectToCategory(category.id, 0)}
                  />
                ) : null}
                {projects.flatMap((project, index) => {
                  const row = (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      meta={`${countProjectBlocks(state, project.id)}`}
                      variant={
                        projectSortMode === "priority"
                          ? "overview priority"
                          : "overview"
                      }
                      renaming={isRenameTarget(
                        renameTarget,
                        "project",
                        project.id,
                        "overview",
                      )}
                      dragging={draggedProjectId === project.id}
                      dropBefore={
                        projectDropTarget?.categoryId === category.id
                        && projectDropTarget.index === index
                      }
                      dropAfter={
                        projectDropTarget?.categoryId === category.id
                        && projectDropTarget.index === index + 1
                      }
                      onOpen={() => onOpenProject(project.id)}
                      onStartRename={() => onStartRenameProject(project.id)}
                      onRename={(name) => onRenameProject(project.id, name)}
                      onCancelRename={onCancelRename}
                      onDragStart={() => onProjectDragStart(project.id)}
                      onDragEnd={onProjectDragEnd}
                      onPriorityDragOver={
                        projectSortMode === "priority" && draggedProjectId
                          ? (event) =>
                              onProjectDropTargetChange({
                                categoryId: category.id,
                                index: getVerticalDropIndex(event, index),
                              })
                          : undefined
                      }
                      onPriorityDrop={
                        projectSortMode === "priority" && draggedProjectId
                          ? (event) =>
                              onDropProjectToCategory(
                                category.id,
                                getVerticalDropIndex(event, index),
                              )
                          : undefined
                      }
                    />
                  );
                  if (projectSortMode !== "priority" || !draggedProjectId) {
                    return [row];
                  }
                  return [
                    row,
                    <ProjectDropZone
                      key={`${project.id}:after`}
                      active={
                        projectDropTarget?.categoryId === category.id
                        && projectDropTarget.index === index + 1
                      }
                      onDragOver={() =>
                        onProjectDropTargetChange({
                          categoryId: category.id,
                          index: index + 1,
                        })
                      }
                      onDrop={() =>
                        onDropProjectToCategory(category.id, index + 1)
                      }
                    />,
                  ];
                })}
              </div>
            ) : (
              <div className="systemsSyntaxCategoryEmpty">No projects</div>
            )}
            <button
              type="button"
              className="systemsSyntaxCategoryAdd"
              onClick={() => onCreateProject(category.id)}
            >
              Add project
            </button>
          </section>
        );
      })}
    </div>
  );
}

function ProjectWorkspace({
  state,
  project,
  openedBlock,
  path,
  currentChildren,
  newBlockName,
  draggedBlockId,
  dropTarget,
  renameTarget,
  onOpenProject,
  onOpenBlock,
  onEditProject,
  onStartRenameProject,
  onStartRenameBlock,
  onRenameProject,
  onRenameBlock,
  onCancelRename,
  onNewBlockNameChange,
  onCreateBlock,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  onDropOrder,
  onDeleteBlock,
  onShowProjects,
}: {
  state: SystemsSyntaxState;
  project: SystemsSyntaxProject;
  openedBlock: SystemsSyntaxBlock | null;
  path: SystemsSyntaxBlock[];
  currentChildren: string[];
  newBlockName: string;
  draggedBlockId: string | null;
  dropTarget: DropTarget;
  renameTarget: RenameTarget;
  onOpenProject: () => void;
  onOpenBlock: (blockId: string) => void;
  onEditProject: () => void;
  onStartRenameProject: (
    projectId: string,
    surface: ProjectRenameSurface,
  ) => void;
  onStartRenameBlock: (blockId: string, surface: BlockRenameSurface) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onRenameBlock: (blockId: string, name: string) => void;
  onCancelRename: () => void;
  onNewBlockNameChange: (name: string) => void;
  onCreateBlock: (event: FormEvent) => void;
  onDragStart: (blockId: string) => void;
  onDragEnd: () => void;
  onDropTargetChange: (target: DropTarget) => void;
  onDropOrder: (parentId: string | null, index: number) => void;
  onDeleteBlock: (block: SystemsSyntaxBlock) => void;
  onShowProjects: () => void;
}) {
  const category = getCreativeCategory(project.categoryId);
  const currentName = openedBlock?.name ?? project.name;
  const isCurrentRenaming = openedBlock
    ? isRenameTarget(renameTarget, "block", openedBlock.id, "header")
    : isRenameTarget(renameTarget, "project", project.id, "header");
  const blockCount = countProjectBlocks(state, project.id);
  return (
    <>
      <nav className="systemsSyntaxBreadcrumbs" aria-label="System Syntax path">
        <button type="button" onClick={onShowProjects}>Projects</button>
        <span>
          <span aria-hidden="true">/</span>
          <button
            type="button"
            onClick={() => {
              onOpenProject();
              onCancelRename();
            }}
          >
            {project.name}
          </button>
        </span>
        {path.map((block) => (
          <span key={block.id}>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              className={block.id === openedBlock?.id ? "current" : ""}
              onClick={() => onOpenBlock(block.id)}
            >
              {block.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="systemsSyntaxCurrentHeader">
        <div className="systemsSyntaxCurrentIdentity">
          <div
            className="systemsSyntaxEyebrow systemsSyntaxCategoryEyebrow"
            style={categoryStyle(category.color)}
          >
            <span className="systemsSyntaxCategoryDot" aria-hidden="true" />
            {openedBlock ? project.name : category.singularLabel}
          </div>
          <div className="systemsSyntaxEditableHeading">
            {isCurrentRenaming ? (
              <InlineNameEditor
                value={currentName}
                ariaLabel={`Rename ${currentName}`}
                onSave={(name) =>
                  openedBlock
                    ? onRenameBlock(openedBlock.id, name)
                    : onRenameProject(project.id, name)
                }
                onCancel={onCancelRename}
              />
            ) : (
              <h2>{currentName}</h2>
            )}
            {!isCurrentRenaming ? (
              <button
                type="button"
                className="systemsSyntaxInlineEditButton systemsSyntaxHeadingEditButton"
                aria-label={`Rename ${currentName}`}
                onClick={() =>
                  openedBlock
                    ? onStartRenameBlock(openedBlock.id, "header")
                    : onStartRenameProject(project.id, "header")
                }
              >
                ✎
              </button>
            ) : null}
          </div>
          {!openedBlock ? (
            <span className="systemsSyntaxProjectStats">
              {blockCount} block{blockCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="systemsSyntaxHeaderActions">
          <button
            type="button"
            className="systemsSyntaxEditButton"
            onClick={onEditProject}
          >
            Options
          </button>
          <form className="systemsSyntaxCreateForm" onSubmit={onCreateBlock}>
            <input
              value={newBlockName}
              onChange={(event) => onNewBlockNameChange(event.target.value)}
              placeholder={`New block inside ${currentName}`}
              aria-label={`New block inside ${currentName}`}
            />
            <button type="submit" disabled={!newBlockName.trim()}>
              Add
            </button>
          </form>
        </div>
      </div>

      <div className="systemsSyntaxChildren" aria-label={`Blocks inside ${currentName}`}>
        <DropZone
          active={
            dropTarget?.type === "order"
            && dropTarget.parentId === (openedBlock?.id ?? null)
            && dropTarget.index === 0
          }
          onDragOver={() =>
            onDropTargetChange({
              type: "order",
              parentId: openedBlock?.id ?? null,
              index: 0,
            })
          }
          onDrop={() => onDropOrder(openedBlock?.id ?? null, 0)}
        />
        {currentChildren.flatMap((blockId, index) => {
          const block = state.blocks[blockId];
          if (!block) return [];
          const parentId = openedBlock?.id ?? null;
          const orderDropIndex =
            dropTarget?.type === "order" && dropTarget.parentId === parentId
              ? dropTarget.index
              : null;
          const childCount = block.children.length;
          return [
            <article
              key={block.id}
              className={[
                "systemsSyntaxBlockCard",
                draggedBlockId === block.id ? "dragging" : "",
                orderDropIndex === index ? "dropBefore" : "",
                orderDropIndex === index + 1 ? "dropAfter" : "",
              ].filter(Boolean).join(" ")}
              draggable
              onDragStart={(event) => {
                if (event.target instanceof HTMLButtonElement) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", block.id);
                onDragStart(block.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                onDropTargetChange({
                  type: "order",
                  parentId,
                  index: getVerticalDropIndex(event, index),
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDropOrder(parentId, getVerticalDropIndex(event, index));
              }}
            >
              <button
                type="button"
                className="systemsSyntaxBlockOpenButton"
                onClick={() => onOpenBlock(block.id)}
              >
                <span className="systemsSyntaxBlockName">{block.name}</span>
                {childCount > 0 ? (
                  <span className="systemsSyntaxBlockMeta">
                    {childCount} block{childCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className="systemsSyntaxBlockDeleteButton"
                aria-label={`Delete ${block.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteBlock(block);
                }}
              >
                ×
              </button>
            </article>,
            <DropZone
              key={`${block.id}:after`}
              active={
                dropTarget?.type === "order"
                && dropTarget.parentId === (openedBlock?.id ?? null)
                && dropTarget.index === index + 1
              }
              onDragOver={() =>
                onDropTargetChange({
                  type: "order",
                  parentId: openedBlock?.id ?? null,
                  index: index + 1,
                })
              }
              onDrop={() => onDropOrder(openedBlock?.id ?? null, index + 1)}
            />,
          ];
        })}
        {currentChildren.length === 0 ? (
          <div className="systemsSyntaxEmpty">
            <strong>No blocks yet.</strong>
            <span>Add a block or drag one here.</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ProjectDialog({
  dialog,
  project,
  onClose,
  onSave,
  onRequestDelete,
}: {
  dialog: Exclude<ProjectDialogState, null>;
  project: SystemsSyntaxProject | null;
  onClose: () => void;
  onSave: (name: string, categoryId: CreativeCategoryId) => void;
  onRequestDelete: (project: SystemsSyntaxProject) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [categoryId, setCategoryId] = useState<CreativeCategoryId>(
    project?.categoryId
    ?? (dialog.mode === "create" ? dialog.categoryId : "tools"),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), categoryId);
  };

  return (
    <Modal
      title={dialog.mode === "create" ? "New project" : "Project options"}
      onClose={onClose}
      compact
    >
      <form className="systemsSyntaxDialogForm" onSubmit={submit}>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
          />
        </label>
        <fieldset>
          <legend>Category</legend>
          <div className="systemsSyntaxCategoryPicker">
            {CREATIVE_CATEGORIES.map((category) => (
              <label
                key={category.id}
                className={categoryId === category.id ? "active" : ""}
                style={categoryStyle(category.color)}
              >
                <input
                  type="radio"
                  name="systems-syntax-category"
                  value={category.id}
                  checked={categoryId === category.id}
                  onChange={() => setCategoryId(category.id)}
                />
                <span className="systemsSyntaxCategoryDot" aria-hidden="true" />
                <span>{category.singularLabel}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="systemsSyntaxDialogActions">
          {project ? (
            <button
              type="button"
              className="systemsSyntaxDeleteTextButton"
              onClick={() => onRequestDelete(project)}
            >
              Delete project
            </button>
          ) : <span />}
          <div>
            <button type="button" className="secondaryButton" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={!name.trim()}>
              {project ? "Save changes" : "Create project"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function DropZone({
  active,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={active ? "systemsSyntaxDropZone active" : "systemsSyntaxDropZone"}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
    />
  );
}
