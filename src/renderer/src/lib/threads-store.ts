import {
  isCreativeCategoryId,
  type CreativeCategoryId,
} from "@shared/creative-categories";

export type TiePosition = "before" | "after";
export type MoveDirection = "up" | "down";

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

export interface ThreadsState {
  version: 4;
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

export const THREADS_STORAGE_KEY = "programs.threads.v4";
export const LEGACY_THREADS_V3_STORAGE_KEY = "programs.threads.v3";
export const LEGACY_THREADS_V2_STORAGE_KEY = "programs.threads.v2";
export const LEGACY_THREADS_STORAGE_KEY = "programs.threads.v1";
export const LEGACY_THREADS_SOURCE_STORAGE_KEY = "programs.systems-syntax.v2";
export const LEGACY_THREADS_SOURCE_GLOBAL_STORAGE_KEY = "programs.systems-syntax.v1";
export const IMPORTED_LEGACY_PROJECT_ID = "imported-syntax";

export const createEmptyThreadsState = (): ThreadsState => ({
  version: 4,
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
): Pick<
  ThreadsState,
  "blocks"
  | "blockOrder"
  | "blockPlacements"
  | "blockPlacementOrder"
  | "crossThreadLooseTies"
  | "crossThreadLooseTieOrder"
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

  return {
    blocks,
    blockOrder: state.blockOrder.filter((id) => Boolean(blocks[id])),
    blockPlacements,
    blockPlacementOrder: state.blockPlacementOrder.filter((id) => Boolean(blockPlacements[id])),
    crossThreadLooseTies,
    crossThreadLooseTieOrder: state.crossThreadLooseTieOrder.filter((id) =>
      Boolean(crossThreadLooseTies[id]),
    ),
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
  return {
    ...state,
    projects: {
      ...state.projects,
      [id]: { id, name: trimmedName, categoryId },
    },
    projectOrder: [...state.projectOrder, id],
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
    ...removeBlockPlacements(state, deletedPlacementIds),
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
  return {
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

  return applyValidStrictTies(
    {
      version: 4,
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
    },
    rawPlacements,
  );
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
    };
    if (parsed.version === 3) {
      return migrateV3ThreadsState(raw) ?? createEmptyThreadsState();
    }
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
  threadsV3Raw: string | null,
  threadsV2Raw: string | null = null,
  threadsV1Raw: string | null = null,
  groupedRaw: string | null = null,
  globalRaw: string | null = null,
): ThreadsState => {
  return migrateV3ThreadsState(threadsV3Raw)
    ?? migrateV2ThreadsState(threadsV3Raw)
    ?? migrateV2ThreadsState(threadsV2Raw)
    ?? migrateLegacyProjectRecords(threadsV2Raw)
    ?? migrateLegacyProjectRecords(threadsV1Raw)
    ?? migrateLegacyProjectRecords(groupedRaw)
    ?? migrateLegacyProjectRecords(globalRaw)
    ?? createEmptyThreadsState();
};
