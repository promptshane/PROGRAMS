export type AppPage = "homepage" | "projects" | "agents";

export interface AppPageDefinition {
  id: AppPage;
  label: string;
}

export const APP_PAGE_OPTIONS: AppPageDefinition[] = [
  { id: "homepage", label: "Homepage" },
  { id: "projects", label: "Projects" },
  { id: "agents", label: "Agents" },
];

export const getVisibleAppPageOptions = (): AppPageDefinition[] => APP_PAGE_OPTIONS;

export const resolveVisibleAppPage = (page: AppPage): AppPage => page;
