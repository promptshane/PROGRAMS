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
  LEGACY_THREADS_SOURCE_GLOBAL_STORAGE_KEY,
  LEGACY_THREADS_SOURCE_STORAGE_KEY,
  LEGACY_THREADS_STORAGE_KEY,
  LEGACY_THREADS_V2_STORAGE_KEY,
  THREADS_STORAGE_KEY,
  clearStrictTie,
  countProjectThreads,
  countThreadBlocks,
  createBlock,
  createCrossThreadLooseTie,
  createProject,
  createThread,
  deleteCrossThreadLooseTie,
  getCategoryProjects,
  getIncomingCrossThreadLooseTies,
  getOutgoingCrossThreadLooseTies,
  getProjectThreads,
  getThreadDisplayBlockIds,
  migrateLegacyThreadsState,
  moveBlockInThread,
  parseThreadsState,
  setStrictTie,
  updateBlockText,
  type Block,
  type CrossThreadLooseTie,
  type MoveDirection,
  type Project,
  type Thread,
  type ThreadsMutationResult,
  type ThreadsState,
  type TiePosition,
} from "../lib/threads-store";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, XIcon } from "./icons";
import { Modal } from "./ui-primitives";

type ThreadsView =
  | { level: "categories" }
  | { level: "projects"; categoryId: CreativeCategoryId }
  | { level: "threads"; categoryId: CreativeCategoryId; projectId: string };

type CreateDialogState =
  | { type: "project"; categoryId: CreativeCategoryId }
  | { type: "thread"; projectId: string }
  | null;

type LinkDialogState = { sourceBlockId: string } | null;

interface BlockLocation {
  block: Block;
  thread: Thread;
  project: Project;
}

const createId = (prefix: "project" | "thread" | "block" | "cross-link"): string =>
  typeof crypto.randomUUID === "function"
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const categoryStyle = (color: string): CSSProperties =>
  ({ "--threads-category": color }) as CSSProperties;

const formatCount = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

const truncateBlockText = (text: string): string =>
  text.length > 52 ? `${text.slice(0, 49)}...` : text;

const loadState = (): ThreadsState => {
  try {
    const current = localStorage.getItem(THREADS_STORAGE_KEY);
    if (current !== null) return parseThreadsState(current);
    return migrateLegacyThreadsState(
      localStorage.getItem(LEGACY_THREADS_V2_STORAGE_KEY),
      localStorage.getItem(LEGACY_THREADS_STORAGE_KEY),
      localStorage.getItem(LEGACY_THREADS_SOURCE_STORAGE_KEY),
      localStorage.getItem(LEGACY_THREADS_SOURCE_GLOBAL_STORAGE_KEY),
    );
  } catch {
    return parseThreadsState(null);
  }
};

const saveState = (state: ThreadsState): void => {
  try {
    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Threads remains usable in-memory if renderer storage is unavailable.
  }
};

const getBlockLocation = (
  state: ThreadsState,
  blockId: string,
): BlockLocation | null => {
  const block = state.blocks[blockId];
  const thread = block ? state.threads[block.threadId] : null;
  const project = thread ? state.projects[thread.projectId] : null;
  return block && thread && project ? { block, thread, project } : null;
};

const getBlockPath = (state: ThreadsState, blockId: string): string => {
  const location = getBlockLocation(state, blockId);
  if (!location) return "Missing block";
  const category = getCreativeCategory(location.project.categoryId);
  return `${category.label} / ${location.project.name} / ${location.thread.name}`;
};

export function ThreadsPage() {
  const [state, setState] = useState<ThreadsState>(loadState);
  const [view, setView] = useState<ThreadsView>({ level: "categories" });
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [newBlockText, setNewBlockText] = useState("");
  const [createDialog, setCreateDialog] = useState<CreateDialogState>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [blockWarning, setBlockWarning] = useState<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);

  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    if (!highlightedBlockId) return undefined;
    const timeout = window.setTimeout(() => setHighlightedBlockId(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [highlightedBlockId]);

  const selectedCategory = view.level === "categories"
    ? null
    : getCreativeCategory(view.categoryId);
  const selectedProject = view.level === "threads"
    ? state.projects[view.projectId] ?? null
    : null;

  useEffect(() => {
    if (view.level === "threads" && !state.projects[view.projectId]) {
      setView({ level: "projects", categoryId: view.categoryId });
      setExpandedThreadId(null);
      setNewBlockText("");
      setEditingBlockId(null);
      setBlockWarning(null);
    }
  }, [state.projects, view]);

  useEffect(() => {
    if (expandedThreadId && !state.threads[expandedThreadId]) {
      setExpandedThreadId(null);
      setNewBlockText("");
      setEditingBlockId(null);
      setBlockWarning(null);
    }
  }, [expandedThreadId, state.threads]);

  const projects = useMemo(
    () =>
      view.level === "projects"
        ? getCategoryProjects(state, view.categoryId)
        : [],
    [state, view],
  );

  const threads = useMemo(
    () =>
      view.level === "threads"
        ? getProjectThreads(state, view.projectId)
        : [],
    [state, view],
  );

  const applyMutationResult = (result: ThreadsMutationResult) => {
    setState(result.state);
    setBlockWarning(result.error);
  };

  const goBack = () => {
    setExpandedThreadId(null);
    setNewBlockText("");
    setEditingBlockId(null);
    setBlockWarning(null);
    if (view.level === "threads") {
      setView({ level: "projects", categoryId: view.categoryId });
    } else if (view.level === "projects") {
      setView({ level: "categories" });
    }
  };

  const openCategory = (categoryId: CreativeCategoryId) => {
    setExpandedThreadId(null);
    setNewBlockText("");
    setEditingBlockId(null);
    setBlockWarning(null);
    setView({ level: "projects", categoryId });
  };

  const openProject = (project: Project) => {
    setExpandedThreadId(null);
    setNewBlockText("");
    setEditingBlockId(null);
    setBlockWarning(null);
    setView({
      level: "threads",
      categoryId: project.categoryId,
      projectId: project.id,
    });
  };

  const toggleThread = (threadId: string) => {
    setNewBlockText("");
    setEditingBlockId(null);
    setBlockWarning(null);
    setExpandedThreadId((current) => current === threadId ? null : threadId);
  };

  const saveCreatedItem = (name: string) => {
    if (!createDialog) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (createDialog.type === "project") {
      const projectId = createId("project");
      setState((current) =>
        createProject(current, trimmedName, createDialog.categoryId, projectId),
      );
      setView({
        level: "threads",
        categoryId: createDialog.categoryId,
        projectId,
      });
    } else {
      const threadId = createId("thread");
      setState((current) =>
        createThread(current, trimmedName, createDialog.projectId, threadId),
      );
      setExpandedThreadId(threadId);
      setNewBlockText("");
    }

    setCreateDialog(null);
  };

  const submitBlock = (thread: Thread, event: FormEvent) => {
    event.preventDefault();
    const text = newBlockText.trim();
    if (!text) return;
    setState((current) => createBlock(current, thread.id, text, createId("block")));
    setNewBlockText("");
    setBlockWarning(null);
  };

  const startEditBlock = (block: Block) => {
    setEditingBlockId(block.id);
    setEditingText(block.text);
    setBlockWarning(null);
  };

  const saveBlockEdit = (blockId: string) => {
    if (!editingText.trim()) {
      setBlockWarning("Block text cannot be empty.");
      return;
    }
    setState((current) => updateBlockText(current, blockId, editingText));
    setEditingBlockId(null);
    setEditingText("");
    setBlockWarning(null);
  };

  const cancelBlockEdit = () => {
    setEditingBlockId(null);
    setEditingText("");
  };

  const moveBlock = (blockId: string, direction: MoveDirection) => {
    applyMutationResult(moveBlockInThread(state, blockId, direction));
  };

  const tieStrict = (
    blockId: string,
    position: TiePosition,
    targetBlockId: string,
  ) => {
    applyMutationResult(setStrictTie(state, blockId, position, targetBlockId));
  };

  const untieStrict = (blockId: string, position: TiePosition) => {
    setState((current) => clearStrictTie(current, blockId, position));
    setBlockWarning(null);
  };

  const openLinkDialog = (sourceBlockId: string) => {
    setLinkDialog({ sourceBlockId });
    setLinkSearch("");
    setBlockWarning(null);
  };

  const createCallbackLink = (sourceBlockId: string, targetBlockId: string) => {
    const result = createCrossThreadLooseTie(
      state,
      sourceBlockId,
      targetBlockId,
      createId("cross-link"),
    );
    applyMutationResult(result);
    if (!result.error) {
      setLinkDialog(null);
      setLinkSearch("");
    }
  };

  const removeCallbackLink = (tieId: string) => {
    setState((current) => deleteCrossThreadLooseTie(current, tieId));
    setBlockWarning(null);
  };

  const jumpToBlock = (blockId: string) => {
    const location = getBlockLocation(state, blockId);
    if (!location) return;
    setView({
      level: "threads",
      categoryId: location.project.categoryId,
      projectId: location.project.id,
    });
    setExpandedThreadId(location.thread.id);
    setHighlightedBlockId(blockId);
    setBlockWarning(null);
  };

  return (
    <section className="threadsPage" data-testid="threads-page">
      <header className="threadsScreenHeader">
        {view.level !== "categories" ? (
          <button
            type="button"
            className="threadsBackButton"
            aria-label="Back"
            onClick={goBack}
          >
            <span aria-hidden="true">&lt;</span>
          </button>
        ) : null}

        <div className="threadsTitleBlock">
          {selectedCategory ? (
            <div
              className="threadsBreadcrumb"
              style={categoryStyle(selectedCategory.color)}
            >
              <span>{selectedCategory.label}</span>
              {selectedProject ? (
                <>
                  <span aria-hidden="true">/</span>
                  <span>{selectedProject.name}</span>
                </>
              ) : null}
            </div>
          ) : null}
          <h1>
            {view.level === "categories"
              ? "Threads"
              : view.level === "projects"
                ? "Projects"
                : "Threads"}
          </h1>
        </div>

        {view.level === "projects" ? (
          <button
            type="button"
            className="threadsAddButton"
            onClick={() =>
              setCreateDialog({ type: "project", categoryId: view.categoryId })
            }
          >
            Add Project
          </button>
        ) : null}

        {view.level === "threads" ? (
          <button
            type="button"
            className="threadsAddButton"
            onClick={() => setCreateDialog({ type: "thread", projectId: view.projectId })}
          >
            Add Thread
          </button>
        ) : null}
      </header>

      {view.level === "categories" ? (
        <CategoryList onOpenCategory={openCategory} />
      ) : null}

      {view.level === "projects" && selectedCategory ? (
        <ProjectList
          state={state}
          projects={projects}
          categoryId={selectedCategory.id}
          onOpenProject={openProject}
        />
      ) : null}

      {view.level === "threads" && selectedProject ? (
        <ThreadList
          state={state}
          threads={threads}
          expandedThreadId={expandedThreadId}
          newBlockText={newBlockText}
          editingBlockId={editingBlockId}
          editingText={editingText}
          blockWarning={blockWarning}
          highlightedBlockId={highlightedBlockId}
          onNewBlockTextChange={setNewBlockText}
          onEditingTextChange={setEditingText}
          onToggleThread={toggleThread}
          onSubmitBlock={submitBlock}
          onStartEditBlock={startEditBlock}
          onSaveBlockEdit={saveBlockEdit}
          onCancelBlockEdit={cancelBlockEdit}
          onMoveBlock={moveBlock}
          onSetStrictTie={tieStrict}
          onClearStrictTie={untieStrict}
          onOpenLinkDialog={openLinkDialog}
          onDeleteCrossThreadLooseTie={removeCallbackLink}
          onJumpToBlock={jumpToBlock}
        />
      ) : null}

      {createDialog ? (
        <CreateDialog
          dialog={createDialog}
          project={createDialog.type === "thread"
            ? state.projects[createDialog.projectId] ?? null
            : null}
          onClose={() => setCreateDialog(null)}
          onSave={saveCreatedItem}
        />
      ) : null}

      {linkDialog ? (
        <CrossThreadLinkDialog
          state={state}
          sourceBlockId={linkDialog.sourceBlockId}
          search={linkSearch}
          onSearchChange={setLinkSearch}
          onClose={() => setLinkDialog(null)}
          onCreateLink={createCallbackLink}
        />
      ) : null}
    </section>
  );
}

function CategoryList({
  onOpenCategory,
}: {
  onOpenCategory: (categoryId: CreativeCategoryId) => void;
}) {
  return (
    <div className="threadsList" aria-label="Categories">
      {CREATIVE_CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          className="threadsRow"
          style={categoryStyle(category.color)}
          onClick={() => onOpenCategory(category.id)}
        >
          <span className="threadsRowName">{category.label}</span>
        </button>
      ))}
    </div>
  );
}

function ProjectList({
  state,
  projects,
  categoryId,
  onOpenProject,
}: {
  state: ThreadsState;
  projects: Project[];
  categoryId: CreativeCategoryId;
  onOpenProject: (project: Project) => void;
}) {
  const category = getCreativeCategory(categoryId);
  if (projects.length === 0) {
    return (
      <div className="threadsEmptyState" style={categoryStyle(category.color)}>
        No Projects
      </div>
    );
  }

  return (
    <div className="threadsList" aria-label={`${category.label} projects`}>
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          className="threadsRow"
          style={categoryStyle(category.color)}
          onClick={() => onOpenProject(project)}
        >
          <span className="threadsRowName">{project.name}</span>
          <span className="threadsRowCount">
            {formatCount(countProjectThreads(state, project.id), "Thread")}
          </span>
        </button>
      ))}
    </div>
  );
}

function ThreadList({
  state,
  threads,
  expandedThreadId,
  newBlockText,
  editingBlockId,
  editingText,
  blockWarning,
  highlightedBlockId,
  onNewBlockTextChange,
  onEditingTextChange,
  onToggleThread,
  onSubmitBlock,
  onStartEditBlock,
  onSaveBlockEdit,
  onCancelBlockEdit,
  onMoveBlock,
  onSetStrictTie,
  onClearStrictTie,
  onOpenLinkDialog,
  onDeleteCrossThreadLooseTie,
  onJumpToBlock,
}: {
  state: ThreadsState;
  threads: Thread[];
  expandedThreadId: string | null;
  newBlockText: string;
  editingBlockId: string | null;
  editingText: string;
  blockWarning: string | null;
  highlightedBlockId: string | null;
  onNewBlockTextChange: (text: string) => void;
  onEditingTextChange: (text: string) => void;
  onToggleThread: (threadId: string) => void;
  onSubmitBlock: (thread: Thread, event: FormEvent) => void;
  onStartEditBlock: (block: Block) => void;
  onSaveBlockEdit: (blockId: string) => void;
  onCancelBlockEdit: () => void;
  onMoveBlock: (blockId: string, direction: MoveDirection) => void;
  onSetStrictTie: (
    blockId: string,
    position: TiePosition,
    targetBlockId: string,
  ) => void;
  onClearStrictTie: (blockId: string, position: TiePosition) => void;
  onOpenLinkDialog: (sourceBlockId: string) => void;
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  if (threads.length === 0) {
    return <div className="threadsEmptyState">No Threads</div>;
  }

  return (
    <div className="threadsList" aria-label="Project threads">
      {threads.map((thread) => {
        const isExpanded = expandedThreadId === thread.id;
        return (
          <section key={thread.id} className="threadsThreadGroup">
            <button
              type="button"
              className={`threadsRow${isExpanded ? " active" : ""}`}
              aria-expanded={isExpanded}
              onClick={() => onToggleThread(thread.id)}
            >
              <span className="threadsRowName">{thread.name}</span>
              <span className="threadsRowCount">
                {formatCount(countThreadBlocks(state, thread.id), "Block")}
              </span>
            </button>
            {isExpanded ? (
              <ThreadAccordion
                state={state}
                thread={thread}
                newBlockText={newBlockText}
                editingBlockId={editingBlockId}
                editingText={editingText}
                blockWarning={blockWarning}
                highlightedBlockId={highlightedBlockId}
                onNewBlockTextChange={onNewBlockTextChange}
                onEditingTextChange={onEditingTextChange}
                onSubmitBlock={onSubmitBlock}
                onStartEditBlock={onStartEditBlock}
                onSaveBlockEdit={onSaveBlockEdit}
                onCancelBlockEdit={onCancelBlockEdit}
                onMoveBlock={onMoveBlock}
                onSetStrictTie={onSetStrictTie}
                onClearStrictTie={onClearStrictTie}
                onOpenLinkDialog={onOpenLinkDialog}
                onDeleteCrossThreadLooseTie={onDeleteCrossThreadLooseTie}
                onJumpToBlock={onJumpToBlock}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ThreadAccordion({
  state,
  thread,
  newBlockText,
  editingBlockId,
  editingText,
  blockWarning,
  highlightedBlockId,
  onNewBlockTextChange,
  onEditingTextChange,
  onSubmitBlock,
  onStartEditBlock,
  onSaveBlockEdit,
  onCancelBlockEdit,
  onMoveBlock,
  onSetStrictTie,
  onClearStrictTie,
  onOpenLinkDialog,
  onDeleteCrossThreadLooseTie,
  onJumpToBlock,
}: {
  state: ThreadsState;
  thread: Thread;
  newBlockText: string;
  editingBlockId: string | null;
  editingText: string;
  blockWarning: string | null;
  highlightedBlockId: string | null;
  onNewBlockTextChange: (text: string) => void;
  onEditingTextChange: (text: string) => void;
  onSubmitBlock: (thread: Thread, event: FormEvent) => void;
  onStartEditBlock: (block: Block) => void;
  onSaveBlockEdit: (blockId: string) => void;
  onCancelBlockEdit: () => void;
  onMoveBlock: (blockId: string, direction: MoveDirection) => void;
  onSetStrictTie: (
    blockId: string,
    position: TiePosition,
    targetBlockId: string,
  ) => void;
  onClearStrictTie: (blockId: string, position: TiePosition) => void;
  onOpenLinkDialog: (sourceBlockId: string) => void;
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  const blockIds = getThreadDisplayBlockIds(state, thread.id);
  return (
    <div className="threadsAccordion">
      <form
        className="threadsAddBlockForm"
        onSubmit={(event) => onSubmitBlock(thread, event)}
      >
        <textarea
          value={newBlockText}
          onChange={(event) => onNewBlockTextChange(event.target.value)}
          placeholder="Block text"
          aria-label="Block text"
          rows={3}
        />
        <button type="submit" disabled={!newBlockText.trim()}>
          Add Block
        </button>
      </form>

      {blockWarning ? (
        <div className="threadsBlockWarning">{blockWarning}</div>
      ) : null}

      {blockIds.length > 0 ? (
        <div className="threadsBlockList">
          {blockIds.map((blockId, index) => {
            const block = state.blocks[blockId];
            return block ? (
              <BlockRow
                key={block.id}
                state={state}
                block={block}
                previousBlockId={blockIds[index - 1] ?? null}
                nextBlockId={blockIds[index + 1] ?? null}
                isEditing={editingBlockId === block.id}
                editingText={editingText}
                isHighlighted={highlightedBlockId === block.id}
                onEditingTextChange={onEditingTextChange}
                onStartEditBlock={onStartEditBlock}
                onSaveBlockEdit={onSaveBlockEdit}
                onCancelBlockEdit={onCancelBlockEdit}
                onMoveBlock={onMoveBlock}
                onSetStrictTie={onSetStrictTie}
                onClearStrictTie={onClearStrictTie}
                onOpenLinkDialog={onOpenLinkDialog}
                onDeleteCrossThreadLooseTie={onDeleteCrossThreadLooseTie}
                onJumpToBlock={onJumpToBlock}
              />
            ) : null;
          })}
        </div>
      ) : (
        <div className="threadsEmptyBlocks">No Blocks</div>
      )}
    </div>
  );
}

function BlockRow({
  state,
  block,
  previousBlockId,
  nextBlockId,
  isEditing,
  editingText,
  isHighlighted,
  onEditingTextChange,
  onStartEditBlock,
  onSaveBlockEdit,
  onCancelBlockEdit,
  onMoveBlock,
  onSetStrictTie,
  onClearStrictTie,
  onOpenLinkDialog,
  onDeleteCrossThreadLooseTie,
  onJumpToBlock,
}: {
  state: ThreadsState;
  block: Block;
  previousBlockId: string | null;
  nextBlockId: string | null;
  isEditing: boolean;
  editingText: string;
  isHighlighted: boolean;
  onEditingTextChange: (text: string) => void;
  onStartEditBlock: (block: Block) => void;
  onSaveBlockEdit: (blockId: string) => void;
  onCancelBlockEdit: () => void;
  onMoveBlock: (blockId: string, direction: MoveDirection) => void;
  onSetStrictTie: (
    blockId: string,
    position: TiePosition,
    targetBlockId: string,
  ) => void;
  onClearStrictTie: (blockId: string, position: TiePosition) => void;
  onOpenLinkDialog: (sourceBlockId: string) => void;
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  const strictBefore = previousBlockId
    ? block.strictTies.before === previousBlockId
    : false;
  const strictAfter = nextBlockId
    ? block.strictTies.after === nextBlockId
    : false;
  const outgoingLinks = getOutgoingCrossThreadLooseTies(state, block.id);
  const incomingLinks = getIncomingCrossThreadLooseTies(state, block.id);

  return (
    <article
      className={[
        "threadsBlockRow",
        strictBefore ? "strictBefore" : "",
        strictAfter ? "strictAfter" : "",
        isHighlighted ? "highlighted" : "",
      ].filter(Boolean).join(" ")}
    >
      {strictBefore ? (
        <span className="threadsStrictConnector before" title="Strict tie" />
      ) : null}
      {strictAfter ? (
        <span className="threadsStrictConnector after" title="Strict tie" />
      ) : null}

      <div className="threadsBlockMain">
        {isEditing ? (
          <form
            className="threadsBlockEditForm"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveBlockEdit(block.id);
            }}
          >
            <textarea
              autoFocus
              value={editingText}
              onChange={(event) => onEditingTextChange(event.target.value)}
              rows={3}
            />
            <div className="threadsBlockEditActions">
              <button
                type="submit"
                className="threadsIconButton"
                aria-label="Save Block text"
                disabled={!editingText.trim()}
              >
                <CheckIcon />
              </button>
              <button
                type="button"
                className="threadsIconButton"
                aria-label="Cancel Block edit"
                onClick={onCancelBlockEdit}
              >
                <XIcon />
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="threadsBlockTextButton"
            onClick={() => onStartEditBlock(block)}
          >
            {block.text}
          </button>
        )}

        <div className="threadsBlockMeta">
          <StrictTieControl
            label="before"
            block={block}
            targetBlockId={previousBlockId}
            isTied={strictBefore}
            onSetStrictTie={onSetStrictTie}
            onClearStrictTie={onClearStrictTie}
          />
          <StrictTieControl
            label="after"
            block={block}
            targetBlockId={nextBlockId}
            isTied={strictAfter}
            onSetStrictTie={onSetStrictTie}
            onClearStrictTie={onClearStrictTie}
          />
          <button
            type="button"
            className="threadsMetaButton"
            onClick={() => onOpenLinkDialog(block.id)}
          >
            Link
          </button>
        </div>

        <CallbackLinks
          state={state}
          outgoingLinks={outgoingLinks}
          incomingLinks={incomingLinks}
          onDeleteCrossThreadLooseTie={onDeleteCrossThreadLooseTie}
          onJumpToBlock={onJumpToBlock}
        />
      </div>

      <div className="threadsBlockReorder" aria-label="Reorder Block">
        <button
          type="button"
          className="threadsIconButton"
          aria-label="Move Block up"
          onClick={() => onMoveBlock(block.id, "up")}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          className="threadsIconButton"
          aria-label="Move Block down"
          onClick={() => onMoveBlock(block.id, "down")}
        >
          <ArrowDownIcon />
        </button>
      </div>
    </article>
  );
}

function StrictTieControl({
  label,
  block,
  targetBlockId,
  isTied,
  onSetStrictTie,
  onClearStrictTie,
}: {
  label: TiePosition;
  block: Block;
  targetBlockId: string | null;
  isTied: boolean;
  onSetStrictTie: (
    blockId: string,
    position: TiePosition,
    targetBlockId: string,
  ) => void;
  onClearStrictTie: (blockId: string, position: TiePosition) => void;
}) {
  if (!targetBlockId && !isTied) return null;
  return isTied ? (
    <button
      type="button"
      className="threadsMetaButton strict active"
      onClick={() => onClearStrictTie(block.id, label)}
    >
      Strict {label}
    </button>
  ) : (
    <button
      type="button"
      className="threadsMetaButton strict"
      onClick={() => targetBlockId && onSetStrictTie(block.id, label, targetBlockId)}
    >
      Tie {label}
    </button>
  );
}

function CallbackLinks({
  state,
  outgoingLinks,
  incomingLinks,
  onDeleteCrossThreadLooseTie,
  onJumpToBlock,
}: {
  state: ThreadsState;
  outgoingLinks: CrossThreadLooseTie[];
  incomingLinks: CrossThreadLooseTie[];
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  if (outgoingLinks.length === 0 && incomingLinks.length === 0) return null;
  return (
    <div className="threadsCallbackLinks">
      {outgoingLinks.map((tie) => {
        const target = state.blocks[tie.targetBlockId];
        if (!target) return null;
        return (
          <span key={tie.id} className="threadsCallbackChip outgoing">
            <button
              type="button"
              title={getBlockPath(state, target.id)}
              onClick={() => onJumpToBlock(target.id)}
            >
              Callback to {truncateBlockText(target.text)}
            </button>
            <button
              type="button"
              aria-label="Remove callback link"
              onClick={() => onDeleteCrossThreadLooseTie(tie.id)}
            >
              <XIcon />
            </button>
          </span>
        );
      })}
      {incomingLinks.map((tie) => {
        const source = state.blocks[tie.sourceBlockId];
        if (!source) return null;
        return (
          <span key={tie.id} className="threadsCallbackChip incoming">
            <button
              type="button"
              title={getBlockPath(state, source.id)}
              onClick={() => onJumpToBlock(source.id)}
            >
              Callback from {truncateBlockText(source.text)}
            </button>
            <button
              type="button"
              aria-label="Remove callback link"
              onClick={() => onDeleteCrossThreadLooseTie(tie.id)}
            >
              <XIcon />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function CrossThreadLinkDialog({
  state,
  sourceBlockId,
  search,
  onSearchChange,
  onClose,
  onCreateLink,
}: {
  state: ThreadsState;
  sourceBlockId: string;
  search: string;
  onSearchChange: (search: string) => void;
  onClose: () => void;
  onCreateLink: (sourceBlockId: string, targetBlockId: string) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const source = state.blocks[sourceBlockId] ?? null;
  const candidates = state.blockOrder
    .map((blockId) => state.blocks[blockId])
    .filter((block): block is Block => Boolean(block) && block.id !== sourceBlockId)
    .filter((block) => {
      if (!normalizedSearch) return true;
      const searchable = `${getBlockPath(state, block.id)} ${block.text}`.toLowerCase();
      return searchable.includes(normalizedSearch);
    });

  return (
    <Modal title="Link Block" onClose={onClose} compact>
      <div className="threadsLinkDialog">
        {source ? (
          <div className="threadsDialogContext">
            From {truncateBlockText(source.text)}
          </div>
        ) : null}
        <input
          autoFocus
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search blocks"
        />
        <div className="threadsLinkResults">
          {candidates.length > 0 ? (
            candidates.map((block) => (
              <button
                key={block.id}
                type="button"
                className="threadsLinkResult"
                onClick={() => onCreateLink(sourceBlockId, block.id)}
              >
                <span>{truncateBlockText(block.text)}</span>
                <small>{getBlockPath(state, block.id)}</small>
              </button>
            ))
          ) : (
            <div className="threadsEmptyBlocks">No matching Blocks</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CreateDialog({
  dialog,
  project,
  onClose,
  onSave,
}: {
  dialog: Exclude<CreateDialogState, null>;
  project: Project | null;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const title = dialog.type === "project" ? "New Project" : "New Thread";
  const label = dialog.type === "project" ? "Project name" : "Thread name";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave(name);
  };

  return (
    <Modal title={title} onClose={onClose} compact>
      <form className="threadDialogForm" onSubmit={submit}>
        <label>
          {label}
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={label}
          />
        </label>
        {project ? (
          <div className="threadsDialogContext">{project.name}</div>
        ) : null}
        <div className="threadDialogActions">
          <span />
          <div>
            <button type="button" className="secondaryButton" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={!name.trim()}>
              Create
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
