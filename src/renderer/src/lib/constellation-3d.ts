import type {
  ConstellationGraph,
  ConstellationNode,
  ConstellationVector3,
} from "./constellation-graph";

export interface ConstellationRotation {
  yaw: number;
  pitch: number;
}

export interface ConstellationProjection {
  x: number;
  y: number;
  z: number;
  scale: number;
  depth: number;
  visible: boolean;
}

export interface ConstellationWheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
}

export type ConstellationFocusKind = "overview" | "category" | "project" | "system";

export const DEFAULT_CONSTELLATION_ROTATION: Readonly<ConstellationRotation> = {
  yaw: -0.28,
  pitch: -0.1,
};

export const rotateConstellationVector = (
  point: ConstellationVector3,
  rotation: ConstellationRotation,
): ConstellationVector3 => {
  const cosYaw = Math.cos(rotation.yaw);
  const sinYaw = Math.sin(rotation.yaw);
  const yawX = point.x * cosYaw + point.z * sinYaw;
  const yawZ = -point.x * sinYaw + point.z * cosYaw;
  const cosPitch = Math.cos(rotation.pitch);
  const sinPitch = Math.sin(rotation.pitch);
  return {
    x: yawX,
    y: point.y * cosPitch - yawZ * sinPitch,
    z: point.y * sinPitch + yawZ * cosPitch,
  };
};

export const rotateConstellationPointAroundAxis = (
  point: ConstellationVector3,
  origin: ConstellationVector3,
  axis: ConstellationVector3,
  angle: number,
): ConstellationVector3 => {
  const axisLength = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const unitAxis = {
    x: axis.x / axisLength,
    y: axis.y / axisLength,
    z: axis.z / axisLength,
  };
  const relative = {
    x: point.x - origin.x,
    y: point.y - origin.y,
    z: point.z - origin.z,
  };
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dot =
    unitAxis.x * relative.x
    + unitAxis.y * relative.y
    + unitAxis.z * relative.z;
  const cross = {
    x: unitAxis.y * relative.z - unitAxis.z * relative.y,
    y: unitAxis.z * relative.x - unitAxis.x * relative.z,
    z: unitAxis.x * relative.y - unitAxis.y * relative.x,
  };

  return {
    x: origin.x + relative.x * cosine + cross.x * sine + unitAxis.x * dot * (1 - cosine),
    y: origin.y + relative.y * cosine + cross.y * sine + unitAxis.y * dot * (1 - cosine),
    z: origin.z + relative.z * cosine + cross.z * sine + unitAxis.z * dot * (1 - cosine),
  };
};

export const projectConstellationPoint = (
  point: ConstellationVector3,
  rotation: ConstellationRotation,
  width: number,
  height: number,
  cameraDistance: number,
  focalLength: number,
): ConstellationProjection => {
  const rotated = rotateConstellationVector(point, rotation);
  const denominator = Math.max(80, cameraDistance - rotated.z);
  const scale = focalLength / denominator;
  return {
    x: width / 2 + rotated.x * scale,
    y: height / 2 + rotated.y * scale,
    z: rotated.z,
    scale,
    depth: Math.max(-1, Math.min(1, rotated.z / 850)),
    visible: denominator > 80,
  };
};

export const focusRotationForPoint = (
  point: ConstellationVector3,
): ConstellationRotation => {
  const yaw = Math.atan2(-point.x, point.z);
  const horizontalDistance = Math.hypot(point.x, point.z);
  return {
    yaw,
    pitch: Math.atan2(point.y, horizontalDistance),
  };
};

export const shortestAngleDelta = (from: number, to: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

export const getConstellationWheelYawDelta = (
  input: ConstellationWheelInput,
): number => {
  const rawDelta =
    Math.abs(input.deltaX) > 0.01
      ? input.deltaX
      : input.shiftKey
        ? input.deltaY
        : 0;
  if (rawDelta === 0) return 0;

  const deltaModeScale = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 360 : 1;
  return Math.max(-0.28, Math.min(0.28, rawDelta * deltaModeScale * 0.0018));
};

export const isConstellationCategoryDescendantHighlighted = (
  node: ConstellationNode,
  selectedNode: ConstellationNode | null,
  hoveredNode: ConstellationNode | null,
): boolean =>
  !hoveredNode
  && selectedNode?.kind === "category"
  && node.id !== selectedNode.id
  && node.categoryId === selectedNode.categoryId;

const graphIndex = (graph: ConstellationGraph): Map<string, ConstellationNode> =>
  new Map(graph.nodes.map((node) => [node.id, node]));

export const getConstellationFocusKind = (
  graph: ConstellationGraph,
  selectedId: string | null,
): ConstellationFocusKind => {
  if (!selectedId) return "overview";
  const kind = graphIndex(graph).get(selectedId)?.kind;
  return kind === "category" || kind === "project" || kind === "system" ? kind : "overview";
};

export const getConstellationBackTarget = (
  graph: ConstellationGraph,
  selectedId: string | null,
): string | null => {
  if (!selectedId) return null;
  const nodesById = graphIndex(graph);
  const selected = nodesById.get(selectedId);
  if (!selected || selected.kind === "category") return null;
  if (selected.kind === "project") return selected.parentId;
  if (selected.kind === "system") return selected.parentId;
  return null;
};

export const getConstellationFocusAnchorId = (
  graph: ConstellationGraph,
  selectedId: string | null,
): string | null => {
  if (!selectedId) return null;
  const selected = graphIndex(graph).get(selectedId);
  if (!selected) return null;
  return selected.kind === "system" ? selected.parentId : selected.id;
};

export const resolveConstellationInteractionTarget = (
  graph: ConstellationGraph,
  rawNodeId: string | null,
  selectedId: string | null,
): string | null => {
  if (!rawNodeId) return null;
  const nodesById = graphIndex(graph);
  const raw = nodesById.get(rawNodeId);
  if (!raw || raw.kind === "self") return null;
  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;

  if (!selected) {
    return raw.kind === "category" ? raw.id : raw.categoryId ? `category:${raw.categoryId}` : null;
  }

  if (selected.kind === "category") {
    if (raw.categoryId !== selected.categoryId) return null;
    if (raw.kind === "project") return raw.id;
    if (raw.kind === "system") return raw.parentId;
    return null;
  }

  const projectId = selected.kind === "project" ? selected.id : selected.parentId;
  if (!projectId || raw.kind !== "system" || raw.parentId !== projectId) return null;
  return raw.id;
};

export const getConstellationLabelIds = (
  graph: ConstellationGraph,
  selectedId: string | null,
  hoveredId: string | null,
): string[] => {
  const nodesById = graphIndex(graph);
  const labels: string[] = [];
  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;

  if (selected?.kind === "category") {
    labels.push(selected.id);
  } else if (selected?.kind === "project") {
    if (selected.parentId) labels.push(selected.parentId);
    labels.push(selected.id);
  } else if (selected?.kind === "system") {
    const project = selected.parentId ? nodesById.get(selected.parentId) ?? null : null;
    if (project?.parentId) labels.push(project.parentId);
    if (project) labels.push(project.id);
    labels.push(selected.id);
  }

  if (hoveredId && !labels.includes(hoveredId)) labels.push(hoveredId);
  return labels;
};

export const getConstellationColoredNodeIds = (
  graph: ConstellationGraph,
  selectedId: string | null,
  hoveredId: string | null,
): Set<string> => {
  const nodesById = graphIndex(graph);
  const hovered = hoveredId ? nodesById.get(hoveredId) ?? null : null;
  if (hovered) {
    const coloredIds = new Set(
      graph.nodes
        .filter((node) => {
          if (hovered.kind === "category") return node.categoryId === hovered.categoryId;
          if (hovered.kind === "project") {
            return node.id === hovered.id || node.parentId === hovered.id;
          }
          return node.id === hovered.id;
        })
        .map((node) => node.id),
    );
    if (selectedId && nodesById.has(selectedId)) coloredIds.add(selectedId);
    return coloredIds;
  }

  if (selectedId && nodesById.has(selectedId)) return new Set([selectedId]);
  return new Set(
    graph.nodes
      .filter((node) => node.kind === "category")
      .map((node) => node.id),
  );
};
