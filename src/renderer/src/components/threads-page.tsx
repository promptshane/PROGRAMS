import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
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
  deleteBlock,
  deleteCrossThreadLooseTie,
  deleteThread,
  getCategoryProjects,
  getIncomingCrossThreadLooseTies,
  getOutgoingCrossThreadLooseTies,
  getProjectThreads,
  getThreadDisplayBlockIds,
  migrateLegacyThreadsState,
  moveBlockInThread,
  moveThreadInProject,
  parseThreadsState,
  setStrictTie,
  updateProject,
  updateBlockText,
  updateThread,
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
type ThreadSortMode = "manual" | "name" | "quantity";
type TitleEditTarget =
  | { type: "project"; id: string }
  | { type: "thread"; id: string }
  | null;
type DeleteDialogState =
  | {
    type: "thread";
    threadId: string;
    name: string;
    blockCount: number;
    callbackLinkCount: number;
    strictTieCount: number;
  }
  | {
    type: "block";
    blockId: string;
    text: string;
    callbackLinkCount: number;
    strictTieCount: number;
  }
  | null;

interface BlockLocation {
  block: Block;
  thread: Thread;
  project: Project;
}

const THREAD_SORT_STORAGE_KEY = "programs.threads.sortMode";
const THREAD_SORT_MODES: ThreadSortMode[] = ["manual", "name", "quantity"];

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

const isThreadSortMode = (value: string | null): value is ThreadSortMode =>
  value === "manual" || value === "name" || value === "quantity";

const formatThreadSortMode = (mode: ThreadSortMode): string => {
  switch (mode) {
    case "manual":
      return "Manual";
    case "name":
      return "Name";
    case "quantity":
      return "Quantity";
  }
};

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

const loadThreadSortMode = (): ThreadSortMode => {
  try {
    const stored = localStorage.getItem(THREAD_SORT_STORAGE_KEY);
    return isThreadSortMode(stored) ? stored : "manual";
  } catch {
    return "manual";
  }
};

const saveState = (state: ThreadsState): void => {
  try {
    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Threads remains usable in-memory if renderer storage is unavailable.
  }
};

const saveThreadSortMode = (mode: ThreadSortMode): void => {
  try {
    localStorage.setItem(THREAD_SORT_STORAGE_KEY, mode);
  } catch {
    // Sorting remains usable in-memory if renderer storage is unavailable.
  }
};

const sortThreads = (
  state: ThreadsState,
  threads: Thread[],
  sortMode: ThreadSortMode,
): Thread[] => {
  if (sortMode === "manual") return threads;
  const manualIndex = new Map(threads.map((thread, index) => [thread.id, index]));
  const byManualOrder = (a: Thread, b: Thread) =>
    (manualIndex.get(a.id) ?? 0) - (manualIndex.get(b.id) ?? 0);
  const sorted = [...threads];
  if (sortMode === "name") {
    return sorted.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
      || byManualOrder(a, b),
    );
  }
  return sorted.sort((a, b) =>
    countThreadBlocks(state, b.id) - countThreadBlocks(state, a.id)
    || byManualOrder(a, b),
  );
};

const getThreadBlockIdSet = (state: ThreadsState, threadId: string): Set<string> =>
  new Set(
    Object.values(state.blocks)
      .filter((block) => block.threadId === threadId)
      .map((block) => block.id),
  );

const countAffectedCallbackLinks = (
  state: ThreadsState,
  deletedBlockIds: Set<string>,
): number =>
  state.crossThreadLooseTieOrder.filter((tieId) => {
    const tie = state.crossThreadLooseTies[tieId];
    return Boolean(tie)
      && (deletedBlockIds.has(tie.sourceBlockId) || deletedBlockIds.has(tie.targetBlockId));
  }).length;

const countAffectedStrictTies = (
  state: ThreadsState,
  deletedBlockIds: Set<string>,
): number => {
  const affectedPairs = new Set<string>();
  for (const blockId of deletedBlockIds) {
    const block = state.blocks[blockId];
    if (!block) continue;
    for (const targetBlockId of [block.strictTies.before, block.strictTies.after]) {
      if (!targetBlockId || !state.blocks[targetBlockId]) continue;
      const pair = [blockId, targetBlockId].sort().join(":");
      affectedPairs.add(pair);
    }
  }
  return affectedPairs.size;
};

const createThreadDeleteDialogState = (
  state: ThreadsState,
  thread: Thread,
): Exclude<DeleteDialogState, null> => {
  const deletedBlockIds = getThreadBlockIdSet(state, thread.id);
  return {
    type: "thread",
    threadId: thread.id,
    name: thread.name,
    blockCount: deletedBlockIds.size,
    callbackLinkCount: countAffectedCallbackLinks(state, deletedBlockIds),
    strictTieCount: countAffectedStrictTies(state, deletedBlockIds),
  };
};

const createBlockDeleteDialogState = (
  state: ThreadsState,
  block: Block,
): Exclude<DeleteDialogState, null> => {
  const deletedBlockIds = new Set([block.id]);
  return {
    type: "block",
    blockId: block.id,
    text: block.text,
    callbackLinkCount: countAffectedCallbackLinks(state, deletedBlockIds),
    strictTieCount: countAffectedStrictTies(state, deletedBlockIds),
  };
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
  const [threadSortMode, setThreadSortMode] = useState<ThreadSortMode>(loadThreadSortMode);
  const [isEditMode, setIsEditMode] = useState(false);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [isAddingThread, setIsAddingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [newBlockText, setNewBlockText] = useState("");
  const [createDialog, setCreateDialog] = useState<CreateDialogState>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [editingTitle, setEditingTitle] = useState<TitleEditTarget>(null);
  const [editingTitleText, setEditingTitleText] = useState("");
  const [titleWarning, setTitleWarning] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [blockWarning, setBlockWarning] = useState<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);

  useEffect(() => saveState(state), [state]);
  useEffect(() => saveThreadSortMode(threadSortMode), [threadSortMode]);

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
      setIsEditMode(false);
      setExpandedThreadId(null);
      setIsAddingThread(false);
      setNewThreadName("");
      setNewBlockText("");
      setEditingTitle(null);
      setEditingTitleText("");
      setTitleWarning(null);
      setEditingBlockId(null);
      setEditingText("");
      setLinkDialog(null);
      setLinkSearch("");
      setDeleteDialog(null);
      setBlockWarning(null);
    }
  }, [state.projects, view]);

  useEffect(() => {
    if (expandedThreadId && !state.threads[expandedThreadId]) {
      setExpandedThreadId(null);
      setNewBlockText("");
      setEditingBlockId(null);
      setEditingText("");
      setBlockWarning(null);
    }
  }, [expandedThreadId, state.threads]);

  useEffect(() => {
    if (!editingTitle) return;
    const exists = editingTitle.type === "project"
      ? Boolean(state.projects[editingTitle.id])
      : Boolean(state.threads[editingTitle.id]);
    if (!exists) {
      setEditingTitle(null);
      setEditingTitleText("");
      setTitleWarning(null);
    }
  }, [editingTitle, state.projects, state.threads]);

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

  const sortedThreads = useMemo(
    () => sortThreads(state, threads, threadSortMode),
    [state, threads, threadSortMode],
  );

  const applyMutationResult = (result: ThreadsMutationResult) => {
    setState(result.state);
    setBlockWarning(result.error);
  };

  const clearTitleEdit = () => {
    setEditingTitle(null);
    setEditingTitleText("");
  };

  const clearEditState = () => {
    clearTitleEdit();
    setIsAddingThread(false);
    setNewThreadName("");
    setNewBlockText("");
    setEditingBlockId(null);
    setEditingText("");
    setLinkDialog(null);
    setLinkSearch("");
    setDeleteDialog(null);
  };

  const toggleEditMode = () => {
    if (isEditMode) {
      setIsEditMode(false);
      clearEditState();
      setTitleWarning(null);
      setBlockWarning(null);
      return;
    }
    setIsEditMode(true);
    setTitleWarning(null);
    setBlockWarning(null);
  };

  const goBack = () => {
    setExpandedThreadId(null);
    clearEditState();
    setIsEditMode(false);
    setTitleWarning(null);
    setBlockWarning(null);
    if (view.level === "threads") {
      setView({ level: "projects", categoryId: view.categoryId });
    } else if (view.level === "projects") {
      setView({ level: "categories" });
    }
  };

  const openCategory = (categoryId: CreativeCategoryId) => {
    setExpandedThreadId(null);
    clearEditState();
    setIsEditMode(false);
    setTitleWarning(null);
    setBlockWarning(null);
    setView({ level: "projects", categoryId });
  };

  const openProject = (project: Project) => {
    setExpandedThreadId(null);
    clearEditState();
    setIsEditMode(false);
    setTitleWarning(null);
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

  const cycleThreadSortMode = () => {
    const currentIndex = THREAD_SORT_MODES.indexOf(threadSortMode);
    const nextMode = THREAD_SORT_MODES[(currentIndex + 1) % THREAD_SORT_MODES.length];
    setThreadSortMode(nextMode);
    setTitleWarning(null);
  };

  const startEditTitle = (target: Exclude<TitleEditTarget, null>, currentName: string) => {
    setEditingTitle(target);
    setEditingTitleText(currentName);
    setTitleWarning(null);
  };

  const saveTitleEdit = () => {
    if (!editingTitle) return;
    const nextName = editingTitleText.trim();
    if (!nextName) {
      setTitleWarning(`${editingTitle.type === "project" ? "Project" : "Thread"} name cannot be empty.`);
      clearTitleEdit();
      return;
    }
    if (editingTitle.type === "project") {
      setState((current) => updateProject(current, editingTitle.id, { name: nextName }));
    } else {
      setState((current) => updateThread(current, editingTitle.id, { name: nextName }));
    }
    clearTitleEdit();
    setTitleWarning(null);
  };

  const cancelTitleEdit = () => {
    clearTitleEdit();
    setTitleWarning(null);
  };

  const moveThread = (threadId: string, direction: MoveDirection) => {
    if (!isEditMode) return;
    const result = moveThreadInProject(state, threadId, direction);
    setState(result.state);
    setTitleWarning(result.error);
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

  const startAddingThread = () => {
    if (!isEditMode) return;
    clearTitleEdit();
    setEditingBlockId(null);
    setEditingText("");
    setIsAddingThread(true);
    setNewThreadName("");
    setTitleWarning(null);
  };

  const saveInlineThread = () => {
    if (!isEditMode || view.level !== "threads") return;
    const trimmedName = newThreadName.trim();
    if (!trimmedName) {
      setTitleWarning("Thread name cannot be empty.");
      return;
    }
    const threadId = createId("thread");
    setState((current) => createThread(current, trimmedName, view.projectId, threadId));
    setExpandedThreadId(threadId);
    setIsAddingThread(false);
    setNewThreadName("");
    setNewBlockText("");
    setTitleWarning(null);
    setBlockWarning(null);
  };

  const cancelInlineThread = () => {
    setIsAddingThread(false);
    setNewThreadName("");
    setTitleWarning(null);
  };

  const submitBlock = (thread: Thread, event: FormEvent) => {
    event.preventDefault();
    if (!isEditMode) return;
    const text = newBlockText.trim();
    if (!text) return;
    setState((current) => createBlock(current, thread.id, text, createId("block")));
    setNewBlockText("");
    setBlockWarning(null);
  };

  const startEditBlock = (block: Block) => {
    if (!isEditMode) return;
    setEditingBlockId(block.id);
    setEditingText(block.text);
    setBlockWarning(null);
  };

  const saveBlockEdit = (blockId: string) => {
    if (!isEditMode) return;
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
    if (!isEditMode) return;
    applyMutationResult(moveBlockInThread(state, blockId, direction));
  };

  const tieStrict = (
    blockId: string,
    position: TiePosition,
    targetBlockId: string,
  ) => {
    if (!isEditMode) return;
    applyMutationResult(setStrictTie(state, blockId, position, targetBlockId));
  };

  const untieStrict = (blockId: string, position: TiePosition) => {
    if (!isEditMode) return;
    setState((current) => clearStrictTie(current, blockId, position));
    setBlockWarning(null);
  };

  const openLinkDialog = (sourceBlockId: string) => {
    if (!isEditMode) return;
    setLinkDialog({ sourceBlockId });
    setLinkSearch("");
    setBlockWarning(null);
  };

  const createCallbackLink = (sourceBlockId: string, targetBlockId: string) => {
    if (!isEditMode) return;
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
    if (!isEditMode) return;
    setState((current) => deleteCrossThreadLooseTie(current, tieId));
    setBlockWarning(null);
  };

  const requestDeleteThread = (thread: Thread) => {
    if (!isEditMode) return;
    const dialog = createThreadDeleteDialogState(state, thread);
    if (
      dialog.type === "thread"
      && dialog.blockCount === 0
      && dialog.callbackLinkCount === 0
      && dialog.strictTieCount === 0
    ) {
      setState((current) => deleteThread(current, thread.id));
      if (expandedThreadId === thread.id) setExpandedThreadId(null);
      if (editingTitle?.type === "thread" && editingTitle.id === thread.id) clearTitleEdit();
      setTitleWarning(null);
      setBlockWarning(null);
      return;
    }
    setDeleteDialog(dialog);
  };

  const requestDeleteBlock = (block: Block) => {
    if (!isEditMode) return;
    setDeleteDialog(createBlockDeleteDialogState(state, block));
  };

  const confirmDelete = () => {
    if (!deleteDialog) return;
    if (deleteDialog.type === "thread") {
      const threadId = deleteDialog.threadId;
      setState((current) => deleteThread(current, threadId));
      if (expandedThreadId === threadId) setExpandedThreadId(null);
      clearEditState();
    } else {
      const blockId = deleteDialog.blockId;
      setState((current) => deleteBlock(current, blockId));
      if (editingBlockId === blockId) {
        setEditingBlockId(null);
        setEditingText("");
      }
      setLinkDialog(null);
      setLinkSearch("");
      setDeleteDialog(null);
    }
    setTitleWarning(null);
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
      <div className="threadsChromeMask" aria-hidden="true" />
      <header className="threadsTopBar windowNoDrag">
        <div className="threadsTopBarPrimary">
          {view.level !== "categories" ? (
            <button
              type="button"
              className="agentTopBarButton threadsBackButton windowNoDrag"
              onClick={goBack}
            >
              Back
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
        </div>

        <div className="threadsTopBarActions">
          {view.level === "threads" ? (
            <button
              type="button"
              className="projectBrowseSortBadge projectBrowseBadgeClickable threadsSortButton"
              onClick={cycleThreadSortMode}
            >
              Sort: {formatThreadSortMode(threadSortMode)}
            </button>
          ) : null}

          {view.level === "projects" ? (
            <button
              type="button"
              className="agentTopBarButton threadsAddButton windowNoDrag"
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
              className={`agentTopBarButton threadsModeButton windowNoDrag${isEditMode ? " active" : ""}`}
              aria-pressed={isEditMode}
              onClick={toggleEditMode}
            >
              {isEditMode ? "View" : "Edit"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="chatViewportDivider pageChromeDivider threadsPageDivider" aria-hidden="true" />

      {titleWarning ? (
        <div className="threadsTitleWarning">{titleWarning}</div>
      ) : null}

      {view.level === "categories" ? (
        <CategoryList onOpenCategory={openCategory} />
      ) : null}

      {view.level === "projects" && selectedCategory ? (
        <ProjectList
          state={state}
          projects={projects}
          categoryId={selectedCategory.id}
          editingTitle={editingTitle}
          editingTitleText={editingTitleText}
          onOpenProject={openProject}
          onStartEditTitle={startEditTitle}
          onEditingTitleTextChange={setEditingTitleText}
          onSaveTitleEdit={saveTitleEdit}
          onCancelTitleEdit={cancelTitleEdit}
        />
      ) : null}

      {view.level === "threads" && selectedProject ? (
        <ThreadList
          state={state}
          threads={sortedThreads}
          sortMode={threadSortMode}
          isEditMode={isEditMode}
          isAddingThread={isAddingThread}
          expandedThreadId={expandedThreadId}
          newThreadName={newThreadName}
          newBlockText={newBlockText}
          editingTitle={editingTitle}
          editingTitleText={editingTitleText}
          editingBlockId={editingBlockId}
          editingText={editingText}
          blockWarning={blockWarning}
          highlightedBlockId={highlightedBlockId}
          onStartEditTitle={startEditTitle}
          onEditingTitleTextChange={setEditingTitleText}
          onSaveTitleEdit={saveTitleEdit}
          onCancelTitleEdit={cancelTitleEdit}
          onStartAddingThread={startAddingThread}
          onNewThreadNameChange={setNewThreadName}
          onSaveInlineThread={saveInlineThread}
          onCancelInlineThread={cancelInlineThread}
          onNewBlockTextChange={setNewBlockText}
          onEditingTextChange={setEditingText}
          onToggleThread={toggleThread}
          onMoveThread={moveThread}
          onSubmitBlock={submitBlock}
          onStartEditBlock={startEditBlock}
          onSaveBlockEdit={saveBlockEdit}
          onCancelBlockEdit={cancelBlockEdit}
          onMoveBlock={moveBlock}
          onSetStrictTie={tieStrict}
          onClearStrictTie={untieStrict}
          onOpenLinkDialog={openLinkDialog}
          onDeleteCrossThreadLooseTie={removeCallbackLink}
          onRequestDeleteThread={requestDeleteThread}
          onRequestDeleteBlock={requestDeleteBlock}
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

      {isEditMode && linkDialog ? (
        <CrossThreadLinkDialog
          state={state}
          sourceBlockId={linkDialog.sourceBlockId}
          search={linkSearch}
          onSearchChange={setLinkSearch}
          onClose={() => setLinkDialog(null)}
          onCreateLink={createCallbackLink}
        />
      ) : null}

      {deleteDialog ? (
        <DeleteConfirmationDialog
          dialog={deleteDialog}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={confirmDelete}
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

function InlineEditableName({
  value,
  editValue,
  isEditing,
  canEdit = true,
  ariaLabel,
  onStartEdit,
  onValueChange,
  onSave,
  onCancel,
}: {
  value: string;
  editValue: string;
  isEditing: boolean;
  canEdit?: boolean;
  ariaLabel: string;
  onStartEdit: () => void;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const stopRowClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  if (isEditing) {
    return (
      <form
        className="threadsInlineEdit"
        onClick={stopRowClick}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <input
          autoFocus
          value={editValue}
          aria-label={ariaLabel}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onSave}
        />
        <div className="threadsInlineEditActions">
          <button
            type="button"
            className="threadsIconButton"
            aria-label={`Save ${ariaLabel}`}
            disabled={!editValue.trim()}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSave();
            }}
          >
            <CheckIcon />
          </button>
          <button
            type="button"
            className="threadsIconButton"
            aria-label={`Cancel ${ariaLabel} edit`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
          >
            <XIcon />
          </button>
        </div>
      </form>
    );
  }

  if (!canEdit) {
    return <span className="threadsRowName">{value}</span>;
  }

  return (
    <button
      type="button"
      className="threadsRowName threadsEditableName"
      aria-label={`Edit ${ariaLabel}`}
      onClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
    >
      {value}
    </button>
  );
}

function ProjectList({
  state,
  projects,
  categoryId,
  editingTitle,
  editingTitleText,
  onOpenProject,
  onStartEditTitle,
  onEditingTitleTextChange,
  onSaveTitleEdit,
  onCancelTitleEdit,
}: {
  state: ThreadsState;
  projects: Project[];
  categoryId: CreativeCategoryId;
  editingTitle: TitleEditTarget;
  editingTitleText: string;
  onOpenProject: (project: Project) => void;
  onStartEditTitle: (target: Exclude<TitleEditTarget, null>, currentName: string) => void;
  onEditingTitleTextChange: (text: string) => void;
  onSaveTitleEdit: () => void;
  onCancelTitleEdit: () => void;
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
        <article
          key={project.id}
          className="threadsRow threadsRowClickable"
          style={categoryStyle(category.color)}
          role="button"
          tabIndex={0}
          onClick={() => onOpenProject(project)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenProject(project);
            }
          }}
        >
          <InlineEditableName
            value={project.name}
            editValue={editingTitle?.type === "project" && editingTitle.id === project.id
              ? editingTitleText
              : ""}
            isEditing={editingTitle?.type === "project" && editingTitle.id === project.id}
            ariaLabel="Project name"
            onStartEdit={() => onStartEditTitle({ type: "project", id: project.id }, project.name)}
            onValueChange={onEditingTitleTextChange}
            onSave={onSaveTitleEdit}
            onCancel={onCancelTitleEdit}
          />
          <button
            type="button"
            className="threadsRowCountButton"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProject(project);
            }}
          >
            {formatCount(countProjectThreads(state, project.id), "Thread")}
          </button>
        </article>
      ))}
    </div>
  );
}

function InlineAddThreadRow({
  isAdding,
  value,
  onStart,
  onValueChange,
  onSave,
  onCancel,
}: {
  isAdding: boolean;
  value: string;
  onStart: () => void;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  if (!isAdding) {
    return (
      <section className="threadsThreadGroup threadsAddThreadGroup">
        <button
          type="button"
          className="threadsRow threadsRowClickable threadsAddThreadRow"
          onClick={onStart}
        >
          <span className="threadsRowName">Add Thread</span>
        </button>
      </section>
    );
  }

  return (
    <section className="threadsThreadGroup threadsAddThreadGroup">
      <form
        className="threadsRow threadsInlineAddThreadForm"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <input
          autoFocus
          value={value}
          aria-label="New Thread name"
          placeholder="Thread name"
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="threadsInlineEditActions">
          <button
            type="submit"
            className="threadsIconButton"
            aria-label="Create Thread"
            disabled={!value.trim()}
          >
            <CheckIcon />
          </button>
          <button
            type="button"
            className="threadsIconButton"
            aria-label="Cancel new Thread"
            onClick={onCancel}
          >
            <XIcon />
          </button>
        </div>
      </form>
    </section>
  );
}

function ThreadList({
  state,
  threads,
  sortMode,
  isEditMode,
  isAddingThread,
  expandedThreadId,
  newThreadName,
  newBlockText,
  editingTitle,
  editingTitleText,
  editingBlockId,
  editingText,
  blockWarning,
  highlightedBlockId,
  onStartEditTitle,
  onEditingTitleTextChange,
  onSaveTitleEdit,
  onCancelTitleEdit,
  onStartAddingThread,
  onNewThreadNameChange,
  onSaveInlineThread,
  onCancelInlineThread,
  onNewBlockTextChange,
  onEditingTextChange,
  onToggleThread,
  onMoveThread,
  onSubmitBlock,
  onStartEditBlock,
  onSaveBlockEdit,
  onCancelBlockEdit,
  onMoveBlock,
  onSetStrictTie,
  onClearStrictTie,
  onOpenLinkDialog,
  onDeleteCrossThreadLooseTie,
  onRequestDeleteThread,
  onRequestDeleteBlock,
  onJumpToBlock,
}: {
  state: ThreadsState;
  threads: Thread[];
  sortMode: ThreadSortMode;
  isEditMode: boolean;
  isAddingThread: boolean;
  expandedThreadId: string | null;
  newThreadName: string;
  newBlockText: string;
  editingTitle: TitleEditTarget;
  editingTitleText: string;
  editingBlockId: string | null;
  editingText: string;
  blockWarning: string | null;
  highlightedBlockId: string | null;
  onStartEditTitle: (target: Exclude<TitleEditTarget, null>, currentName: string) => void;
  onEditingTitleTextChange: (text: string) => void;
  onSaveTitleEdit: () => void;
  onCancelTitleEdit: () => void;
  onStartAddingThread: () => void;
  onNewThreadNameChange: (text: string) => void;
  onSaveInlineThread: () => void;
  onCancelInlineThread: () => void;
  onNewBlockTextChange: (text: string) => void;
  onEditingTextChange: (text: string) => void;
  onToggleThread: (threadId: string) => void;
  onMoveThread: (threadId: string, direction: MoveDirection) => void;
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
  onRequestDeleteThread: (thread: Thread) => void;
  onRequestDeleteBlock: (block: Block) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  return (
    <div className="threadsList" aria-label="Project threads">
      {isEditMode ? (
        <InlineAddThreadRow
          isAdding={isAddingThread}
          value={newThreadName}
          onStart={onStartAddingThread}
          onValueChange={onNewThreadNameChange}
          onSave={onSaveInlineThread}
          onCancel={onCancelInlineThread}
        />
      ) : null}

      {threads.length === 0 ? (
        <div className="threadsEmptyState">No Threads</div>
      ) : threads.map((thread, index) => {
        const isExpanded = expandedThreadId === thread.id;
        const isMuted = Boolean(expandedThreadId) && !isExpanded;
        return (
          <section key={thread.id} className="threadsThreadGroup">
            <div
              className={[
                "threadsRow",
                "threadsRowClickable",
                isExpanded ? "active" : "",
                isMuted ? "muted" : "",
              ].filter(Boolean).join(" ")}
              role="button"
              tabIndex={0}
              onClick={() => onToggleThread(thread.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleThread(thread.id);
                }
              }}
            >
              <InlineEditableName
                value={thread.name}
                editValue={editingTitle?.type === "thread" && editingTitle.id === thread.id
                  ? editingTitleText
                  : ""}
                isEditing={editingTitle?.type === "thread" && editingTitle.id === thread.id}
                canEdit={isEditMode}
                ariaLabel="Thread name"
                onStartEdit={() => onStartEditTitle({ type: "thread", id: thread.id }, thread.name)}
                onValueChange={onEditingTitleTextChange}
                onSave={onSaveTitleEdit}
                onCancel={onCancelTitleEdit}
              />
              <button
                type="button"
                className="threadsRowCountButton"
                aria-expanded={isExpanded}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleThread(thread.id);
                }}
              >
                {formatCount(countThreadBlocks(state, thread.id), "Block")}
              </button>
              {isEditMode ? (
                <div className="threadsRowActions" aria-label="Thread actions">
                  {sortMode === "manual" ? (
                    <>
                      <button
                        type="button"
                        className="threadsIconButton"
                        aria-label="Move Thread up"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveThread(thread.id, "up");
                        }}
                        disabled={index === 0}
                      >
                        <ArrowUpIcon />
                      </button>
                      <button
                        type="button"
                        className="threadsIconButton"
                        aria-label="Move Thread down"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveThread(thread.id, "down");
                        }}
                        disabled={index === threads.length - 1}
                      >
                        <ArrowDownIcon />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="threadsIconButton threadsDeleteButton"
                    aria-label="Delete Thread"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestDeleteThread(thread);
                    }}
                  >
                    <XIcon />
                  </button>
                </div>
              ) : null}
            </div>
            {isExpanded ? (
              <ThreadAccordion
                state={state}
                thread={thread}
                isEditMode={isEditMode}
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
                onRequestDeleteBlock={onRequestDeleteBlock}
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
  isEditMode,
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
  onRequestDeleteBlock,
  onJumpToBlock,
}: {
  state: ThreadsState;
  thread: Thread;
  isEditMode: boolean;
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
  onRequestDeleteBlock: (block: Block) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  const blockIds = getThreadDisplayBlockIds(state, thread.id);
  return (
    <div className="threadsAccordion">
      {isEditMode ? (
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
      ) : null}

      {isEditMode && blockWarning ? (
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
                isEditMode={isEditMode}
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
                onRequestDeleteBlock={onRequestDeleteBlock}
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
  isEditMode,
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
  onRequestDeleteBlock,
  onJumpToBlock,
}: {
  state: ThreadsState;
  block: Block;
  previousBlockId: string | null;
  nextBlockId: string | null;
  isEditMode: boolean;
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
  onRequestDeleteBlock: (block: Block) => void;
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
      {isEditMode ? (
        <StrictTieControl
          label="after"
          block={block}
          targetBlockId={nextBlockId}
          isTied={strictAfter}
          onSetStrictTie={onSetStrictTie}
          onClearStrictTie={onClearStrictTie}
        />
      ) : null}

      <div className="threadsBlockMain">
        {isEditMode && isEditing ? (
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
        ) : isEditMode ? (
          <button
            type="button"
            className="threadsBlockTextButton"
            onClick={() => onStartEditBlock(block)}
          >
            {block.text}
          </button>
        ) : (
          <div className="threadsBlockTextReadOnly">{block.text}</div>
        )}

        {isEditMode ? (
          <div className="threadsBlockMeta">
            <button
              type="button"
              className="threadsMetaButton"
              onClick={() => onOpenLinkDialog(block.id)}
            >
              Link
            </button>
          </div>
        ) : null}

        <CallbackLinks
          state={state}
          outgoingLinks={outgoingLinks}
          incomingLinks={incomingLinks}
          isEditMode={isEditMode}
          onDeleteCrossThreadLooseTie={onDeleteCrossThreadLooseTie}
          onJumpToBlock={onJumpToBlock}
        />
      </div>

      {isEditMode ? (
        <div className="threadsBlockReorder" aria-label="Block actions">
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
          <button
            type="button"
            className="threadsIconButton threadsDeleteButton"
            aria-label="Delete Block"
            onClick={() => onRequestDeleteBlock(block)}
          >
            <XIcon />
          </button>
        </div>
      ) : null}
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
  const actionLabel = isTied
    ? `Cut strict tie ${label}`
    : `Create strict tie ${label}`;
  return (
    <button
      type="button"
      className={[
        "threadsTieButton",
        label,
        isTied ? "tied" : "candidate",
      ].join(" ")}
      aria-label={actionLabel}
      onClick={() => {
        if (isTied) {
          onClearStrictTie(block.id, label);
        } else if (targetBlockId) {
          onSetStrictTie(block.id, label, targetBlockId);
        }
      }}
    >
      <span className="threadsTieGlyph" aria-hidden="true" />
      <span className="threadsTieCut" aria-hidden="true">
        <XIcon />
      </span>
    </button>
  );
}

function CallbackLinks({
  state,
  outgoingLinks,
  incomingLinks,
  isEditMode,
  onDeleteCrossThreadLooseTie,
  onJumpToBlock,
}: {
  state: ThreadsState;
  outgoingLinks: CrossThreadLooseTie[];
  incomingLinks: CrossThreadLooseTie[];
  isEditMode: boolean;
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
            {isEditMode ? (
              <button
                type="button"
                aria-label="Remove callback link"
                onClick={() => onDeleteCrossThreadLooseTie(tie.id)}
              >
                <XIcon />
              </button>
            ) : null}
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
            {isEditMode ? (
              <button
                type="button"
                aria-label="Remove callback link"
                onClick={() => onDeleteCrossThreadLooseTie(tie.id)}
              >
                <XIcon />
              </button>
            ) : null}
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

function DeleteConfirmationDialog({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: Exclude<DeleteDialogState, null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const impactItems = dialog.type === "thread"
    ? [
      `${formatCount(dialog.blockCount, "Block")} will be deleted`,
      dialog.callbackLinkCount > 0
        ? `${formatCount(dialog.callbackLinkCount, "callback link")} will be removed`
        : null,
      dialog.strictTieCount > 0
        ? `${formatCount(dialog.strictTieCount, "strict tie")} will be cleared`
        : null,
    ].filter((item): item is string => Boolean(item))
    : [
      "1 Block will be deleted",
      dialog.callbackLinkCount > 0
        ? `${formatCount(dialog.callbackLinkCount, "callback link")} will be removed`
        : null,
      dialog.strictTieCount > 0
        ? `${formatCount(dialog.strictTieCount, "strict tie")} will be cleared`
        : null,
    ].filter((item): item is string => Boolean(item));

  return (
    <Modal
      title={dialog.type === "thread" ? "Delete Thread" : "Delete Block"}
      onClose={onCancel}
      compact
    >
      <div className="threadsConfirmDelete">
        <div className="dangerCard">
          <strong>
            {dialog.type === "thread"
              ? `Delete "${dialog.name}"?`
              : "Delete this Block?"}
          </strong>
          <p>
            {dialog.type === "thread"
              ? "This removes the Thread and its saved content."
              : truncateBlockText(dialog.text)}
          </p>
        </div>
        <ul className="threadsDeleteImpactList">
          {impactItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="threadsDeleteWarning">This cannot be undone.</p>
        <div className="modalActions">
          <button type="button" className="secondaryButton" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="secondaryButton dangerButton" onClick={onConfirm}>
            Delete
          </button>
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
