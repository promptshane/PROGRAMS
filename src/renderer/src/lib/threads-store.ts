import {
  isCreativeCategoryId,
  type CreativeCategoryId,
} from "@shared/creative-categories";

export type TiePosition = "before" | "after";
export type MoveDirection = "up" | "down";
export type LinearSegmentTier = "season" | "episode";

export interface BlockStrictTies {
  before: string | null;
  after: string | null;
}

export interface Project {
  id: string;
  name: string;
  categoryId: CreativeCategoryId;
}

export interface Thread {
  id: string;
  name: string;
  projectId: string;
}

export interface Block {
  id: string;
  text: string;
}

export interface BlockPlacement {
  id: string;
  blockId: string;
  threadId: string;
  strictTies: BlockStrictTies;
}

export interface CrossThreadLooseTie {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
}

export interface LinearSequence {
  id: string;
  projectId: string;
  entryOrder: string[];
}

export type LinearSequenceEntry =
  | {
    id: string;
    sequenceId: string;
    type: "placement";
    placementId: string;
  }
  | {
    id: string;
    sequenceId: string;
    type: "blank";
    note: string;
  }
  | {
    id: string;
    sequenceId: string;
    type: "segment";
    title: string;
    tier?: LinearSegmentTier;
  };

export interface LinearOutlineNode {
  kind: LinearSegmentTier;
  entryId: string;
  title: string;
  startIndex: number;
  endIndex: number;
  parentEntryId: string | null;
  episodes: LinearOutlineNode[];
}

export interface LinearOutlineEntryInfo {
  depth: 0 | 1 | 2;
  seasonEntryId: string | null;
  episodeEntryId: string | null;
}

export interface LinearOutline {
  nodes: LinearOutlineNode[];
  entryInfo: LinearOutlineEntryInfo[];
}

export type ScriptElementType =
  | "scene_heading"
  | "action"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition";

export const SCRIPT_ELEMENT_TYPES: ScriptElementType[] = [
  "scene_heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
];

export interface ScriptElement {
  id: string;
  documentId: string;
  type: ScriptElementType;
  text: string;
  linkedEntryId?: string;
}

export interface ScriptDocument {
  id: string;
  projectId: string;
  elementOrder: string[];
}

export interface ThreadsState {
  version: 5;
  projects: Record<string, Project>;
  projectOrder: string[];
  threads: Record<string, Thread>;
  threadOrder: string[];
  blocks: Record<string, Block>;
  blockOrder: string[];
  blockPlacements: Record<string, BlockPlacement>;
  blockPlacementOrder: string[];
  crossThreadLooseTies: Record<string, CrossThreadLooseTie>;
  crossThreadLooseTieOrder: string[];
  linearSequences: Record<string, LinearSequence>;
  linearSequenceOrder: string[];
  linearSequenceEntries: Record<string, LinearSequenceEntry>;
  scriptDocuments: Record<string, ScriptDocument>;
  scriptDocumentOrder: string[];
  scriptElements: Record<string, ScriptElement>;
}

export interface ThreadBlockOrder {
  orderedBlockIds: string[];
  unplacedBlockIds: string[];
}

export interface ThreadsMutationResult {
  state: ThreadsState;
  error: string | null;
}

interface LegacyBlock {
  id: string;
  threadId: string;
  text: string;
  strictTies: BlockStrictTies;
}

export const THREADS_STORAGE_KEY = "programs.threads.v5";
export const LEGACY_THREADS_V4_STORAGE_KEY = "programs.threads.v4";
export const LEGACY_THREADS_V3_STORAGE_KEY = "programs.threads.v3";
export const LEGACY_THREADS_V2_STORAGE_KEY = "programs.threads.v2";
export const LEGACY_THREADS_STORAGE_KEY = "programs.threads.v1";
export const LEGACY_THREADS_SOURCE_STORAGE_KEY = "programs.systems-syntax.v2";
export const LEGACY_THREADS_SOURCE_GLOBAL_STORAGE_KEY = "programs.systems-syntax.v1";
export const IMPORTED_LEGACY_PROJECT_ID = "imported-syntax";

export const createEmptyThreadsState = (): ThreadsState => ({
  version: 5,
  projects: {},
  projectOrder: [],
  threads: {},
  threadOrder: [],
  blocks: {},
  blockOrder: [],
  blockPlacements: {},
  blockPlacementOrder: [],
  crossThreadLooseTies: {},
  crossThreadLooseTieOrder: [],
  linearSequences: {},
  linearSequenceOrder: [],
  linearSequenceEntries: {},
  scriptDocuments: {},
  scriptDocumentOrder: [],
  scriptElements: {},
});

const uniqueExistingIds = (
  value: unknown,
  exists: (id: string) => boolean,
): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id, index, ids): id is string =>
      typeof id === "string"
      && exists(id)
      && ids.indexOf(id) === index,
  );
};

const oppositeTie = (position: TiePosition): TiePosition =>
  position === "before" ? "after" : "before";

const emptyStrictTies = (): BlockStrictTies => ({ before: null, after: null });

const mutationResult = (
  state: ThreadsState,
  error: string | null = null,
): ThreadsMutationResult => ({ state, error });

const createLinearSequenceId = (
  projectId: string,
  existingIds: Set<string> = new Set(),
): string => {
  const baseId = `linear-${projectId}`;
  if (!existingIds.has(baseId)) return baseId;
  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
};

const normalizeLinearData = (
  projects: Record<string, Project>,
  projectOrder: string[],
  threads: Record<string, Thread>,
  blockPlacements: Record<string, BlockPlacement>,
  rawSequences: Record<string, LinearSequence> = {},
  sequenceOrderInput: unknown = [],
  rawEntries: Record<string, LinearSequenceEntry> = {},
): Pick<ThreadsState, "linearSequences" | "linearSequenceOrder" | "linearSequenceEntries"> => {
  const sourceSequenceOrder = uniqueExistingIds(
    sequenceOrderInput,
    (id) => Boolean(rawSequences[id]),
  );
  for (const sequenceId of Object.keys(rawSequences)) {
    if (!sourceSequenceOrder.includes(sequenceId)) sourceSequenceOrder.push(sequenceId);
  }

  const sequencesByProject = new Map<string, LinearSequence>();
  const sequenceIds = new Set<string>();
  for (const sequenceId of sourceSequenceOrder) {
    const sequence = rawSequences[sequenceId];
    if (
      !sequence
      || sequence.id !== sequenceId
      || typeof sequence.projectId !== "string"
      || !projects[sequence.projectId]
      || sequencesByProject.has(sequence.projectId)
    ) {
      continue;
    }
    const entryOrder = uniqueExistingIds(
      sequence.entryOrder,
      (entryId) => Boolean(rawEntries[entryId]),
    );
    for (const entryId of Object.keys(rawEntries)) {
      if (rawEntries[entryId]?.sequenceId === sequenceId && !entryOrder.includes(entryId)) {
        entryOrder.push(entryId);
      }
    }
    const normalizedSequence = { ...sequence, entryOrder };
    sequencesByProject.set(sequence.projectId, normalizedSequence);
    sequenceIds.add(sequenceId);
  }

  for (const projectId of projectOrder) {
    if (!projects[projectId] || sequencesByProject.has(projectId)) continue;
    const sequenceId = createLinearSequenceId(projectId, sequenceIds);
    sequenceIds.add(sequenceId);
    sequencesByProject.set(projectId, {
      id: sequenceId,
      projectId,
      entryOrder: [],
    });
  }

  const linearSequences: Record<string, LinearSequence> = {};
  const linearSequenceEntries: Record<string, LinearSequenceEntry> = {};
  const linearSequenceOrder: string[] = [];

  for (const projectId of projectOrder) {
    const sequence = sequencesByProject.get(projectId);
    if (!sequence) continue;
    const seenPlacementIds = new Set<string>();
    const entryOrder: string[] = [];
    for (const entryId of sequence.entryOrder) {
      const entry = rawEntries[entryId];
      if (!entry || entry.id !== entryId || entry.sequenceId !== sequence.id) continue;
      if (entry.type === "placement") {
        const placement = blockPlacements[entry.placementId];
        const thread = placement ? threads[placement.threadId] : null;
        if (!placement || !thread || thread.projectId !== projectId) continue;
        if (seenPlacementIds.has(entry.placementId)) continue;
        seenPlacementIds.add(entry.placementId);
        linearSequenceEntries[entryId] = entry;
        entryOrder.push(entryId);
      } else if (entry.type === "blank") {
        linearSequenceEntries[entryId] = {
          ...entry,
          note: entry.note.trim(),
        };
        entryOrder.push(entryId);
      } else if (entry.type === "segment") {
        const title = entry.title.trim();
        if (!title) continue;
        linearSequenceEntries[entryId] = {
          ...entry,
          title,
          tier: entry.tier === "season" || entry.tier === "episode" ? entry.tier : undefined,
        };
        entryOrder.push(entryId);
      }
    }
    linearSequences[sequence.id] = { ...sequence, entryOrder };
    linearSequenceOrder.push(sequence.id);
  }

  return { linearSequences, linearSequenceOrder, linearSequenceEntries };
};

const pruneLinearData = (
  state: ThreadsState,
): Pick<ThreadsState, "linearSequences" | "linearSequenceOrder" | "linearSequenceEntries"> =>
  normalizeLinearData(
    state.projects,
    state.projectOrder,
    state.threads,
    state.blockPlacements,
    state.linearSequences,
    state.linearSequenceOrder,
    state.linearSequenceEntries,
  );

const createScriptDocumentId = (
  projectId: string,
  existingIds: Set<string> = new Set(),
): string => {
  const baseId = `script-${projectId}`;
  if (!existingIds.has(baseId)) return baseId;
  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
};

const normalizeScriptData = (
  projects: Record<string, Project>,
  projectOrder: string[],
  linearSequenceEntries: Record<string, LinearSequenceEntry>,
  rawDocuments: Record<string, ScriptDocument> = {},
  documentOrderInput: unknown = [],
  rawElements: Record<string, ScriptElement> = {},
): Pick<ThreadsState, "scriptDocuments" | "scriptDocumentOrder" | "scriptElements"> => {
  const sourceDocumentOrder = uniqueExistingIds(
    documentOrderInput,
    (id) => Boolean(rawDocuments[id]),
  );
  for (const documentId of Object.keys(rawDocuments)) {
    if (!sourceDocumentOrder.includes(documentId)) sourceDocumentOrder.push(documentId);
  }

  const documentsByProject = new Map<string, ScriptDocument>();
  const documentIds = new Set<string>();
  for (const documentId of sourceDocumentOrder) {
    const doc = rawDocuments[documentId];
    if (
      !doc
      || doc.id !== documentId
      || typeof doc.projectId !== "string"
      || !projects[doc.projectId]
      || documentsByProject.has(doc.projectId)
    ) {
      continue;
    }
    const elementOrder = uniqueExistingIds(
      doc.elementOrder,
      (elementId) => Boolean(rawElements[elementId]),
    );
    for (const elementId of Object.keys(rawElements)) {
      if (rawElements[elementId]?.documentId === documentId && !elementOrder.includes(elementId)) {
        elementOrder.push(elementId);
      }
    }
    documentsByProject.set(doc.projectId, { ...doc, elementOrder });
    documentIds.add(documentId);
  }

  for (const projectId of projectOrder) {
    if (!projects[projectId] || documentsByProject.has(projectId)) continue;
    const documentId = createScriptDocumentId(projectId, documentIds);
    documentIds.add(documentId);
    documentsByProject.set(projectId, { id: documentId, projectId, elementOrder: [] });
  }

  const scriptDocuments: Record<string, ScriptDocument> = {};
  const scriptElements: Record<string, ScriptElement> = {};
  const scriptDocumentOrder: string[] = [];

  for (const projectId of projectOrder) {
    const doc = documentsByProject.get(projectId);
    if (!doc) continue;
    const elementOrder: string[] = [];
    for (const elementId of doc.elementOrder) {
      const element = rawElements[elementId];
      if (!element || element.id !== elementId || element.documentId !== doc.id) continue;
      const linkedEntryId =
        element.linkedEntryId && linearSequenceEntries[element.linkedEntryId]
          ? element.linkedEntryId
          : undefined;
      scriptElements[elementId] = { ...element, text: element.text.trim(), linkedEntryId };
      elementOrder.push(elementId);
    }
    scriptDocuments[doc.id] = { ...doc, elementOrder };
    scriptDocumentOrder.push(doc.id);
  }

  return { scriptDocuments, scriptDocumentOrder, scriptElements };
};

const pruneScriptData = (
  state: ThreadsState,
): Pick<ThreadsState, "scriptDocuments" | "scriptDocumentOrder" | "scriptElements"> =>
  normalizeScriptData(
    state.projects,
    state.projectOrder,
    state.linearSequenceEntries,
    state.scriptDocuments,
    state.scriptDocumentOrder,
    state.scriptElements,
  );

const getProjectLinearSequence = (
  state: ThreadsState,
  projectId: string,
): LinearSequence | null => {
  const sequenceId = state.linearSequenceOrder.find(
    (id) => state.linearSequences[id]?.projectId === projectId,
  );
  return sequenceId ? state.linearSequences[sequenceId] ?? null : null;
};

const copyPlacementWithStrictTie = (
  blockPlacements: Record<string, BlockPlacement>,
  placementId: string,
  position: TiePosition,
  targetPlacementId: string | null,
): Record<string, BlockPlacement> => {
  const placement = blockPlacements[placementId];
  if (!placement || placement.strictTies[position] === targetPlacementId) return blockPlacements;
  return {
    ...blockPlacements,
    [placementId]: {
      ...placement,
      strictTies: {
        ...placement.strictTies,
        [position]: targetPlacementId,
      },
    },
  };
};

const removeBlockPlacements = (
  state: ThreadsState,
  deletedPlacementIds: Set<string>,
  deletedProjectIds: Set<string> = new Set(),
): Pick<
  ThreadsState,
  "blocks"
  | "blockOrder"
  | "blockPlacements"
  | "blockPlacementOrder"
  | "crossThreadLooseTies"
  | "crossThreadLooseTieOrder"
  | "linearSequences"
  | "linearSequenceOrder"
  | "linearSequenceEntries"
  | "scriptDocuments"
  | "scriptDocumentOrder"
  | "scriptElements"
> => {
  const blockPlacements: Record<string, BlockPlacement> = {};
  for (const [placementId, placement] of Object.entries(state.blockPlacements)) {
    if (deletedPlacementIds.has(placementId)) continue;
    blockPlacements[placementId] = {
      ...placement,
      strictTies: {
        before: deletedPlacementIds.has(placement.strictTies.before ?? "") ? null : placement.strictTies.before,
        after: deletedPlacementIds.has(placement.strictTies.after ?? "") ? null : placement.strictTies.after,
      },
    };
  }

  const usedBlockIds = new Set(
    Object.values(blockPlacements).map((placement) => placement.blockId),
  );
  const deletedBlockIds = new Set(
    Object.keys(state.blocks).filter((blockId) => !usedBlockIds.has(blockId)),
  );

  const blocks: Record<string, Block> = {};
  for (const [blockId, block] of Object.entries(state.blocks)) {
    if (!deletedBlockIds.has(blockId)) blocks[blockId] = block;
  }

  const crossThreadLooseTies: Record<string, CrossThreadLooseTie> = {};
  for (const [tieId, tie] of Object.entries(state.crossThreadLooseTies)) {
    if (
      deletedBlockIds.has(tie.sourceBlockId)
      || deletedBlockIds.has(tie.targetBlockId)
    ) {
      continue;
    }
    crossThreadLooseTies[tieId] = tie;
  }

  const nextState = {
    ...state,
    projects: Object.fromEntries(
      Object.entries(state.projects).filter(([projectId]) => !deletedProjectIds.has(projectId)),
    ),
    blocks,
    blockOrder: state.blockOrder.filter((id) => Boolean(blocks[id])),
    blockPlacements,
    blockPlacementOrder: state.blockPlacementOrder.filter((id) => Boolean(blockPlacements[id])),
    crossThreadLooseTies,
    crossThreadLooseTieOrder: state.crossThreadLooseTieOrder.filter((id) =>
      Boolean(crossThreadLooseTies[id]),
    ),
  };

  const linearPruned = pruneLinearData(nextState);
  const stateForScriptPrune = { ...nextState, ...linearPruned };

  return {
    blocks: nextState.blocks,
    blockOrder: nextState.blockOrder,
    blockPlacements: nextState.blockPlacements,
    blockPlacementOrder: nextState.blockPlacementOrder,
    crossThreadLooseTies: nextState.crossThreadLooseTies,
    crossThreadLooseTieOrder: nextState.crossThreadLooseTieOrder,
    ...linearPruned,
    ...pruneScriptData(stateForScriptPrune),
  };
};

const replaceThreadPlacementOrder = (
  state: ThreadsState,
  threadId: string,
  nextThreadPlacementIds: string[],
): string[] => {
  let inserted = false;
  const nextPlacementOrder: string[] = [];
  for (const placementId of state.blockPlacementOrder) {
    const placement = state.blockPlacements[placementId];
    if (placement?.threadId !== threadId) {
      nextPlacementOrder.push(placementId);
      continue;
    }
    if (!inserted) {
      nextPlacementOrder.push(...nextThreadPlacementIds);
      inserted = true;
    }
  }
  if (!inserted) nextPlacementOrder.push(...nextThreadPlacementIds);
  return nextPlacementOrder;
};

const getStrictSegmentPlacementIds = (
  state: ThreadsState,
  placementId: string,
): string[] => {
  const placement = state.blockPlacements[placementId];
  if (!placement) return [];
  const threadPlacementIds = getThreadPlacementIds(state, placement.threadId);
  const placementIndex = threadPlacementIds.indexOf(placementId);
  if (placementIndex === -1) return [];

  let start = placementIndex;
  while (start > 0) {
    const currentId = threadPlacementIds[start];
    const previousId = threadPlacementIds[start - 1];
    const current = state.blockPlacements[currentId];
    const previous = state.blockPlacements[previousId];
    if (
      current?.strictTies.before === previousId
      && previous?.strictTies.after === currentId
    ) {
      start -= 1;
      continue;
    }
    break;
  }

  let end = placementIndex;
  while (end < threadPlacementIds.length - 1) {
    const currentId = threadPlacementIds[end];
    const nextId = threadPlacementIds[end + 1];
    const current = state.blockPlacements[currentId];
    const next = state.blockPlacements[nextId];
    if (
      current?.strictTies.after === nextId
      && next?.strictTies.before === currentId
    ) {
      end += 1;
      continue;
    }
    break;
  }

  return threadPlacementIds.slice(start, end + 1);
};

export const createProject = (
  state: ThreadsState,
  name: string,
  categoryId: CreativeCategoryId,
  id: string,
): ThreadsState => {
  const trimmedName = name.trim();
  if (!trimmedName || !id || state.projects[id] || !isCreativeCategoryId(categoryId)) {
    return state;
  }
  const sequenceId = createLinearSequenceId(id, new Set(Object.keys(state.linearSequences)));
  const scriptDocumentId = createScriptDocumentId(id, new Set(Object.keys(state.scriptDocuments)));
  return {
    ...state,
    projects: {
      ...state.projects,
      [id]: { id, name: trimmedName, categoryId },
    },
    projectOrder: [...state.projectOrder, id],
    linearSequences: {
      ...state.linearSequences,
      [sequenceId]: { id: sequenceId, projectId: id, entryOrder: [] },
    },
    linearSequenceOrder: [...state.linearSequenceOrder, sequenceId],
    scriptDocuments: {
      ...state.scriptDocuments,
      [scriptDocumentId]: { id: scriptDocumentId, projectId: id, elementOrder: [] },
    },
    scriptDocumentOrder: [...state.scriptDocumentOrder, scriptDocumentId],
  };
};

export const updateProject = (
  state: ThreadsState,
  projectId: string,
  updates: { name?: string; categoryId?: CreativeCategoryId },
): ThreadsState => {
  const project = state.projects[projectId];
  if (!project) return state;
  const nextName = updates.name === undefined ? project.name : updates.name.trim();
  const nextCategoryId = updates.categoryId ?? project.categoryId;
  if (!nextName || !isCreativeCategoryId(nextCategoryId)) return state;
  if (nextName === project.name && nextCategoryId === project.categoryId) return state;
  return {
    ...state,
    projects: {
      ...state.projects,
      [projectId]: {
        ...project,
        name: nextName,
        categoryId: nextCategoryId,
      },
    },
  };
};

export const deleteProject = (
  state: ThreadsState,
  projectId: string,
): ThreadsState => {
  if (!state.projects[projectId]) return state;

  const deletedThreadIds = new Set(
    Object.values(state.threads)
      .filter((thread) => thread.projectId === projectId)
      .map((thread) => thread.id),
  );
  const deletedPlacementIds = new Set(
    Object.values(state.blockPlacements)
      .filter((placement) => deletedThreadIds.has(placement.threadId))
      .map((placement) => placement.id),
  );

  const projects = { ...state.projects };
  delete projects[projectId];

  const threads: Record<string, Thread> = {};
  for (const [threadId, thread] of Object.entries(state.threads)) {
    if (!deletedThreadIds.has(threadId)) threads[threadId] = thread;
  }

  return {
    ...state,
    projects,
    projectOrder: state.projectOrder.filter((id) => id !== projectId),
    threads,
    threadOrder: state.threadOrder.filter((id) => !deletedThreadIds.has(id)),
    ...removeBlockPlacements(state, deletedPlacementIds, new Set([projectId])),
  };
};

export const createThread = (
  state: ThreadsState,
  name: string,
  projectId: string,
  id: string,
): ThreadsState => {
  const trimmedName = name.trim();
  if (!trimmedName || !id || state.threads[id] || !state.projects[projectId]) {
    return state;
  }
  return {
    ...state,
    threads: {
      ...state.threads,
      [id]: { id, name: trimmedName, projectId },
    },
    threadOrder: [...state.threadOrder, id],
  };
};

export const updateThread = (
  state: ThreadsState,
  threadId: string,
  updates: { name?: string; projectId?: string },
): ThreadsState => {
  const thread = state.threads[threadId];
  if (!thread) return state;
  const nextName = updates.name === undefined ? thread.name : updates.name.trim();
  const nextProjectId = updates.projectId ?? thread.projectId;
  if (!nextName || !state.projects[nextProjectId]) return state;
  if (nextName === thread.name && nextProjectId === thread.projectId) return state;
  const nextState = {
    ...state,
    threads: {
      ...state.threads,
      [threadId]: {
        ...thread,
        name: nextName,
        projectId: nextProjectId,
      },
    },
  };
  if (nextProjectId === thread.projectId) return nextState;
  const withLinearPruned = { ...nextState, ...pruneLinearData(nextState) };
  return { ...withLinearPruned, ...pruneScriptData(withLinearPruned) };
};

export const moveThreadInProject = (
  state: ThreadsState,
  threadId: string,
  direction: MoveDirection,
): ThreadsMutationResult => {
  const thread = state.threads[threadId];
  if (!thread) return mutationResult(state, "Thread not found.");

  const projectThreadIds = state.threadOrder.filter((id) =>
    state.threads[id]?.projectId === thread.projectId,
  );
  const currentIndex = projectThreadIds.indexOf(threadId);
  if (currentIndex === -1) return mutationResult(state, "Thread not found.");

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= projectThreadIds.length) {
    return mutationResult(state, direction === "up" ? "Already at the top." : "Already at the bottom.");
  }

  const nextProjectThreadIds = [...projectThreadIds];
  const [movedThreadId] = nextProjectThreadIds.splice(currentIndex, 1);
  nextProjectThreadIds.splice(targetIndex, 0, movedThreadId);

  let replacementIndex = 0;
  const threadOrder = state.threadOrder.map((id) => {
    const current = state.threads[id];
    if (current?.projectId !== thread.projectId) return id;
    return nextProjectThreadIds[replacementIndex++] ?? id;
  });

  return mutationResult({ ...state, threadOrder });
};

export const deleteThread = (
  state: ThreadsState,
  threadId: string,
): ThreadsState => {
  if (!state.threads[threadId]) return state;

  const deletedPlacementIds = new Set(
    Object.values(state.blockPlacements)
      .filter((placement) => placement.threadId === threadId)
      .map((placement) => placement.id),
  );
  const threads = { ...state.threads };
  delete threads[threadId];

  return {
    ...state,
    threads,
    threadOrder: state.threadOrder.filter((id) => id !== threadId),
    ...removeBlockPlacements(state, deletedPlacementIds),
  };
};

export const createBlock = (
  state: ThreadsState,
  threadId: string,
  text: string,
  blockId: string,
  placementId: string = blockId,
): ThreadsState => {
  const thread = state.threads[threadId];
  const trimmedText = text.trim();
  if (
    !thread
    || !trimmedText
    || !blockId
    || !placementId
    || state.blocks[blockId]
    || state.blockPlacements[placementId]
  ) {
    return state;
  }
  return {
    ...state,
    blocks: {
      ...state.blocks,
      [blockId]: {
        id: blockId,
        text: trimmedText,
      },
    },
    blockOrder: [...state.blockOrder, blockId],
    blockPlacements: {
      ...state.blockPlacements,
      [placementId]: {
        id: placementId,
        blockId,
        threadId,
        strictTies: emptyStrictTies(),
      },
    },
    blockPlacementOrder: [...state.blockPlacementOrder, placementId],
  };
};

export const addExistingBlockPlacement = (
  state: ThreadsState,
  threadId: string,
  blockId: string,
  placementId: string,
): ThreadsMutationResult => {
  if (!state.threads[threadId]) return mutationResult(state, "Thread not found.");
  if (!state.blocks[blockId]) return mutationResult(state, "Choose an existing Block.");
  if (!placementId || state.blockPlacements[placementId]) {
    return mutationResult(state, "Could not add Block to this Thread.");
  }
  const alreadyPlaced = Object.values(state.blockPlacements).some((placement) =>
    placement.threadId === threadId && placement.blockId === blockId,
  );
  if (alreadyPlaced) {
    return mutationResult(state, "That Block is already in this Thread.");
  }
  return mutationResult({
    ...state,
    blockPlacements: {
      ...state.blockPlacements,
      [placementId]: {
        id: placementId,
        blockId,
        threadId,
        strictTies: emptyStrictTies(),
      },
    },
    blockPlacementOrder: [...state.blockPlacementOrder, placementId],
  });
};

export const updateBlockText = (
  state: ThreadsState,
  blockId: string,
  text: string,
): ThreadsState => {
  const block = state.blocks[blockId];
  const trimmedText = text.trim();
  if (!block || !trimmedText || block.text === trimmedText) return state;
  return {
    ...state,
    blocks: {
      ...state.blocks,
      [blockId]: {
        ...block,
        text: trimmedText,
      },
    },
  };
};

export const removeBlockPlacement = (
  state: ThreadsState,
  placementId: string,
): ThreadsState => {
  if (!state.blockPlacements[placementId]) return state;
  return {
    ...state,
    ...removeBlockPlacements(state, new Set([placementId])),
  };
};

export const deleteBlock = (
  state: ThreadsState,
  blockId: string,
): ThreadsState => {
  if (!state.blocks[blockId]) return state;
  const deletedPlacementIds = new Set(
    Object.values(state.blockPlacements)
      .filter((placement) => placement.blockId === blockId)
      .map((placement) => placement.id),
  );
  return {
    ...state,
    ...removeBlockPlacements(state, deletedPlacementIds),
  };
};

export const deleteBlockEverywhere = deleteBlock;

export const setStrictTie = (
  state: ThreadsState,
  placementId: string,
  position: TiePosition,
  targetPlacementId: string,
): ThreadsMutationResult => {
  const placement = state.blockPlacements[placementId];
  const targetPlacement = state.blockPlacements[targetPlacementId];
  if (!placement || !targetPlacement || placement.id === targetPlacement.id) {
    return mutationResult(state, "Choose two different blocks for a strict tie.");
  }
  if (placement.threadId !== targetPlacement.threadId) {
    return mutationResult(state, "Strict ties can only connect blocks in the same thread.");
  }

  const threadPlacementIds = getThreadPlacementIds(state, placement.threadId);
  const placementIndex = threadPlacementIds.indexOf(placementId);
  const targetIndex = threadPlacementIds.indexOf(targetPlacementId);
  const expectedTargetIndex = position === "before" ? placementIndex - 1 : placementIndex + 1;
  if (placementIndex === -1 || targetIndex !== expectedTargetIndex) {
    return mutationResult(
      state,
      "Strict ties require adjacent blocks. Reorder the blocks first.",
    );
  }

  const opposite = oppositeTie(position);
  if (
    placement.strictTies[position] === targetPlacementId
    && targetPlacement.strictTies[opposite] === placementId
  ) {
    return mutationResult(state);
  }
  if (placement.strictTies[position] && placement.strictTies[position] !== targetPlacementId) {
    return mutationResult(state, "Remove the existing strict tie in this slot first.");
  }
  if (targetPlacement.strictTies[opposite] && targetPlacement.strictTies[opposite] !== placementId) {
    return mutationResult(state, "Remove the neighboring block's strict tie first.");
  }
  if (placement.strictTies[opposite] === targetPlacementId || targetPlacement.strictTies[position] === placementId) {
    return mutationResult(state, "Those blocks are already strictly tied in the opposite direction.");
  }

  let blockPlacements = state.blockPlacements;
  blockPlacements = copyPlacementWithStrictTie(blockPlacements, placementId, position, targetPlacementId);
  blockPlacements = copyPlacementWithStrictTie(blockPlacements, targetPlacementId, opposite, placementId);
  return mutationResult(blockPlacements === state.blockPlacements ? state : { ...state, blockPlacements });
};

export const clearStrictTie = (
  state: ThreadsState,
  placementId: string,
  position: TiePosition,
): ThreadsState => {
  const placement = state.blockPlacements[placementId];
  const targetPlacementId = placement?.strictTies[position] ?? null;
  if (!placement || !targetPlacementId) return state;
  const opposite = oppositeTie(position);
  let blockPlacements = copyPlacementWithStrictTie(state.blockPlacements, placementId, position, null);
  if (blockPlacements[targetPlacementId]?.strictTies[opposite] === placementId) {
    blockPlacements = copyPlacementWithStrictTie(blockPlacements, targetPlacementId, opposite, null);
  }
  return blockPlacements === state.blockPlacements ? state : { ...state, blockPlacements };
};

export const moveBlockInThread = (
  state: ThreadsState,
  placementId: string,
  direction: MoveDirection,
): ThreadsMutationResult => {
  const placement = state.blockPlacements[placementId];
  if (!placement) return mutationResult(state, "Block not found.");

  const threadPlacementIds = getThreadPlacementIds(state, placement.threadId);
  const selectedSegment = getStrictSegmentPlacementIds(state, placementId);
  if (selectedSegment.length === 0) return mutationResult(state, "Block not found.");

  const selectedStart = threadPlacementIds.indexOf(selectedSegment[0]);
  const selectedEnd = threadPlacementIds.indexOf(selectedSegment[selectedSegment.length - 1]);
  const neighborIndex = direction === "up" ? selectedStart - 1 : selectedEnd + 1;
  if (neighborIndex < 0 || neighborIndex >= threadPlacementIds.length) {
    return mutationResult(state, direction === "up" ? "Already at the top." : "Already at the bottom.");
  }

  const neighborId = threadPlacementIds[neighborIndex];
  const neighborSegment = getStrictSegmentPlacementIds(state, neighborId);
  if (neighborSegment.length === 0) {
    return mutationResult(state, "Block not found.");
  }

  const selectedSet = new Set(selectedSegment);
  const remaining = threadPlacementIds.filter((id) => !selectedSet.has(id));
  const insertAt = direction === "up"
    ? remaining.indexOf(neighborSegment[0])
    : remaining.indexOf(neighborSegment[neighborSegment.length - 1]) + 1;
  const nextThreadPlacementIds = [
    ...remaining.slice(0, insertAt),
    ...selectedSegment,
    ...remaining.slice(insertAt),
  ];

  return mutationResult({
    ...state,
    blockPlacementOrder: replaceThreadPlacementOrder(
      state,
      placement.threadId,
      nextThreadPlacementIds,
    ),
  });
};

export const createCrossThreadLooseTie = (
  state: ThreadsState,
  sourceBlockId: string,
  targetBlockId: string,
  id: string,
): ThreadsMutationResult => {
  if (!id || state.crossThreadLooseTies[id]) {
    return mutationResult(state, "Could not create callback link.");
  }
  if (!state.blocks[sourceBlockId] || !state.blocks[targetBlockId]) {
    return mutationResult(state, "Choose an existing target block.");
  }
  if (sourceBlockId === targetBlockId) {
    return mutationResult(state, "A block cannot link to itself.");
  }
  const duplicate = Object.values(state.crossThreadLooseTies).some((tie) =>
    tie.sourceBlockId === sourceBlockId && tie.targetBlockId === targetBlockId,
  );
  if (duplicate) {
    return mutationResult(state, "That callback link already exists.");
  }
  return mutationResult({
    ...state,
    crossThreadLooseTies: {
      ...state.crossThreadLooseTies,
      [id]: { id, sourceBlockId, targetBlockId },
    },
    crossThreadLooseTieOrder: [...state.crossThreadLooseTieOrder, id],
  });
};

export const deleteCrossThreadLooseTie = (
  state: ThreadsState,
  tieId: string,
): ThreadsState => {
  if (!state.crossThreadLooseTies[tieId]) return state;
  const crossThreadLooseTies = { ...state.crossThreadLooseTies };
  delete crossThreadLooseTies[tieId];
  return {
    ...state,
    crossThreadLooseTies,
    crossThreadLooseTieOrder: state.crossThreadLooseTieOrder.filter((id) => id !== tieId),
  };
};

export const getOutgoingCrossThreadLooseTies = (
  state: ThreadsState,
  blockId: string,
): CrossThreadLooseTie[] =>
  state.crossThreadLooseTieOrder
    .map((tieId) => state.crossThreadLooseTies[tieId])
    .filter(
      (tie): tie is CrossThreadLooseTie =>
        Boolean(tie) && tie.sourceBlockId === blockId && Boolean(state.blocks[tie.targetBlockId]),
    );

export const getIncomingCrossThreadLooseTies = (
  state: ThreadsState,
  blockId: string,
): CrossThreadLooseTie[] =>
  state.crossThreadLooseTieOrder
    .map((tieId) => state.crossThreadLooseTies[tieId])
    .filter(
      (tie): tie is CrossThreadLooseTie =>
        Boolean(tie) && tie.targetBlockId === blockId && Boolean(state.blocks[tie.sourceBlockId]),
    );

export const countProjectThreads = (
  state: ThreadsState,
  projectId: string,
): number =>
  state.threadOrder.filter((threadId) => state.threads[threadId]?.projectId === projectId).length;

export const countThreadBlocks = (
  state: ThreadsState,
  threadId: string,
): number =>
  state.blockPlacementOrder.filter((placementId) => state.blockPlacements[placementId]?.threadId === threadId).length;

export const countBlockPlacements = (
  state: ThreadsState,
  blockId: string,
): number =>
  state.blockPlacementOrder.filter((placementId) => state.blockPlacements[placementId]?.blockId === blockId).length;

export const getCategoryProjects = (
  state: ThreadsState,
  categoryId: CreativeCategoryId,
): Project[] =>
  state.projectOrder
    .map((projectId) => state.projects[projectId])
    .filter(
      (project): project is Project =>
        Boolean(project) && project.categoryId === categoryId,
    );

export const getProjectThreads = (
  state: ThreadsState,
  projectId: string,
): Thread[] =>
  state.threadOrder
    .map((threadId) => state.threads[threadId])
    .filter(
      (thread): thread is Thread =>
        Boolean(thread) && thread.projectId === projectId,
    );

export const getBlockPlacementIds = (
  state: ThreadsState,
  blockId: string,
): string[] =>
  state.blockPlacementOrder.filter((placementId) => state.blockPlacements[placementId]?.blockId === blockId);

export const getThreadPlacementIds = (
  state: ThreadsState,
  threadId: string,
): string[] =>
  state.blockPlacementOrder.filter((placementId) => state.blockPlacements[placementId]?.threadId === threadId);

export const getThreadDisplayPlacementIds = (
  state: ThreadsState,
  threadId: string,
): string[] => getThreadPlacementIds(state, threadId);

export const getThreadBlockIds = (
  state: ThreadsState,
  threadId: string,
): string[] =>
  getThreadPlacementIds(state, threadId)
    .map((placementId) => state.blockPlacements[placementId]?.blockId)
    .filter((blockId): blockId is string => Boolean(blockId));

export const getThreadBlockOrder = (
  state: ThreadsState,
  threadId: string,
): ThreadBlockOrder => ({
  orderedBlockIds: getThreadBlockIds(state, threadId),
  unplacedBlockIds: [],
});

export const getThreadDisplayBlockIds = (
  state: ThreadsState,
  threadId: string,
): string[] => getThreadBlockIds(state, threadId);

export const getProjectLinearSequenceEntries = (
  state: ThreadsState,
  projectId: string,
): LinearSequenceEntry[] => {
  const sequence = getProjectLinearSequence(state, projectId);
  if (!sequence) return [];
  return sequence.entryOrder
    .map((entryId) => state.linearSequenceEntries[entryId])
    .filter((entry): entry is LinearSequenceEntry => Boolean(entry));
};

export const deriveLinearOutline = (entries: LinearSequenceEntry[]): LinearOutline => {
  const nodes: LinearOutlineNode[] = [];
  const entryInfo: LinearOutlineEntryInfo[] = new Array(entries.length);
  let currentSeason: LinearOutlineNode | null = null;
  let currentEpisode: LinearOutlineNode | null = null;

  const closeEpisode = (uptoIndex: number) => {
    if (currentEpisode) currentEpisode.endIndex = uptoIndex;
    currentEpisode = null;
  };
  const closeSeason = (uptoIndex: number) => {
    closeEpisode(uptoIndex);
    if (currentSeason) currentSeason.endIndex = uptoIndex;
    currentSeason = null;
  };

  entries.forEach((entry, index) => {
    if (entry.type === "segment" && entry.tier === "season") {
      closeSeason(index - 1);
      const node: LinearOutlineNode = {
        kind: "season",
        entryId: entry.id,
        title: entry.title,
        startIndex: index,
        endIndex: index,
        parentEntryId: null,
        episodes: [],
      };
      nodes.push(node);
      currentSeason = node;
      entryInfo[index] = { depth: 0, seasonEntryId: null, episodeEntryId: null };
      return;
    }
    if (entry.type === "segment" && entry.tier === "episode") {
      closeEpisode(index - 1);
      const node: LinearOutlineNode = {
        kind: "episode",
        entryId: entry.id,
        title: entry.title,
        startIndex: index,
        endIndex: index,
        parentEntryId: currentSeason ? currentSeason.entryId : null,
        episodes: [],
      };
      if (currentSeason) {
        currentSeason.episodes.push(node);
        entryInfo[index] = { depth: 1, seasonEntryId: currentSeason.entryId, episodeEntryId: null };
      } else {
        nodes.push(node);
        entryInfo[index] = { depth: 0, seasonEntryId: null, episodeEntryId: null };
      }
      currentEpisode = node;
      return;
    }
    if (currentEpisode) {
      entryInfo[index] = {
        depth: currentSeason ? 2 : 1,
        seasonEntryId: currentSeason ? currentSeason.entryId : null,
        episodeEntryId: currentEpisode.entryId,
      };
    } else if (currentSeason) {
      entryInfo[index] = { depth: 1, seasonEntryId: currentSeason.entryId, episodeEntryId: null };
    } else {
      entryInfo[index] = { depth: 0, seasonEntryId: null, episodeEntryId: null };
    }
  });
  closeSeason(entries.length - 1);
  return { nodes, entryInfo };
};

export const getLinearOutline = (
  state: ThreadsState,
  projectId: string,
): LinearOutline => deriveLinearOutline(getProjectLinearSequenceEntries(state, projectId));

export const isLinearEntryCollapsed = (
  outline: LinearOutline,
  index: number,
  collapsedEntryIds: ReadonlySet<string>,
): boolean => {
  const info = outline.entryInfo[index];
  if (!info) return false;
  return (
    (info.seasonEntryId !== null && collapsedEntryIds.has(info.seasonEntryId))
    || (info.episodeEntryId !== null && collapsedEntryIds.has(info.episodeEntryId))
  );
};

export const addLinearBlockPlacementEntry = (
  state: ThreadsState,
  projectId: string,
  placementId: string,
  entryId: string,
): ThreadsMutationResult => {
  if (!state.projects[projectId]) return mutationResult(state, "Project not found.");
  const sequence = getProjectLinearSequence(state, projectId);
  if (!sequence) return mutationResult(state, "Linear Sequence not found.");
  const placement = state.blockPlacements[placementId];
  const thread = placement ? state.threads[placement.threadId] : null;
  if (!placement || !thread || thread.projectId !== projectId) {
    return mutationResult(state, "Choose a Block from this Project.");
  }
  if (!entryId || state.linearSequenceEntries[entryId]) {
    return mutationResult(state, "Could not add Block to Linear View.");
  }
  const duplicate = sequence.entryOrder.some((existingEntryId) => {
    const entry = state.linearSequenceEntries[existingEntryId];
    return entry?.type === "placement" && entry.placementId === placementId;
  });
  if (duplicate) {
    return mutationResult(state, "That Block placement is already in Linear View.");
  }
  return mutationResult({
    ...state,
    linearSequences: {
      ...state.linearSequences,
      [sequence.id]: {
        ...sequence,
        entryOrder: [...sequence.entryOrder, entryId],
      },
    },
    linearSequenceEntries: {
      ...state.linearSequenceEntries,
      [entryId]: {
        id: entryId,
        sequenceId: sequence.id,
        type: "placement",
        placementId,
      },
    },
  });
};

export const addLinearBlankEntry = (
  state: ThreadsState,
  projectId: string,
  note: string,
  entryId: string,
): ThreadsMutationResult => {
  if (!state.projects[projectId]) return mutationResult(state, "Project not found.");
  const sequence = getProjectLinearSequence(state, projectId);
  if (!sequence) return mutationResult(state, "Linear Sequence not found.");
  if (!entryId || state.linearSequenceEntries[entryId]) {
    return mutationResult(state, "Could not add Blank to Linear View.");
  }
  return mutationResult({
    ...state,
    linearSequences: {
      ...state.linearSequences,
      [sequence.id]: {
        ...sequence,
        entryOrder: [...sequence.entryOrder, entryId],
      },
    },
    linearSequenceEntries: {
      ...state.linearSequenceEntries,
      [entryId]: {
        id: entryId,
        sequenceId: sequence.id,
        type: "blank",
        note: note.trim(),
      },
    },
  });
};

export const addLinearSegmentEntry = (
  state: ThreadsState,
  projectId: string,
  title: string,
  entryId: string,
  tier?: LinearSegmentTier,
): ThreadsMutationResult => {
  if (!state.projects[projectId]) return mutationResult(state, "Project not found.");
  const sequence = getProjectLinearSequence(state, projectId);
  if (!sequence) return mutationResult(state, "Linear Sequence not found.");
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return mutationResult(state, "Segment title cannot be empty.");
  if (!entryId || state.linearSequenceEntries[entryId]) {
    return mutationResult(state, "Could not add Segment to Linear View.");
  }
  return mutationResult({
    ...state,
    linearSequences: {
      ...state.linearSequences,
      [sequence.id]: {
        ...sequence,
        entryOrder: [...sequence.entryOrder, entryId],
      },
    },
    linearSequenceEntries: {
      ...state.linearSequenceEntries,
      [entryId]: {
        id: entryId,
        sequenceId: sequence.id,
        type: "segment",
        title: trimmedTitle,
        tier,
      },
    },
  });
};

export const updateLinearBlankEntryNote = (
  state: ThreadsState,
  entryId: string,
  note: string,
): ThreadsState => {
  const entry = state.linearSequenceEntries[entryId];
  if (!entry || entry.type !== "blank") return state;
  const nextNote = note.trim();
  if (entry.note === nextNote) return state;
  return {
    ...state,
    linearSequenceEntries: {
      ...state.linearSequenceEntries,
      [entryId]: { ...entry, note: nextNote },
    },
  };
};

export const updateLinearSegmentEntryTitle = (
  state: ThreadsState,
  entryId: string,
  title: string,
): ThreadsState => {
  const entry = state.linearSequenceEntries[entryId];
  if (!entry || entry.type !== "segment") return state;
  const nextTitle = title.trim();
  if (!nextTitle || entry.title === nextTitle) return state;
  return {
    ...state,
    linearSequenceEntries: {
      ...state.linearSequenceEntries,
      [entryId]: { ...entry, title: nextTitle },
    },
  };
};

export const updateLinearSegmentEntryTier = (
  state: ThreadsState,
  entryId: string,
  tier: LinearSegmentTier | null,
): ThreadsState => {
  const entry = state.linearSequenceEntries[entryId];
  if (!entry || entry.type !== "segment") return state;
  const nextTier = tier ?? undefined;
  if ((entry.tier ?? undefined) === nextTier) return state;
  return {
    ...state,
    linearSequenceEntries: {
      ...state.linearSequenceEntries,
      [entryId]: { ...entry, tier: nextTier },
    },
  };
};

export const moveLinearEntry = (
  state: ThreadsState,
  entryId: string,
  direction: MoveDirection,
): ThreadsMutationResult => {
  const entry = state.linearSequenceEntries[entryId];
  const sequence = entry ? state.linearSequences[entry.sequenceId] : null;
  if (!entry || !sequence) return mutationResult(state, "Linear entry not found.");
  const currentIndex = sequence.entryOrder.indexOf(entryId);
  if (currentIndex === -1) return mutationResult(state, "Linear entry not found.");
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sequence.entryOrder.length) {
    return mutationResult(state, direction === "up" ? "Already at the top." : "Already at the bottom.");
  }
  const entryOrder = [...sequence.entryOrder];
  const [movedEntryId] = entryOrder.splice(currentIndex, 1);
  entryOrder.splice(targetIndex, 0, movedEntryId);
  return mutationResult({
    ...state,
    linearSequences: {
      ...state.linearSequences,
      [sequence.id]: { ...sequence, entryOrder },
    },
  });
};

export const removeLinearEntry = (
  state: ThreadsState,
  entryId: string,
): ThreadsState => {
  const entry = state.linearSequenceEntries[entryId];
  const sequence = entry ? state.linearSequences[entry.sequenceId] : null;
  if (!entry || !sequence) return state;
  const linearSequenceEntries = { ...state.linearSequenceEntries };
  delete linearSequenceEntries[entryId];
  const scriptElements = { ...state.scriptElements };
  for (const [elementId, element] of Object.entries(scriptElements)) {
    if (element.linkedEntryId === entryId) {
      scriptElements[elementId] = { ...element, linkedEntryId: undefined };
    }
  }
  return {
    ...state,
    linearSequences: {
      ...state.linearSequences,
      [sequence.id]: {
        ...sequence,
        entryOrder: sequence.entryOrder.filter((id) => id !== entryId),
      },
    },
    linearSequenceEntries,
    scriptElements,
  };
};

const getProjectScriptDocument = (
  state: ThreadsState,
  projectId: string,
): ScriptDocument | null =>
  Object.values(state.scriptDocuments).find((doc) => doc.projectId === projectId) ?? null;

export const getProjectScriptElements = (
  state: ThreadsState,
  projectId: string,
): ScriptElement[] => {
  const doc = getProjectScriptDocument(state, projectId);
  if (!doc) return [];
  return doc.elementOrder
    .map((id) => state.scriptElements[id])
    .filter((element): element is ScriptElement => Boolean(element));
};

export const addScriptElement = (
  state: ThreadsState,
  projectId: string,
  type: ScriptElementType,
  text: string,
  elementId: string,
  afterElementId?: string,
): ThreadsMutationResult => {
  if (!state.projects[projectId]) return mutationResult(state, "Project not found.");
  const doc = getProjectScriptDocument(state, projectId);
  if (!doc) return mutationResult(state, "Script not found.");
  if (!elementId || state.scriptElements[elementId]) {
    return mutationResult(state, "Could not add to Script.");
  }
  const elementOrder = [...doc.elementOrder];
  if (afterElementId) {
    const index = elementOrder.indexOf(afterElementId);
    if (index === -1) return mutationResult(state, "Script element not found.");
    elementOrder.splice(index + 1, 0, elementId);
  } else {
    elementOrder.push(elementId);
  }
  return mutationResult({
    ...state,
    scriptDocuments: {
      ...state.scriptDocuments,
      [doc.id]: { ...doc, elementOrder },
    },
    scriptElements: {
      ...state.scriptElements,
      [elementId]: { id: elementId, documentId: doc.id, type, text, linkedEntryId: undefined },
    },
  });
};

export const updateScriptElementText = (
  state: ThreadsState,
  elementId: string,
  text: string,
): ThreadsState => {
  const element = state.scriptElements[elementId];
  if (!element || element.text === text) return state;
  return {
    ...state,
    scriptElements: {
      ...state.scriptElements,
      [elementId]: { ...element, text },
    },
  };
};

export const updateScriptElementType = (
  state: ThreadsState,
  elementId: string,
  type: ScriptElementType,
): ThreadsState => {
  const element = state.scriptElements[elementId];
  if (!element || element.type === type) return state;
  return {
    ...state,
    scriptElements: {
      ...state.scriptElements,
      [elementId]: { ...element, type },
    },
  };
};

export const moveScriptElement = (
  state: ThreadsState,
  elementId: string,
  direction: MoveDirection,
): ThreadsMutationResult => {
  const element = state.scriptElements[elementId];
  const doc = element ? state.scriptDocuments[element.documentId] : null;
  if (!element || !doc) return mutationResult(state, "Script element not found.");
  const currentIndex = doc.elementOrder.indexOf(elementId);
  if (currentIndex === -1) return mutationResult(state, "Script element not found.");
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= doc.elementOrder.length) {
    return mutationResult(state, direction === "up" ? "Already at the top." : "Already at the bottom.");
  }
  const elementOrder = [...doc.elementOrder];
  const [movedElementId] = elementOrder.splice(currentIndex, 1);
  elementOrder.splice(targetIndex, 0, movedElementId);
  return mutationResult({
    ...state,
    scriptDocuments: {
      ...state.scriptDocuments,
      [doc.id]: { ...doc, elementOrder },
    },
  });
};

export const removeScriptElement = (
  state: ThreadsState,
  elementId: string,
): ThreadsState => {
  const element = state.scriptElements[elementId];
  const doc = element ? state.scriptDocuments[element.documentId] : null;
  if (!element || !doc) return state;
  const scriptElements = { ...state.scriptElements };
  delete scriptElements[elementId];
  return {
    ...state,
    scriptDocuments: {
      ...state.scriptDocuments,
      [doc.id]: {
        ...doc,
        elementOrder: doc.elementOrder.filter((id) => id !== elementId),
      },
    },
    scriptElements,
  };
};

export const linkScriptElementToEntry = (
  state: ThreadsState,
  elementId: string,
  entryId: string,
): ThreadsMutationResult => {
  const element = state.scriptElements[elementId];
  if (!element) return mutationResult(state, "Script element not found.");
  const doc = state.scriptDocuments[element.documentId];
  const entry = state.linearSequenceEntries[entryId];
  const sequence = entry ? state.linearSequences[entry.sequenceId] : null;
  if (!doc || !entry || !sequence || sequence.projectId !== doc.projectId) {
    return mutationResult(state, "Choose a Linear View entry from this Project.");
  }
  return mutationResult({
    ...state,
    scriptElements: {
      ...state.scriptElements,
      [elementId]: { ...element, linkedEntryId: entryId },
    },
  });
};

export const unlinkScriptElement = (
  state: ThreadsState,
  elementId: string,
): ThreadsState => {
  const element = state.scriptElements[elementId];
  if (!element || !element.linkedEntryId) return state;
  return {
    ...state,
    scriptElements: {
      ...state.scriptElements,
      [elementId]: { ...element, linkedEntryId: undefined },
    },
  };
};

export const createBlockFromScriptElement = (
  state: ThreadsState,
  elementId: string,
  threadId: string,
  blockId: string,
  placementId: string,
  linearEntryId: string,
): ThreadsMutationResult => {
  const element = state.scriptElements[elementId];
  if (!element) return mutationResult(state, "Script element not found.");
  const doc = state.scriptDocuments[element.documentId];
  const thread = doc ? state.threads[threadId] : null;
  if (!doc || !thread || thread.projectId !== doc.projectId) {
    return mutationResult(state, "Choose a Thread from this Project.");
  }
  const trimmedText = element.text.trim();
  if (!trimmedText) return mutationResult(state, "Script text is empty.");
  const withBlock = createBlock(state, threadId, trimmedText, blockId, placementId);
  if (withBlock === state) return mutationResult(state, "Could not create Block.");
  const withLinearEntry = addLinearBlockPlacementEntry(withBlock, doc.projectId, placementId, linearEntryId);
  if (withLinearEntry.error) return withLinearEntry;
  return linkScriptElementToEntry(withLinearEntry.state, elementId, linearEntryId);
};

const applyValidStrictTies = (
  state: ThreadsState,
  rawPlacements: Record<string, BlockPlacement>,
): ThreadsState => {
  let nextState = state;
  for (const placementId of state.blockPlacementOrder) {
    const rawPlacement = rawPlacements[placementId];
    if (!rawPlacement) continue;
    if (rawPlacement.strictTies.before) {
      nextState = setStrictTie(
        nextState,
        placementId,
        "before",
        rawPlacement.strictTies.before,
      ).state;
    }
    if (rawPlacement.strictTies.after) {
      nextState = setStrictTie(
        nextState,
        placementId,
        "after",
        rawPlacement.strictTies.after,
      ).state;
    }
  }
  return nextState;
};

const normalizeThreadsState = (
  projects: Record<string, Project>,
  projectOrderInput: unknown,
  threads: Record<string, Thread>,
  threadOrderInput: unknown,
  rawBlocks: Record<string, Block>,
  blockOrderInput: unknown,
  rawPlacements: Record<string, BlockPlacement>,
  placementOrderInput: unknown,
  rawCrossThreadLooseTies: Record<string, CrossThreadLooseTie> = {},
  crossThreadLooseTieOrderInput: unknown = [],
  rawLinearSequences: Record<string, LinearSequence> = {},
  linearSequenceOrderInput: unknown = [],
  rawLinearSequenceEntries: Record<string, LinearSequenceEntry> = {},
  rawScriptDocuments: Record<string, ScriptDocument> = {},
  scriptDocumentOrderInput: unknown = [],
  rawScriptElements: Record<string, ScriptElement> = {},
): ThreadsState => {
  const projectOrder = uniqueExistingIds(projectOrderInput, (id) => Boolean(projects[id]));
  for (const projectId of Object.keys(projects)) {
    if (!projectOrder.includes(projectId)) projectOrder.push(projectId);
  }

  const threadOrder = uniqueExistingIds(threadOrderInput, (id) => Boolean(threads[id]));
  for (const threadId of Object.keys(threads)) {
    if (!threadOrder.includes(threadId)) threadOrder.push(threadId);
  }

  const sourcePlacementOrder = uniqueExistingIds(
    placementOrderInput,
    (id) => Boolean(rawPlacements[id]),
  );
  for (const placementId of Object.keys(rawPlacements)) {
    if (!sourcePlacementOrder.includes(placementId)) sourcePlacementOrder.push(placementId);
  }

  const blockPlacements: Record<string, BlockPlacement> = {};
  const seenThreadBlocks = new Set<string>();
  for (const placementId of sourcePlacementOrder) {
    const placement = rawPlacements[placementId];
    if (
      !placement
      || !rawBlocks[placement.blockId]
      || !threads[placement.threadId]
    ) {
      continue;
    }
    const threadBlockKey = `${placement.threadId}:${placement.blockId}`;
    if (seenThreadBlocks.has(threadBlockKey)) continue;
    seenThreadBlocks.add(threadBlockKey);
    blockPlacements[placementId] = {
      ...placement,
      strictTies: emptyStrictTies(),
    };
  }
  const blockPlacementOrder = sourcePlacementOrder.filter((id) => Boolean(blockPlacements[id]));
  const usedBlockIds = new Set(
    Object.values(blockPlacements).map((placement) => placement.blockId),
  );

  const blocks: Record<string, Block> = {};
  for (const [blockId, block] of Object.entries(rawBlocks)) {
    if (usedBlockIds.has(blockId)) {
      blocks[blockId] = block;
    }
  }

  const blockOrder = uniqueExistingIds(blockOrderInput, (id) => Boolean(blocks[id]));
  for (const blockId of Object.keys(blocks)) {
    if (!blockOrder.includes(blockId)) blockOrder.push(blockId);
  }

  const crossThreadLooseTies: Record<string, CrossThreadLooseTie> = {};
  for (const [tieId, tie] of Object.entries(rawCrossThreadLooseTies)) {
    if (
      tie.id === tieId
      && tie.sourceBlockId !== tie.targetBlockId
      && Boolean(blocks[tie.sourceBlockId])
      && Boolean(blocks[tie.targetBlockId])
    ) {
      crossThreadLooseTies[tieId] = tie;
    }
  }

  const crossThreadLooseTieOrder = uniqueExistingIds(
    crossThreadLooseTieOrderInput,
    (id) => Boolean(crossThreadLooseTies[id]),
  );
  for (const tieId of Object.keys(crossThreadLooseTies)) {
    if (!crossThreadLooseTieOrder.includes(tieId)) {
      crossThreadLooseTieOrder.push(tieId);
    }
  }

  const stateWithStrictTies = applyValidStrictTies(
    {
      version: 5,
      projects,
      projectOrder,
      threads,
      threadOrder,
      blocks,
      blockOrder,
      blockPlacements,
      blockPlacementOrder,
      crossThreadLooseTies,
      crossThreadLooseTieOrder,
      linearSequences: {},
      linearSequenceOrder: [],
      linearSequenceEntries: {},
      scriptDocuments: {},
      scriptDocumentOrder: [],
      scriptElements: {},
    },
    rawPlacements,
  );

  const linearData = normalizeLinearData(
    projects,
    projectOrder,
    threads,
    stateWithStrictTies.blockPlacements,
    rawLinearSequences,
    linearSequenceOrderInput,
    rawLinearSequenceEntries,
  );

  return {
    ...stateWithStrictTies,
    ...linearData,
    ...normalizeScriptData(
      projects,
      projectOrder,
      linearData.linearSequenceEntries,
      rawScriptDocuments,
      scriptDocumentOrderInput,
      rawScriptElements,
    ),
  };
};

const normalizeLegacyThreadsState = (
  projects: Record<string, Project>,
  projectOrderInput: unknown,
  threads: Record<string, Thread>,
  threadOrderInput: unknown,
  rawLegacyBlocks: Record<string, LegacyBlock>,
  blockOrderInput: unknown,
  rawCrossThreadLooseTies: Record<string, CrossThreadLooseTie> = {},
  crossThreadLooseTieOrderInput: unknown = [],
): ThreadsState => {
  const blocks: Record<string, Block> = {};
  const placements: Record<string, BlockPlacement> = {};
  for (const legacyBlock of Object.values(rawLegacyBlocks)) {
    blocks[legacyBlock.id] = {
      id: legacyBlock.id,
      text: legacyBlock.text,
    };
    placements[legacyBlock.id] = {
      id: legacyBlock.id,
      blockId: legacyBlock.id,
      threadId: legacyBlock.threadId,
      strictTies: legacyBlock.strictTies,
    };
  }
  return normalizeThreadsState(
    projects,
    projectOrderInput,
    threads,
    threadOrderInput,
    blocks,
    blockOrderInput,
    placements,
    blockOrderInput,
    rawCrossThreadLooseTies,
    crossThreadLooseTieOrderInput,
  );
};

const parseProjectRecord = (
  value: unknown,
  id: string,
): Project | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Project>;
  if (
    candidate.id !== id
    || typeof candidate.name !== "string"
    || !isCreativeCategoryId(candidate.categoryId)
  ) {
    return null;
  }
  return {
    id,
    name: candidate.name.trim() || "Untitled Project",
    categoryId: candidate.categoryId,
  };
};

const parseThreadRecord = (
  value: unknown,
  id: string,
  projects: Record<string, Project>,
): Thread | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Thread>;
  if (
    candidate.id !== id
    || typeof candidate.name !== "string"
    || typeof candidate.projectId !== "string"
    || !projects[candidate.projectId]
  ) {
    return null;
  }
  return {
    id,
    name: candidate.name.trim() || "Untitled Thread",
    projectId: candidate.projectId,
  };
};

const parseBlockRecord = (
  value: unknown,
  id: string,
): Block | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Block>;
  if (
    candidate.id !== id
    || typeof candidate.text !== "string"
  ) {
    return null;
  }
  return {
    id,
    text: candidate.text.trim() || "Untitled Block",
  };
};

const parsePlacementRecord = (
  value: unknown,
  id: string,
  blocks: Record<string, Block>,
  threads: Record<string, Thread>,
): BlockPlacement | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BlockPlacement>;
  if (
    candidate.id !== id
    || typeof candidate.blockId !== "string"
    || typeof candidate.threadId !== "string"
    || !blocks[candidate.blockId]
    || !threads[candidate.threadId]
  ) {
    return null;
  }
  const strictTiesSource = candidate.strictTies && typeof candidate.strictTies === "object"
    ? candidate.strictTies as Partial<BlockStrictTies>
    : {};
  return {
    id,
    blockId: candidate.blockId,
    threadId: candidate.threadId,
    strictTies: {
      before: typeof strictTiesSource.before === "string" ? strictTiesSource.before : null,
      after: typeof strictTiesSource.after === "string" ? strictTiesSource.after : null,
    },
  };
};

const parseLegacyBlockRecord = (
  value: unknown,
  id: string,
  threads: Record<string, Thread>,
): LegacyBlock | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LegacyBlock> & {
    ties?: unknown;
    strictTies?: unknown;
  };
  if (
    candidate.id !== id
    || typeof candidate.text !== "string"
    || typeof candidate.threadId !== "string"
    || !threads[candidate.threadId]
  ) {
    return null;
  }
  const strictTiesSource = candidate.strictTies && typeof candidate.strictTies === "object"
    ? candidate.strictTies as Partial<BlockStrictTies>
    : candidate.ties && typeof candidate.ties === "object"
      ? candidate.ties as Partial<BlockStrictTies>
      : {};
  return {
    id,
    threadId: candidate.threadId,
    text: candidate.text.trim() || "Untitled Block",
    strictTies: {
      before: typeof strictTiesSource.before === "string" ? strictTiesSource.before : null,
      after: typeof strictTiesSource.after === "string" ? strictTiesSource.after : null,
    },
  };
};

const parseCrossThreadLooseTieRecord = (
  value: unknown,
  id: string,
  blocks: Record<string, Block> | Record<string, LegacyBlock>,
): CrossThreadLooseTie | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CrossThreadLooseTie>;
  if (
    candidate.id !== id
    || typeof candidate.sourceBlockId !== "string"
    || typeof candidate.targetBlockId !== "string"
    || candidate.sourceBlockId === candidate.targetBlockId
    || !blocks[candidate.sourceBlockId]
    || !blocks[candidate.targetBlockId]
  ) {
    return null;
  }
  return {
    id,
    sourceBlockId: candidate.sourceBlockId,
    targetBlockId: candidate.targetBlockId,
  };
};

const parseLinearSequenceRecord = (
  value: unknown,
  id: string,
  projects: Record<string, Project>,
): LinearSequence | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LinearSequence>;
  if (
    candidate.id !== id
    || typeof candidate.projectId !== "string"
    || !projects[candidate.projectId]
  ) {
    return null;
  }
  return {
    id,
    projectId: candidate.projectId,
    entryOrder: Array.isArray(candidate.entryOrder)
      ? candidate.entryOrder.filter((entryId): entryId is string => typeof entryId === "string")
      : [],
  };
};

const parseLinearSequenceEntryRecord = (
  value: unknown,
  id: string,
): LinearSequenceEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LinearSequenceEntry>;
  if (
    candidate.id !== id
    || typeof candidate.sequenceId !== "string"
    || typeof candidate.type !== "string"
  ) {
    return null;
  }
  if (candidate.type === "placement") {
    const placementEntry = candidate as Partial<Extract<LinearSequenceEntry, { type: "placement" }>>;
    if (typeof placementEntry.placementId !== "string") return null;
    return {
      id,
      sequenceId: candidate.sequenceId,
      type: "placement",
      placementId: placementEntry.placementId,
    };
  }
  if (candidate.type === "blank") {
    const blankEntry = candidate as Partial<Extract<LinearSequenceEntry, { type: "blank" }>>;
    return {
      id,
      sequenceId: candidate.sequenceId,
      type: "blank",
      note: typeof blankEntry.note === "string" ? blankEntry.note.trim() : "",
    };
  }
  if (candidate.type === "segment") {
    const segmentEntry = candidate as Partial<Extract<LinearSequenceEntry, { type: "segment" }>>;
    const title = typeof segmentEntry.title === "string" ? segmentEntry.title.trim() : "";
    if (!title) return null;
    const tier =
      segmentEntry.tier === "season" || segmentEntry.tier === "episode"
        ? segmentEntry.tier
        : undefined;
    return {
      id,
      sequenceId: candidate.sequenceId,
      type: "segment",
      title,
      tier,
    };
  }
  return null;
};

const parseScriptDocumentRecord = (
  value: unknown,
  id: string,
  projects: Record<string, Project>,
): ScriptDocument | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ScriptDocument>;
  if (
    candidate.id !== id
    || typeof candidate.projectId !== "string"
    || !projects[candidate.projectId]
  ) {
    return null;
  }
  return {
    id,
    projectId: candidate.projectId,
    elementOrder: Array.isArray(candidate.elementOrder)
      ? candidate.elementOrder.filter((elementId): elementId is string => typeof elementId === "string")
      : [],
  };
};

const parseScriptElementRecord = (
  value: unknown,
  id: string,
): ScriptElement | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ScriptElement>;
  if (
    candidate.id !== id
    || typeof candidate.documentId !== "string"
    || typeof candidate.type !== "string"
    || !SCRIPT_ELEMENT_TYPES.includes(candidate.type as ScriptElementType)
  ) {
    return null;
  }
  return {
    id,
    documentId: candidate.documentId,
    type: candidate.type as ScriptElementType,
    text: typeof candidate.text === "string" ? candidate.text : "",
    linkedEntryId: typeof candidate.linkedEntryId === "string" ? candidate.linkedEntryId : undefined,
  };
};

export const parseThreadsState = (raw: string | null): ThreadsState => {
  if (!raw) return createEmptyThreadsState();
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      projects?: unknown;
      projectOrder?: unknown;
      threads?: unknown;
      threadOrder?: unknown;
      blocks?: unknown;
      blockOrder?: unknown;
      blockPlacements?: unknown;
      blockPlacementOrder?: unknown;
      crossThreadLooseTies?: unknown;
      crossThreadLooseTieOrder?: unknown;
      linearSequences?: unknown;
      linearSequenceOrder?: unknown;
      linearSequenceEntries?: unknown;
      scriptDocuments?: unknown;
      scriptDocumentOrder?: unknown;
      scriptElements?: unknown;
    };
    if (parsed.version === 4) {
      return migrateV4ThreadsState(raw) ?? createEmptyThreadsState();
    }
    if (parsed.version === 3) {
      return migrateV3ThreadsState(raw) ?? createEmptyThreadsState();
    }
    if (
      parsed.version !== 5
      || !parsed.projects
      || typeof parsed.projects !== "object"
      || !parsed.threads
      || typeof parsed.threads !== "object"
      || !parsed.blocks
      || typeof parsed.blocks !== "object"
      || !parsed.blockPlacements
      || typeof parsed.blockPlacements !== "object"
    ) {
      return createEmptyThreadsState();
    }

    const projects: Record<string, Project> = {};
    for (const [id, value] of Object.entries(parsed.projects)) {
      const project = parseProjectRecord(value, id);
      if (project) projects[id] = project;
    }

    const threads: Record<string, Thread> = {};
    for (const [id, value] of Object.entries(parsed.threads)) {
      const thread = parseThreadRecord(value, id, projects);
      if (thread) threads[id] = thread;
    }

    const blocks: Record<string, Block> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      const block = parseBlockRecord(value, id);
      if (block) blocks[id] = block;
    }

    const blockPlacements: Record<string, BlockPlacement> = {};
    for (const [id, value] of Object.entries(parsed.blockPlacements)) {
      const placement = parsePlacementRecord(value, id, blocks, threads);
      if (placement) blockPlacements[id] = placement;
    }

    const crossThreadLooseTies: Record<string, CrossThreadLooseTie> = {};
    if (parsed.crossThreadLooseTies && typeof parsed.crossThreadLooseTies === "object") {
      for (const [id, value] of Object.entries(parsed.crossThreadLooseTies)) {
        const tie = parseCrossThreadLooseTieRecord(value, id, blocks);
        if (tie) crossThreadLooseTies[id] = tie;
      }
    }

    const linearSequences: Record<string, LinearSequence> = {};
    if (parsed.linearSequences && typeof parsed.linearSequences === "object") {
      for (const [id, value] of Object.entries(parsed.linearSequences)) {
        const sequence = parseLinearSequenceRecord(value, id, projects);
        if (sequence) linearSequences[id] = sequence;
      }
    }

    const linearSequenceEntries: Record<string, LinearSequenceEntry> = {};
    if (parsed.linearSequenceEntries && typeof parsed.linearSequenceEntries === "object") {
      for (const [id, value] of Object.entries(parsed.linearSequenceEntries)) {
        const entry = parseLinearSequenceEntryRecord(value, id);
        if (entry) linearSequenceEntries[id] = entry;
      }
    }

    const scriptDocuments: Record<string, ScriptDocument> = {};
    if (parsed.scriptDocuments && typeof parsed.scriptDocuments === "object") {
      for (const [id, value] of Object.entries(parsed.scriptDocuments)) {
        const doc = parseScriptDocumentRecord(value, id, projects);
        if (doc) scriptDocuments[id] = doc;
      }
    }

    const scriptElements: Record<string, ScriptElement> = {};
    if (parsed.scriptElements && typeof parsed.scriptElements === "object") {
      for (const [id, value] of Object.entries(parsed.scriptElements)) {
        const element = parseScriptElementRecord(value, id);
        if (element) scriptElements[id] = element;
      }
    }

    return normalizeThreadsState(
      projects,
      parsed.projectOrder,
      threads,
      parsed.threadOrder,
      blocks,
      parsed.blockOrder,
      blockPlacements,
      parsed.blockPlacementOrder,
      crossThreadLooseTies,
      parsed.crossThreadLooseTieOrder,
      linearSequences,
      parsed.linearSequenceOrder,
      linearSequenceEntries,
      scriptDocuments,
      parsed.scriptDocumentOrder,
      scriptElements,
    );
  } catch {
    return createEmptyThreadsState();
  }
};

const migrateV4ThreadsState = (raw: string | null): ThreadsState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      projects?: unknown;
      projectOrder?: unknown;
      threads?: unknown;
      threadOrder?: unknown;
      blocks?: unknown;
      blockOrder?: unknown;
      blockPlacements?: unknown;
      blockPlacementOrder?: unknown;
      crossThreadLooseTies?: unknown;
      crossThreadLooseTieOrder?: unknown;
    };
    if (
      parsed.version !== 4
      || !parsed.projects
      || typeof parsed.projects !== "object"
      || !parsed.threads
      || typeof parsed.threads !== "object"
      || !parsed.blocks
      || typeof parsed.blocks !== "object"
      || !parsed.blockPlacements
      || typeof parsed.blockPlacements !== "object"
    ) {
      return null;
    }

    const projects: Record<string, Project> = {};
    for (const [id, value] of Object.entries(parsed.projects)) {
      const project = parseProjectRecord(value, id);
      if (project) projects[id] = project;
    }

    const threads: Record<string, Thread> = {};
    for (const [id, value] of Object.entries(parsed.threads)) {
      const thread = parseThreadRecord(value, id, projects);
      if (thread) threads[id] = thread;
    }

    const blocks: Record<string, Block> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      const block = parseBlockRecord(value, id);
      if (block) blocks[id] = block;
    }

    const blockPlacements: Record<string, BlockPlacement> = {};
    for (const [id, value] of Object.entries(parsed.blockPlacements)) {
      const placement = parsePlacementRecord(value, id, blocks, threads);
      if (placement) blockPlacements[id] = placement;
    }

    const crossThreadLooseTies: Record<string, CrossThreadLooseTie> = {};
    if (parsed.crossThreadLooseTies && typeof parsed.crossThreadLooseTies === "object") {
      for (const [id, value] of Object.entries(parsed.crossThreadLooseTies)) {
        const tie = parseCrossThreadLooseTieRecord(value, id, blocks);
        if (tie) crossThreadLooseTies[id] = tie;
      }
    }

    return normalizeThreadsState(
      projects,
      parsed.projectOrder,
      threads,
      parsed.threadOrder,
      blocks,
      parsed.blockOrder,
      blockPlacements,
      parsed.blockPlacementOrder,
      crossThreadLooseTies,
      parsed.crossThreadLooseTieOrder,
    );
  } catch {
    return createEmptyThreadsState();
  }
};

const getV2ThreadDisplayBlockIds = (
  blocks: Record<string, LegacyBlock>,
  blockOrder: string[],
  threadId: string,
): string[] => {
  const threadBlockIds = blockOrder.filter((blockId) => blocks[blockId]?.threadId === threadId);
  const threadBlockIdSet = new Set(threadBlockIds);
  const unplacedBlockIds = threadBlockIds.filter((blockId) => {
    const strictTies = blocks[blockId]?.strictTies;
    return strictTies?.before === null && strictTies.after === null;
  });
  const unplacedBlockIdSet = new Set(unplacedBlockIds);
  const visited = new Set<string>();
  const orderedBlockIds: string[] = [];

  const walkAfter = (startBlockId: string) => {
    let currentId: string | null = startBlockId;
    while (currentId && threadBlockIdSet.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      orderedBlockIds.push(currentId);
      const nextId: string | null = blocks[currentId]?.strictTies.after ?? null;
      currentId = nextId && threadBlockIdSet.has(nextId) ? nextId : null;
    }
  };

  for (const blockId of threadBlockIds) {
    const block = blocks[blockId];
    if (!block || unplacedBlockIdSet.has(blockId)) continue;
    if (block.strictTies.before === null) walkAfter(blockId);
  }

  for (const blockId of threadBlockIds) {
    if (!visited.has(blockId) && !unplacedBlockIdSet.has(blockId)) {
      walkAfter(blockId);
    }
  }

  return [...orderedBlockIds, ...unplacedBlockIds];
};

const migrateV3ThreadsState = (raw: string | null): ThreadsState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      projects?: unknown;
      projectOrder?: unknown;
      threads?: unknown;
      threadOrder?: unknown;
      blocks?: unknown;
      blockOrder?: unknown;
      crossThreadLooseTies?: unknown;
      crossThreadLooseTieOrder?: unknown;
    };
    if (
      parsed.version !== 3
      || !parsed.projects
      || typeof parsed.projects !== "object"
      || !parsed.threads
      || typeof parsed.threads !== "object"
      || !parsed.blocks
      || typeof parsed.blocks !== "object"
    ) {
      return null;
    }

    const projects: Record<string, Project> = {};
    for (const [id, value] of Object.entries(parsed.projects)) {
      const project = parseProjectRecord(value, id);
      if (project) projects[id] = project;
    }

    const threads: Record<string, Thread> = {};
    for (const [id, value] of Object.entries(parsed.threads)) {
      const thread = parseThreadRecord(value, id, projects);
      if (thread) threads[id] = thread;
    }

    const blocks: Record<string, LegacyBlock> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      const block = parseLegacyBlockRecord(value, id, threads);
      if (block) blocks[id] = block;
    }

    const crossThreadLooseTies: Record<string, CrossThreadLooseTie> = {};
    if (parsed.crossThreadLooseTies && typeof parsed.crossThreadLooseTies === "object") {
      for (const [id, value] of Object.entries(parsed.crossThreadLooseTies)) {
        const tie = parseCrossThreadLooseTieRecord(value, id, blocks);
        if (tie) crossThreadLooseTies[id] = tie;
      }
    }

    return normalizeLegacyThreadsState(
      projects,
      parsed.projectOrder,
      threads,
      parsed.threadOrder,
      blocks,
      parsed.blockOrder,
      crossThreadLooseTies,
      parsed.crossThreadLooseTieOrder,
    );
  } catch {
    return createEmptyThreadsState();
  }
};

const migrateV2ThreadsState = (raw: string | null): ThreadsState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      projects?: unknown;
      projectOrder?: unknown;
      threads?: unknown;
      threadOrder?: unknown;
      blocks?: unknown;
      blockOrder?: unknown;
    };
    if (
      parsed.version !== 2
      || !parsed.projects
      || typeof parsed.projects !== "object"
      || !parsed.threads
      || typeof parsed.threads !== "object"
      || !parsed.blocks
      || typeof parsed.blocks !== "object"
    ) {
      return null;
    }

    const projects: Record<string, Project> = {};
    for (const [id, value] of Object.entries(parsed.projects)) {
      const project = parseProjectRecord(value, id);
      if (project) projects[id] = project;
    }

    const threads: Record<string, Thread> = {};
    for (const [id, value] of Object.entries(parsed.threads)) {
      const thread = parseThreadRecord(value, id, projects);
      if (thread) threads[id] = thread;
    }

    const blocks: Record<string, LegacyBlock> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      const block = parseLegacyBlockRecord(value, id, threads);
      if (block) blocks[id] = block;
    }

    const sourceBlockOrder = uniqueExistingIds(parsed.blockOrder, (id) => Boolean(blocks[id]));
    for (const blockId of Object.keys(blocks)) {
      if (!sourceBlockOrder.includes(blockId)) sourceBlockOrder.push(blockId);
    }

    const threadOrder = uniqueExistingIds(parsed.threadOrder, (id) => Boolean(threads[id]));
    for (const threadId of Object.keys(threads)) {
      if (!threadOrder.includes(threadId)) threadOrder.push(threadId);
    }

    const migratedBlockOrder: string[] = [];
    const migratedBlockOrderSet = new Set<string>();
    for (const threadId of threadOrder) {
      for (const blockId of getV2ThreadDisplayBlockIds(blocks, sourceBlockOrder, threadId)) {
        if (!migratedBlockOrderSet.has(blockId)) {
          migratedBlockOrder.push(blockId);
          migratedBlockOrderSet.add(blockId);
        }
      }
    }
    for (const blockId of sourceBlockOrder) {
      if (!migratedBlockOrderSet.has(blockId)) migratedBlockOrder.push(blockId);
    }

    return normalizeLegacyThreadsState(
      projects,
      parsed.projectOrder,
      threads,
      threadOrder,
      blocks,
      migratedBlockOrder,
    );
  } catch {
    return createEmptyThreadsState();
  }
};

const migrateLegacyProjectRecords = (
  raw: string | null,
): ThreadsState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      threads?: unknown;
      threadOrder?: unknown;
      projects?: unknown;
      projectOrder?: unknown;
      blocks?: unknown;
    };

    if (
      parsed.version === 1
      && parsed.threads
      && typeof parsed.threads === "object"
    ) {
      const projects: Record<string, Project> = {};
      for (const [id, value] of Object.entries(parsed.threads)) {
        const project = parseProjectRecord(value, id);
        if (project) projects[id] = project;
      }
      return normalizeThreadsState(projects, parsed.threadOrder, {}, [], {}, [], {}, []);
    }

    if (
      parsed.version === 2
      && parsed.projects
      && typeof parsed.projects === "object"
      && !parsed.threads
    ) {
      const projects: Record<string, Project> = {};
      for (const [id, value] of Object.entries(parsed.projects)) {
        const project = parseProjectRecord(value, id);
        if (project) projects[id] = project;
      }
      return normalizeThreadsState(projects, parsed.projectOrder, {}, [], {}, [], {}, []);
    }

    if (parsed.blocks && typeof parsed.blocks === "object") {
      return createProject(
        createEmptyThreadsState(),
        "Imported Syntax",
        "tools",
        IMPORTED_LEGACY_PROJECT_ID,
      );
    }
  } catch {
    return createEmptyThreadsState();
  }
  return null;
};

export const migrateLegacyThreadsState = (
  currentRaw: string | null,
  threadsV3Raw: string | null = null,
  threadsV2Raw: string | null = null,
  threadsV1Raw: string | null = null,
  groupedRaw: string | null = null,
  globalRaw: string | null = null,
): ThreadsState => {
  return migrateV4ThreadsState(currentRaw)
    ?? migrateV3ThreadsState(currentRaw)
    ?? migrateV2ThreadsState(currentRaw)
    ?? migrateV3ThreadsState(threadsV3Raw)
    ?? migrateV2ThreadsState(threadsV3Raw)
    ?? migrateLegacyProjectRecords(threadsV3Raw)
    ?? migrateV2ThreadsState(threadsV2Raw)
    ?? migrateLegacyProjectRecords(threadsV2Raw)
    ?? migrateLegacyProjectRecords(threadsV1Raw)
    ?? migrateLegacyProjectRecords(groupedRaw)
    ?? migrateLegacyProjectRecords(globalRaw)
    ?? createEmptyThreadsState();
};
