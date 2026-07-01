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
  LEGACY_THREADS_V4_STORAGE_KEY,
  LEGACY_THREADS_V3_STORAGE_KEY,
  LEGACY_THREADS_V2_STORAGE_KEY,
  SCRIPT_ELEMENT_TYPES,
  THREADS_STORAGE_KEY,
  addExistingBlockPlacement,
  addLinearBlankEntry,
  addLinearBlockPlacementEntry,
  addLinearSegmentEntry,
  addScriptElement,
  clearStrictTie,
  countBlockPlacements,
  countProjectThreads,
  countThreadBlocks,
  createBlock,
  createBlockFromScriptElement,
  createCrossThreadLooseTie,
  createProject,
  createThread,
  deleteBlockEverywhere,
  deleteCrossThreadLooseTie,
  deleteThread,
  getCategoryProjects,
  getBlockPlacementIds,
  getIncomingCrossThreadLooseTies,
  getLinearOutline,
  getOutgoingCrossThreadLooseTies,
  getProjectLinearSequenceEntries,
  getProjectScriptElements,
  getProjectThreads,
  getThreadDisplayPlacementIds,
  isLinearEntryCollapsed,
  linkScriptElementToEntry,
  migrateLegacyThreadsState,
  moveLinearEntry,
  moveBlockInThread,
  moveScriptElement,
  moveThreadInProject,
  parseThreadsState,
  removeLinearEntry,
  removeBlockPlacement,
  removeScriptElement,
  setStrictTie,
  unlinkScriptElement,
  updateLinearBlankEntryNote,
  updateLinearSegmentEntryTier,
  updateLinearSegmentEntryTitle,
  updateProject,
  updateBlockText,
  updateScriptElementText,
  updateScriptElementType,
  updateThread,
  type Block,
  type BlockPlacement,
  type CrossThreadLooseTie,
  type LinearOutline,
  type LinearOutlineNode,
  type LinearSegmentTier,
  type LinearSequenceEntry,
  type MoveDirection,
  type Project,
  type ScriptElement,
  type ScriptElementType,
  type Thread,
  type ThreadsMutationResult,
  type ThreadsState,
  type TiePosition,
} from "../lib/threads-store";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, XIcon } from "./icons";
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
type ProjectScreenMode = "threads" | "linear" | "script";
type ThreadsDisplayMode = "list" | "cards";
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
    orphanedBlockCount: number;
    callbackLinkCount: number;
    strictTieCount: number;
  }
  | {
    type: "placement";
    placementId: string;
    blockId: string;
    text: string;
    isFinalPlacement: boolean;
    callbackLinkCount: number;
    strictTieCount: number;
  }
  | {
    type: "block";
    blockId: string;
    text: string;
    placementCount: number;
    callbackLinkCount: number;
    strictTieCount: number;
  }
  | null;

interface BlockLocation {
  block: Block;
  placement: BlockPlacement;
  thread: Thread;
  project: Project;
}

const THREAD_SORT_STORAGE_KEY = "programs.threads.sortMode";
const THREAD_DISPLAY_MODE_STORAGE_KEY = "programs.threads.displayMode";
const THREAD_SORT_MODES: ThreadSortMode[] = ["manual", "name", "quantity"];

const createId = (prefix: "project" | "thread" | "block" | "placement" | "cross-link" | "linear-entry" | "script-element"): string =>
  typeof crypto.randomUUID === "function"
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const categoryStyle = (color: string): CSSProperties =>
  ({ "--threads-category": color }) as CSSProperties;

const cardStyle = (categoryColor: string, cardColor: string): CSSProperties =>
  ({
    "--threads-category": categoryColor,
    "--threads-card": cardColor,
  }) as CSSProperties;

const formatCount = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

const truncateBlockText = (text: string): string =>
  text.length > 52 ? `${text.slice(0, 49)}...` : text;

const isThreadSortMode = (value: string | null): value is ThreadSortMode =>
  value === "manual" || value === "name" || value === "quantity";

const isThreadsDisplayMode = (value: string | null): value is ThreadsDisplayMode =>
  value === "list" || value === "cards";

const getCardColor = (seed: string, index: number): string => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = (Math.abs(hash) + index * 137) % 360;
  return `hsl(${hue} 62% 56%)`;
};

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
      localStorage.getItem(LEGACY_THREADS_V4_STORAGE_KEY),
      localStorage.getItem(LEGACY_THREADS_V3_STORAGE_KEY),
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

const loadThreadsDisplayMode = (): ThreadsDisplayMode => {
  try {
    const stored = localStorage.getItem(THREAD_DISPLAY_MODE_STORAGE_KEY);
    return isThreadsDisplayMode(stored) ? stored : "list";
  } catch {
    return "list";
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

const saveThreadsDisplayMode = (mode: ThreadsDisplayMode): void => {
  try {
    localStorage.setItem(THREAD_DISPLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // Display mode remains usable in-memory if renderer storage is unavailable.
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

const getThreadPlacementIdSet = (state: ThreadsState, threadId: string): Set<string> =>
  new Set(
    Object.values(state.blockPlacements)
      .filter((placement) => placement.threadId === threadId)
      .map((placement) => placement.id),
  );

const getDeletedBlockIdsAfterRemovingPlacements = (
  state: ThreadsState,
  deletedPlacementIds: Set<string>,
): Set<string> => {
  const remainingBlockIds = new Set(
    Object.values(state.blockPlacements)
      .filter((placement) => !deletedPlacementIds.has(placement.id))
      .map((placement) => placement.blockId),
  );
  return new Set(
    Object.keys(state.blocks).filter((blockId) => !remainingBlockIds.has(blockId)),
  );
};

const countAffectedCallbackLinks = (
  state: ThreadsState,
  deletedBlockIds: Set<string>,
): number =>
  state.crossThreadLooseTieOrder.filter((tieId) => {
    const tie = state.crossThreadLooseTies[tieId];
    return Boolean(tie)
      && (deletedBlockIds.has(tie.sourceBlockId) || deletedBlockIds.has(tie.targetBlockId));
  }).length;

const countAffectedPlacementStrictTies = (
  state: ThreadsState,
  deletedPlacementIds: Set<string>,
): number => {
  const affectedPairs = new Set<string>();
  for (const placementId of deletedPlacementIds) {
    const placement = state.blockPlacements[placementId];
    if (!placement) continue;
    for (const targetPlacementId of [placement.strictTies.before, placement.strictTies.after]) {
      if (!targetPlacementId || !state.blockPlacements[targetPlacementId]) continue;
      const pair = [placementId, targetPlacementId].sort().join(":");
      affectedPairs.add(pair);
    }
  }
  return affectedPairs.size;
};

const createThreadDeleteDialogState = (
  state: ThreadsState,
  thread: Thread,
): Exclude<DeleteDialogState, null> => {
  const deletedPlacementIds = getThreadPlacementIdSet(state, thread.id);
  const deletedBlockIds = getDeletedBlockIdsAfterRemovingPlacements(state, deletedPlacementIds);
  return {
    type: "thread",
    threadId: thread.id,
    name: thread.name,
    blockCount: deletedPlacementIds.size,
    orphanedBlockCount: deletedBlockIds.size,
    callbackLinkCount: countAffectedCallbackLinks(state, deletedBlockIds),
    strictTieCount: countAffectedPlacementStrictTies(state, deletedPlacementIds),
  };
};

const createPlacementDeleteDialogState = (
  state: ThreadsState,
  placement: BlockPlacement,
): Exclude<DeleteDialogState, null> => {
  const block = state.blocks[placement.blockId];
  const deletedPlacementIds = new Set([placement.id]);
  const deletedBlockIds = getDeletedBlockIdsAfterRemovingPlacements(state, deletedPlacementIds);
  return {
    type: "placement",
    placementId: placement.id,
    blockId: placement.blockId,
    text: block?.text ?? "Missing Block",
    isFinalPlacement: deletedBlockIds.has(placement.blockId),
    callbackLinkCount: countAffectedCallbackLinks(state, deletedBlockIds),
    strictTieCount: countAffectedPlacementStrictTies(state, deletedPlacementIds),
  };
};

const createBlockDeleteEverywhereDialogState = (
  state: ThreadsState,
  block: Block,
): Exclude<DeleteDialogState, null> => {
  const deletedPlacementIds = new Set(getBlockPlacementIds(state, block.id));
  const deletedBlockIds = new Set([block.id]);
  return {
    type: "block",
    blockId: block.id,
    text: block.text,
    placementCount: deletedPlacementIds.size,
    callbackLinkCount: countAffectedCallbackLinks(state, deletedBlockIds),
    strictTieCount: countAffectedPlacementStrictTies(state, deletedPlacementIds),
  };
};

const getBlockLocations = (
  state: ThreadsState,
  blockId: string,
): BlockLocation[] => {
  const block = state.blocks[blockId];
  if (!block) return [];
  return state.blockPlacementOrder
    .map((placementId) => state.blockPlacements[placementId])
    .filter((placement): placement is BlockPlacement =>
      Boolean(placement) && placement.blockId === blockId,
    )
    .map((placement) => {
      const thread = state.threads[placement.threadId] ?? null;
      const project = thread ? state.projects[thread.projectId] ?? null : null;
      return thread && project ? { block, placement, thread, project } : null;
    })
    .filter((location): location is BlockLocation => Boolean(location));
};

const getBlockPathSummary = (state: ThreadsState, blockId: string): string => {
  const paths = getBlockLocations(state, blockId).map((location) => {
    const category = getCreativeCategory(location.project.categoryId);
    return `${category.label} / ${location.project.name} / ${location.thread.name}`;
  });
  if (paths.length === 0) return "Missing block";
  if (paths.length === 1) return paths[0];
  return `${paths[0]} (+${paths.length - 1} more)`;
};

const getOtherPlacementTitle = (
  state: ThreadsState,
  blockId: string,
  placementId: string,
): string | undefined => {
  const paths = getBlockLocations(state, blockId)
    .filter((location) => location.placement.id !== placementId)
    .map((location) => {
      const category = getCreativeCategory(location.project.categoryId);
      return `${category.label} / ${location.project.name} / ${location.thread.name}`;
    });
  return paths.length > 0 ? `Also in ${paths.join("; ")}` : undefined;
};

export function ThreadsPage() {
  const [state, setState] = useState<ThreadsState>(loadState);
  const [view, setView] = useState<ThreadsView>({ level: "categories" });
  const [projectScreenMode, setProjectScreenMode] = useState<ProjectScreenMode>("threads");
  const [threadSortMode, setThreadSortMode] = useState<ThreadSortMode>(loadThreadSortMode);
  const [displayMode, setDisplayMode] = useState<ThreadsDisplayMode>(loadThreadsDisplayMode);
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
  const [editingLinearBlankId, setEditingLinearBlankId] = useState<string | null>(null);
  const [editingLinearNote, setEditingLinearNote] = useState("");
  const [editingLinearSegmentId, setEditingLinearSegmentId] = useState<string | null>(null);
  const [editingLinearSegmentTitle, setEditingLinearSegmentTitle] = useState("");
  const [editingLinearSegmentTier, setEditingLinearSegmentTier] = useState<LinearSegmentTier | undefined>(undefined);
  const [blockWarning, setBlockWarning] = useState<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);

  useEffect(() => saveState(state), [state]);
  useEffect(() => saveThreadSortMode(threadSortMode), [threadSortMode]);
  useEffect(() => saveThreadsDisplayMode(displayMode), [displayMode]);

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
      setEditingLinearBlankId(null);
      setEditingLinearNote("");
      setEditingLinearSegmentId(null);
      setEditingLinearSegmentTitle("");
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

  useEffect(() => {
    if (!editingLinearBlankId || state.linearSequenceEntries[editingLinearBlankId]?.type === "blank") {
      return;
    }
    setEditingLinearBlankId(null);
    setEditingLinearNote("");
  }, [editingLinearBlankId, state.linearSequenceEntries]);

  useEffect(() => {
    if (!editingLinearSegmentId || state.linearSequenceEntries[editingLinearSegmentId]?.type === "segment") {
      return;
    }
    setEditingLinearSegmentId(null);
    setEditingLinearSegmentTitle("");
    setEditingLinearSegmentTier(undefined);
  }, [editingLinearSegmentId, state.linearSequenceEntries]);

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
    setEditingLinearBlankId(null);
    setEditingLinearNote("");
    setEditingLinearSegmentId(null);
    setEditingLinearSegmentTitle("");
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
    setProjectScreenMode("threads");
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
    setProjectScreenMode("threads");
    setTitleWarning(null);
    setBlockWarning(null);
    setView({ level: "projects", categoryId });
  };

  const openProject = (project: Project) => {
    setExpandedThreadId(null);
    clearEditState();
    setIsEditMode(false);
    setProjectScreenMode("threads");
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
    setEditingLinearBlankId(null);
    setEditingLinearNote("");
    setEditingLinearSegmentId(null);
    setEditingLinearSegmentTitle("");
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
    setState((current) => createBlock(current, thread.id, text, createId("block"), createId("placement")));
    setNewBlockText("");
    setBlockWarning(null);
  };

  const addExistingBlockToThread = (thread: Thread, blockId: string) => {
    if (!isEditMode) return;
    const result = addExistingBlockPlacement(
      state,
      thread.id,
      blockId,
      createId("placement"),
    );
    applyMutationResult(result);
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

  const moveBlock = (placementId: string, direction: MoveDirection) => {
    if (!isEditMode) return;
    applyMutationResult(moveBlockInThread(state, placementId, direction));
  };

  const tieStrict = (
    placementId: string,
    position: TiePosition,
    targetPlacementId: string,
  ) => {
    if (!isEditMode) return;
    applyMutationResult(setStrictTie(state, placementId, position, targetPlacementId));
  };

  const untieStrict = (placementId: string, position: TiePosition) => {
    if (!isEditMode) return;
    setState((current) => clearStrictTie(current, placementId, position));
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

  const setProjectMode = (mode: ProjectScreenMode) => {
    if (projectScreenMode === mode) return;
    setProjectScreenMode(mode);
    setExpandedThreadId(null);
    setIsAddingThread(false);
    setNewThreadName("");
    setNewBlockText("");
    setEditingBlockId(null);
    setEditingText("");
    setEditingLinearBlankId(null);
    setEditingLinearNote("");
    setEditingLinearSegmentId(null);
    setEditingLinearSegmentTitle("");
    setLinkDialog(null);
    setLinkSearch("");
    setBlockWarning(null);
    setTitleWarning(null);
  };

  const addLinearPlacementToProject = (projectId: string, placementId: string) => {
    if (!isEditMode) return;
    applyMutationResult(addLinearBlockPlacementEntry(
      state,
      projectId,
      placementId,
      createId("linear-entry"),
    ));
  };

  const addLinearBlankToProject = (projectId: string, note: string) => {
    if (!isEditMode) return;
    applyMutationResult(addLinearBlankEntry(
      state,
      projectId,
      note,
      createId("linear-entry"),
    ));
  };

  const addLinearSegmentToProject = (projectId: string, title: string, tier?: LinearSegmentTier) => {
    if (!isEditMode) return;
    applyMutationResult(addLinearSegmentEntry(
      state,
      projectId,
      title,
      createId("linear-entry"),
      tier,
    ));
  };

  const startEditLinearBlank = (entry: Extract<LinearSequenceEntry, { type: "blank" }>) => {
    if (!isEditMode) return;
    setEditingLinearBlankId(entry.id);
    setEditingLinearNote(entry.note);
    setBlockWarning(null);
  };

  const saveLinearBlankNote = (entryId: string) => {
    if (!isEditMode) return;
    setState((current) => updateLinearBlankEntryNote(current, entryId, editingLinearNote));
    setEditingLinearBlankId(null);
    setEditingLinearNote("");
    setBlockWarning(null);
  };

  const cancelLinearBlankEdit = () => {
    setEditingLinearBlankId(null);
    setEditingLinearNote("");
    setBlockWarning(null);
  };

  const startEditLinearSegment = (entry: Extract<LinearSequenceEntry, { type: "segment" }>) => {
    if (!isEditMode) return;
    setEditingLinearSegmentId(entry.id);
    setEditingLinearSegmentTitle(entry.title);
    setEditingLinearSegmentTier(entry.tier);
    setBlockWarning(null);
  };

  const saveLinearSegmentTitle = (entryId: string) => {
    if (!isEditMode) return;
    setState((current) => {
      const withTitle = updateLinearSegmentEntryTitle(current, entryId, editingLinearSegmentTitle);
      return updateLinearSegmentEntryTier(withTitle, entryId, editingLinearSegmentTier ?? null);
    });
    setEditingLinearSegmentId(null);
    setEditingLinearSegmentTitle("");
    setEditingLinearSegmentTier(undefined);
    setBlockWarning(null);
  };

  const cancelLinearSegmentEdit = () => {
    setEditingLinearSegmentId(null);
    setEditingLinearSegmentTitle("");
    setEditingLinearSegmentTier(undefined);
    setBlockWarning(null);
  };

  const moveLinearSequenceEntry = (entryId: string, direction: MoveDirection) => {
    if (!isEditMode) return;
    applyMutationResult(moveLinearEntry(state, entryId, direction));
  };

  const removeLinearSequenceEntry = (entryId: string) => {
    if (!isEditMode) return;
    setState((current) => removeLinearEntry(current, entryId));
    if (editingLinearBlankId === entryId) {
      setEditingLinearBlankId(null);
      setEditingLinearNote("");
    }
    if (editingLinearSegmentId === entryId) {
      setEditingLinearSegmentId(null);
      setEditingLinearSegmentTitle("");
      setEditingLinearSegmentTier(undefined);
    }
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

  const requestRemovePlacement = (placement: BlockPlacement) => {
    if (!isEditMode) return;
    setDeleteDialog(createPlacementDeleteDialogState(state, placement));
  };

  const requestDeleteBlockEverywhere = (block: Block) => {
    if (!isEditMode) return;
    setDeleteDialog(createBlockDeleteEverywhereDialogState(state, block));
  };

  const confirmDelete = () => {
    if (!deleteDialog) return;
    if (deleteDialog.type === "thread") {
      const threadId = deleteDialog.threadId;
      setState((current) => deleteThread(current, threadId));
      if (expandedThreadId === threadId) setExpandedThreadId(null);
      clearEditState();
    } else if (deleteDialog.type === "placement") {
      const { placementId, blockId } = deleteDialog;
      setState((current) => removeBlockPlacement(current, placementId));
      if (editingBlockId === blockId) {
        setEditingBlockId(null);
        setEditingText("");
      }
      setLinkDialog(null);
      setLinkSearch("");
      setDeleteDialog(null);
    } else {
      const blockId = deleteDialog.blockId;
      setState((current) => deleteBlockEverywhere(current, blockId));
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
    const location = getBlockLocations(state, blockId)[0] ?? null;
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
                  : projectScreenMode === "linear"
                    ? "Linear View"
                    : projectScreenMode === "script"
                      ? "Script"
                      : "Threads"}
            </h1>
          </div>
        </div>

        <div className="threadsTopBarActions">
          {view.level === "threads" ? (
            <div className="threadsProjectModeTabs" role="tablist" aria-label="Project view">
              <button
                type="button"
                className={projectScreenMode === "threads" ? "active" : ""}
                aria-pressed={projectScreenMode === "threads"}
                onClick={() => setProjectMode("threads")}
              >
                Threads
              </button>
              <button
                type="button"
                className={projectScreenMode === "linear" ? "active" : ""}
                aria-pressed={projectScreenMode === "linear"}
                onClick={() => setProjectMode("linear")}
              >
                Linear View
              </button>
              <button
                type="button"
                className={projectScreenMode === "script" ? "active" : ""}
                aria-pressed={projectScreenMode === "script"}
                onClick={() => setProjectMode("script")}
              >
                Script
              </button>
            </div>
          ) : null}

          {view.level === "threads" && projectScreenMode === "threads" ? (
            <button
              type="button"
              className="projectBrowseSortBadge projectBrowseBadgeClickable threadsSortButton"
              onClick={cycleThreadSortMode}
            >
              Sort: {formatThreadSortMode(threadSortMode)}
            </button>
          ) : null}

          {view.level !== "threads" || projectScreenMode === "threads" ? (
            <div className="threadsDisplayModeTabs" role="tablist" aria-label="Threads display mode">
              <button
                type="button"
                className={displayMode === "list" ? "active" : ""}
                aria-pressed={displayMode === "list"}
                onClick={() => setDisplayMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={displayMode === "cards" ? "active" : ""}
                aria-pressed={displayMode === "cards"}
                onClick={() => setDisplayMode("cards")}
              >
                Cards
              </button>
            </div>
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
        <CategoryList
          state={state}
          displayMode={displayMode}
          onOpenCategory={openCategory}
        />
      ) : null}

      {view.level === "projects" && selectedCategory ? (
        <ProjectList
          state={state}
          projects={projects}
          categoryId={selectedCategory.id}
          displayMode={displayMode}
          editingTitle={editingTitle}
          editingTitleText={editingTitleText}
          onOpenProject={openProject}
          onStartEditTitle={startEditTitle}
          onEditingTitleTextChange={setEditingTitleText}
          onSaveTitleEdit={saveTitleEdit}
          onCancelTitleEdit={cancelTitleEdit}
        />
      ) : null}

      {view.level === "threads" && selectedProject && projectScreenMode === "threads" ? (
        <ThreadList
          state={state}
          threads={sortedThreads}
          sortMode={threadSortMode}
          displayMode={displayMode}
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
          onAddExistingBlock={addExistingBlockToThread}
          onStartEditBlock={startEditBlock}
          onSaveBlockEdit={saveBlockEdit}
          onCancelBlockEdit={cancelBlockEdit}
          onMoveBlock={moveBlock}
          onSetStrictTie={tieStrict}
          onClearStrictTie={untieStrict}
          onOpenLinkDialog={openLinkDialog}
          onDeleteCrossThreadLooseTie={removeCallbackLink}
          onRequestDeleteThread={requestDeleteThread}
          onRequestRemovePlacement={requestRemovePlacement}
          onRequestDeleteBlockEverywhere={requestDeleteBlockEverywhere}
          onJumpToBlock={jumpToBlock}
        />
      ) : null}

      {view.level === "threads" && selectedProject && projectScreenMode === "linear" ? (
        <LinearView
          state={state}
          project={selectedProject}
          isEditMode={isEditMode}
          blockWarning={blockWarning}
          editingBlankId={editingLinearBlankId}
          editingBlankNote={editingLinearNote}
          editingSegmentId={editingLinearSegmentId}
          editingSegmentTitle={editingLinearSegmentTitle}
          editingSegmentTier={editingLinearSegmentTier}
          onEditingBlankNoteChange={setEditingLinearNote}
          onEditingSegmentTitleChange={setEditingLinearSegmentTitle}
          onEditingSegmentTierChange={setEditingLinearSegmentTier}
          onAddPlacement={addLinearPlacementToProject}
          onAddBlank={addLinearBlankToProject}
          onAddSegment={addLinearSegmentToProject}
          onStartEditBlank={startEditLinearBlank}
          onSaveBlank={saveLinearBlankNote}
          onCancelBlank={cancelLinearBlankEdit}
          onStartEditSegment={startEditLinearSegment}
          onSaveSegment={saveLinearSegmentTitle}
          onCancelSegment={cancelLinearSegmentEdit}
          onMoveEntry={moveLinearSequenceEntry}
          onRemoveEntry={removeLinearSequenceEntry}
        />
      ) : null}

      {view.level === "threads" && selectedProject && projectScreenMode === "script" ? (
        <ScriptView
          state={state}
          project={selectedProject}
          isEditMode={isEditMode}
          onSetState={setState}
          onApplyMutation={applyMutationResult}
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

function CardDots({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span className="threadsCardDots" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </span>
  );
}

function CategoryList({
  state,
  displayMode,
  onOpenCategory,
}: {
  state: ThreadsState;
  displayMode: ThreadsDisplayMode;
  onOpenCategory: (categoryId: CreativeCategoryId) => void;
}) {
  return (
    <div
      className={displayMode === "cards" ? "threadsList threadsCardGrid" : "threadsList"}
      aria-label="Categories"
    >
      {CREATIVE_CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          className={displayMode === "cards" ? "threadsCard threadsCategoryCard" : "threadsRow"}
          style={cardStyle(category.color, category.color)}
          onClick={() => onOpenCategory(category.id)}
        >
          <span className={displayMode === "cards" ? "threadsCardName" : "threadsRowName"}>
            {category.label}
          </span>
          {displayMode === "cards" ? (
            <>
              <CardDots
                count={getCategoryProjects(state, category.id).length}
                label={`${category.label} projects`}
              />
              <span className="threadsCardCount">
                {formatCount(getCategoryProjects(state, category.id).length, "Project")}
              </span>
            </>
          ) : null}
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
  displayMode,
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
  displayMode: ThreadsDisplayMode;
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
    <div
      className={displayMode === "cards" ? "threadsList threadsCardGrid" : "threadsList"}
      aria-label={`${category.label} projects`}
    >
      {projects.map((project, index) => {
        const threadCount = countProjectThreads(state, project.id);
        return (
        <article
          key={project.id}
          className={displayMode === "cards" ? "threadsCard threadsProjectCard" : "threadsRow threadsRowClickable"}
          style={displayMode === "cards"
            ? cardStyle(category.color, getCardColor(project.id || project.name, index))
            : categoryStyle(category.color)}
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
          {displayMode === "cards" ? (
            <>
              <CardDots
                count={threadCount}
                label={`${project.name} threads`}
              />
              <span className="threadsCardCount">{formatCount(threadCount, "Thread")}</span>
            </>
          ) : (
            <button
              type="button"
              className="threadsRowCountButton"
              onClick={(event) => {
                event.stopPropagation();
                onOpenProject(project);
              }}
            >
              {formatCount(threadCount, "Thread")}
            </button>
          )}
        </article>
        );
      })}
    </div>
  );
}

function InlineAddThreadRow({
  isAdding,
  displayMode,
  value,
  onStart,
  onValueChange,
  onSave,
  onCancel,
}: {
  isAdding: boolean;
  displayMode: ThreadsDisplayMode;
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
      <section className={displayMode === "cards"
        ? "threadsThreadGroup threadsAddThreadGroup threadsCardAddGroup"
        : "threadsThreadGroup threadsAddThreadGroup"}
      >
        <button
          type="button"
          className={displayMode === "cards"
            ? "threadsCard threadsAddThreadCard threadsAddThreadRow"
            : "threadsRow threadsRowClickable threadsAddThreadRow"}
          onClick={onStart}
        >
          <span className={displayMode === "cards" ? "threadsCardName" : "threadsRowName"}>
            Add Thread
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className={displayMode === "cards"
      ? "threadsThreadGroup threadsAddThreadGroup threadsCardAddGroup"
      : "threadsThreadGroup threadsAddThreadGroup"}
    >
      <form
        className={displayMode === "cards"
          ? "threadsCard threadsInlineAddThreadForm threadsAddThreadCard"
          : "threadsRow threadsInlineAddThreadForm"}
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
  displayMode,
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
  onAddExistingBlock,
  onStartEditBlock,
  onSaveBlockEdit,
  onCancelBlockEdit,
  onMoveBlock,
  onSetStrictTie,
  onClearStrictTie,
  onOpenLinkDialog,
  onDeleteCrossThreadLooseTie,
  onRequestDeleteThread,
  onRequestRemovePlacement,
  onRequestDeleteBlockEverywhere,
  onJumpToBlock,
}: {
  state: ThreadsState;
  threads: Thread[];
  sortMode: ThreadSortMode;
  displayMode: ThreadsDisplayMode;
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
  onAddExistingBlock: (thread: Thread, blockId: string) => void;
  onStartEditBlock: (block: Block) => void;
  onSaveBlockEdit: (blockId: string) => void;
  onCancelBlockEdit: () => void;
  onMoveBlock: (placementId: string, direction: MoveDirection) => void;
  onSetStrictTie: (
    placementId: string,
    position: TiePosition,
    targetPlacementId: string,
  ) => void;
  onClearStrictTie: (placementId: string, position: TiePosition) => void;
  onOpenLinkDialog: (sourceBlockId: string) => void;
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onRequestDeleteThread: (thread: Thread) => void;
  onRequestRemovePlacement: (placement: BlockPlacement) => void;
  onRequestDeleteBlockEverywhere: (block: Block) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  return (
    <div
      className={displayMode === "cards" ? "threadsList threadsCardGrid threadsThreadCardGrid" : "threadsList"}
      aria-label="Project threads"
    >
      {isEditMode ? (
        <InlineAddThreadRow
          isAdding={isAddingThread}
          displayMode={displayMode}
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
        const blockCount = countThreadBlocks(state, thread.id);
        const threadColor = getCardColor(thread.id || thread.name, index);
        return (
          <section
            key={thread.id}
            className={[
              "threadsThreadGroup",
              displayMode === "cards" ? "threadsThreadCardGroup" : "",
              displayMode === "cards" && isExpanded ? "expanded" : "",
              displayMode === "cards" && isMuted ? "muted" : "",
            ].filter(Boolean).join(" ")}
            style={displayMode === "cards" ? cardStyle(threadColor, threadColor) : undefined}
          >
            <div
              className={[
                displayMode === "cards" ? "threadsCard threadsThreadCard" : "threadsRow",
                displayMode === "cards" ? "" : "threadsRowClickable",
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
              {displayMode === "cards" ? (
                <>
                  <CardDots count={blockCount} label={`${thread.name} Blocks`} />
                  <span className="threadsCardCount">{formatCount(blockCount, "Block")}</span>
                </>
              ) : (
                <button
                  type="button"
                  className="threadsRowCountButton"
                  aria-expanded={isExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleThread(thread.id);
                  }}
                >
                  {formatCount(blockCount, "Block")}
                </button>
              )}
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
                onAddExistingBlock={onAddExistingBlock}
                onStartEditBlock={onStartEditBlock}
                onSaveBlockEdit={onSaveBlockEdit}
                onCancelBlockEdit={onCancelBlockEdit}
                onMoveBlock={onMoveBlock}
                onSetStrictTie={onSetStrictTie}
                onClearStrictTie={onClearStrictTie}
                onOpenLinkDialog={onOpenLinkDialog}
                onDeleteCrossThreadLooseTie={onDeleteCrossThreadLooseTie}
                onRequestRemovePlacement={onRequestRemovePlacement}
                onRequestDeleteBlockEverywhere={onRequestDeleteBlockEverywhere}
                onJumpToBlock={onJumpToBlock}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function LinearView({
  state,
  project,
  isEditMode,
  blockWarning,
  editingBlankId,
  editingBlankNote,
  editingSegmentId,
  editingSegmentTitle,
  editingSegmentTier,
  onEditingBlankNoteChange,
  onEditingSegmentTitleChange,
  onEditingSegmentTierChange,
  onAddPlacement,
  onAddBlank,
  onAddSegment,
  onStartEditBlank,
  onSaveBlank,
  onCancelBlank,
  onStartEditSegment,
  onSaveSegment,
  onCancelSegment,
  onMoveEntry,
  onRemoveEntry,
}: {
  state: ThreadsState;
  project: Project;
  isEditMode: boolean;
  blockWarning: string | null;
  editingBlankId: string | null;
  editingBlankNote: string;
  editingSegmentId: string | null;
  editingSegmentTitle: string;
  editingSegmentTier: LinearSegmentTier | undefined;
  onEditingBlankNoteChange: (note: string) => void;
  onEditingSegmentTitleChange: (title: string) => void;
  onEditingSegmentTierChange: (tier: LinearSegmentTier | undefined) => void;
  onAddPlacement: (projectId: string, placementId: string) => void;
  onAddBlank: (projectId: string, note: string) => void;
  onAddSegment: (projectId: string, title: string, tier?: LinearSegmentTier) => void;
  onStartEditBlank: (entry: Extract<LinearSequenceEntry, { type: "blank" }>) => void;
  onSaveBlank: (entryId: string) => void;
  onCancelBlank: () => void;
  onStartEditSegment: (entry: Extract<LinearSequenceEntry, { type: "segment" }>) => void;
  onSaveSegment: (entryId: string) => void;
  onCancelSegment: () => void;
  onMoveEntry: (entryId: string, direction: MoveDirection) => void;
  onRemoveEntry: (entryId: string) => void;
}) {
  const [addMode, setAddMode] = useState<"block" | "blank" | "segment">("block");
  const [placementSearch, setPlacementSearch] = useState("");
  const [blankNote, setBlankNote] = useState("");
  const [segmentTitle, setSegmentTitle] = useState("");
  const [segmentTier, setSegmentTier] = useState<LinearSegmentTier | undefined>(undefined);
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<Set<string>>(new Set());
  const [isOutlinePanelOpen, setIsOutlinePanelOpen] = useState(true);
  const [pendingScrollEntryId, setPendingScrollEntryId] = useState<string | null>(null);
  const entries = getProjectLinearSequenceEntries(state, project.id);
  const outline = useMemo(() => getLinearOutline(state, project.id), [state, project.id]);
  const outlineNodesByEntryId = useMemo(() => {
    const map = new Map<string, LinearOutlineNode>();
    const visit = (node: LinearOutlineNode) => {
      map.set(node.entryId, node);
      node.episodes.forEach(visit);
    };
    outline.nodes.forEach(visit);
    return map;
  }, [outline]);

  useEffect(() => {
    if (!pendingScrollEntryId) return;
    const element = document.getElementById(`linear-entry-${pendingScrollEntryId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingScrollEntryId(null);
  }, [pendingScrollEntryId]);

  const toggleCollapsed = (entryId: string) => {
    setCollapsedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const jumpToEntry = (node: LinearOutlineNode) => {
    const parentId = node.parentEntryId;
    if (parentId) {
      setCollapsedEntryIds((current) => {
        if (!current.has(parentId)) return current;
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
    setPendingScrollEntryId(node.entryId);
  };

  const existingPlacementIds = new Set(
    entries
      .filter((entry): entry is Extract<LinearSequenceEntry, { type: "placement" }> =>
        entry.type === "placement",
      )
      .map((entry) => entry.placementId),
  );
  const normalizedSearch = placementSearch.trim().toLowerCase();
  const placementCandidates = state.blockPlacementOrder
    .map((placementId) => state.blockPlacements[placementId])
    .filter((placement): placement is BlockPlacement => {
      if (!placement || existingPlacementIds.has(placement.id)) return false;
      const thread = state.threads[placement.threadId];
      return Boolean(thread) && thread.projectId === project.id;
    })
    .filter((placement) => {
      if (!normalizedSearch) return true;
      const block = state.blocks[placement.blockId];
      const thread = state.threads[placement.threadId];
      return `${thread?.name ?? ""} ${block?.text ?? ""}`.toLowerCase().includes(normalizedSearch);
    });

  const submitBlank = (event: FormEvent) => {
    event.preventDefault();
    onAddBlank(project.id, blankNote);
    setBlankNote("");
  };

  const submitSegment = (event: FormEvent) => {
    event.preventDefault();
    if (!segmentTitle.trim()) return;
    onAddSegment(project.id, segmentTitle, segmentTier);
    setSegmentTitle("");
  };

  return (
    <div className="threadsList threadsLinearList" aria-label="Project Linear View">
      {isEditMode ? (
        <div className="threadsAddBlockForm threadsLinearAddPanel">
          <div className="threadsAddBlockModeTabs" role="tablist" aria-label="Add Linear entry mode">
            <button
              type="button"
              className={addMode === "block" ? "active" : ""}
              aria-pressed={addMode === "block"}
              onClick={() => setAddMode("block")}
            >
              Block
            </button>
            <button
              type="button"
              className={addMode === "blank" ? "active" : ""}
              aria-pressed={addMode === "blank"}
              onClick={() => setAddMode("blank")}
            >
              Blank
            </button>
            <button
              type="button"
              className={addMode === "segment" ? "active" : ""}
              aria-pressed={addMode === "segment"}
              onClick={() => setAddMode("segment")}
            >
              Segment
            </button>
          </div>

          {addMode === "block" ? (
            <div className="threadsExistingBlockPicker">
              <input
                autoFocus
                value={placementSearch}
                onChange={(event) => setPlacementSearch(event.target.value)}
                placeholder="Search blocks"
                aria-label="Search project Blocks"
              />
              <div className="threadsLinkResults">
                {placementCandidates.length > 0 ? (
                  placementCandidates.map((placement) => {
                    const block = state.blocks[placement.blockId];
                    const thread = state.threads[placement.threadId];
                    if (!block || !thread) return null;
                    return (
                      <button
                        key={placement.id}
                        type="button"
                        className="threadsLinkResult"
                        onClick={() => {
                          onAddPlacement(project.id, placement.id);
                          setPlacementSearch("");
                        }}
                      >
                        <span>{truncateBlockText(block.text)}</span>
                        <small>{thread.name}</small>
                      </button>
                    );
                  })
                ) : (
                  <div className="threadsEmptyBlocks">No matching Blocks</div>
                )}
              </div>
            </div>
          ) : addMode === "blank" ? (
            <form className="threadsAddBlockFields" onSubmit={submitBlank}>
              <textarea
                autoFocus
                value={blankNote}
                onChange={(event) => setBlankNote(event.target.value)}
                placeholder="Blank note (optional)"
                aria-label="Blank note"
                rows={2}
              />
              <button type="submit">Add Blank</button>
            </form>
          ) : (
            <form className="threadsAddBlockFields" onSubmit={submitSegment}>
              <div className="threadsLinearTierPicker" role="radiogroup" aria-label="Segment tier">
                <button
                  type="button"
                  className={!segmentTier ? "active" : ""}
                  aria-pressed={!segmentTier}
                  onClick={() => setSegmentTier(undefined)}
                >
                  Plain
                </button>
                <button
                  type="button"
                  className={segmentTier === "season" ? "active" : ""}
                  aria-pressed={segmentTier === "season"}
                  onClick={() => setSegmentTier("season")}
                >
                  Season
                </button>
                <button
                  type="button"
                  className={segmentTier === "episode" ? "active" : ""}
                  aria-pressed={segmentTier === "episode"}
                  onClick={() => setSegmentTier("episode")}
                >
                  Episode
                </button>
              </div>
              <input
                autoFocus
                value={segmentTitle}
                onChange={(event) => setSegmentTitle(event.target.value)}
                placeholder={
                  segmentTier === "season"
                    ? "Season name (e.g. Season 1)"
                    : segmentTier === "episode"
                      ? "Episode name (e.g. Episode 3)"
                      : "Segment name"
                }
                aria-label="Segment name"
              />
              <button type="submit" disabled={!segmentTitle.trim()}>
                {segmentTier === "season" ? "Add Season" : segmentTier === "episode" ? "Add Episode" : "Add Segment"}
              </button>
            </form>
          )}
        </div>
      ) : null}

      {isEditMode && blockWarning ? (
        <div className="threadsBlockWarning">{blockWarning}</div>
      ) : null}

      {outline.nodes.length > 0 ? (
        <LinearOutlinePanel
          outline={outline}
          collapsedEntryIds={collapsedEntryIds}
          isOpen={isOutlinePanelOpen}
          onToggleOpen={() => setIsOutlinePanelOpen((open) => !open)}
          onToggleCollapse={toggleCollapsed}
          onJumpToEntry={jumpToEntry}
        />
      ) : null}

      {entries.length > 0 ? (
        <div className="threadsLinearRows">
          {entries.map((entry, index) => {
            if (isLinearEntryCollapsed(outline, index, collapsedEntryIds)) return null;
            const info = outline.entryInfo[index];
            const outlineNode =
              entry.type === "segment" && entry.tier ? outlineNodesByEntryId.get(entry.id) : undefined;
            return (
              <LinearEntryRow
                key={entry.id}
                state={state}
                entry={entry}
                index={index}
                total={entries.length}
                depth={info ? info.depth : 0}
                outlineNode={outlineNode}
                isCollapsed={collapsedEntryIds.has(entry.id)}
                onToggleCollapse={toggleCollapsed}
                isEditMode={isEditMode}
                isEditingBlank={editingBlankId === entry.id}
                editingBlankNote={editingBlankNote}
                isEditingSegment={editingSegmentId === entry.id}
                editingSegmentTitle={editingSegmentTitle}
                editingSegmentTier={editingSegmentTier}
                onEditingBlankNoteChange={onEditingBlankNoteChange}
                onEditingSegmentTitleChange={onEditingSegmentTitleChange}
                onEditingSegmentTierChange={onEditingSegmentTierChange}
                onStartEditBlank={onStartEditBlank}
                onSaveBlank={onSaveBlank}
                onCancelBlank={onCancelBlank}
                onStartEditSegment={onStartEditSegment}
                onSaveSegment={onSaveSegment}
                onCancelSegment={onCancelSegment}
                onMoveEntry={onMoveEntry}
                onRemoveEntry={onRemoveEntry}
              />
            );
          })}
        </div>
      ) : (
        <div className="threadsEmptyState">No Linear entries</div>
      )}
    </div>
  );
}

function LinearOutlinePanel({
  outline,
  collapsedEntryIds,
  isOpen,
  onToggleOpen,
  onToggleCollapse,
  onJumpToEntry,
}: {
  outline: LinearOutline;
  collapsedEntryIds: ReadonlySet<string>;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleCollapse: (entryId: string) => void;
  onJumpToEntry: (node: LinearOutlineNode) => void;
}) {
  const totalSeasons = outline.nodes.filter((node) => node.kind === "season").length;
  const totalEpisodes = outline.nodes.reduce(
    (sum, node) => sum + (node.kind === "season" ? node.episodes.length : 1),
    0,
  );

  const renderNode = (node: LinearOutlineNode) => {
    const isCollapsed = collapsedEntryIds.has(node.entryId);
    const entryCount = node.endIndex - node.startIndex;
    return (
      <div key={node.entryId} className="threadsLinearOutlineNode">
        <div className="threadsLinearOutlineNodeRow">
          <button
            type="button"
            className="threadsIconButton threadsLinearCollapseToggle"
            aria-label={isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapse(node.entryId)}
          >
            <span className={`threadsLinearChevron${isCollapsed ? " collapsed" : ""}`}>
              <ChevronDownIcon />
            </span>
          </button>
          <button
            type="button"
            className="threadsLinearOutlineJumpButton"
            onClick={() => onJumpToEntry(node)}
          >
            <span className="threadsLinearOutlineNodeTitle">{node.title}</span>
            {node.kind === "season" ? (
              <span className="threadsLinearCountBadge">{formatCount(node.episodes.length, "Episode")}</span>
            ) : null}
            <span className="threadsLinearCountBadge">{formatCount(entryCount, "Row")}</span>
          </button>
        </div>
        {node.kind === "season" && node.episodes.length > 0 ? (
          <div className="threadsLinearOutlineChildren">
            {node.episodes.map((episode) => renderNode(episode))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="threadsLinearOutlinePanel">
      <button
        type="button"
        className="threadsLinearOutlineToggle"
        aria-expanded={isOpen}
        onClick={onToggleOpen}
      >
        <span className={`threadsLinearChevron${isOpen ? "" : " collapsed"}`}>
          <ChevronDownIcon />
        </span>
        <span>Outline</span>
        <span className="threadsLinearCountBadge">{formatCount(totalSeasons, "Season")}</span>
        <span className="threadsLinearCountBadge">{formatCount(totalEpisodes, "Episode")}</span>
      </button>
      {isOpen ? (
        <div className="threadsLinearOutlineTree">
          {outline.nodes.map((node) => renderNode(node))}
        </div>
      ) : null}
    </div>
  );
}

function LinearEntryRow({
  state,
  entry,
  index,
  total,
  depth,
  outlineNode,
  isCollapsed,
  onToggleCollapse,
  isEditMode,
  isEditingBlank,
  editingBlankNote,
  isEditingSegment,
  editingSegmentTitle,
  editingSegmentTier,
  onEditingBlankNoteChange,
  onEditingSegmentTitleChange,
  onEditingSegmentTierChange,
  onStartEditBlank,
  onSaveBlank,
  onCancelBlank,
  onStartEditSegment,
  onSaveSegment,
  onCancelSegment,
  onMoveEntry,
  onRemoveEntry,
}: {
  state: ThreadsState;
  entry: LinearSequenceEntry;
  index: number;
  total: number;
  depth: 0 | 1 | 2;
  outlineNode: LinearOutlineNode | undefined;
  isCollapsed: boolean;
  onToggleCollapse: (entryId: string) => void;
  isEditMode: boolean;
  isEditingBlank: boolean;
  editingBlankNote: string;
  isEditingSegment: boolean;
  editingSegmentTitle: string;
  editingSegmentTier: LinearSegmentTier | undefined;
  onEditingBlankNoteChange: (note: string) => void;
  onEditingSegmentTitleChange: (title: string) => void;
  onEditingSegmentTierChange: (tier: LinearSegmentTier | undefined) => void;
  onStartEditBlank: (entry: Extract<LinearSequenceEntry, { type: "blank" }>) => void;
  onSaveBlank: (entryId: string) => void;
  onCancelBlank: () => void;
  onStartEditSegment: (entry: Extract<LinearSequenceEntry, { type: "segment" }>) => void;
  onSaveSegment: (entryId: string) => void;
  onCancelSegment: () => void;
  onMoveEntry: (entryId: string, direction: MoveDirection) => void;
  onRemoveEntry: (entryId: string) => void;
}) {
  const depthClass = depth === 2 ? " threadsLinearDepth2" : depth === 1 ? " threadsLinearDepth1" : "";

  const renderActions = () => isEditMode ? (
    <div className="threadsBlockReorder" aria-label="Linear entry actions">
      <button
        type="button"
        className="threadsIconButton"
        aria-label="Move Linear entry up"
        onClick={() => onMoveEntry(entry.id, "up")}
        disabled={index === 0}
      >
        <ArrowUpIcon />
      </button>
      <button
        type="button"
        className="threadsIconButton"
        aria-label="Move Linear entry down"
        onClick={() => onMoveEntry(entry.id, "down")}
        disabled={index === total - 1}
      >
        <ArrowDownIcon />
      </button>
      <button
        type="button"
        className="threadsIconButton threadsDeleteButton"
        aria-label="Remove Linear entry"
        onClick={() => onRemoveEntry(entry.id)}
      >
        <XIcon />
      </button>
    </div>
  ) : null;

  if (entry.type === "placement") {
    const placement = state.blockPlacements[entry.placementId];
    const block = placement ? state.blocks[placement.blockId] : null;
    const thread = placement ? state.threads[placement.threadId] : null;
    if (!placement || !block || !thread) return null;
    const isShared = countBlockPlacements(state, block.id) > 1;
    const sharedTitle = isShared ? getOtherPlacementTitle(state, block.id, placement.id) : undefined;
    return (
      <article className={`threadsBlockRow threadsLinearEntryRow${depthClass}`}>
        <div className="threadsBlockMain">
          <div className={`threadsBlockTextReadOnly${isShared ? " shared" : ""}`} title={sharedTitle}>
            {block.text}
          </div>
          <div className="threadsBlockMeta">
            <span className="threadsLinearThreadTag" title={`Thread: ${thread.name}`}>
              {thread.name}
            </span>
          </div>
        </div>
        {renderActions()}
      </article>
    );
  }

  if (entry.type === "segment") {
    const tier = entry.tier;
    const tierRowClass =
      tier === "season" ? " threadsLinearSeasonRow" : tier === "episode" ? " threadsLinearEpisodeRow" : "";
    const entryCount = outlineNode ? outlineNode.endIndex - outlineNode.startIndex : 0;
    const titleClass =
      tier === "season" ? "threadsLinearSeasonTitle" : tier === "episode" ? "threadsLinearEpisodeTitle" : "threadsLinearSegmentTitle";
    const isEditingThis = isEditMode && isEditingSegment;

    return (
      <article
        id={`linear-entry-${entry.id}`}
        className={`threadsBlockRow threadsLinearEntryRow threadsLinearSegmentRow${tierRowClass}${depthClass}`}
      >
        <div className="threadsBlockMain">
          <div className="threadsLinearSegmentHeaderRow">
            {outlineNode ? (
              <button
                type="button"
                className="threadsIconButton threadsLinearCollapseToggle"
                aria-label={isCollapsed ? `Expand ${entry.title}` : `Collapse ${entry.title}`}
                aria-expanded={!isCollapsed}
                onClick={() => onToggleCollapse(entry.id)}
              >
                <span className={`threadsLinearChevron${isCollapsed ? " collapsed" : ""}`}>
                  <ChevronDownIcon />
                </span>
              </button>
            ) : null}
            {isEditingThis ? (
              <form
                className="threadsBlockEditForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveSegment(entry.id);
                }}
              >
                <div className="threadsLinearTierPicker" role="radiogroup" aria-label="Segment tier">
                  <button
                    type="button"
                    className={!editingSegmentTier ? "active" : ""}
                    aria-pressed={!editingSegmentTier}
                    onClick={() => onEditingSegmentTierChange(undefined)}
                  >
                    Plain
                  </button>
                  <button
                    type="button"
                    className={editingSegmentTier === "season" ? "active" : ""}
                    aria-pressed={editingSegmentTier === "season"}
                    onClick={() => onEditingSegmentTierChange("season")}
                  >
                    Season
                  </button>
                  <button
                    type="button"
                    className={editingSegmentTier === "episode" ? "active" : ""}
                    aria-pressed={editingSegmentTier === "episode"}
                    onClick={() => onEditingSegmentTierChange("episode")}
                  >
                    Episode
                  </button>
                </div>
                <input
                  autoFocus
                  value={editingSegmentTitle}
                  onChange={(event) => onEditingSegmentTitleChange(event.target.value)}
                  placeholder="Segment name"
                />
                <div className="threadsBlockEditActions">
                  <button
                    type="submit"
                    className="threadsIconButton"
                    aria-label="Save Segment name"
                    disabled={!editingSegmentTitle.trim()}
                  >
                    <CheckIcon />
                  </button>
                  <button
                    type="button"
                    className="threadsIconButton"
                    aria-label="Cancel Segment edit"
                    onClick={onCancelSegment}
                  >
                    <XIcon />
                  </button>
                </div>
              </form>
            ) : isEditMode ? (
              <button
                type="button"
                className={titleClass}
                onClick={() => onStartEditSegment(entry)}
              >
                {entry.title}
              </button>
            ) : (
              <div className={titleClass}>{entry.title}</div>
            )}
          </div>
          {outlineNode && !isEditingThis ? (
            <div className="threadsLinearNodeBadges">
              {isCollapsed ? (
                <span className="threadsLinearCountBadge">{entryCount} hidden</span>
              ) : (
                <>
                  {outlineNode.kind === "season" ? (
                    <span className="threadsLinearCountBadge">{formatCount(outlineNode.episodes.length, "Episode")}</span>
                  ) : null}
                  <span className="threadsLinearCountBadge">{formatCount(entryCount, "Row")}</span>
                </>
              )}
            </div>
          ) : null}
        </div>
        {renderActions()}
      </article>
    );
  }

  const blankLabel = entry.note || "Blank - to be filled";
  return (
    <article className={`threadsBlockRow threadsLinearEntryRow threadsLinearBlankRow${depthClass}`}>
      <div className="threadsBlockMain">
        {isEditMode && isEditingBlank ? (
          <form
            className="threadsBlockEditForm"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveBlank(entry.id);
            }}
          >
            <textarea
              autoFocus
              value={editingBlankNote}
              onChange={(event) => onEditingBlankNoteChange(event.target.value)}
              placeholder="Blank note"
              rows={2}
            />
            <div className="threadsBlockEditActions">
              <button
                type="submit"
                className="threadsIconButton"
                aria-label="Save Blank note"
              >
                <CheckIcon />
              </button>
              <button
                type="button"
                className="threadsIconButton"
                aria-label="Cancel Blank note edit"
                onClick={onCancelBlank}
              >
                <XIcon />
              </button>
            </div>
          </form>
        ) : isEditMode ? (
          <button
            type="button"
            className="threadsLinearBlankButton"
            onClick={() => onStartEditBlank(entry)}
          >
            {blankLabel}
          </button>
        ) : (
          <div className="threadsLinearBlankText">{blankLabel}</div>
        )}
      </div>
      {renderActions()}
    </article>
  );
}

const SCRIPT_ELEMENT_LABELS: Record<ScriptElementType, string> = {
  scene_heading: "Scene",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
};

const SCRIPT_ELEMENT_PLACEHOLDERS: Record<ScriptElementType, string> = {
  scene_heading: "INT. LOCATION - DAY",
  action: "Describe the action...",
  character: "CHARACTER NAME",
  dialogue: "What they say...",
  parenthetical: "(how they say it)",
  transition: "CUT TO:",
};

const nextScriptElementType = (type: ScriptElementType): ScriptElementType => {
  switch (type) {
    case "scene_heading":
      return "action";
    case "character":
      return "dialogue";
    case "dialogue":
      return "action";
    case "parenthetical":
      return "dialogue";
    case "transition":
      return "scene_heading";
    default:
      return "action";
  }
};

const autoGrowTextarea = (element: HTMLTextAreaElement) => {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
};

function ScriptView({
  state,
  project,
  isEditMode,
  onSetState,
  onApplyMutation,
}: {
  state: ThreadsState;
  project: Project;
  isEditMode: boolean;
  onSetState: (updater: (current: ThreadsState) => ThreadsState) => void;
  onApplyMutation: (result: ThreadsMutationResult) => void;
}) {
  const elements = getProjectScriptElements(state, project.id);
  const linearEntries = getProjectLinearSequenceEntries(state, project.id);
  const projectThreads = getProjectThreads(state, project.id);

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [pendingFocusElementId, setPendingFocusElementId] = useState<string | null>(null);
  const [pendingScrollElementId, setPendingScrollElementId] = useState<string | null>(null);
  const [isTaggedPanelOpen, setIsTaggedPanelOpen] = useState(true);
  const [tagPickerElementId, setTagPickerElementId] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const [blockThreadElementId, setBlockThreadElementId] = useState<string | null>(null);
  const [blockThreadId, setBlockThreadId] = useState("");

  useEffect(() => {
    if (!pendingFocusElementId) return;
    const element = document.getElementById(`script-textarea-${pendingFocusElementId}`);
    (element as HTMLTextAreaElement | null)?.focus();
    setPendingFocusElementId(null);
  }, [pendingFocusElementId]);

  useEffect(() => {
    if (!pendingScrollElementId) return;
    document
      .getElementById(`script-element-${pendingScrollElementId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingScrollElementId(null);
  }, [pendingScrollElementId]);

  const addElement = (type: ScriptElementType, afterElementId?: string) => {
    const newId = createId("script-element");
    onApplyMutation(addScriptElement(state, project.id, type, "", newId, afterElementId));
    setSelectedElementId(newId);
    setPendingFocusElementId(newId);
  };

  const existingLinkedEntryIds = new Set(
    elements.map((element) => element.linkedEntryId).filter((id): id is string => Boolean(id)),
  );

  const normalizedTagSearch = tagSearch.trim().toLowerCase();
  const tagCandidates = linearEntries.filter((entry) => {
    if (existingLinkedEntryIds.has(entry.id)) return false;
    if (entry.type === "placement") {
      const placement = state.blockPlacements[entry.placementId];
      const block = placement ? state.blocks[placement.blockId] : null;
      if (!block) return false;
      return !normalizedTagSearch || block.text.toLowerCase().includes(normalizedTagSearch);
    }
    if (entry.type === "segment") {
      return !normalizedTagSearch || entry.title.toLowerCase().includes(normalizedTagSearch);
    }
    return false;
  });

  const openTagPicker = (elementId: string) => {
    setTagPickerElementId(elementId);
    setTagSearch("");
  };

  const openBlockCreate = (elementId: string) => {
    setBlockThreadElementId(elementId);
    setBlockThreadId(projectThreads[0]?.id ?? "");
  };

  const handleCreateBlock = (element: ScriptElement) => {
    if (!blockThreadId) return;
    onApplyMutation(
      createBlockFromScriptElement(
        state,
        element.id,
        blockThreadId,
        createId("block"),
        createId("placement"),
        createId("linear-entry"),
      ),
    );
    setBlockThreadElementId(null);
  };

  const jumpToTaggedElement = (entryId: string) => {
    const element = elements.find((candidate) => candidate.linkedEntryId === entryId);
    if (!element) return;
    setSelectedElementId(element.id);
    setPendingScrollElementId(element.id);
  };

  return (
    <div className="threadsList threadsScriptLayout" aria-label="Project Script">
      <div className="threadsScriptMain">
        {elements.length === 0 ? (
          isEditMode ? (
            <button
              type="button"
              className="threadsScriptAddFirst"
              onClick={() => addElement("scene_heading")}
            >
              Start writing — add the first line
            </button>
          ) : (
            <div className="threadsEmptyState">No script yet</div>
          )
        ) : (
          elements.map((element) => (
            <ScriptElementRow
              key={element.id}
              state={state}
              element={element}
              isEditMode={isEditMode}
              isSelected={selectedElementId === element.id}
              isTagPickerOpen={tagPickerElementId === element.id}
              isBlockCreateOpen={blockThreadElementId === element.id}
              tagSearch={tagSearch}
              tagCandidates={tagCandidates}
              projectThreads={projectThreads}
              blockThreadId={blockThreadId}
              onSelect={() => setSelectedElementId(element.id)}
              onTextChange={(text) => onSetState((current) => updateScriptElementText(current, element.id, text))}
              onTypeChange={(type) => onSetState((current) => updateScriptElementType(current, element.id, type))}
              onEnter={() => addElement(nextScriptElementType(element.type), element.id)}
              onMove={(direction) => onApplyMutation(moveScriptElement(state, element.id, direction))}
              onRemove={() => {
                onSetState((current) => removeScriptElement(current, element.id));
                if (selectedElementId === element.id) setSelectedElementId(null);
              }}
              onOpenTagPicker={() => openTagPicker(element.id)}
              onCloseTagPicker={() => setTagPickerElementId(null)}
              onTagSearchChange={setTagSearch}
              onLinkEntry={(entryId) => {
                onApplyMutation(linkScriptElementToEntry(state, element.id, entryId));
                setTagPickerElementId(null);
              }}
              onUnlink={() => onSetState((current) => unlinkScriptElement(current, element.id))}
              onOpenBlockCreate={() => openBlockCreate(element.id)}
              onCloseBlockCreate={() => setBlockThreadElementId(null)}
              onBlockThreadChange={setBlockThreadId}
              onCreateBlock={() => handleCreateBlock(element)}
            />
          ))
        )}
        {isEditMode && elements.length > 0 ? (
          <button
            type="button"
            className="threadsScriptAddLine"
            onClick={() => addElement(nextScriptElementType(elements[elements.length - 1].type))}
          >
            + Add line
          </button>
        ) : null}
      </div>

      {isEditMode ? (
        <ScriptTaggedPanel
          state={state}
          linearEntries={linearEntries}
          taggedEntryIds={existingLinkedEntryIds}
          isOpen={isTaggedPanelOpen}
          onToggleOpen={() => setIsTaggedPanelOpen((open) => !open)}
          onJumpToEntry={jumpToTaggedElement}
        />
      ) : null}
    </div>
  );
}

function ScriptElementRow({
  state,
  element,
  isEditMode,
  isSelected,
  isTagPickerOpen,
  isBlockCreateOpen,
  tagSearch,
  tagCandidates,
  projectThreads,
  blockThreadId,
  onSelect,
  onTextChange,
  onTypeChange,
  onEnter,
  onMove,
  onRemove,
  onOpenTagPicker,
  onCloseTagPicker,
  onTagSearchChange,
  onLinkEntry,
  onUnlink,
  onOpenBlockCreate,
  onCloseBlockCreate,
  onBlockThreadChange,
  onCreateBlock,
}: {
  state: ThreadsState;
  element: ScriptElement;
  isEditMode: boolean;
  isSelected: boolean;
  isTagPickerOpen: boolean;
  isBlockCreateOpen: boolean;
  tagSearch: string;
  tagCandidates: LinearSequenceEntry[];
  projectThreads: Thread[];
  blockThreadId: string;
  onSelect: () => void;
  onTextChange: (text: string) => void;
  onTypeChange: (type: ScriptElementType) => void;
  onEnter: () => void;
  onMove: (direction: MoveDirection) => void;
  onRemove: () => void;
  onOpenTagPicker: () => void;
  onCloseTagPicker: () => void;
  onTagSearchChange: (value: string) => void;
  onLinkEntry: (entryId: string) => void;
  onUnlink: () => void;
  onOpenBlockCreate: () => void;
  onCloseBlockCreate: () => void;
  onBlockThreadChange: (threadId: string) => void;
  onCreateBlock: () => void;
}) {
  const linkedEntry = element.linkedEntryId ? state.linearSequenceEntries[element.linkedEntryId] : null;
  const linkedLabel = (() => {
    if (!linkedEntry) return null;
    if (linkedEntry.type === "placement") {
      const placement = state.blockPlacements[linkedEntry.placementId];
      const block = placement ? state.blocks[placement.blockId] : null;
      return block ? truncateBlockText(block.text) : "Linked Block";
    }
    if (linkedEntry.type === "segment") return linkedEntry.title;
    return "Linked entry";
  })();

  if (!isEditMode) {
    return (
      <div
        id={`script-element-${element.id}`}
        className={`threadsScriptElement threadsScriptElement-${element.type}`}
      >
        {element.text || " "}
      </div>
    );
  }

  return (
    <div
      id={`script-element-${element.id}`}
      className={`threadsScriptElementRow threadsScriptElement-${element.type}${isSelected ? " selected" : ""}`}
    >
      <textarea
        id={`script-textarea-${element.id}`}
        ref={(node) => {
          if (node) autoGrowTextarea(node);
        }}
        className="threadsScriptTextarea"
        value={element.text}
        rows={1}
        onFocus={onSelect}
        onChange={(event) => {
          onTextChange(event.target.value);
          autoGrowTextarea(event.target);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onEnter();
          }
        }}
        placeholder={SCRIPT_ELEMENT_PLACEHOLDERS[element.type]}
      />
      {isSelected ? (
        <div className="threadsScriptToolbar">
          <select
            className="threadsScriptTypeSelect"
            value={element.type}
            onChange={(event) => onTypeChange(event.target.value as ScriptElementType)}
            aria-label="Element type"
          >
            {SCRIPT_ELEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {SCRIPT_ELEMENT_LABELS[type]}
              </option>
            ))}
          </select>

          {linkedEntry ? (
            <span className="threadsScriptTagChip">
              <span>{linkedLabel}</span>
              <button
                type="button"
                className="threadsIconButton"
                aria-label="Remove tag"
                onClick={onUnlink}
              >
                <XIcon />
              </button>
            </span>
          ) : (
            <>
              <button type="button" className="threadsScriptTagButton" onClick={onOpenTagPicker}>
                Tag Block
              </button>
              <button type="button" className="threadsScriptTagButton" onClick={onOpenBlockCreate}>
                Make Block
              </button>
            </>
          )}

          <div className="threadsBlockReorder threadsScriptRowActions">
            <button
              type="button"
              className="threadsIconButton"
              aria-label="Move line up"
              onClick={() => onMove("up")}
            >
              <ArrowUpIcon />
            </button>
            <button
              type="button"
              className="threadsIconButton"
              aria-label="Move line down"
              onClick={() => onMove("down")}
            >
              <ArrowDownIcon />
            </button>
            <button
              type="button"
              className="threadsIconButton threadsDeleteButton"
              aria-label="Remove line"
              onClick={onRemove}
            >
              <XIcon />
            </button>
          </div>
        </div>
      ) : null}

      {isTagPickerOpen ? (
        <div className="threadsScriptTagPicker">
          <input
            autoFocus
            value={tagSearch}
            onChange={(event) => onTagSearchChange(event.target.value)}
            placeholder="Search Linear View entries"
            aria-label="Search Linear View entries"
          />
          <div className="threadsLinkResults">
            {tagCandidates.length > 0 ? (
              tagCandidates.map((entry) => {
                const label =
                  entry.type === "placement"
                    ? (() => {
                        const placement = state.blockPlacements[entry.placementId];
                        const block = placement ? state.blocks[placement.blockId] : null;
                        return block ? truncateBlockText(block.text) : null;
                      })()
                    : entry.type === "segment"
                      ? entry.title
                      : null;
                if (!label) return null;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="threadsLinkResult"
                    onClick={() => onLinkEntry(entry.id)}
                  >
                    <span>{label}</span>
                  </button>
                );
              })
            ) : (
              <div className="threadsEmptyBlocks">No matching entries</div>
            )}
          </div>
          <button type="button" className="threadsScriptTagPickerClose" onClick={onCloseTagPicker}>
            Cancel
          </button>
        </div>
      ) : null}

      {isBlockCreateOpen ? (
        <div className="threadsScriptTagPicker">
          {projectThreads.length > 0 ? (
            <>
              <select
                value={blockThreadId}
                onChange={(event) => onBlockThreadChange(event.target.value)}
                aria-label="Thread for new Block"
              >
                {projectThreads.map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={onCreateBlock} disabled={!element.text.trim()}>
                Create Block
              </button>
            </>
          ) : (
            <div className="threadsEmptyBlocks">Add a Thread first</div>
          )}
          <button type="button" className="threadsScriptTagPickerClose" onClick={onCloseBlockCreate}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ScriptTaggedPanel({
  state,
  linearEntries,
  taggedEntryIds,
  isOpen,
  onToggleOpen,
  onJumpToEntry,
}: {
  state: ThreadsState;
  linearEntries: LinearSequenceEntry[];
  taggedEntryIds: ReadonlySet<string>;
  isOpen: boolean;
  onToggleOpen: () => void;
  onJumpToEntry: (entryId: string) => void;
}) {
  const rows = linearEntries.filter(
    (entry): entry is Extract<LinearSequenceEntry, { type: "placement" | "segment" }> =>
      entry.type === "placement" || entry.type === "segment",
  );

  return (
    <div className="threadsScriptOutlinePanel">
      <button
        type="button"
        className="threadsLinearOutlineToggle"
        aria-expanded={isOpen}
        onClick={onToggleOpen}
      >
        <span className={`threadsLinearChevron${isOpen ? "" : " collapsed"}`}>
          <ChevronDownIcon />
        </span>
        <span>Linear View</span>
        <span className="threadsLinearCountBadge">{formatCount(taggedEntryIds.size, "Tagged")}</span>
      </button>
      {isOpen ? (
        <div className="threadsLinearOutlineTree threadsScriptOutlineTree">
          {rows.length === 0 ? (
            <div className="threadsEmptyBlocks">No Linear View entries yet</div>
          ) : (
            rows.map((entry) => {
              const isTagged = taggedEntryIds.has(entry.id);
              const label =
                entry.type === "placement"
                  ? (() => {
                      const placement = state.blockPlacements[entry.placementId];
                      const block = placement ? state.blocks[placement.blockId] : null;
                      return block ? truncateBlockText(block.text) : "Block";
                    })()
                  : entry.title;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`threadsLinearOutlineJumpButton threadsScriptOutlineRow${isTagged ? " tagged" : " untagged"}`}
                  onClick={() => (isTagged ? onJumpToEntry(entry.id) : undefined)}
                  disabled={!isTagged}
                >
                  <span className="threadsLinearOutlineNodeTitle">{label}</span>
                  {!isTagged ? <span className="threadsLinearCountBadge">Untagged</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
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
  onAddExistingBlock,
  onStartEditBlock,
  onSaveBlockEdit,
  onCancelBlockEdit,
  onMoveBlock,
  onSetStrictTie,
  onClearStrictTie,
  onOpenLinkDialog,
  onDeleteCrossThreadLooseTie,
  onRequestRemovePlacement,
  onRequestDeleteBlockEverywhere,
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
  onAddExistingBlock: (thread: Thread, blockId: string) => void;
  onStartEditBlock: (block: Block) => void;
  onSaveBlockEdit: (blockId: string) => void;
  onCancelBlockEdit: () => void;
  onMoveBlock: (placementId: string, direction: MoveDirection) => void;
  onSetStrictTie: (
    placementId: string,
    position: TiePosition,
    targetPlacementId: string,
  ) => void;
  onClearStrictTie: (placementId: string, position: TiePosition) => void;
  onOpenLinkDialog: (sourceBlockId: string) => void;
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onRequestRemovePlacement: (placement: BlockPlacement) => void;
  onRequestDeleteBlockEverywhere: (block: Block) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  const [addMode, setAddMode] = useState<"new" | "existing">("new");
  const [existingBlockSearch, setExistingBlockSearch] = useState("");
  const placementIds = getThreadDisplayPlacementIds(state, thread.id);
  const placedBlockIds = new Set(
    placementIds
      .map((placementId) => state.blockPlacements[placementId]?.blockId)
      .filter((blockId): blockId is string => Boolean(blockId)),
  );
  const normalizedExistingSearch = existingBlockSearch.trim().toLowerCase();
  const existingBlockCandidates = state.blockOrder
    .map((blockId) => state.blocks[blockId])
    .filter((block): block is Block => Boolean(block) && !placedBlockIds.has(block.id))
    .filter((block) => {
      if (!normalizedExistingSearch) return true;
      const paths = getBlockLocations(state, block.id)
        .map((location) => {
          const category = getCreativeCategory(location.project.categoryId);
          return `${category.label} / ${location.project.name} / ${location.thread.name}`;
        })
        .join(" ");
      return `${paths} ${block.text}`.toLowerCase().includes(normalizedExistingSearch);
    });

  return (
    <div className="threadsAccordion">
      {isEditMode ? (
        <div className="threadsAddBlockForm">
          <div className="threadsAddBlockModeTabs" role="tablist" aria-label="Add Block mode">
            <button
              type="button"
              className={addMode === "new" ? "active" : ""}
              aria-pressed={addMode === "new"}
              onClick={() => setAddMode("new")}
            >
              New
            </button>
            <button
              type="button"
              className={addMode === "existing" ? "active" : ""}
              aria-pressed={addMode === "existing"}
              onClick={() => setAddMode("existing")}
            >
              Existing
            </button>
          </div>

          {addMode === "new" ? (
            <form
              className="threadsAddBlockFields"
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
          ) : (
            <div className="threadsExistingBlockPicker">
              <input
                autoFocus
                value={existingBlockSearch}
                onChange={(event) => setExistingBlockSearch(event.target.value)}
                placeholder="Search blocks"
                aria-label="Search existing Blocks"
              />
              <div className="threadsLinkResults">
                {existingBlockCandidates.length > 0 ? (
                  existingBlockCandidates.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      className="threadsLinkResult"
                      onClick={() => {
                        onAddExistingBlock(thread, block.id);
                        setExistingBlockSearch("");
                      }}
                    >
                      <span>{truncateBlockText(block.text)}</span>
                      <small>{getBlockPathSummary(state, block.id)}</small>
                    </button>
                  ))
                ) : (
                  <div className="threadsEmptyBlocks">No matching Blocks</div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {isEditMode && blockWarning ? (
        <div className="threadsBlockWarning">{blockWarning}</div>
      ) : null}

      {placementIds.length > 0 ? (
        <div className="threadsBlockList">
          {placementIds.map((placementId, index) => {
            const placement = state.blockPlacements[placementId];
            const block = placement ? state.blocks[placement.blockId] : null;
            return placement && block ? (
              <BlockRow
                key={placement.id}
                state={state}
                placement={placement}
                block={block}
                previousPlacementId={placementIds[index - 1] ?? null}
                nextPlacementId={placementIds[index + 1] ?? null}
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
                onRequestRemovePlacement={onRequestRemovePlacement}
                onRequestDeleteBlockEverywhere={onRequestDeleteBlockEverywhere}
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
  placement,
  block,
  previousPlacementId,
  nextPlacementId,
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
  onRequestRemovePlacement,
  onRequestDeleteBlockEverywhere,
  onJumpToBlock,
}: {
  state: ThreadsState;
  placement: BlockPlacement;
  block: Block;
  previousPlacementId: string | null;
  nextPlacementId: string | null;
  isEditMode: boolean;
  isEditing: boolean;
  editingText: string;
  isHighlighted: boolean;
  onEditingTextChange: (text: string) => void;
  onStartEditBlock: (block: Block) => void;
  onSaveBlockEdit: (blockId: string) => void;
  onCancelBlockEdit: () => void;
  onMoveBlock: (placementId: string, direction: MoveDirection) => void;
  onSetStrictTie: (
    placementId: string,
    position: TiePosition,
    targetPlacementId: string,
  ) => void;
  onClearStrictTie: (placementId: string, position: TiePosition) => void;
  onOpenLinkDialog: (sourceBlockId: string) => void;
  onDeleteCrossThreadLooseTie: (tieId: string) => void;
  onRequestRemovePlacement: (placement: BlockPlacement) => void;
  onRequestDeleteBlockEverywhere: (block: Block) => void;
  onJumpToBlock: (blockId: string) => void;
}) {
  const strictBefore = previousPlacementId
    ? placement.strictTies.before === previousPlacementId
    : false;
  const strictAfter = nextPlacementId
    ? placement.strictTies.after === nextPlacementId
    : false;
  const outgoingLinks = getOutgoingCrossThreadLooseTies(state, block.id);
  const incomingLinks = getIncomingCrossThreadLooseTies(state, block.id);
  const isShared = countBlockPlacements(state, block.id) > 1;
  const sharedTitle = isShared ? getOtherPlacementTitle(state, block.id, placement.id) : undefined;

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
          placement={placement}
          targetPlacementId={nextPlacementId}
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
            className={`threadsBlockTextButton${isShared ? " shared" : ""}`}
            title={sharedTitle}
            onClick={() => onStartEditBlock(block)}
          >
            {block.text}
          </button>
        ) : (
          <div className={`threadsBlockTextReadOnly${isShared ? " shared" : ""}`} title={sharedTitle}>
            {block.text}
          </div>
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
            {isShared ? (
              <button
                type="button"
                className="threadsMetaButton danger"
                onClick={() => onRequestDeleteBlockEverywhere(block)}
              >
                Delete everywhere
              </button>
            ) : null}
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
            onClick={() => onMoveBlock(placement.id, "up")}
          >
            <ArrowUpIcon />
          </button>
          <button
            type="button"
            className="threadsIconButton"
            aria-label="Move Block down"
            onClick={() => onMoveBlock(placement.id, "down")}
          >
            <ArrowDownIcon />
          </button>
          <button
            type="button"
            className="threadsIconButton threadsDeleteButton"
            aria-label="Remove Block from Thread"
            onClick={() => onRequestRemovePlacement(placement)}
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
  placement,
  targetPlacementId,
  isTied,
  onSetStrictTie,
  onClearStrictTie,
}: {
  label: TiePosition;
  placement: BlockPlacement;
  targetPlacementId: string | null;
  isTied: boolean;
  onSetStrictTie: (
    placementId: string,
    position: TiePosition,
    targetPlacementId: string,
  ) => void;
  onClearStrictTie: (placementId: string, position: TiePosition) => void;
}) {
  if (!targetPlacementId && !isTied) return null;
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
          onClearStrictTie(placement.id, label);
        } else if (targetPlacementId) {
          onSetStrictTie(placement.id, label, targetPlacementId);
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
              title={getBlockPathSummary(state, target.id)}
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
              title={getBlockPathSummary(state, source.id)}
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
      const paths = getBlockLocations(state, block.id)
        .map((location) => {
          const category = getCreativeCategory(location.project.categoryId);
          return `${category.label} / ${location.project.name} / ${location.thread.name}`;
        })
        .join(" ");
      const searchable = `${paths} ${block.text}`.toLowerCase();
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
                <small>{getBlockPathSummary(state, block.id)}</small>
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
  const title = dialog.type === "thread"
    ? "Delete Thread"
    : dialog.type === "placement"
      ? "Remove Block"
      : "Delete Block Everywhere";
  const headline = dialog.type === "thread"
    ? `Delete "${dialog.name}"?`
    : dialog.type === "placement"
      ? "Remove this Block from this Thread?"
      : "Delete this Block everywhere?";
  const body = dialog.type === "thread"
    ? "This removes the Thread and only the Block placements inside it."
    : truncateBlockText(dialog.text);
  const confirmLabel = dialog.type === "placement"
    ? "Remove from Thread"
    : dialog.type === "block"
      ? "Delete everywhere"
      : "Delete";
  const impactItems = dialog.type === "thread"
    ? [
      `${formatCount(dialog.blockCount, "Block placement")} will be removed`,
      dialog.orphanedBlockCount > 0
        ? `${formatCount(dialog.orphanedBlockCount, "unshared Block")} will be deleted`
        : null,
      dialog.callbackLinkCount > 0
        ? `${formatCount(dialog.callbackLinkCount, "callback link")} will be removed`
        : null,
      dialog.strictTieCount > 0
        ? `${formatCount(dialog.strictTieCount, "strict tie")} will be cleared`
        : null,
    ].filter((item): item is string => Boolean(item))
    : dialog.type === "placement"
      ? [
        "1 Block placement will be removed",
        dialog.isFinalPlacement ? "This is the final placement, so the Block content will be deleted" : null,
        dialog.callbackLinkCount > 0
          ? `${formatCount(dialog.callbackLinkCount, "callback link")} will be removed`
          : null,
        dialog.strictTieCount > 0
          ? `${formatCount(dialog.strictTieCount, "strict tie")} will be cleared`
          : null,
      ].filter((item): item is string => Boolean(item))
      : [
        `${formatCount(dialog.placementCount, "Block placement")} will be removed`,
        dialog.callbackLinkCount > 0
          ? `${formatCount(dialog.callbackLinkCount, "callback link")} will be removed`
          : null,
        dialog.strictTieCount > 0
          ? `${formatCount(dialog.strictTieCount, "strict tie")} will be cleared`
          : null,
      ].filter((item): item is string => Boolean(item));

  return (
    <Modal
      title={title}
      onClose={onCancel}
      compact
    >
      <div className="threadsConfirmDelete">
        <div className="dangerCard">
          <strong>{headline}</strong>
          <p>{body}</p>
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
            {confirmLabel}
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
