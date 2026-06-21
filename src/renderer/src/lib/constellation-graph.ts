export type ConstellationCategoryId =
  | "stories"
  | "philosophy"
  | "tools"
  | "games"
  | "videos"
  | "music";

export type ConstellationNodeKind = "self" | "category" | "project" | "system";

export type ConstellationNodeStatus = "quiet" | "active" | "attention";

export interface ConstellationVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ConstellationNode extends ConstellationVector3 {
  id: string;
  label: string;
  kind: ConstellationNodeKind;
  categoryId: ConstellationCategoryId | null;
  parentId: string | null;
  description: string;
  magnitude: number;
  priority: number;
  status: ConstellationNodeStatus;
  phase: number;
}

export type ConstellationEdgeKind = "hierarchy" | "dependency" | "cross-project";

export interface ConstellationEdge {
  id: string;
  source: string;
  target: string;
  kind: ConstellationEdgeKind;
  strength: number;
}

export interface ConstellationGraph {
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
}

export interface ConstellationCategoryDefinition {
  id: ConstellationCategoryId;
  label: string;
  color: string;
  glow: string;
  anchor: ConstellationVector3;
}

export const CONSTELLATION_SPHERE_RADIUS = 620;

export const CONSTELLATION_CATEGORIES: readonly ConstellationCategoryDefinition[] = [
  {
    id: "stories",
    label: "Stories",
    color: "#ef8aa5",
    glow: "#e85f86",
    anchor: { x: -0.63, y: -0.35, z: 0.69 },
  },
  {
    id: "philosophy",
    label: "Philosophy",
    color: "#aaa0e8",
    glow: "#8878da",
    anchor: { x: 0.59, y: -0.48, z: 0.65 },
  },
  {
    id: "tools",
    label: "Tools",
    color: "#87c8df",
    glow: "#5aa9c8",
    anchor: { x: -0.54, y: 0.61, z: -0.58 },
  },
  {
    id: "games",
    label: "Games",
    color: "#c5d58d",
    glow: "#aebf66",
    anchor: { x: 0.61, y: 0.48, z: -0.63 },
  },
  {
    id: "videos",
    label: "Videos",
    color: "#f2ad72",
    glow: "#db7d43",
    anchor: { x: 0.1, y: -0.82, z: -0.56 },
  },
  {
    id: "music",
    label: "Music",
    color: "#72d6bd",
    glow: "#39ac91",
    anchor: { x: -0.1, y: 0.82, z: 0.56 },
  },
] as const;

const PROJECT_NAMES: Record<ConstellationCategoryId, readonly string[]> = {
  stories: [
    "The Glass Archive",
    "Signal at Low Tide",
    "The Last Orchard",
    "Night Train Atlas",
    "Mercury House",
    "A Map of Ghosts",
    "The Quiet Engine",
  ],
  philosophy: [
    "Agency Ledger",
    "The Honest Machine",
    "Power & Weakness",
    "Attention Ecology",
    "Meaning Under Load",
    "The Friction Thesis",
    "Finite Games",
  ],
  tools: [
    "Orbit Console",
    "Memory Loom",
    "Signal Router",
    "Local Atlas",
    "Prompt Foundry",
    "Thread Keeper",
    "Telemetry Deck",
  ],
  games: [
    "Lakeside",
    "Ash Circuit",
    "Little Gods",
    "Neon Pilgrim",
    "Deep Weather",
    "Iron Garden",
    "Last Light Tactics",
  ],
  videos: [
    "Field Notes",
    "Afterimage",
    "Signal Cut",
    "Midnight Essay",
    "Small Worlds",
    "Process Reel",
    "The Long Take",
  ],
  music: [
    "Night Bloom",
    "Soft Machines",
    "Weather Patterns",
    "Static Choir",
    "Glass River",
    "Second Sun",
    "Rooms in Motion",
  ],
};

const SYSTEM_NAMES: Record<ConstellationCategoryId, readonly string[]> = {
  stories: [
    "Character lattice",
    "Scene engine",
    "World memory",
    "Conflict loop",
    "Voice guide",
    "Timeline",
    "Theme signals",
    "Research vault",
    "Draft pipeline",
    "Revision map",
    "Continuity guard",
    "Reader tension",
    "Image language",
    "Ending logic",
  ],
  philosophy: [
    "Core premise",
    "Argument map",
    "Counterexample bank",
    "Term glossary",
    "Source trail",
    "Tension model",
    "Ethics check",
    "Case studies",
    "Question queue",
    "Synthesis pass",
    "Contradiction log",
    "First principles",
    "Practical tests",
    "Open problems",
  ],
  tools: [
    "Input adapter",
    "State store",
    "Command bus",
    "Sync layer",
    "Search index",
    "Task queue",
    "Auth boundary",
    "Renderer",
    "Event stream",
    "Plugin bridge",
    "Telemetry",
    "Recovery path",
    "Test harness",
    "Release pipeline",
  ],
  games: [
    "Core loop",
    "World simulation",
    "Player controller",
    "Encounter director",
    "Progression",
    "Save system",
    "Combat model",
    "Economy",
    "Level grammar",
    "Audio state",
    "Quest logic",
    "AI behavior",
    "Visual feedback",
    "Build pipeline",
  ],
  videos: [
    "Story outline",
    "Storyboard",
    "Shot list",
    "Footage catalog",
    "Edit timeline",
    "Motion graphics",
    "Color grade",
    "Sound mix",
    "Caption track",
    "Thumbnail study",
    "Publishing queue",
    "Audience notes",
    "Archive master",
    "Distribution plan",
  ],
  music: [
    "Composition",
    "Arrangement",
    "Rhythm map",
    "Melody sketch",
    "Harmony stack",
    "Sound design",
    "Instrument rack",
    "Recording takes",
    "Edit comp",
    "Mix bus",
    "Mastering chain",
    "Artwork",
    "Release plan",
    "Live set",
  ],
};

const CATEGORY_DESCRIPTIONS: Record<ConstellationCategoryId, string> = {
  stories: "Narrative worlds, essays, characters, and long-form experiments.",
  philosophy: "Working models for agency, attention, meaning, and power.",
  tools: "Utilities and systems that extend how the workspace operates.",
  games: "Playable worlds, mechanics, simulations, and interactive prototypes.",
  videos: "Films, visual essays, process reels, and moving-image experiments.",
  music: "Songs, scores, sound design, recordings, and live performance ideas.",
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRandom = (seed: string): (() => number) => {
  let state = hashString(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

const vector = (x: number, y: number, z: number): ConstellationVector3 => ({ x, y, z });

const add = (left: ConstellationVector3, right: ConstellationVector3): ConstellationVector3 =>
  vector(left.x + right.x, left.y + right.y, left.z + right.z);

const scale = (value: ConstellationVector3, amount: number): ConstellationVector3 =>
  vector(value.x * amount, value.y * amount, value.z * amount);

const length = (value: ConstellationVector3): number =>
  Math.hypot(value.x, value.y, value.z);

const normalize = (value: ConstellationVector3): ConstellationVector3 => {
  const magnitude = length(value) || 1;
  return scale(value, 1 / magnitude);
};

const cross = (left: ConstellationVector3, right: ConstellationVector3): ConstellationVector3 =>
  vector(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );

const tangentBasis = (
  normal: ConstellationVector3,
): { tangent: ConstellationVector3; bitangent: ConstellationVector3 } => {
  const reference = Math.abs(normal.y) > 0.82 ? vector(1, 0, 0) : vector(0, 1, 0);
  const tangent = normalize(cross(reference, normal));
  return { tangent, bitangent: normalize(cross(normal, tangent)) };
};

const positionFromBasis = (
  center: ConstellationVector3,
  normal: ConstellationVector3,
  tangent: ConstellationVector3,
  bitangent: ConstellationVector3,
  tangentOffset: number,
  bitangentOffset: number,
  radialOffset: number,
): ConstellationVector3 =>
  add(
    add(
      add(center, scale(tangent, tangentOffset)),
      scale(bitangent, bitangentOffset),
    ),
    scale(normal, radialOffset),
  );

const statusFromRoll = (roll: number): ConstellationNodeStatus =>
  roll > 0.91 ? "attention" : roll > 0.69 ? "active" : "quiet";

const addEdge = (
  edges: ConstellationEdge[],
  seenEdges: Set<string>,
  source: string,
  target: string,
  kind: ConstellationEdgeKind,
  strength: number,
): void => {
  const sorted = source < target ? `${source}::${target}` : `${target}::${source}`;
  if (seenEdges.has(sorted)) return;
  seenEdges.add(sorted);
  edges.push({
    id: `${kind}:${sorted}`,
    source,
    target,
    kind,
    strength: round(Math.max(0.18, Math.min(1, strength))),
  });
};

export const createFakeConstellationGraph = (seed = "programs-constellation-v2"): ConstellationGraph => {
  const random = createRandom(seed);
  const nodes: ConstellationNode[] = [
    {
      id: "me",
      label: "Me",
      kind: "self",
      categoryId: null,
      parentId: null,
      description: "The center of the current creative and technical system.",
      magnitude: 1,
      priority: 1,
      status: "active",
      x: 0,
      y: 0,
      z: 0,
      phase: 0,
    },
  ];
  const edges: ConstellationEdge[] = [];
  const seenEdges = new Set<string>();
  const projectIdsByCategory = new Map<ConstellationCategoryId, string[]>();
  const systemIdsByProject = new Map<string, string[]>();

  for (const [categoryIndex, category] of CONSTELLATION_CATEGORIES.entries()) {
    const categoryNormal = normalize(category.anchor);
    const categoryCenter = scale(categoryNormal, CONSTELLATION_SPHERE_RADIUS * 0.78);
    const categoryNodeId = `category:${category.id}`;
    const categoryBasis = tangentBasis(categoryNormal);

    nodes.push({
      id: categoryNodeId,
      label: category.label,
      kind: "category",
      categoryId: category.id,
      parentId: "me",
      description: CATEGORY_DESCRIPTIONS[category.id],
      magnitude: 0.86,
      priority: round(0.82 + random() * 0.16),
      status: categoryIndex % 2 === 0 ? "active" : "quiet",
      x: round(categoryCenter.x),
      y: round(categoryCenter.y),
      z: round(categoryCenter.z),
      phase: round(random() * Math.PI * 2),
    });
    addEdge(edges, seenEdges, "me", categoryNodeId, "hierarchy", 0.9);

    const projectIds: string[] = [];
    const projectNames = PROJECT_NAMES[category.id];
    for (const [projectIndex, projectName] of projectNames.entries()) {
      const projectId = `project:${category.id}:${projectIndex + 1}`;
      projectIds.push(projectId);
      const projectAngle =
        (projectIndex / projectNames.length) * Math.PI * 2
        + categoryIndex * 0.37
        + (random() - 0.5) * 0.25;
      const projectRing = 165 + (projectIndex % 3) * 58 + random() * 34;
      const projectPosition = positionFromBasis(
        categoryCenter,
        categoryNormal,
        categoryBasis.tangent,
        categoryBasis.bitangent,
        Math.cos(projectAngle) * projectRing,
        Math.sin(projectAngle) * projectRing * 0.82,
        24 + (random() - 0.5) * 92,
      );
      const projectNormal = normalize(projectPosition);
      const projectBasis = tangentBasis(projectNormal);

      nodes.push({
        id: projectId,
        label: projectName,
        kind: "project",
        categoryId: category.id,
        parentId: categoryNodeId,
        description: `A placeholder ${category.label.toLowerCase()} project with interconnected working systems.`,
        magnitude: round(0.48 + random() * 0.38),
        priority: round(0.38 + random() * 0.6),
        status: statusFromRoll(random()),
        x: round(projectPosition.x),
        y: round(projectPosition.y),
        z: round(projectPosition.z),
        phase: round(random() * Math.PI * 2),
      });
      addEdge(edges, seenEdges, categoryNodeId, projectId, "hierarchy", 0.54 + random() * 0.36);

      const systemCount = 10 + Math.floor(random() * 5);
      const systemIds: string[] = [];
      for (let systemIndex = 0; systemIndex < systemCount; systemIndex += 1) {
        const systemId = `system:${category.id}:${projectIndex + 1}:${systemIndex + 1}`;
        systemIds.push(systemId);
        const systemAngle =
          (systemIndex / systemCount) * Math.PI * 2
          + projectIndex * 0.41
          + (random() - 0.5) * 0.34;
        const systemRing = 58 + (systemIndex % 3) * 30 + random() * 20;
        const systemPosition = positionFromBasis(
          projectPosition,
          projectNormal,
          projectBasis.tangent,
          projectBasis.bitangent,
          Math.cos(systemAngle) * systemRing,
          Math.sin(systemAngle) * systemRing * 0.78,
          (random() - 0.5) * 58,
        );
        const baseName = SYSTEM_NAMES[category.id][systemIndex % SYSTEM_NAMES[category.id].length];

        nodes.push({
          id: systemId,
          label: baseName,
          kind: "system",
          categoryId: category.id,
          parentId: projectId,
          description: `${baseName} inside ${projectName}. Placeholder status and relationships.`,
          magnitude: round(0.16 + random() * 0.42),
          priority: round(0.18 + random() * 0.78),
          status: statusFromRoll(random()),
          x: round(systemPosition.x),
          y: round(systemPosition.y),
          z: round(systemPosition.z),
          phase: round(random() * Math.PI * 2),
        });
        addEdge(edges, seenEdges, projectId, systemId, "hierarchy", 0.32 + random() * 0.5);
      }

      for (let systemIndex = 0; systemIndex < systemIds.length; systemIndex += 1) {
        addEdge(
          edges,
          seenEdges,
          systemIds[systemIndex],
          systemIds[(systemIndex + 1) % systemIds.length],
          "dependency",
          0.2 + random() * 0.5,
        );
        if (random() > 0.38) {
          const offset = 2 + Math.floor(random() * Math.min(5, systemIds.length - 2));
          addEdge(
            edges,
            seenEdges,
            systemIds[systemIndex],
            systemIds[(systemIndex + offset) % systemIds.length],
            "dependency",
            0.18 + random() * 0.7,
          );
        }
      }
      systemIdsByProject.set(projectId, systemIds);
    }

    for (let projectIndex = 0; projectIndex < projectIds.length - 1; projectIndex += 1) {
      const sourceSystems = systemIdsByProject.get(projectIds[projectIndex]) ?? [];
      const targetSystems = systemIdsByProject.get(projectIds[projectIndex + 1]) ?? [];
      if (sourceSystems.length > 0 && targetSystems.length > 0) {
        addEdge(
          edges,
          seenEdges,
          sourceSystems[Math.floor(random() * sourceSystems.length)],
          targetSystems[Math.floor(random() * targetSystems.length)],
          "cross-project",
          0.2 + random() * 0.42,
        );
      }
    }
    projectIdsByCategory.set(category.id, projectIds);
  }

  for (let categoryIndex = 0; categoryIndex < CONSTELLATION_CATEGORIES.length; categoryIndex += 1) {
    const sourceCategory = CONSTELLATION_CATEGORIES[categoryIndex];
    const targetCategory = CONSTELLATION_CATEGORIES[(categoryIndex + 1) % CONSTELLATION_CATEGORIES.length];
    const sourceProjects = projectIdsByCategory.get(sourceCategory.id) ?? [];
    const targetProjects = projectIdsByCategory.get(targetCategory.id) ?? [];
    for (let crossIndex = 0; crossIndex < 3; crossIndex += 1) {
      const sourceProject = sourceProjects[Math.floor(random() * sourceProjects.length)];
      const targetProject = targetProjects[Math.floor(random() * targetProjects.length)];
      const sourceSystems = systemIdsByProject.get(sourceProject) ?? [];
      const targetSystems = systemIdsByProject.get(targetProject) ?? [];
      if (sourceSystems.length > 0 && targetSystems.length > 0) {
        addEdge(
          edges,
          seenEdges,
          sourceSystems[Math.floor(random() * sourceSystems.length)],
          targetSystems[Math.floor(random() * targetSystems.length)],
          "cross-project",
          0.18 + random() * 0.34,
        );
      }
    }
  }

  return { nodes, edges };
};
