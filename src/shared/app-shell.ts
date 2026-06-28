export type AppPage = "homepage" | "threads" | "projects" | "agents";
export type LegacyAppPage = "systems-syntax";

export interface AppPageDefinition {
  id: AppPage;
  label: string;
}

export const APP_PAGE_OPTIONS: AppPageDefinition[] = [
  { id: "homepage", label: "Homepage" },
  { id: "threads", label: "Threads" },
  { id: "projects", label: "Projects" },
  { id: "agents", label: "Agents" },
];

export const getVisibleAppPageOptions = (): AppPageDefinition[] => APP_PAGE_OPTIONS;

export const resolveVisibleAppPage = (page: AppPage | LegacyAppPage): AppPage =>
  page === "systems-syntax" ? "threads" : page;
