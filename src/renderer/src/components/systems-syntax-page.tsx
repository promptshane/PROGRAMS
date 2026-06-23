import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  CREATIVE_CATEGORIES,
  getCreativeCategory,
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

const saveState = (state: SystemsSyntaxState): void => {
  try {
    localStorage.setItem(SYSTEMS_SYNTAX_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // System Syntax remains usable in-memory if renderer storage is unavailable.
  }
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [openedBlockId, setOpenedBlockId] = useState<string | null>(null);
  const [newBlockName, setNewBlockName] = useState("");
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest>(null);

  useEffect(() => saveState(state), [state]);

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
    () =>
      new Map(
        CREATIVE_CATEGORIES.map((category) => [
          category.id,
          state.projectOrder
            .map((projectId) => state.projects[projectId])
            .filter(
              (project): project is SystemsSyntaxProject =>
                Boolean(project) && project.categoryId === category.id,
            ),
        ]),
      ),
    [state.projectOrder, state.projects],
  );

  const selectProject = (projectId: string | null) => {
    setSelectedProjectId(projectId);
    setOpenedBlockId(null);
    setNewBlockName("");
    setDraggedBlockId(null);
    setDropTarget(null);
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
          <div className="sectionTag">Workspace</div>
          <h1>System Syntax</h1>
          <p>Organize each project as a hierarchy of connected working blocks.</p>
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

          <div className="systemsSyntaxProjectGroups">
            {CREATIVE_CATEGORIES.map((category) => {
              const projects = projectsByCategory.get(category.id) ?? [];
              return (
                <section
                  key={category.id}
                  className="systemsSyntaxProjectGroup"
                  style={categoryStyle(category.color)}
                >
                  <div className="systemsSyntaxProjectGroupTitle">
                    <span className="systemsSyntaxCategoryDot" aria-hidden="true" />
                    <span>{category.label}</span>
                    <span>{projects.length}</span>
                  </div>
                  {projects.length > 0 ? (
                    <div className="systemsSyntaxProjectList">
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={`systemsSyntaxProjectButton${
                            selectedProjectId === project.id ? " active" : ""
                          }`}
                          onClick={() => selectProject(project.id)}
                        >
                          <span>{project.name}</span>
                          <span>{countProjectBlocks(state, project.id)}</span>
                        </button>
                      ))}
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
                  )}
                </section>
              );
            })}
          </div>

          {selectedProject ? (
            <section className="systemsSyntaxBlockTreeSection">
              <div className="systemsSyntaxPanelTitle">Project blocks</div>
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
              dropTarget={dropTarget}
              onOpenProject={() => setOpenedBlockId(null)}
              onOpenBlock={setOpenedBlockId}
              onEditProject={() =>
                setProjectDialog({ mode: "edit", projectId: selectedProject.id })
              }
              onEditBlock={() => openedBlock && setEditingBlockId(openedBlock.id)}
              onNewBlockNameChange={setNewBlockName}
              onCreateBlock={createBlock}
              onDragStart={setDraggedBlockId}
              onDragEnd={() => {
                setDraggedBlockId(null);
                setDropTarget(null);
              }}
              onDropTargetChange={setDropTarget}
              onDropInside={moveDraggedInside}
              onDropOrder={moveDraggedBlock}
              onShowProjects={() => selectProject(null)}
            />
          ) : (
            <ProjectsOverview
              state={state}
              projectsByCategory={projectsByCategory}
              onOpenProject={(projectId) => selectProject(projectId)}
              onCreateProject={(categoryId) =>
                setProjectDialog({ mode: "create", categoryId })
              }
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

      {editingBlockId && state.blocks[editingBlockId] ? (
        <BlockDialog
          block={state.blocks[editingBlockId]}
          onClose={() => setEditingBlockId(null)}
          onSave={(name) => {
            setState((current) =>
              updateSystemsSyntaxBlock(current, editingBlockId, name),
            );
            setEditingBlockId(null);
          }}
          onRequestDelete={(block) => {
            setEditingBlockId(null);
            setDeleteRequest({
              type: "block",
              id: block.id,
              name: block.name,
              childCount: countBlockDescendants(state, block.id),
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
                Delete “{deleteRequest.name}”?
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
  onOpenProject,
  onCreateProject,
}: {
  state: SystemsSyntaxState;
  projectsByCategory: Map<CreativeCategoryId, SystemsSyntaxProject[]>;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (categoryId: CreativeCategoryId) => void;
}) {
  return (
    <>
      <nav className="systemsSyntaxBreadcrumbs" aria-label="System Syntax path">
        <button type="button" className="current">Projects</button>
      </nav>
      <div className="systemsSyntaxOverviewHeader">
        <div>
          <div className="systemsSyntaxEyebrow">All projects</div>
          <h2>Your systems, grouped by medium</h2>
          <p>
            Each project owns its own block hierarchy and maps cleanly to one
            constellation category.
          </p>
        </div>
      </div>
      <div className="systemsSyntaxCategoryGrid">
        {CREATIVE_CATEGORIES.map((category) => {
          const projects = projectsByCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              className="systemsSyntaxCategoryCard"
              style={categoryStyle(category.color)}
            >
              <div className="systemsSyntaxCategoryCardHeader">
                <div>
                  <span className="systemsSyntaxCategoryDot" aria-hidden="true" />
                  <h3>{category.label}</h3>
                </div>
                <span>
                  {projects.length} project{projects.length === 1 ? "" : "s"}
                </span>
              </div>
              {projects.length > 0 ? (
                <div className="systemsSyntaxOverviewProjects">
                  {projects.map((project) => {
                    const blockCount = countProjectBlocks(state, project.id);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                      >
                        <span>{project.name}</span>
                        <span>
                          {blockCount} block{blockCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="systemsSyntaxCategoryEmpty">
                  No {category.singularLabel.toLowerCase()} projects yet.
                </div>
              )}
              <button
                type="button"
                className="systemsSyntaxCategoryAdd"
                onClick={() => onCreateProject(category.id)}
              >
                Add {category.singularLabel.toLowerCase()} project
              </button>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ProjectWorkspace({
  state,
  project,
  openedBlock,
  path,
  currentChildren,
  newBlockName,
  dropTarget,
  onOpenProject,
  onOpenBlock,
  onEditProject,
  onEditBlock,
  onNewBlockNameChange,
  onCreateBlock,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  onDropInside,
  onDropOrder,
  onShowProjects,
}: {
  state: SystemsSyntaxState;
  project: SystemsSyntaxProject;
  openedBlock: SystemsSyntaxBlock | null;
  path: SystemsSyntaxBlock[];
  currentChildren: string[];
  newBlockName: string;
  dropTarget: DropTarget;
  onOpenProject: () => void;
  onOpenBlock: (blockId: string) => void;
  onEditProject: () => void;
  onEditBlock: () => void;
  onNewBlockNameChange: (name: string) => void;
  onCreateBlock: (event: FormEvent) => void;
  onDragStart: (blockId: string) => void;
  onDragEnd: () => void;
  onDropTargetChange: (target: DropTarget) => void;
  onDropInside: (blockId: string) => void;
  onDropOrder: (parentId: string | null, index: number) => void;
  onShowProjects: () => void;
}) {
  const category = getCreativeCategory(project.categoryId);
  const currentName = openedBlock?.name ?? project.name;
  return (
    <>
      <nav className="systemsSyntaxBreadcrumbs" aria-label="System Syntax path">
        <button type="button" onClick={onShowProjects}>Projects</button>
        <span>
          <span aria-hidden="true">/</span>
          <button type="button" onClick={onOpenProject}>{project.name}</button>
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
            {openedBlock ? `Block in ${project.name}` : `${category.singularLabel} project`}
          </div>
          <h2>{currentName}</h2>
          {!openedBlock ? (
            <span className="systemsSyntaxProjectStats">
              {countProjectBlocks(state, project.id)} total block
              {countProjectBlocks(state, project.id) === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="systemsSyntaxHeaderActions">
          <button
            type="button"
            className="systemsSyntaxEditButton"
            onClick={openedBlock ? onEditBlock : onEditProject}
          >
            Edit {openedBlock ? "block" : "project"}
          </button>
          <form className="systemsSyntaxCreateForm" onSubmit={onCreateBlock}>
            <input
              value={newBlockName}
              onChange={(event) => onNewBlockNameChange(event.target.value)}
              placeholder={`New block inside ${currentName}`}
              aria-label={`New block inside ${currentName}`}
            />
            <button type="submit" disabled={!newBlockName.trim()}>
              Add block
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
          return [
            <article
              key={block.id}
              className={[
                "systemsSyntaxBlockCard",
                dropTarget?.type === "inside" && dropTarget.blockId === block.id
                  ? "dropTarget"
                  : "",
              ].filter(Boolean).join(" ")}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", block.id);
                onDragStart(block.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                onDropTargetChange({ type: "inside", blockId: block.id });
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDropInside(block.id);
              }}
            >
              <button type="button" onClick={() => onOpenBlock(block.id)}>
                <span className="systemsSyntaxBlockName">{block.name}</span>
                <span className="systemsSyntaxBlockMeta">
                  {block.children.length === 0
                    ? "Empty"
                    : `${block.children.length} block${
                        block.children.length === 1 ? "" : "s"
                      }`}
                </span>
              </button>
              <span className="systemsSyntaxDragHandle" aria-hidden="true">⋮⋮</span>
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
            <strong>Nothing inside {currentName} yet.</strong>
            <span>Create a block above, or drag another block into this level.</span>
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
      title={dialog.mode === "create" ? "New System Syntax project" : "Edit project"}
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

function BlockDialog({
  block,
  onClose,
  onSave,
  onRequestDelete,
}: {
  block: SystemsSyntaxBlock;
  onClose: () => void;
  onSave: (name: string) => void;
  onRequestDelete: (block: SystemsSyntaxBlock) => void;
}) {
  const [name, setName] = useState(block.name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim());
  };
  return (
    <Modal title="Edit block" onClose={onClose} compact>
      <form className="systemsSyntaxDialogForm" onSubmit={submit}>
        <label>
          Block name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="systemsSyntaxDialogActions">
          <button
            type="button"
            className="systemsSyntaxDeleteTextButton"
            onClick={() => onRequestDelete(block)}
          >
            Delete block
          </button>
          <div>
            <button type="button" className="secondaryButton" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={!name.trim()}>
              Save changes
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
