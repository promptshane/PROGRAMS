import type { InstallSkillCatalogInput, Skill } from "@shared/types";

export const USER_TESTING_RUNNER_PLACEHOLDER = "{{PROGRAMS_PLAYWRIGHT_RUNNER}}";

const FRONTEND_DESIGN_INSTRUCTIONS = `
Use this skill when the request is primarily about interface polish, layout, visual hierarchy, responsive behavior, or motion.

Operating rules:
- Establish a clear visual direction before changing code.
- Use deliberate typography, spacing, contrast, and color tokens instead of generic defaults.
- Preserve the existing design system when one already exists.
- Check desktop and mobile layouts whenever the change touches visible UI.
- Prefer meaningful motion and state feedback over decorative animation.
- Call out any missing assets, copy, or design constraints that block a coherent result.
`.trim();

const USER_TESTING_INSTRUCTIONS = `
Use this skill when you need to exercise a running web app like a user and inspect the visible result.

Workflow:
- Make sure the app is running locally and identify its URL.
- Run the PROGRAMS Playwright runner:
  node "${USER_TESTING_RUNNER_PLACEHOLDER}" --url <local-url> --output-dir <artifact-dir> [--actions-json '<json>']
- Review the generated screenshots, console messages, and text snapshot after each meaningful change.
- If the app exposes window.render_game_to_text(), capture and compare that output with what is visible on screen.
- Iterate until the behavior and visuals match the requested outcome.

Action format:
- wait: {"type":"wait","ms":1200}
- click: {"type":"click","selector":"button[type=submit]"}
- fill: {"type":"fill","selector":"input[name=email]","value":"test@example.com"}
- press: {"type":"press","key":"Enter","selector":"input[name=email]"}
- hover: {"type":"hover","selector":"[data-testid=menu]"}
`.trim();

const CATALOG_SKILLS: Record<InstallSkillCatalogInput["catalogId"], Omit<Skill, "id" | "createdAt" | "updatedAt" | "installStatus" | "installPath" | "lastError"> & { defaultInstallStatus?: Skill["installStatus"] }> = {
  "frontend-design-universal": {
    name: "Front-end Design",
    description: "Universal design-focused skill for intentional UI, responsive layouts, and polished visual direction.",
    sourceProvider: "universal",
    sourceType: "skill",
    instructions: FRONTEND_DESIGN_INSTRUCTIONS,
    originalFilePath: null,
    isUniversal: true,
    installSlug: "frontend-design-universal",
    defaultInstallStatus: "ready",
  },
  "user-testing-universal": {
    name: "User Testing",
    description: "Universal browser-testing skill that uses the PROGRAMS Playwright runner to inspect live app behavior.",
    sourceProvider: "universal",
    sourceType: "skill",
    instructions: USER_TESTING_INSTRUCTIONS,
    originalFilePath: null,
    isUniversal: true,
    installSlug: "user-testing-universal",
    defaultInstallStatus: "ready",
  },
};

export const listCatalogSkills = (): InstallSkillCatalogInput["catalogId"][] =>
  Object.keys(CATALOG_SKILLS) as InstallSkillCatalogInput["catalogId"][];

export const buildCatalogSkill = (
  catalogId: InstallSkillCatalogInput["catalogId"],
  options: {
    id: string;
    createdAt: string;
    updatedAt: string;
    installStatus?: Skill["installStatus"];
    installPath?: string | null;
    lastError?: string | null;
  },
): Skill => {
  const preset = CATALOG_SKILLS[catalogId];
  return {
    id: options.id,
    name: preset.name,
    description: preset.description,
    sourceProvider: preset.sourceProvider,
    sourceType: preset.sourceType,
    instructions: preset.instructions,
    originalFilePath: preset.originalFilePath,
    isUniversal: preset.isUniversal,
    installStatus: options.installStatus ?? preset.defaultInstallStatus ?? "ready",
    installSlug: preset.installSlug,
    installPath: options.installPath ?? null,
    lastError: options.lastError ?? null,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
  };
};
