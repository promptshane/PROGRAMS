import type { CorePillar, PillarType } from "./types";

export const MAIN_TIMELINE_PILLAR_TYPES = ["core", "tbd", "hard-stop"] as const satisfies readonly PillarType[];
export const BRANCH_PILLAR_TYPES = ["side", "ghost"] as const satisfies readonly PillarType[];
export const ALL_PILLAR_TYPES = ["core", "side", "ghost", "tbd", "hard-stop"] as const satisfies readonly PillarType[];

export interface PillarFlowLine {
  pillar: CorePillar;
  depth: number;
  trail: string[];
}

export interface FormatPillarFlowSectionOptions {
  includeDetails?: boolean;
  showTrail?: boolean;
  emptyLabel?: string;
}

const PILLAR_TONE_WORDS: Record<PillarType, string> = {
  core: "green",
  side: "blue",
  ghost: "purple",
  tbd: "yellow",
  "hard-stop": "red",
};

const PILLAR_KIND_WORDS: Record<PillarType, string> = {
  core: "core",
  side: "side",
  ghost: "ghost",
  tbd: "tbd",
  "hard-stop": "end",
};

export const sortPillarsByOrder = <T extends { order?: number }>(pillars: T[]): T[] =>
  [...pillars].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

export const getPillarLane = (pillarType: PillarType): "main" | "branch" =>
  pillarType === "side" || pillarType === "ghost" ? "branch" : "main";

export const collectPillarFlowLines = (
  pillars: CorePillar[],
  allowedTypes: readonly PillarType[] = MAIN_TIMELINE_PILLAR_TYPES,
): PillarFlowLine[] => {
  const allowed = new Set<PillarType>(allowedTypes);
  const lines: PillarFlowLine[] = [];

  const visit = (items: CorePillar[], depth: number, trail: string[]): void => {
    for (const pillar of sortPillarsByOrder(items)) {
      const nextTrail = [...trail, pillar.name];
      if (allowed.has(pillar.pillarType)) {
        lines.push({ pillar, depth, trail: nextTrail });
      }
      if (pillar.corePillars.length > 0) {
        visit(pillar.corePillars, depth + 1, nextTrail);
      }
    }
  };

  visit(pillars, 0, []);
  return lines;
};

const formatPillarDetailLines = (pillar: CorePillar, indent: string): string[] => {
  const lines: string[] = [];
  if (pillar.function?.summary) lines.push(`${indent}  Function: ${pillar.function.summary}`);
  if (pillar.thesis?.summary) lines.push(`${indent}  Thesis: ${pillar.thesis.summary}`);
  if (pillar.fullFlow?.summary) lines.push(`${indent}  Flow: ${pillar.fullFlow.summary}`);
  if (pillar.assumptionText) {
    lines.push(
      `${indent}  Assumption: ${pillar.assumptionSource === "dan" ? "Dan assumes" : "Direction"} ${pillar.assumptionText}`,
    );
  }
  return lines;
};

export const formatPillarFlowSection = (
  title: string,
  pillars: CorePillar[],
  allowedTypes: readonly PillarType[] = MAIN_TIMELINE_PILLAR_TYPES,
  options: FormatPillarFlowSectionOptions = {},
): string => {
  const lines = collectPillarFlowLines(pillars, allowedTypes);
  if (lines.length === 0) {
    return `${title}:\n- ${options.emptyLabel ?? "None yet."}`;
  }

  const rendered = lines.map(({ pillar, depth, trail }) => {
    const indent = "  ".repeat(depth);
    const tone = PILLAR_TONE_WORDS[pillar.pillarType];
    const kind = PILLAR_KIND_WORDS[pillar.pillarType];
    const path = options.showTrail && trail.length > 1 ? ` (${trail.slice(0, -1).join(" > ")})` : "";
    const detailLines = options.includeDetails === false ? [] : formatPillarDetailLines(pillar, indent);

    return [
      `${indent}- [${tone} ${kind}] ${pillar.name}${path}`,
      ...detailLines,
    ].join("\n");
  });

  return `${title}:\n${rendered.join("\n")}`;
};
