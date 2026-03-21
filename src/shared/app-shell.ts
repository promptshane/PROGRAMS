import { SLACK_CHAT_ENABLED } from "./types.ts";

export type AppPage = "homepage" | "projects" | "slack" | "agents" | "skills" | "calendar" | "health";

export interface AppPageDefinition {
  id: AppPage;
  label: string;
}

export const APP_PAGE_OPTIONS: AppPageDefinition[] = [
  { id: "homepage", label: "Homepage" },
  { id: "projects", label: "Projects" },
  { id: "slack", label: "Slack" },
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "calendar", label: "Calendar" },
  { id: "health", label: "Health" },
];

const SLACK_FALLBACK_PAGE: AppPage = "agents";

export const getVisibleAppPageOptions = (): AppPageDefinition[] =>
  SLACK_CHAT_ENABLED
    ? APP_PAGE_OPTIONS
    : APP_PAGE_OPTIONS.filter((page) => page.id !== "slack");

export const resolveVisibleAppPage = (page: AppPage): AppPage =>
  SLACK_CHAT_ENABLED || page !== "slack" ? page : SLACK_FALLBACK_PAGE;
