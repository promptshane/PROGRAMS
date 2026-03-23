import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { FlowchartGraph, FlowchartNode } from "@shared/types";
import { normalizeFlowchartGraph } from "@shared/flowchart";
import { getDefaultNodeId } from "../lib/flowchart-navigation";

export interface GuidedOption {
  nodeId: string;
  node: FlowchartNode;
  edgeLabel: string | null;
}

export interface GuidedFlowchartState {
  graph: FlowchartGraph | null;
  currentNodeId: string | null;
  currentNode: FlowchartNode | null;
  options: GuidedOption[];
  canGoBack: boolean;
  navigateTo: (id: string) => void;
  goBack: () => void;
}

export function useGuidedFlowchart(rawGraph: FlowchartGraph | null): GuidedFlowchartState {
  const graph = useMemo(() => normalizeFlowchartGraph(rawGraph), [rawGraph]);

  const defaultNodeId = useMemo(() => (graph ? getDefaultNodeId(graph) : null), [graph]);
  const [history, setHistory] = useState<string[]>(() => (defaultNodeId ? [defaultNodeId] : []));

  const prevGraphRef = useRef(rawGraph);
  useEffect(() => {
    if (rawGraph !== prevGraphRef.current) {
      prevGraphRef.current = rawGraph;
      const newDefault = graph ? getDefaultNodeId(graph) : null;
      setHistory(newDefault ? [newDefault] : []);
    }
  }, [rawGraph, graph]);

  const currentNodeId = history.length > 0 ? history[history.length - 1] : null;

  const currentNode = useMemo(
    () => (graph && currentNodeId ? (graph.nodes.find((n) => n.id === currentNodeId) ?? null) : null),
    [graph, currentNodeId],
  );

  const options = useMemo((): GuidedOption[] => {
    if (!graph || !currentNodeId) return [];
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges
      .filter((e) => e.from === currentNodeId && nodeMap.has(e.to))
      .map((e) => ({
        nodeId: e.to,
        node: nodeMap.get(e.to)!,
        edgeLabel: e.label ?? null,
      }));
  }, [graph, currentNodeId]);

  const navigateTo = useCallback((id: string) => {
    setHistory((prev) => [...prev, id]);
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  return {
    graph,
    currentNodeId,
    currentNode,
    options,
    canGoBack: history.length > 1,
    navigateTo,
    goBack,
  };
}
