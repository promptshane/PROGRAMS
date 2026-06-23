export type CreativeCategoryId =
  | "stories"
  | "philosophy"
  | "tools"
  | "games"
  | "videos"
  | "music";

export interface CreativeCategoryDefinition {
  id: CreativeCategoryId;
  label: string;
  singularLabel: string;
  color: string;
  glow: string;
}

export const CREATIVE_CATEGORIES: readonly CreativeCategoryDefinition[] = [
  {
    id: "stories",
    label: "Stories",
    singularLabel: "Story",
    color: "#ef8aa5",
    glow: "#e85f86",
  },
  {
    id: "philosophy",
    label: "Philosophy",
    singularLabel: "Philosophy",
    color: "#aaa0e8",
    glow: "#8878da",
  },
  {
    id: "tools",
    label: "Tools",
    singularLabel: "Tool",
    color: "#87c8df",
    glow: "#5aa9c8",
  },
  {
    id: "games",
    label: "Games",
    singularLabel: "Game",
    color: "#c5d58d",
    glow: "#aebf66",
  },
  {
    id: "videos",
    label: "Videos",
    singularLabel: "Video",
    color: "#f2ad72",
    glow: "#db7d43",
  },
  {
    id: "music",
    label: "Music",
    singularLabel: "Music",
    color: "#72d6bd",
    glow: "#39ac91",
  },
] as const;

const CREATIVE_CATEGORY_IDS = new Set<CreativeCategoryId>(
  CREATIVE_CATEGORIES.map((category) => category.id),
);

export const isCreativeCategoryId = (value: unknown): value is CreativeCategoryId =>
  typeof value === "string" && CREATIVE_CATEGORY_IDS.has(value as CreativeCategoryId);

export const getCreativeCategory = (
  categoryId: CreativeCategoryId,
): CreativeCategoryDefinition =>
  CREATIVE_CATEGORIES.find((category) => category.id === categoryId)
  ?? CREATIVE_CATEGORIES[0];
