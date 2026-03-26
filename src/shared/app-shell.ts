export type AppPage = "homepage" | "projects" | "slack" | "agents" | "skills";

export interface AppPageDefinition {
  id: AppPage;
  label: string;
}

export const APP_PAGE_OPTIONS: AppPageDefinition[] = [
  { id: "homepage", label: "Homepage" },
  { id: "projects", label: "Projects" },
  { id: "agents", label: "Agents" },
  { id: "slack", label: "Slack" },
  { id: "skills", label: "Skills" },
];

export const getVisibleAppPageOptions = (): AppPageDefinition[] => APP_PAGE_OPTIONS;

export const resolveVisibleAppPage = (page: AppPage): AppPage => page;
