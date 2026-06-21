import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CONSTELLATION_CATEGORIES,
  CONSTELLATION_SPHERE_RADIUS,
  createFakeConstellationGraph,
  type ConstellationEdge,
  type ConstellationNode,
} from "../lib/constellation-graph";
import {
  DEFAULT_CONSTELLATION_ROTATION,
  focusRotationForPoint,
  getConstellationBackTarget,
  getConstellationColoredNodeIds,
  getConstellationFocusAnchorId,
  getConstellationFocusKind,
  getConstellationLabelIds,
  getConstellationWheelYawDelta,
  isConstellationCategoryDescendantHighlighted,
  projectConstellationPoint,
  resolveConstellationInteractionTarget,
  rotateConstellationPointAroundAxis,
  shortestAngleDelta,
  type ConstellationProjection,
  type ConstellationRotation,
} from "../lib/constellation-3d";

interface ViewportSize {
  width: number;
  height: number;
  dpr: number;
}

interface AmbientStar {
  x: number;
  y: number;
  size: number;
  alpha: number;
  phase: number;
}

interface ProjectedNode extends ConstellationProjection {
  node: ConstellationNode;
  hitRadius: number;
  visualRadius: number;
}

type StarSpriteIntensity = "quiet" | "highlighted" | "active";

const categoryById = new Map(CONSTELLATION_CATEGORIES.map((category) => [category.id, category]));
const MAX_CANVAS_PIXELS = 6_500_000;
const OVERVIEW_DISTANCE = 1480;
const CATEGORY_DISTANCE = 1200;
const PROJECT_DISTANCE = 1000;
const IDLE_ROTATION_SPEED = 0.000028;
const LOCAL_ORBIT_SPEED = 0.000022;
const LOCAL_ORBIT_DELAY = 900;
const MANUAL_SPIN_HOLD_MS = 650;
const WHITE_STAR_COLOR = "#edf5f8";
const HIGHLIGHTED_WHITE_STAR_COLOR = "#f8fcff";

const makeAmbientStars = (): AmbientStar[] => {
  let state = 0x91e10da5;
  const random = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 185 }, () => ({
    x: random(),
    y: random(),
    size: 0.28 + random() * 1.05,
    alpha: 0.035 + random() * 0.22,
    phase: random() * Math.PI * 2,
  }));
};

const buildAdjacency = (edges: ConstellationEdge[]): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  return adjacency;
};

const hexToRgb = (color: string): { red: number; green: number; blue: number } => {
  const value = color.replace("#", "");
  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
};

const rgba = (color: string, alpha: number): string => {
  const { red, green, blue } = hexToRgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
};

const nodeBaseRadius = (node: ConstellationNode): number => {
  if (node.kind === "self") return 3.8;
  if (node.kind === "category") return 4.8 + node.magnitude * 1.8;
  if (node.kind === "project") return 3 + node.magnitude * 2.2;
  return 1.25 + node.magnitude * 1.6;
};

const nodeCategoryColor = (node: ConstellationNode): string =>
  node.categoryId ? categoryById.get(node.categoryId)?.color ?? "#dcecf2" : "#eef8fb";

const nodeCategoryGlow = (node: ConstellationNode): string =>
  node.categoryId ? categoryById.get(node.categoryId)?.glow ?? "#afcfd9" : "#dceef4";

const nodeBelongsToProject = (node: ConstellationNode, projectId: string): boolean =>
  node.id === projectId || node.parentId === projectId;

const nodeBelongsToTarget = (
  node: ConstellationNode,
  target: ConstellationNode | null,
): boolean => {
  if (!target) return false;
  if (target.kind === "category") return node.categoryId === target.categoryId;
  if (target.kind === "project") return nodeBelongsToProject(node, target.id);
  return node.id === target.id;
};

export function ConstellationHomepage({
  topRightControls,
}: {
  topRightControls?: ReactNode;
}) {
  const graph = useMemo(() => createFakeConstellationGraph(), []);
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const adjacency = useMemo(() => buildAdjacency(graph.edges), [graph.edges]);
  const ambientStars = useMemo(makeAmbientStars, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<ViewportSize>({ width: 0, height: 0, dpr: 1 });
  const projectedNodesRef = useRef<Map<string, ProjectedNode>>(new Map());
  const rotationRef = useRef<ConstellationRotation>({ ...DEFAULT_CONSTELLATION_ROTATION });
  const targetRotationRef = useRef<ConstellationRotation>({ ...DEFAULT_CONSTELLATION_ROTATION });
  const cameraDistanceRef = useRef(OVERVIEW_DISTANCE);
  const targetCameraDistanceRef = useRef(OVERVIEW_DISTANCE);
  const localOrbitAngleRef = useRef(0);
  const focusAnchorIdRef = useRef<string | null>(null);
  const returningToOverviewRef = useRef(false);
  const manualSpinUntilRef = useRef(0);
  const selectionChangedAtRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const reducedMotionRef = useRef(false);
  const previousFrameTimeRef = useRef(0);
  const pointerRef = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, distance: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const coloredNodeIds = useMemo(
    () => getConstellationColoredNodeIds(graph, selectedId, hoveredId),
    [graph, hoveredId, selectedId],
  );
  const coloredNodeIdsRef = useRef(coloredNodeIds);
  coloredNodeIdsRef.current = coloredNodeIds;

  useEffect(() => {
    selectedIdRef.current = selectedId;
    selectionChangedAtRef.current = performance.now();
    const focusAnchorId = getConstellationFocusAnchorId(graph, selectedId);
    const focusAnchor = focusAnchorId ? nodesById.get(focusAnchorId) ?? null : null;
    if (!focusAnchor) {
      targetCameraDistanceRef.current = OVERVIEW_DISTANCE;
      targetRotationRef.current = { ...DEFAULT_CONSTELLATION_ROTATION };
      returningToOverviewRef.current = focusAnchorIdRef.current !== null;
      focusAnchorIdRef.current = null;
      localOrbitAngleRef.current = 0;
      return;
    }
    if (focusAnchorIdRef.current !== focusAnchorId) localOrbitAngleRef.current = 0;
    focusAnchorIdRef.current = focusAnchorId;
    returningToOverviewRef.current = false;
    targetRotationRef.current = focusRotationForPoint(focusAnchor);
    targetCameraDistanceRef.current =
      focusAnchor.kind === "category" ? CATEGORY_DISTANCE : PROJECT_DISTANCE;
  }, [graph, nodesById, selectedId]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  const navigateBack = useCallback(() => {
    setSelectedId((current) => getConstellationBackTarget(graph, current));
    setHoveredId(null);
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let resizeTimer = 0;

    const readViewport = (): ViewportSize => {
      const bounds = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const requestedDpr = Math.min(window.devicePixelRatio || 1, 2);
      const dpr = Math.min(
        requestedDpr,
        Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)),
      );
      return { width, height, dpr };
    };

    const commitResize = (viewport = readViewport()) => {
      const { width, height, dpr } = viewport;
      viewportRef.current = viewport;
      const targetWidth = Math.max(1, Math.round(width * dpr));
      const targetHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width === targetWidth && canvas.height === targetHeight) return;
      const previousFrame = document.createElement("canvas");
      previousFrame.width = canvas.width;
      previousFrame.height = canvas.height;
      const previousContext = previousFrame.getContext("2d");
      if (previousContext && canvas.width > 0 && canvas.height > 0) {
        previousContext.drawImage(canvas, 0, 0);
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const resizedContext = canvas.getContext("2d");
      if (resizedContext && previousFrame.width > 0 && previousFrame.height > 0) {
        resizedContext.drawImage(
          previousFrame,
          0,
          0,
          previousFrame.width,
          previousFrame.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
      canvas.dataset.viewportWidth = String(width);
      canvas.dataset.viewportHeight = String(height);
    };

    const resize = () => {
      const viewport = readViewport();
      viewportRef.current = viewport;
      canvas.dataset.viewportWidth = String(viewport.width);
      canvas.dataset.viewportHeight = String(viewport.height);
      window.clearTimeout(resizeTimer);
      if (canvas.width <= 1 || canvas.height <= 1) {
        commitResize(viewport);
        return;
      }
      resizeTimer = window.setTimeout(() => commitResize(viewportRef.current), 90);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    commitResize();
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = query.matches;
      setReducedMotion(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      const yawDelta = getConstellationWheelYawDelta(event);
      if (yawDelta === 0) return;

      event.preventDefault();
      targetRotationRef.current.yaw += yawDelta;
      manualSpinUntilRef.current = performance.now() + MANUAL_SPIN_HOLD_MS;
      returningToOverviewRef.current = false;
      hoveredIdRef.current = null;
      setHoveredId(null);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const starSprites = new Map<string, HTMLCanvasElement>();
    let animationFrame = 0;
    let running = true;

    const createStarSprite = (
      color: string,
      intensity: StarSpriteIntensity,
      diffraction: boolean,
    ): HTMLCanvasElement => {
      const key = `${color}:${intensity}:${diffraction ? "flare" : "soft"}`;
      const cached = starSprites.get(key);
      if (cached) return cached;
      const sprite = document.createElement("canvas");
      sprite.width = 128;
      sprite.height = 128;
      const spriteContext = sprite.getContext("2d");
      if (!spriteContext) return sprite;
      const center = 64;
      const isActive = intensity === "active";
      const isHighlighted = intensity === "highlighted";
      const glow = spriteContext.createRadialGradient(center, center, 0, center, center, 62);
      glow.addColorStop(0, "rgba(255, 255, 255, 1)");
      glow.addColorStop(0.035, "rgba(247, 252, 255, 0.98)");
      glow.addColorStop(0.095, rgba(color, isActive ? 0.92 : isHighlighted ? 0.66 : 0.42));
      glow.addColorStop(0.24, rgba(color, isActive ? 0.32 : isHighlighted ? 0.21 : 0.13));
      glow.addColorStop(0.58, rgba(color, isActive ? 0.075 : isHighlighted ? 0.047 : 0.03));
      glow.addColorStop(1, rgba(color, 0));
      spriteContext.fillStyle = glow;
      spriteContext.fillRect(0, 0, 128, 128);

      if (diffraction) {
        const horizontal = spriteContext.createLinearGradient(0, center, 128, center);
        horizontal.addColorStop(0, "rgba(255,255,255,0)");
        horizontal.addColorStop(0.45, rgba(color, isActive ? 0.04 : isHighlighted ? 0.027 : 0.018));
        horizontal.addColorStop(0.5, "rgba(255,255,255,0.32)");
        horizontal.addColorStop(0.55, rgba(color, isActive ? 0.04 : isHighlighted ? 0.027 : 0.018));
        horizontal.addColorStop(1, "rgba(255,255,255,0)");
        spriteContext.fillStyle = horizontal;
        spriteContext.fillRect(0, center - 0.45, 128, 0.9);

        const vertical = spriteContext.createLinearGradient(center, 0, center, 128);
        vertical.addColorStop(0, "rgba(255,255,255,0)");
        vertical.addColorStop(0.46, rgba(color, isActive ? 0.035 : isHighlighted ? 0.022 : 0.014));
        vertical.addColorStop(0.5, "rgba(255,255,255,0.24)");
        vertical.addColorStop(0.54, rgba(color, isActive ? 0.035 : isHighlighted ? 0.022 : 0.014));
        vertical.addColorStop(1, "rgba(255,255,255,0)");
        spriteContext.fillStyle = vertical;
        spriteContext.fillRect(center - 0.4, 0, 0.8, 128);
      }
      starSprites.set(key, sprite);
      return sprite;
    };

    const drawHorizon = (
      rotation: ConstellationRotation,
      width: number,
      height: number,
      cameraDistance: number,
      focalLength: number,
    ) => {
      const segmentCount = 96;
      for (let index = 0; index < segmentCount; index += 1) {
        const angleA = (index / segmentCount) * Math.PI * 2;
        const angleB = ((index + 1) / segmentCount) * Math.PI * 2;
        const pointA = {
          x: Math.cos(angleA) * CONSTELLATION_SPHERE_RADIUS,
          y: 0,
          z: Math.sin(angleA) * CONSTELLATION_SPHERE_RADIUS,
        };
        const pointB = {
          x: Math.cos(angleB) * CONSTELLATION_SPHERE_RADIUS,
          y: 0,
          z: Math.sin(angleB) * CONSTELLATION_SPHERE_RADIUS,
        };
        const projectedA = projectConstellationPoint(
          pointA,
          rotation,
          width,
          height,
          cameraDistance,
          focalLength,
        );
        const projectedB = projectConstellationPoint(
          pointB,
          rotation,
          width,
          height,
          cameraDistance,
          focalLength,
        );
        const depthAlpha = ((projectedA.depth + projectedB.depth) / 2 + 1) / 2;
        context.strokeStyle = `rgba(137, 174, 197, ${0.012 + depthAlpha * 0.055})`;
        context.lineWidth = 0.55 + depthAlpha * 0.35;
        context.beginPath();
        context.moveTo(projectedA.x, projectedA.y);
        context.lineTo(projectedB.x, projectedB.y);
        context.stroke();
      }
    };

    const render = (time: number) => {
      if (!running || document.hidden) return;
      let { width, height } = viewportRef.current;
      const liveBounds = containerRef.current?.getBoundingClientRect();
      if (liveBounds) {
        const liveWidth = Math.max(1, Math.round(liveBounds.width));
        const liveHeight = Math.max(1, Math.round(liveBounds.height));
        if (liveWidth !== width || liveHeight !== height) {
          viewportRef.current = {
            ...viewportRef.current,
            width: liveWidth,
            height: liveHeight,
          };
          width = liveWidth;
          height = liveHeight;
          canvas.dataset.viewportWidth = String(width);
          canvas.dataset.viewportHeight = String(height);
        }
      }
      if (width <= 1 || height <= 1) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }

      const previousTime = previousFrameTimeRef.current || time;
      const deltaTime = Math.min(40, time - previousTime);
      previousFrameTimeRef.current = time;
      const selected = selectedIdRef.current;
      const hovered = hoveredIdRef.current;
      const reducedMotion = reducedMotionRef.current;
      const selectedNode = selected ? nodesById.get(selected) ?? null : null;
      const returningToOverview = !selected && returningToOverviewRef.current;
      const rotation = rotationRef.current;
      const targetRotation = targetRotationRef.current;
      const manualYawDelta = Math.abs(shortestAngleDelta(rotation.yaw, targetRotation.yaw));
      const manualSpinActive =
        manualSpinUntilRef.current > 0
        && (time < manualSpinUntilRef.current || manualYawDelta > 0.001);
      if (manualSpinUntilRef.current > 0 && !manualSpinActive) {
        manualSpinUntilRef.current = 0;
      }
      const overviewRotationActive =
        !reducedMotion
        && !hovered
        && !selected
        && !returningToOverview
        && !manualSpinActive;
      const localOrbitActive =
        !reducedMotion
        && !hovered
        && !manualSpinActive
        && (selectedNode?.kind === "category" || selectedNode?.kind === "project")
        && time - selectionChangedAtRef.current > LOCAL_ORBIT_DELAY;

      if (overviewRotationActive) {
        rotation.yaw += deltaTime * IDLE_ROTATION_SPEED;
        targetRotation.yaw = rotation.yaw;
        targetRotation.pitch = DEFAULT_CONSTELLATION_ROTATION.pitch;
      } else {
        const rotationEase = reducedMotion ? 1 : manualSpinActive ? 0.11 : 0.052;
        rotation.yaw += shortestAngleDelta(rotation.yaw, targetRotation.yaw) * rotationEase;
        rotation.pitch += (targetRotation.pitch - rotation.pitch) * rotationEase;
        if (
          returningToOverview
          && Math.abs(shortestAngleDelta(rotation.yaw, targetRotation.yaw)) < 0.001
          && Math.abs(rotation.pitch - targetRotation.pitch) < 0.001
        ) {
          rotationRef.current = { ...DEFAULT_CONSTELLATION_ROTATION };
          targetRotationRef.current = { ...DEFAULT_CONSTELLATION_ROTATION };
          returningToOverviewRef.current = false;
        }
      }

      if (localOrbitActive) {
        localOrbitAngleRef.current =
          (localOrbitAngleRef.current + deltaTime * LOCAL_ORBIT_SPEED) % (Math.PI * 2);
      }

      canvas.dataset.rotationYaw = rotation.yaw.toFixed(4);
      canvas.dataset.rotationPitch = rotation.pitch.toFixed(4);
      canvas.dataset.localOrbitAngle = localOrbitAngleRef.current.toFixed(4);

      const distanceEase = reducedMotion ? 1 : 0.055;
      cameraDistanceRef.current +=
        (targetCameraDistanceRef.current - cameraDistanceRef.current) * distanceEase;
      const cameraDistance = cameraDistanceRef.current;
      const focalLength = Math.min(width, height) * 0.88;

      const renderScaleX = canvas.width / width;
      const renderScaleY = canvas.height / height;
      canvas.dataset.renderScaleX = renderScaleX.toFixed(4);
      canvas.dataset.renderScaleY = renderScaleY.toFixed(4);
      context.setTransform(renderScaleX, 0, 0, renderScaleY, 0, 0);
      context.clearRect(0, 0, width, height);

      const background = context.createRadialGradient(
        width * 0.5,
        height * 0.48,
        0,
        width * 0.5,
        height * 0.48,
        Math.max(width, height) * 0.76,
      );
      background.addColorStop(0, "#070b14");
      background.addColorStop(0.48, "#03050b");
      background.addColorStop(1, "#010207");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      for (const star of ambientStars) {
        const twinkle = reducedMotion ? 0.72 : 0.72 + Math.sin(time * 0.00055 + star.phase) * 0.2;
        context.fillStyle = `rgba(205, 222, 235, ${star.alpha * twinkle})`;
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
        context.fill();
      }

      drawHorizon(rotation, width, height, cameraDistance, focalLength);

      const orbitAnchorId =
        selectedNode?.kind === "category"
          ? selectedNode.id
          : selectedNode?.kind === "project"
            ? selectedNode.id
            : selectedNode?.kind === "system"
              ? selectedNode.parentId
              : null;
      const orbitAnchor = orbitAnchorId ? nodesById.get(orbitAnchorId) ?? null : null;
      const projectedNodes = new Map<string, ProjectedNode>();
      for (const node of graph.nodes) {
        const belongsToOrbit =
          orbitAnchor?.kind === "category"
            ? node.id !== orbitAnchor.id && node.categoryId === orbitAnchor.categoryId
            : orbitAnchor?.kind === "project"
              ? node.parentId === orbitAnchor.id
              : false;
        const worldPosition =
          orbitAnchor && belongsToOrbit
            ? rotateConstellationPointAroundAxis(
                node,
                orbitAnchor,
                orbitAnchor,
                localOrbitAngleRef.current,
              )
            : node;
        const projection = projectConstellationPoint(
          worldPosition,
          rotation,
          width,
          height,
          cameraDistance,
          focalLength,
        );
        const perspectiveFactor = Math.max(0.58, Math.min(2.4, projection.scale / 0.5));
        const visualRadius = nodeBaseRadius(node) * perspectiveFactor;
        projectedNodes.set(node.id, {
          ...projection,
          node,
          visualRadius,
          hitRadius: Math.max(9, visualRadius * 1.65),
        });
      }
      projectedNodesRef.current = projectedNodes;

      const hoveredNode = hovered ? nodesById.get(hovered) ?? null : null;
      const selectedProjectId =
        selectedNode?.kind === "project"
          ? selectedNode.id
          : selectedNode?.kind === "system"
            ? selectedNode.parentId
            : null;

      const emphasisForNode = (node: ConstellationNode): number => {
        let emphasis =
          node.kind === "category" ? 0.42 : node.kind === "project" ? 0.22 : 0.14;
        if (selectedNode?.kind === "category") {
          emphasis = node.id === selectedNode.id
            ? 1
            : node.categoryId === selectedNode.categoryId
              ? 0.48
              : 0.05;
        } else if (selectedProjectId) {
          emphasis = nodeBelongsToProject(node, selectedProjectId)
            ? node.id === selectedProjectId
              ? 1
              : 0.46
            : node.categoryId === selectedNode?.categoryId
              ? 0.08
              : 0.035;
        }
        if (selectedNode?.kind === "system") {
          if (node.id === selectedNode.id) emphasis = 1;
          else if (adjacency.get(selectedNode.id)?.has(node.id)) emphasis = Math.max(emphasis, 0.66);
        }
        if (hoveredNode) {
          if (nodeBelongsToTarget(node, hoveredNode)) {
            emphasis = 1;
          } else if (node.id === selectedNode?.id) {
            emphasis = Math.max(emphasis, 0.78);
          } else if (
            hoveredNode.kind === "system"
            && adjacency.get(hoveredNode.id)?.has(node.id)
          ) {
            emphasis = 0.5;
          } else {
            emphasis *= 0.22;
          }
        }
        return emphasis;
      };

      const edgeEmphasis = (edge: ConstellationEdge): number => {
        const sourceNode = nodesById.get(edge.source);
        const targetNode = nodesById.get(edge.target);
        if (!sourceNode || !targetNode) return 0;
        if (
          hoveredNode?.kind === "system"
          && (edge.source === hoveredNode.id || edge.target === hoveredNode.id)
        ) return 1;
        if (
          selectedNode?.kind === "system"
          && (edge.source === selectedNode.id || edge.target === selectedNode.id)
        ) return 0.82;
        if (
          hoveredNode
          && nodeBelongsToTarget(sourceNode, hoveredNode)
          && nodeBelongsToTarget(targetNode, hoveredNode)
        ) return 0.72;
        if (
          selectedProjectId
          && nodeBelongsToProject(sourceNode, selectedProjectId)
          && nodeBelongsToProject(targetNode, selectedProjectId)
        ) return 0.45;
        if (
          selectedNode?.kind === "category"
          && sourceNode.categoryId === selectedNode.categoryId
          && targetNode.categoryId === selectedNode.categoryId
        ) return 0.3;
        return 0;
      };

      context.lineCap = "round";
      for (const edge of graph.edges) {
        const source = projectedNodes.get(edge.source);
        const target = projectedNodes.get(edge.target);
        const sourceNode = nodesById.get(edge.source);
        if (!source || !target || !sourceNode) continue;
        const depthFactor = Math.max(0.2, Math.min(1, ((source.depth + target.depth) / 2 + 1.25) / 2.25));
        const emphasis = edgeEmphasis(edge);
        const baseAlpha =
          edge.kind === "hierarchy" ? 0.05 : edge.kind === "dependency" ? 0.022 : 0.008;
        const alpha = (baseAlpha + emphasis * 0.18) * depthFactor * edge.strength;
        const edgeColor = emphasis > 0.25 ? nodeCategoryGlow(sourceNode) : "#a9bec9";
        context.strokeStyle = rgba(edgeColor, alpha);
        context.lineWidth = 0.35 + edge.strength * 0.55 + emphasis * 0.5;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }

      const orderedNodes = [...projectedNodes.values()].sort((left, right) => left.z - right.z);
      for (const projected of orderedNodes) {
        const { node } = projected;
        const emphasis = emphasisForNode(node);
        const interactionActive = Boolean(selectedNode || hoveredNode);
        const depthFactor = Math.max(0.24, Math.min(1, (projected.depth + 1.25) / 2.25));
        const contextFactor = interactionActive
          ? 0.2 + Math.min(1, emphasis) * 0.8
          : 1;
        const baseAlpha =
          node.kind === "system" ? 0.7 : node.kind === "project" ? 0.84 : 0.93;
        const twinkleAmplitude =
          node.status === "attention" ? 0.18 : node.status === "active" ? 0.08 : 0.035;
        const twinkle = reducedMotion
          ? 1
          : 1 - twinkleAmplitude * 0.5 + Math.sin(time * 0.0018 + node.phase) * twinkleAmplitude;
        const isCategoryDescendant = isConstellationCategoryDescendantHighlighted(
          node,
          selectedNode,
          hoveredNode,
        );
        const alpha = Math.min(
          1,
          baseAlpha
            * depthFactor
            * contextFactor
            * twinkle
            * (isCategoryDescendant ? 1.16 : 1),
        );
        const activeColor = coloredNodeIdsRef.current.has(node.id);
        const diffraction =
          node.kind === "category"
          || node.kind === "project"
          || node.priority > 0.91;
        const spriteIntensity: StarSpriteIntensity =
          activeColor ? "active" : isCategoryDescendant ? "highlighted" : "quiet";
        const spriteColor =
          activeColor
            ? nodeCategoryColor(node)
            : isCategoryDescendant
              ? HIGHLIGHTED_WHITE_STAR_COLOR
              : WHITE_STAR_COLOR;
        const sprite = createStarSprite(spriteColor, spriteIntensity, diffraction);
        const emphasisScale = 1 + emphasis * 0.25;
        const spriteScale = activeColor ? 12 : isCategoryDescendant ? 10.6 : 10;
        const drawSize = Math.max(16, projected.visualRadius * spriteScale * emphasisScale);
        context.globalAlpha = alpha;
        context.drawImage(
          sprite,
          projected.x - drawSize / 2,
          projected.y - drawSize / 2,
          drawSize,
          drawSize,
        );
        context.globalAlpha = 1;
      }

      const labelIds = getConstellationLabelIds(graph, selected, hovered);
      context.textBaseline = "middle";
      for (const labelId of labelIds) {
        const projected = projectedNodes.get(labelId);
        if (!projected) continue;
        const isHoverLabel = labelId === hovered && labelId !== selected;
        const fontSize =
          projected.node.kind === "category" ? 14 : projected.node.kind === "project" ? 12 : 10;
        context.font = `${projected.node.kind === "category" ? 500 : 450} ${fontSize}px "IBM Plex Sans", "Avenir Next", sans-serif`;
        const x = projected.x + Math.max(9, projected.visualRadius * 1.7);
        const y = projected.y - Math.max(2, projected.visualRadius * 0.15);
        context.shadowColor = "rgba(0, 0, 0, 0.95)";
        context.shadowBlur = 8;
        context.fillStyle = `rgba(226, 235, 240, ${isHoverLabel ? 0.82 : 0.94})`;
        context.fillText(projected.node.label, x, y);
        context.shadowBlur = 0;
      }

      const vignette = context.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.3,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.7,
      );
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.67)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      animationFrame = window.requestAnimationFrame(render);
    };

    const resume = () => {
      window.cancelAnimationFrame(animationFrame);
      previousFrameTimeRef.current = 0;
      if (!document.hidden) animationFrame = window.requestAnimationFrame(render);
    };
    document.addEventListener("visibilitychange", resume);
    animationFrame = window.requestAnimationFrame(render);
    return () => {
      running = false;
      document.removeEventListener("visibilitychange", resume);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [adjacency, ambientStars, graph, nodesById]);

  const screenPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }, []);

  const hitTest = useCallback(
    (screenX: number, screenY: number): string | null => {
      const candidates = [...projectedNodesRef.current.values()]
        .filter((projected) => {
          const distance = Math.hypot(screenX - projected.x, screenY - projected.y);
          return distance <= projected.hitRadius;
        })
        .sort((left, right) => {
          const leftDistance = Math.hypot(screenX - left.x, screenY - left.y);
          const rightDistance = Math.hypot(screenX - right.x, screenY - right.y);
          const distanceDelta = leftDistance - rightDistance;
          return Math.abs(distanceDelta) > 1.5 ? distanceDelta : right.z - left.z;
        });

      for (const candidate of candidates) {
        const target = resolveConstellationInteractionTarget(
          graph,
          candidate.node.id,
          selectedIdRef.current,
        );
        if (target) return target;
      }
      return null;
    },
    [graph],
  );

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = screenPoint(event);
    const pointer = pointerRef.current;
    if (pointer.active && pointer.pointerId === event.pointerId) {
      pointer.distance = Math.hypot(point.x - pointer.startX, point.y - pointer.startY);
      if (pointer.distance > 5) {
        setHoveredId(null);
        return;
      }
    }
    const target = hitTest(point.x, point.y);
    setHoveredId((current) => (current === target ? current : target));
    event.currentTarget.style.cursor = target ? "pointer" : "default";
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = screenPoint(event);
    pointerRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      distance: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    const point = screenPoint(event);
    if (pointer.active && pointer.pointerId === event.pointerId && pointer.distance <= 5) {
      const target = hitTest(point.x, point.y);
      if (target) {
        setSelectedId(target);
        setHoveredId(null);
      } else {
        navigateBack();
      }
    }
    pointer.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedIdRef.current) navigateBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateBack]);

  const focusKind = getConstellationFocusKind(graph, selectedId);
  const rotationPaused =
    reducedMotion || Boolean(hoveredId) || focusKind === "system";

  return (
    <section
      className="constellationHomepage"
      ref={containerRef}
      data-testid="constellation-homepage"
      data-focus-kind={focusKind}
      data-selected-id={selectedId ?? ""}
      data-hovered-id={hoveredId ?? ""}
      data-rotation-paused={rotationPaused ? "true" : "false"}
    >
      <canvas
        ref={canvasRef}
        className="constellationCanvas"
        aria-label="Interactive three-dimensional constellation of stories, philosophy, tools, games, videos, and music"
        data-testid="constellation-canvas"
        data-node-count={graph.nodes.length}
        data-edge-count={graph.edges.length}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => {
          pointerRef.current.active = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerLeave={(event) => {
          setHoveredId(null);
          event.currentTarget.style.cursor = "default";
        }}
      />
      {topRightControls ? (
        <div className="constellationTopRightControls pageChromeTopBarControls windowNoDrag">
          {topRightControls}
        </div>
      ) : null}
      <span className="constellationA11yStatus" aria-live="polite">
        {selectedId ? nodesById.get(selectedId)?.label : "Constellation overview"}
      </span>
    </section>
  );
}
