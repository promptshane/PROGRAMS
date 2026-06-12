import { createElement, type ReactElement } from "react";
import type { AiProvider, AuthSnapshot, UsageSnapshot, UsageWindow } from "@shared/types";
import { providerLabel } from "../lib/formatting";
import { getUsageScheduleTone, type UsageScheduleTone } from "../lib/session-helpers";

export type UsageTriggerDotColor = "green" | "yellow" | "red";
export type UsageTriggerWindowDurationMins = 300 | 10080;

export interface UsageTriggerDotState {
  provider: AiProvider;
  windowDurationMins: UsageTriggerWindowDurationMins;
  color: UsageTriggerDotColor;
}

export interface UsageTriggerProviderGroup {
  provider: AiProvider;
  dots: readonly [UsageTriggerDotState, UsageTriggerDotState];
}

export interface UsageTriggerButtonProps {
  auth: Pick<AuthSnapshot, "claude" | "codex">;
  usage: UsageSnapshot;
  onClick: () => void;
}

const PROVIDER_ORDER: readonly AiProvider[] = ["claude", "codex"];
const WINDOW_ORDER: readonly [UsageTriggerWindowDurationMins, UsageTriggerWindowDurationMins] = [300, 10080];

const DOT_COLOR_CLASS: Record<UsageTriggerDotColor, string> = {
  green: "sysHealthDot--green",
  yellow: "sysHealthDot--yellow",
  red: "sysHealthDot--red",
};

const pickVisibleUsageProviders = (auth: Pick<AuthSnapshot, "claude" | "codex">): AiProvider[] =>
  PROVIDER_ORDER.filter((provider) => auth[provider].loggedIn);

const findUsageWindow = (
  windows: UsageWindow[],
  windowDurationMins: UsageTriggerWindowDurationMins,
): UsageWindow | null => windows.find((window) => window.windowDurationMins === windowDurationMins) ?? null;

const usageScheduleToneToColor = (tone: UsageScheduleTone): UsageTriggerDotColor => {
  if (tone === "over") {
    return "red";
  }
  if (tone === "under") {
    return "green";
  }
  return "yellow";
};

export const getUsageTriggerDotColor = (window: UsageWindow | null | undefined): UsageTriggerDotColor => {
  if (!window) {
    return "yellow";
  }

  return usageScheduleToneToColor(getUsageScheduleTone(window));
};

export const buildUsageTriggerProviderGroups = (
  usage: UsageSnapshot,
  auth: Pick<AuthSnapshot, "claude" | "codex">,
): UsageTriggerProviderGroup[] =>
  pickVisibleUsageProviders(auth).map((provider) => {
    const providerUsage = usage[provider];
    const dots: UsageTriggerProviderGroup["dots"] = [
      {
        provider,
        windowDurationMins: WINDOW_ORDER[0],
        color: getUsageTriggerDotColor(findUsageWindow(providerUsage.windows, WINDOW_ORDER[0])),
      },
      {
        provider,
        windowDurationMins: WINDOW_ORDER[1],
        color: getUsageTriggerDotColor(findUsageWindow(providerUsage.windows, WINDOW_ORDER[1])),
      },
    ];

    return { provider, dots };
  });

export const getUsageTriggerAriaLabel = (auth: Pick<AuthSnapshot, "claude" | "codex">): string | null => {
  const providers = pickVisibleUsageProviders(auth);
  if (providers.length === 0) {
    return null;
  }

  if (providers.length === 1) {
    return `Open usage overview for ${providerLabel(providers[0])}`;
  }

  return "Open usage overview for Claude and Codex";
};

export function UsageTriggerButton({
  auth,
  usage,
  onClick,
}: UsageTriggerButtonProps): ReactElement | null {
  const providerGroups = buildUsageTriggerProviderGroups(usage, auth);
  if (providerGroups.length === 0) {
    return null;
  }

  const ariaLabel = getUsageTriggerAriaLabel(auth) ?? "Open usage overview";

  return createElement(
    "button",
    {
      type: "button",
      className: "usageTrigger projectBrowseBadge projectBrowseBadgeClickable sysHealthTrigger",
      onClick,
      "aria-label": ariaLabel,
      title: ariaLabel,
    },
    createElement(
      "span",
      {
        className: "usageTriggerDots sysHealthTriggerDots",
        "aria-hidden": true,
      },
      ...providerGroups.flatMap((group, index) => [
        index > 0
          ? createElement("span", {
              key: `${group.provider}-divider`,
              className: "usageTriggerDivider",
              "aria-hidden": true,
            })
          : null,
        createElement(
          "span",
          {
            key: group.provider,
            className: `usageTriggerProviderGroup usageTriggerProviderGroup--${group.provider}`,
          },
          createElement("span", {
            className: `sysHealthDot ${DOT_COLOR_CLASS[group.dots[0].color]}`,
            "aria-hidden": true,
          }),
          createElement("span", {
            className: `sysHealthDot ${DOT_COLOR_CLASS[group.dots[1].color]}`,
            "aria-hidden": true,
          }),
        ),
      ]),
    ),
  );
}
