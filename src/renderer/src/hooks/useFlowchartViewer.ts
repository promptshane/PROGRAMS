import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { FlowchartGraph } from "@shared/types";
import { normalizeFlowchartGraph } from "@shared/flowchart";
import { computeLayout, type FlowchartLayout, type LayoutNode } from "../lib/flowchart-layout";
import { getVisibleNodeIds, getMaxHops, getDefaultNodeId } from "../lib/flowchart-navigation";

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface FlowchartViewerState {
  layout: FlowchartLayout;
  selectedNodeId: string | null;
  selectedNode: LayoutNode | null;
  zoomLevel: number;
  maxZoom: number;
  visibleNodeIds: Set<string>;
  viewTransform: ViewTransform;
  selectNode: (id: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

export function useFlowchartViewer(
  rawGraph: FlowchartGraph | null,
  containerWidth: number,
  containerHeight: number,
): FlowchartViewerState {
  const graph = useMemo(() => normalizeFlowchartGraph(rawGraph), [rawGraph]);
  const layout = useMemo(() => (graph ? computeLayout(graph) : { nodes: [], edges: [], width: 0, height: 0 }), [graph]);
  const maxZoom = useMemo(() => (graph ? getMaxHops(graph) : 1), [graph]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(maxZoom);
  const prevGraphRef = useRef(rawGraph);

  // Reset selection when graph changes
  useEffect(() => {
    if (rawGraph !== prevGraphRef.current) {
      prevGraphRef.current = rawGraph;
      setSelectedNodeId(null);
      setZoomLevel(maxZoom);
    }
  }, [rawGraph, maxZoom]);

  const selectedNode = useMemo(
    () => layout.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [layout.nodes, selectedNodeId],
  );

  const visibleNodeIds = useMemo(
    () => (graph ? getVisibleNodeIds(graph, selectedNodeId, zoomLevel) : new Set<string>()),
    [graph, selectedNodeId, zoomLevel],
  );

  const computeTransform = useCallback(
    (nodeId: string | null): ViewTransform => {
      if (!nodeId || layout.width === 0) {
        // Fit entire graph in container
        const scaleX = containerWidth / Math.max(layout.width, 1);
        const scaleY = containerHeight / Math.max(layout.height, 1);
        const scale = Math.min(scaleX, scaleY, 1);
        const x = (containerWidth - layout.width * scale) / 2;
        const y = (containerHeight - layout.height * scale) / 2;
        return { x, y, scale };
      }

      const node = layout.nodes.find((n) => n.id === nodeId);
      if (!node) {
        const scale = Math.min(containerWidth / Math.max(layout.width, 1), containerHeight / Math.max(layout.height, 1), 1);
        return { x: (containerWidth - layout.width * scale) / 2, y: (containerHeight - layout.height * scale) / 2, scale };
      }

      // Scale to fit visible subset with some padding
      const scale = Math.min(containerWidth / Math.max(layout.width, 1), containerHeight / Math.max(layout.height, 1), 1.2);
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      const x = containerWidth / 2 - centerX * scale;
      const y = containerHeight / 2 - centerY * scale;
      return { x, y, scale };
    },
    [containerWidth, containerHeight, layout],
  );

  const viewTransform = useMemo(() => computeTransform(selectedNodeId), [computeTransform, selectedNodeId]);

  const selectNode = useCallback(
    (id: string) => {
      setSelectedNodeId((prev) => (prev === id ? null : id));
    },
    [],
  );

  const zoomIn = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.max(1, prev - 1);
      // If zooming in from full view with no selection, auto-select first node
      if (prev >= maxZoom && !selectedNodeId && graph) {
        const defaultId = getDefaultNodeId(graph);
        if (defaultId) setSelectedNodeId(defaultId);
      }
      return next;
    });
  }, [maxZoom, selectedNodeId, graph]);

  const zoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.min(maxZoom, prev + 1));
  }, [maxZoom]);

  const resetView = useCallback(() => {
    setSelectedNodeId(null);
    setZoomLevel(maxZoom);
  }, [maxZoom]);

  return {
    layout,
    selectedNodeId,
    selectedNode,
    zoomLevel,
    maxZoom,
    visibleNodeIds,
    viewTransform,
    selectNode,
    zoomIn,
    zoomOut,
    resetView,
  };
}
