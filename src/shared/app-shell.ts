import { SLACK_CHAT_ENABLED } from "./types.ts";

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

const SLACK_FALLBACK_PAGE: AppPage = "agents";

export const getVisibleAppPageOptions = (): AppPageDefinition[] =>
  SLACK_CHAT_ENABLED
    ? APP_PAGE_OPTIONS
    : APP_PAGE_OPTIONS.filter((page) => page.id !== "slack");

export const resolveVisibleAppPage = (page: AppPage): AppPage =>
  SLACK_CHAT_ENABLED || page !== "slack" ? page : SLACK_FALLBACK_PAGE;
