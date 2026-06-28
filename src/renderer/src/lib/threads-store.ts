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
  threadId: string;
  text: string;
  strictTies: BlockStrictTies;
}

export interface CrossThreadLooseTie {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
}

export interface ThreadsState {
  version: 3;
  projects: Record<string, Project>;
  projectOrder: string[];
  threads: Record<string, Thread>;
  threadOrder: string[];
  blocks: Record<string, Block>;
  blockOrder: string[];
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

export const THREADS_STORAGE_KEY = "programs.threads.v3";
export const LEGACY_THREADS_V2_STORAGE_KEY = "programs.threads.v2";
export const LEGACY_THREADS_STORAGE_KEY = "programs.threads.v1";
export const LEGACY_THREADS_SOURCE_STORAGE_KEY = "programs.systems-syntax.v2";
export const LEGACY_THREADS_SOURCE_GLOBAL_STORAGE_KEY = "programs.systems-syntax.v1";
export const IMPORTED_LEGACY_PROJECT_ID = "imported-syntax";

export const createEmptyThreadsState = (): ThreadsState => ({
  version: 3,
  projects: {},
  projectOrder: [],
  threads: {},
  threadOrder: [],
  blocks: {},
  blockOrder: [],
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

const copyBlockWithStrictTie = (
  blocks: Record<string, Block>,
  blockId: string,
  position: TiePosition,
  targetBlockId: string | null,
): Record<string, Block> => {
  const block = blocks[blockId];
  if (!block || block.strictTies[position] === targetBlockId) return blocks;
  return {
    ...blocks,
    [blockId]: {
      ...block,
      strictTies: {
        ...block.strictTies,
        [position]: targetBlockId,
      },
    },
  };
};

const removeBlocks = (
  state: ThreadsState,
  deletedBlockIds: Set<string>,
): Pick<ThreadsState, "blocks" | "blockOrder" | "crossThreadLooseTies" | "crossThreadLooseTieOrder"> => {
  const blocks: Record<string, Block> = {};
  for (const [blockId, block] of Object.entries(state.blocks)) {
    if (deletedBlockIds.has(blockId)) continue;
    blocks[blockId] = {
      ...block,
      strictTies: {
        before: deletedBlockIds.has(block.strictTies.before ?? "") ? null : block.strictTies.before,
        after: deletedBlockIds.has(block.strictTies.after ?? "") ? null : block.strictTies.after,
      },
    };
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
    blockOrder: state.blockOrder.filter((id) => !deletedBlockIds.has(id)),
    crossThreadLooseTies,
    crossThreadLooseTieOrder: state.crossThreadLooseTieOrder.filter((id) =>
      Boolean(crossThreadLooseTies[id]),
    ),
  };
};

const replaceThreadBlockOrder = (
  state: ThreadsState,
  threadId: string,
  nextThreadBlockIds: string[],
): string[] => {
  let inserted = false;
  const nextBlockOrder: string[] = [];
  for (const blockId of state.blockOrder) {
    const block = state.blocks[blockId];
    if (block?.threadId !== threadId) {
      nextBlockOrder.push(blockId);
      continue;
    }
    if (!inserted) {
      nextBlockOrder.push(...nextThreadBlockIds);
      inserted = true;
    }
  }
  if (!inserted) nextBlockOrder.push(...nextThreadBlockIds);
  return nextBlockOrder;
};

const getStrictSegmentIds = (
  state: ThreadsState,
  blockId: string,
): string[] => {
  const block = state.blocks[blockId];
  if (!block) return [];
  const threadBlockIds = getThreadBlockIds(state, block.threadId);
  const blockIndex = threadBlockIds.indexOf(blockId);
  if (blockIndex === -1) return [];

  let start = blockIndex;
  while (start > 0) {
    const currentId = threadBlockIds[start];
    const previousId = threadBlockIds[start - 1];
    const current = state.blocks[currentId];
    const previous = state.blocks[previousId];
    if (
      current?.strictTies.before === previousId
      && previous?.strictTies.after === currentId
    ) {
      start -= 1;
      continue;
    }
    break;
  }

  let end = blockIndex;
  while (end < threadBlockIds.length - 1) {
    const currentId = threadBlockIds[end];
    const nextId = threadBlockIds[end + 1];
    const current = state.blocks[currentId];
    const next = state.blocks[nextId];
    if (
      current?.strictTies.after === nextId
      && next?.strictTies.before === currentId
    ) {
      end += 1;
      continue;
    }
    break;
  }

  return threadBlockIds.slice(start, end + 1);
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
  const deletedBlockIds = new Set(
    Object.values(state.blocks)
      .filter((block) => deletedThreadIds.has(block.threadId))
      .map((block) => block.id),
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
    ...removeBlocks(state, deletedBlockIds),
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

export const deleteThread = (
  state: ThreadsState,
  threadId: string,
): ThreadsState => {
  if (!state.threads[threadId]) return state;

  const deletedBlockIds = new Set(
    Object.values(state.blocks)
      .filter((block) => block.threadId === threadId)
      .map((block) => block.id),
  );
  const threads = { ...state.threads };
  delete threads[threadId];

  return {
    ...state,
    threads,
    threadOrder: state.threadOrder.filter((id) => id !== threadId),
    ...removeBlocks(state, deletedBlockIds),
  };
};

export const createBlock = (
  state: ThreadsState,
  threadId: string,
  text: string,
  id: string,
): ThreadsState => {
  const thread = state.threads[threadId];
  const trimmedText = text.trim();
  if (!thread || !trimmedText || !id || state.blocks[id]) return state;
  return {
    ...state,
    blocks: {
      ...state.blocks,
      [id]: {
        id,
        threadId,
        text: trimmedText,
        strictTies: emptyStrictTies(),
      },
    },
    blockOrder: [...state.blockOrder, id],
  };
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

export const deleteBlock = (
  state: ThreadsState,
  blockId: string,
): ThreadsState => {
  if (!state.blocks[blockId]) return state;
  return {
    ...state,
    ...removeBlocks(state, new Set([blockId])),
  };
};

export const setStrictTie = (
  state: ThreadsState,
  blockId: string,
  position: TiePosition,
  targetBlockId: string,
): ThreadsMutationResult => {
  const block = state.blocks[blockId];
  const targetBlock = state.blocks[targetBlockId];
  if (!block || !targetBlock || block.id === targetBlock.id) {
    return mutationResult(state, "Choose two different blocks for a strict tie.");
  }
  if (block.threadId !== targetBlock.threadId) {
    return mutationResult(state, "Strict ties can only connect blocks in the same thread.");
  }

  const threadBlockIds = getThreadBlockIds(state, block.threadId);
  const blockIndex = threadBlockIds.indexOf(blockId);
  const targetIndex = threadBlockIds.indexOf(targetBlockId);
  const expectedTargetIndex = position === "before" ? blockIndex - 1 : blockIndex + 1;
  if (blockIndex === -1 || targetIndex !== expectedTargetIndex) {
    return mutationResult(
      state,
      "Strict ties require adjacent blocks. Reorder the blocks first.",
    );
  }

  const opposite = oppositeTie(position);
  if (block.strictTies[position] === targetBlockId && targetBlock.strictTies[opposite] === blockId) {
    return mutationResult(state);
  }
  if (block.strictTies[position] && block.strictTies[position] !== targetBlockId) {
    return mutationResult(state, "Remove the existing strict tie in this slot first.");
  }
  if (targetBlock.strictTies[opposite] && targetBlock.strictTies[opposite] !== blockId) {
    return mutationResult(state, "Remove the neighboring block's strict tie first.");
  }
  if (block.strictTies[opposite] === targetBlockId || targetBlock.strictTies[position] === blockId) {
    return mutationResult(state, "Those blocks are already strictly tied in the opposite direction.");
  }

  let blocks = state.blocks;
  blocks = copyBlockWithStrictTie(blocks, blockId, position, targetBlockId);
  blocks = copyBlockWithStrictTie(blocks, targetBlockId, opposite, blockId);
  return mutationResult(blocks === state.blocks ? state : { ...state, blocks });
};

export const clearStrictTie = (
  state: ThreadsState,
  blockId: string,
  position: TiePosition,
): ThreadsState => {
  const block = state.blocks[blockId];
  const targetBlockId = block?.strictTies[position] ?? null;
  if (!block || !targetBlockId) return state;
  const opposite = oppositeTie(position);
  let blocks = copyBlockWithStrictTie(state.blocks, blockId, position, null);
  if (blocks[targetBlockId]?.strictTies[opposite] === blockId) {
    blocks = copyBlockWithStrictTie(blocks, targetBlockId, opposite, null);
  }
  return blocks === state.blocks ? state : { ...state, blocks };
};

export const moveBlockInThread = (
  state: ThreadsState,
  blockId: string,
  direction: MoveDirection,
): ThreadsMutationResult => {
  const block = state.blocks[blockId];
  if (!block) return mutationResult(state, "Block not found.");

  const threadBlockIds = getThreadBlockIds(state, block.threadId);
  const selectedSegment = getStrictSegmentIds(state, blockId);
  if (selectedSegment.length === 0) return mutationResult(state, "Block not found.");

  const selectedStart = threadBlockIds.indexOf(selectedSegment[0]);
  const selectedEnd = threadBlockIds.indexOf(selectedSegment[selectedSegment.length - 1]);
  const neighborIndex = direction === "up" ? selectedStart - 1 : selectedEnd + 1;
  if (neighborIndex < 0 || neighborIndex >= threadBlockIds.length) {
    return mutationResult(state, direction === "up" ? "Already at the top." : "Already at the bottom.");
  }

  const neighborId = threadBlockIds[neighborIndex];
  const neighborSegment = getStrictSegmentIds(state, neighborId);
  if (neighborSegment.length === 0) {
    return mutationResult(state, "Block not found.");
  }

  const selectedSet = new Set(selectedSegment);
  const remaining = threadBlockIds.filter((id) => !selectedSet.has(id));
  const insertAt = direction === "up"
    ? remaining.indexOf(neighborSegment[0])
    : remaining.indexOf(neighborSegment[neighborSegment.length - 1]) + 1;
  const nextThreadBlockIds = [
    ...remaining.slice(0, insertAt),
    ...selectedSegment,
    ...remaining.slice(insertAt),
  ];

  return mutationResult({
    ...state,
    blockOrder: replaceThreadBlockOrder(state, block.threadId, nextThreadBlockIds),
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
  state.blockOrder.filter((blockId) => state.blocks[blockId]?.threadId === threadId).length;

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

export const getThreadBlockIds = (
  state: ThreadsState,
  threadId: string,
): string[] =>
  state.blockOrder.filter((blockId) => state.blocks[blockId]?.threadId === threadId);

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
  rawBlocks: Record<string, Block>,
): ThreadsState => {
  let nextState = state;
  for (const blockId of state.blockOrder) {
    const rawBlock = rawBlocks[blockId];
    if (!rawBlock) continue;
    if (rawBlock.strictTies.before) {
      nextState = setStrictTie(
        nextState,
        blockId,
        "before",
        rawBlock.strictTies.before,
      ).state;
    }
    if (rawBlock.strictTies.after) {
      nextState = setStrictTie(
        nextState,
        blockId,
        "after",
        rawBlock.strictTies.after,
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

  const blockOrder = uniqueExistingIds(blockOrderInput, (id) => Boolean(rawBlocks[id]));
  for (const blockId of Object.keys(rawBlocks)) {
    if (!blockOrder.includes(blockId)) blockOrder.push(blockId);
  }

  const blocks = Object.fromEntries(
    Object.values(rawBlocks).map((block) => [
      block.id,
      { ...block, strictTies: emptyStrictTies() },
    ]),
  );

  const crossThreadLooseTies: Record<string, CrossThreadLooseTie> = {};
  for (const [tieId, tie] of Object.entries(rawCrossThreadLooseTies)) {
    if (
      tie.id === tieId
      && tie.sourceBlockId !== tie.targetBlockId
      && Boolean(rawBlocks[tie.sourceBlockId])
      && Boolean(rawBlocks[tie.targetBlockId])
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
      version: 3,
      projects,
      projectOrder,
      threads,
      threadOrder,
      blocks,
      blockOrder,
      crossThreadLooseTies,
      crossThreadLooseTieOrder,
    },
    rawBlocks,
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
  threads: Record<string, Thread>,
): Block | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Block> & {
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

const parseV2BlockRecord = (
  value: unknown,
  id: string,
  threads: Record<string, Thread>,
): Block | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Block> & { ties?: unknown };
  if (
    candidate.id !== id
    || typeof candidate.text !== "string"
    || typeof candidate.threadId !== "string"
    || !threads[candidate.threadId]
  ) {
    return null;
  }
  const ties = candidate.ties && typeof candidate.ties === "object"
    ? candidate.ties as Partial<BlockStrictTies>
    : {};
  return {
    id,
    threadId: candidate.threadId,
    text: candidate.text.trim() || "Untitled Block",
    strictTies: {
      before: typeof ties.before === "string" ? ties.before : null,
      after: typeof ties.after === "string" ? ties.after : null,
    },
  };
};

const parseCrossThreadLooseTieRecord = (
  value: unknown,
  id: string,
  blocks: Record<string, Block>,
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
      const block = parseBlockRecord(value, id, threads);
      if (block) blocks[id] = block;
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
      crossThreadLooseTies,
      parsed.crossThreadLooseTieOrder,
    );
  } catch {
    return createEmptyThreadsState();
  }
};

const getV2ThreadDisplayBlockIds = (
  blocks: Record<string, Block>,
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

    const blocks: Record<string, Block> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      const block = parseV2BlockRecord(value, id, threads);
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

    return normalizeThreadsState(
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
      return normalizeThreadsState(projects, parsed.threadOrder, {}, [], {}, []);
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
      return normalizeThreadsState(projects, parsed.projectOrder, {}, [], {}, []);
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
  threadsV2Raw: string | null,
  threadsV1Raw: string | null = null,
  groupedRaw: string | null = null,
  globalRaw: string | null = null,
): ThreadsState => {
  return migrateV2ThreadsState(threadsV2Raw)
    ?? migrateLegacyProjectRecords(threadsV1Raw)
    ?? migrateLegacyProjectRecords(groupedRaw)
    ?? migrateLegacyProjectRecords(globalRaw)
    ?? createEmptyThreadsState();
};
