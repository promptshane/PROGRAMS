import {
  isCreativeCategoryId,
  type CreativeCategoryId,
} from "@shared/creative-categories";

export interface SystemsSyntaxProject {
  id: string;
  name: string;
  categoryId: CreativeCategoryId;
  rootBlockIds: string[];
}

export interface SystemsSyntaxBlock {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null;
  children: string[];
}

export interface SystemsSyntaxState {
  version: 2;
  projects: Record<string, SystemsSyntaxProject>;
  projectOrder: string[];
  blocks: Record<string, SystemsSyntaxBlock>;
}

interface LegacySystemsSyntaxBlock {
  id: string;
  name: string;
  parentId: string | null;
  children: string[];
}

interface LegacySystemsSyntaxState {
  blocks: Record<string, LegacySystemsSyntaxBlock>;
  rootChildren: string[];
}

export const SYSTEMS_SYNTAX_STORAGE_KEY = "programs.systems-syntax.v2";
export const LEGACY_SYSTEMS_SYNTAX_STORAGE_KEY = "programs.systems-syntax.v1";
export const IMPORTED_SYSTEMS_SYNTAX_PROJECT_ID = "imported-syntax";

export const createEmptySystemsSyntaxState = (): SystemsSyntaxState => ({
  version: 2,
  projects: {},
  projectOrder: [],
  blocks: {},
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

const getChildren = (
  state: SystemsSyntaxState,
  projectId: string,
  parentId: string | null,
): string[] => {
  if (parentId === null) return state.projects[projectId]?.rootBlockIds ?? [];
  const parent = state.blocks[parentId];
  return parent?.projectId === projectId ? parent.children : [];
};

const setChildren = (
  state: SystemsSyntaxState,
  projectId: string,
  parentId: string | null,
  children: string[],
): SystemsSyntaxState => {
  if (parentId === null) {
    const project = state.projects[projectId];
    if (!project) return state;
    return {
      ...state,
      projects: {
        ...state.projects,
        [projectId]: { ...project, rootBlockIds: children },
      },
    };
  }
  const parent = state.blocks[parentId];
  if (!parent || parent.projectId !== projectId) return state;
  return {
    ...state,
    blocks: {
      ...state.blocks,
      [parentId]: { ...parent, children },
    },
  };
};

export const createSystemsSyntaxProject = (
  state: SystemsSyntaxState,
  name: string,
  categoryId: CreativeCategoryId,
  id: string,
): SystemsSyntaxState => {
  const trimmedName = name.trim();
  if (!trimmedName || !id || state.projects[id] || !isCreativeCategoryId(categoryId)) {
    return state;
  }
  return {
    ...state,
    projects: {
      ...state.projects,
      [id]: {
        id,
        name: trimmedName,
        categoryId,
        rootBlockIds: [],
      },
    },
    projectOrder: [...state.projectOrder, id],
  };
};

export const updateSystemsSyntaxProject = (
  state: SystemsSyntaxState,
  projectId: string,
  updates: { name?: string; categoryId?: CreativeCategoryId },
): SystemsSyntaxState => {
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

export const moveSystemsSyntaxProject = (
  state: SystemsSyntaxState,
  projectId: string,
  targetIndex: number,
): SystemsSyntaxState => {
  const sourceIndex = state.projectOrder.indexOf(projectId);
  if (sourceIndex < 0) return state;
  const projectOrder = state.projectOrder.filter((id) => id !== projectId);
  const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  projectOrder.splice(
    Math.max(0, Math.min(projectOrder.length, adjustedIndex)),
    0,
    projectId,
  );
  if (projectOrder.every((id, index) => id === state.projectOrder[index])) return state;
  return { ...state, projectOrder };
};

export const moveSystemsSyntaxProjectToCategory = (
  state: SystemsSyntaxState,
  projectId: string,
  targetCategoryId: CreativeCategoryId,
  targetIndex?: number,
): SystemsSyntaxState => {
  const project = state.projects[projectId];
  if (!project || !isCreativeCategoryId(targetCategoryId)) return state;
  if (project.categoryId === targetCategoryId && targetIndex === undefined) {
    return state;
  }

  const sourceCategoryIndex =
    project.categoryId === targetCategoryId
      ? state.projectOrder
          .filter((id) => state.projects[id]?.categoryId === targetCategoryId)
          .indexOf(projectId)
      : -1;
  const adjustedTargetIndex =
    targetIndex !== undefined
    && sourceCategoryIndex >= 0
    && sourceCategoryIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const projects = {
    ...state.projects,
    [projectId]: {
      ...project,
      categoryId: targetCategoryId,
    },
  };
  const projectOrder = state.projectOrder.filter((id) => id !== projectId);
  const targetProjectIds = projectOrder.filter(
    (id) => projects[id]?.categoryId === targetCategoryId,
  );
  const boundedTargetIndex =
    adjustedTargetIndex === undefined
      ? targetProjectIds.length
      : Math.max(0, Math.min(targetProjectIds.length, adjustedTargetIndex));
  const insertBeforeId = targetProjectIds[boundedTargetIndex] ?? null;
  const insertAfterId = targetProjectIds[boundedTargetIndex - 1] ?? null;
  const insertIndex = insertBeforeId
    ? projectOrder.indexOf(insertBeforeId)
    : insertAfterId
      ? projectOrder.indexOf(insertAfterId) + 1
      : projectOrder.length;

  projectOrder.splice(Math.max(0, insertIndex), 0, projectId);

  if (
    projects[projectId].categoryId === project.categoryId
    && projectOrder.every((id, index) => id === state.projectOrder[index])
  ) {
    return state;
  }

  return { ...state, projects, projectOrder };
};

export const deleteSystemsSyntaxProject = (
  state: SystemsSyntaxState,
  projectId: string,
): SystemsSyntaxState => {
  if (!state.projects[projectId]) return state;
  const projects = { ...state.projects };
  delete projects[projectId];
  const blocks = Object.fromEntries(
    Object.entries(state.blocks).filter(([, block]) => block.projectId !== projectId),
  );
  return {
    ...state,
    projects,
    projectOrder: state.projectOrder.filter((id) => id !== projectId),
    blocks,
  };
};

export const createSystemsSyntaxBlock = (
  state: SystemsSyntaxState,
  projectId: string,
  name: string,
  parentId: string | null,
  id: string,
): SystemsSyntaxState => {
  const project = state.projects[projectId];
  const trimmedName = name.trim();
  if (!project || !trimmedName || !id || state.blocks[id]) return state;
  const resolvedParentId =
    parentId && state.blocks[parentId]?.projectId === projectId ? parentId : null;
  const block: SystemsSyntaxBlock = {
    id,
    projectId,
    name: trimmedName,
    parentId: resolvedParentId,
    children: [],
  };
  const nextState: SystemsSyntaxState = {
    ...state,
    blocks: { ...state.blocks, [id]: block },
  };
  return setChildren(nextState, projectId, resolvedParentId, [
    ...getChildren(nextState, projectId, resolvedParentId),
    id,
  ]);
};

export const updateSystemsSyntaxBlock = (
  state: SystemsSyntaxState,
  blockId: string,
  name: string,
): SystemsSyntaxState => {
  const block = state.blocks[blockId];
  const trimmedName = name.trim();
  if (!block || !trimmedName || trimmedName === block.name) return state;
  return {
    ...state,
    blocks: {
      ...state.blocks,
      [blockId]: { ...block, name: trimmedName },
    },
  };
};

const collectBlockTreeIds = (
  state: SystemsSyntaxState,
  blockId: string,
): Set<string> => {
  const collected = new Set<string>();
  const pending = [blockId];
  while (pending.length > 0) {
    const currentId = pending.pop();
    if (!currentId || collected.has(currentId)) continue;
    const block = state.blocks[currentId];
    if (!block) continue;
    collected.add(currentId);
    pending.push(...block.children);
  }
  return collected;
};

export const deleteSystemsSyntaxBlock = (
  state: SystemsSyntaxState,
  blockId: string,
): SystemsSyntaxState => {
  const block = state.blocks[blockId];
  if (!block) return state;
  const deletedIds = collectBlockTreeIds(state, blockId);
  let nextState = setChildren(
    state,
    block.projectId,
    block.parentId,
    getChildren(state, block.projectId, block.parentId).filter((id) => id !== blockId),
  );
  const blocks = { ...nextState.blocks };
  for (const id of deletedIds) delete blocks[id];
  nextState = { ...nextState, blocks };
  return nextState;
};

const isDescendant = (
  state: SystemsSyntaxState,
  candidateId: string,
  ancestorId: string,
): boolean => {
  let currentId: string | null = candidateId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    currentId = state.blocks[currentId]?.parentId ?? null;
  }
  return false;
};

export const moveSystemsSyntaxBlock = (
  state: SystemsSyntaxState,
  blockId: string,
  targetProjectId: string,
  targetParentId: string | null,
  targetIndex: number,
): SystemsSyntaxState => {
  const block = state.blocks[blockId];
  if (!block || block.projectId !== targetProjectId) return state;
  if (!state.projects[targetProjectId]) return state;
  if (targetParentId === blockId) return state;
  if (
    targetParentId
    && state.blocks[targetParentId]?.projectId !== targetProjectId
  ) {
    return state;
  }
  if (targetParentId && isDescendant(state, targetParentId, blockId)) return state;

  const sourceParentId = block.parentId;
  const sourceChildren = getChildren(state, targetProjectId, sourceParentId);
  const sourceIndex = sourceChildren.indexOf(blockId);
  if (sourceIndex < 0) return state;

  let nextState = setChildren(
    state,
    targetProjectId,
    sourceParentId,
    sourceChildren.filter((childId) => childId !== blockId),
  );
  const targetChildren = getChildren(nextState, targetProjectId, targetParentId).filter(
    (childId) => childId !== blockId,
  );
  const adjustedIndex =
    sourceParentId === targetParentId && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  targetChildren.splice(
    Math.max(0, Math.min(targetChildren.length, adjustedIndex)),
    0,
    blockId,
  );
  nextState = setChildren(nextState, targetProjectId, targetParentId, targetChildren);

  return {
    ...nextState,
    blocks: {
      ...nextState.blocks,
      [blockId]: { ...block, parentId: targetParentId },
    },
  };
};

export const getSystemsSyntaxPath = (
  state: SystemsSyntaxState,
  blockId: string | null,
): SystemsSyntaxBlock[] => {
  const path: SystemsSyntaxBlock[] = [];
  let currentId = blockId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    const block = state.blocks[currentId];
    if (!block) break;
    path.unshift(block);
    visited.add(currentId);
    currentId = block.parentId;
  }
  return path;
};

const normalizeSystemsSyntaxState = (
  projects: Record<string, SystemsSyntaxProject>,
  projectOrderInput: unknown,
  blocks: Record<string, SystemsSyntaxBlock>,
): SystemsSyntaxState => {
  const projectOrder = uniqueExistingIds(projectOrderInput, (id) => Boolean(projects[id]));
  for (const projectId of Object.keys(projects)) {
    if (!projectOrder.includes(projectId)) projectOrder.push(projectId);
  }

  for (const block of Object.values(blocks)) {
    const parent = block.parentId ? blocks[block.parentId] : null;
    if (
      !parent
      || parent.id === block.id
      || parent.projectId !== block.projectId
    ) {
      block.parentId = null;
    }
  }

  for (const block of Object.values(blocks)) {
    const visited = new Set<string>([block.id]);
    let currentId = block.parentId;
    while (currentId) {
      if (visited.has(currentId)) {
        block.parentId = null;
        break;
      }
      visited.add(currentId);
      currentId = blocks[currentId]?.parentId ?? null;
    }
  }

  const orderedByParent = new Map<string, string[]>();
  for (const project of Object.values(projects)) {
    orderedByParent.set(
      `${project.id}:root`,
      uniqueExistingIds(
        project.rootBlockIds,
        (id) => blocks[id]?.projectId === project.id && blocks[id]?.parentId === null,
      ),
    );
  }
  for (const block of Object.values(blocks)) {
    orderedByParent.set(
      block.id,
      uniqueExistingIds(
        block.children,
        (id) =>
          blocks[id]?.projectId === block.projectId
          && blocks[id]?.parentId === block.id,
      ),
    );
  }
  for (const block of Object.values(blocks)) {
    const key = block.parentId ?? `${block.projectId}:root`;
    const siblings = orderedByParent.get(key) ?? [];
    if (!siblings.includes(block.id)) siblings.push(block.id);
    orderedByParent.set(key, siblings);
  }
  for (const project of Object.values(projects)) {
    project.rootBlockIds = orderedByParent.get(`${project.id}:root`) ?? [];
  }
  for (const block of Object.values(blocks)) {
    block.children = orderedByParent.get(block.id) ?? [];
  }

  return { version: 2, projects, projectOrder, blocks };
};

export const parseSystemsSyntaxState = (raw: string | null): SystemsSyntaxState => {
  if (!raw) return createEmptySystemsSyntaxState();
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      projects?: unknown;
      projectOrder?: unknown;
      blocks?: unknown;
    };
    if (
      parsed.version !== 2
      || !parsed.projects
      || typeof parsed.projects !== "object"
      || !parsed.blocks
      || typeof parsed.blocks !== "object"
    ) {
      return createEmptySystemsSyntaxState();
    }

    const projects: Record<string, SystemsSyntaxProject> = {};
    for (const [id, value] of Object.entries(parsed.projects)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<SystemsSyntaxProject>;
      if (
        candidate.id !== id
        || typeof candidate.name !== "string"
        || !isCreativeCategoryId(candidate.categoryId)
      ) {
        continue;
      }
      projects[id] = {
        id,
        name: candidate.name.trim() || "Untitled project",
        categoryId: candidate.categoryId,
        rootBlockIds: Array.isArray(candidate.rootBlockIds)
          ? candidate.rootBlockIds.filter((blockId): blockId is string => typeof blockId === "string")
          : [],
      };
    }

    const blocks: Record<string, SystemsSyntaxBlock> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<SystemsSyntaxBlock>;
      if (
        candidate.id !== id
        || typeof candidate.name !== "string"
        || typeof candidate.projectId !== "string"
        || !projects[candidate.projectId]
      ) {
        continue;
      }
      blocks[id] = {
        id,
        projectId: candidate.projectId,
        name: candidate.name.trim() || "Untitled block",
        parentId: typeof candidate.parentId === "string" ? candidate.parentId : null,
        children: Array.isArray(candidate.children)
          ? candidate.children.filter((childId): childId is string => typeof childId === "string")
          : [],
      };
    }

    return normalizeSystemsSyntaxState(projects, parsed.projectOrder, blocks);
  } catch {
    return createEmptySystemsSyntaxState();
  }
};

const parseLegacySystemsSyntaxState = (
  raw: string | null,
): LegacySystemsSyntaxState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacySystemsSyntaxState>;
    if (!parsed.blocks || typeof parsed.blocks !== "object") return null;
    const blocks: Record<string, LegacySystemsSyntaxBlock> = {};
    for (const [id, value] of Object.entries(parsed.blocks)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<LegacySystemsSyntaxBlock>;
      if (candidate.id !== id || typeof candidate.name !== "string") continue;
      blocks[id] = {
        id,
        name: candidate.name.trim() || "Untitled block",
        parentId: typeof candidate.parentId === "string" ? candidate.parentId : null,
        children: Array.isArray(candidate.children)
          ? candidate.children.filter((childId): childId is string => typeof childId === "string")
          : [],
      };
    }
    if (Object.keys(blocks).length === 0) return null;
    for (const block of Object.values(blocks)) {
      if (!block.parentId || !blocks[block.parentId] || block.parentId === block.id) {
        block.parentId = null;
      }
      block.children = uniqueExistingIds(
        block.children,
        (childId) => childId !== block.id && Boolean(blocks[childId]),
      );
    }
    const rootChildren = uniqueExistingIds(
      parsed.rootChildren,
      (id) => Boolean(blocks[id]),
    );
    return { blocks, rootChildren };
  } catch {
    return null;
  }
};

export const migrateLegacySystemsSyntaxState = (
  raw: string | null,
  projectId = IMPORTED_SYSTEMS_SYNTAX_PROJECT_ID,
): SystemsSyntaxState => {
  const legacy = parseLegacySystemsSyntaxState(raw);
  if (!legacy) return createEmptySystemsSyntaxState();
  const projects: Record<string, SystemsSyntaxProject> = {
    [projectId]: {
      id: projectId,
      name: "Imported Syntax",
      categoryId: "tools",
      rootBlockIds: legacy.rootChildren,
    },
  };
  const blocks: Record<string, SystemsSyntaxBlock> = Object.fromEntries(
    Object.values(legacy.blocks).map((block) => [
      block.id,
      { ...block, projectId },
    ]),
  );
  return normalizeSystemsSyntaxState(projects, [projectId], blocks);
};
