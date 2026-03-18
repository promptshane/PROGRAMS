import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app, shell } from "electron";
import {
  CLAUDE_DOWNLOAD_URL,
  CODEX_DOWNLOAD_URL,
  GIT_DOWNLOAD_URL,
  EMPTY_RUNTIME,
  createStarterFlowchart,
} from "@main/defaults";
import { ClaudeService } from "@main/services/claude-service";
import { CodexService } from "@main/services/codex-service";
import { GitHubService, type GitHubClientConfig } from "@main/services/github-service";
import { GitService } from "@main/services/git-service";
import { PlaywrightService } from "@main/services/playwright-service";
import { ProjectStore } from "@main/services/project-store";
import { RunnerService } from "@main/services/runner-service";
import {
  FLOWCHART_OUTPUT_CONTRACT,
  FLOWCHART_PROMPT_RULES,
  type FlowchartRepoHints,
  collectFlowchartRepoHints,
  flowchartGraphJsonSchema,
  formatFlowchartRepoHints,
  materializeFlowchartSnapshot,
  nullableFlowchartGraphJsonSchema,
  readFlowchartSnapshot,
  writeFlowchartSnapshot,
} from "@main/utils/flowchart";
import { emitSettledAppUpdateStatus } from "@main/utils/app-update";
import { getProviderPreflightError } from "@main/utils/provider-auth";
import { parseEnvEntries, parseProjectOutlineReportResponse, serializeEnvEntries } from "@main/utils/project-outline";
import { detectRuntimeConfig, deriveAttachedProjectName, deriveProjectDescription, slugifyRepositoryName } from "@main/utils/project";
import { buildCatalogSkill, USER_TESTING_RUNNER_PLACEHOLDER } from "@main/utils/skill-library";
import { ensureDirectory, pathExists, readTextFile, writeTextFile } from "@main/utils/fs";
import { execCommand } from "@main/utils/process";
import { DEFAULT_MODEL_CATALOG, AGENT_STAGES, AGENT_STAGE_LABELS, DIRECTOR_LABELS, DIRECTOR_NAMES, DIRECTOR_COLORS } from "@shared/types";
import type {
  AgentAttachMaterialsInput,
  AgentAttachMaterialsResult,
  AgentChatInput,
  AgentChatResponse,
  AgentConfirmStageInput,
  AgentCoreDetails,
  AgentExecuteUpdateInput,
  AgentPlannedUpdate,
  AgentProcessTodosInput,
  AgentReorderUpdatesInput,
  AgentSession,
  AgentStage,
  AgentStageData,
  AgentSubmitTodosInput,
  AgentSubmitTodosResponse,
  AgentUpdateScratchpadInput,
  AttachVibeInput,
  ConfirmAgentDataInput,
  CoreDetailsChatInput,
  CoreDetailsChatResponse,
  CascadeProposal,
  CoreDetailsProposal,
  AgentSuggestUpdateInput,
  AgentSuggestUpdateResponse,
  AgentAcceptCascadeInput,
  AgentApplyCoreDetailsInput,
  AiProvider,
  AppUpdateStatus,
  AppEvent,
  ApprovePlanInput,
  AttachPathInspection,
  BootstrapPayload,
  ClaudeAuthStatus,
  CodexAuthStatus,
  CreativeFocusMode,
  DirectorChatInput,
  DirectorChatResponse,
  DirectorConversation,
  DirectorFocusMode,
  DirectorId,
  DirectorStructuredData,
  EnvFileSnapshot,
  FeasibilityAssessment,
  GenerateFlowchartResult,
  GenerateProjectOutlineReportInput,
  GitHubAuthStatus,
  HomeScratchpadItem,
  ModelCatalog,
  ProjectCategory,
  ProjectDirectorProgress,
  RdFocusMode,
  ValidationFocusMode,
  PlanDraft,
  Project,
  ProjectAttachInput,
  ProjectCreateInput,
  ProjectDetail,
  ProjectEnableSyncInput,
  ProjectOutlineReport,
  RemoveVibeInput,
  RenameProjectInput,
  RetrySyncInput,
  RouteUpdateToProgrammingInput,
  RunValidationInput,
  SetValidationFrequencyInput,
  Settings,
  SettingsUpdateInput,
  SetupCheck,
  SetupSnapshot,
  StartPlanInput,
  UpdateProjectInput,
  UpdateRecord,
  RuntimeState,
  UsageSnapshot,
  ValidationResult,
  VersionPlan,
  VersionUpdate,
  VibeAttachment,
  GenerateFlowchartInput,
  PlanningChatInput,
  PlanningChatResponse,
  PlanningChatMessage,
  PlanningSession,
  SavePlannedUpdateInput,
  PendingPlannedUpdate,
  WriteProjectEnvFileInput,
  UnifiedTodoItem,
  ListTodosInput,
  AddTodoInput,
  UpdateTodosInput,
  GitSyncInput,
  GitSyncResult,
  Skill,
  InstallSkillCatalogInput,
  DownloadSkillInput,
  ConvertSkillInput,
  AttachSkillInput,
  DiffStats,
  PlaywrightRunInput,
  PlaywrightRunResult,
  ClaudeConnectionTestResult,
  SlackChatInput,
  SlackChatResponse,
  SlackChatMessage,
} from "@shared/types";

type Emit = (event: AppEvent) => void;

const APP_UPDATE_FRESHNESS_WINDOW_MS = 1000;
const APP_UPDATE_SOURCE_ROOTS = ["src", "scripts"] as const;
const APP_UPDATE_SOURCE_FILES = [
  "build/icon.icns",
  "build/icon.png",
  "build/icon.svg",
  "package.json",
  "package-lock.json",
  "electron-builder.yml",
  "electron.vite.config.ts",
  "tsconfig.json",
] as const;

interface AppUpdateWorkspaceInfo {
  workspacePath: string | null;
  workspaceExists: boolean;
  workspaceValid: boolean;
  workspaceError: string | null;
  sourceUpdatedAt: string | null;
  candidateAppPath: string | null;
  candidateUpdatedAt: string | null;
}

interface AppRendererAssetInfo {
  assetName: string | null;
  assetUpdatedAt: string | null;
}

interface AppUpdateEvaluation {
  status: AppUpdateStatus;
  shouldPackage: boolean;
  packageKey: string | null;
  statusKey: string | null;
  workspacePath: string | null;
}

const flowchartGenerationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["flowchartGraph"],
  properties: {
    flowchartGraph: flowchartGraphJsonSchema,
  },
} as const;

const planningChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "flowchartGraph"],
  properties: {
    response: { type: "string" },
    flowchartGraph: nullableFlowchartGraphJsonSchema,
  },
} as const;

const agentChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "confirmationSuggested", "suggestedSummary"],
  properties: {
    response: { type: "string" },
    confirmationSuggested: { type: "boolean" },
    suggestedSummary: { type: ["string", "null"] },
  },
} as const;

const agentIterationsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "plannedUpdates", "todoMapping"],
  properties: {
    response: { type: "string" },
    plannedUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    todoMapping: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["updateIndex", "todoIds"],
        properties: {
          updateIndex: { type: "number" },
          todoIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const agentTransitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
  },
} as const;

const agentCoreDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "updatedFunction", "updatedThesis", "updatedFullFlow", "updatedCorePillars"],
  properties: {
    response: { type: "string" },
    updatedFunction: { type: ["string", "null"] },
    updatedThesis: { type: ["string", "null"] },
    updatedFullFlow: { type: ["string", "null"] },
    updatedCorePillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "function", "thesis"],
        properties: {
          name: { type: "string" },
          function: { type: ["string", "null"] },
          thesis: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const agentCorePillarsResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "corePillars"],
  properties: {
    response: { type: "string" },
    corePillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "function", "thesis", "children"],
        properties: {
          name: { type: "string" },
          function: { type: "string" },
          thesis: { type: "string" },
          children: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "function", "thesis"],
              properties: {
                name: { type: "string" },
                function: { type: "string" },
                thesis: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const agentSuggestUpdateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "hasProposal", "updatedFunction", "updatedThesis", "updatedFullFlow", "updatedCorePillars"],
  properties: {
    response: { type: "string" },
    hasProposal: { type: "boolean" },
    updatedFunction: { type: ["string", "null"] },
    updatedThesis: { type: ["string", "null"] },
    updatedFullFlow: { type: ["string", "null"] },
    updatedCorePillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "functionSummary", "thesisSummary"],
        properties: {
          name: { type: "string" },
          functionSummary: { type: ["string", "null"] },
          thesisSummary: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const generateCoreDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["function", "thesis", "corePillars", "fullFlow"],
  properties: {
    function: { type: "string" },
    thesis: { type: "string" },
    corePillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "function", "thesis"],
        properties: {
          name: { type: "string" },
          function: { type: "string" },
          thesis: { type: "string" },
        },
      },
    },
    fullFlow: { type: "string" },
  },
} as const;

const agentGeneralChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "targetStages", "hasProposal", "proposedUpdates"],
  properties: {
    response: { type: "string" },
    targetStages: { type: "array", items: { type: "string" } },
    hasProposal: { type: "boolean" },
    proposedUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "updatedSummary"],
        properties: {
          stage: { type: "string" },
          updatedSummary: { type: "string" },
        },
      },
    },
  },
} as const;

const agentCascadeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "cascadeUpdates"],
  properties: {
    response: { type: "string" },
    cascadeUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "updatedSummary"],
        properties: {
          stage: { type: "string" },
          updatedSummary: { type: "string" },
        },
      },
    },
  },
} as const;

function formatCoreDetails(session: AgentSession | null): string {
  if (!session) return "";
  const fn = session.stages.function.confirmed?.summary;
  const th = session.stages.thesis.confirmed?.summary;
  const cp = session.corePillars.map((p) => p.name).join(", ") || null;
  const ff = session.stages.full_flow.confirmed?.summary;
  if (!fn && !th && !cp && !ff) return "";
  return [
    "Project core details:",
    fn && `- Function: ${fn}`,
    th && `- Thesis: ${th}`,
    cp && `- Core pillars: ${cp}`,
    ff && `- Full-flow: ${ff}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function readMaterialContents(paths: string[]): Promise<string> {
  const results: string[] = [];
  for (const filePath of paths) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const baseName = filePath.split("/").pop() ?? filePath;
    if (["txt", "md", "json", "csv", "html", "xml", "ts", "tsx", "js", "jsx"].includes(ext)) {
      try {
        const content = await readTextFile(filePath);
        results.push(`--- File: ${baseName} ---\n${content.slice(0, 8000)}`);
      } catch {
        results.push(`--- File: ${baseName} (could not read) ---`);
      }
    } else {
      results.push(`--- File: ${baseName} (binary, .${ext}) ---\n[File attached but content not directly readable]`);
    }
  }
  return results.join("\n\n");
}

function formatUnifiedConversation(session: AgentSession, maxMessages = 30): string {
  const msgs = session.unifiedMessages.slice(-maxMessages);
  if (msgs.length === 0) return "";
  return `\nConversation so far:\n${msgs.map((m) =>
    `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
  ).join("\n\n")}\n`;
}

// Legacy fallback for sessions without unified messages
function formatCrossStageMessages(session: AgentSession, stage: AgentStage): string {
  // If unified messages exist, use those
  if (session.unifiedMessages.length > 0) {
    return formatUnifiedConversation(session);
  }

  const formatMessages = (msgs: AgentSession["stages"]["function"]["messages"], label: string): string => {
    if (msgs.length === 0) return "";
    return `\n--- ${label} conversation ---\n${msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n`;
  };

  if (stage === "function") {
    const msgs = session.stages.function.messages.slice(-10);
    return msgs.length > 0
      ? `\nConversation so far:\n${msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n`
      : "";
  }

  if (stage === "thesis") {
    const funcMsgs = session.stages.function.messages.slice(-5);
    const thesisMsgs = session.stages.thesis.messages.slice(-10);
    return formatMessages(funcMsgs, "Function") + formatMessages(thesisMsgs, "Thesis");
  }

  if (stage === "core_pillars") {
    const funcMsgs = session.stages.function.messages.slice(-3);
    const thesisMsgs = session.stages.thesis.messages.slice(-5);
    const cpMsgs = session.stages.core_pillars.messages.slice(-10);
    return formatMessages(funcMsgs, "Function") + formatMessages(thesisMsgs, "Thesis") + formatMessages(cpMsgs, "Core Pillars");
  }

  if (stage === "full_flow") {
    const funcMsgs = session.stages.function.messages.slice(-3);
    const thesisMsgs = session.stages.thesis.messages.slice(-3);
    const cpMsgs = session.stages.core_pillars.messages.slice(-5);
    const flowMsgs = session.stages.full_flow.messages.slice(-10);
    return formatMessages(funcMsgs, "Function") + formatMessages(thesisMsgs, "Thesis") + formatMessages(cpMsgs, "Core Pillars") + formatMessages(flowMsgs, "Full-Flow");
  }

  const msgs = session.stages.iterations?.messages.slice(-10) ?? [];
  return msgs.length > 0
    ? `\nConversation so far:\n${msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n`
    : "";
}

async function buildAgentStagePrompt(
  stage: AgentStage,
  projectName: string,
  session: AgentSession,
  repoHints?: string,
): Promise<string> {
  const confirmedContext: string[] = [];
  const fc = session.stages.function.confirmed;
  if (fc) confirmedContext.push(`Function: ${fc.summary}`);
  const tc = session.stages.thesis.confirmed;
  if (tc) confirmedContext.push(`Thesis: ${tc.summary}`);
  const cpc = session.stages.core_pillars.confirmed;
  if (cpc) confirmedContext.push(`Core Pillars: ${cpc.summary}`);
  if (session.corePillars.length > 0) {
    const pillarSummary = session.corePillars.map((p) =>
      `- ${p.name}: ${p.function?.summary ?? "TBD"}`
    ).join("\n");
    confirmedContext.push(`Pillar Details:\n${pillarSummary}`);
  }
  const ff = session.stages.full_flow.confirmed;
  if (ff) {
    confirmedContext.push(`Full-Flow: ${ff.summary}`);
    if (ff.currentState) confirmedContext.push(`Current State: ${ff.currentState}`);
    if (ff.finalGoal) confirmedContext.push(`Final Goal: ${ff.finalGoal}`);
  }
  const ic = session.stages.iterations.confirmed;
  if (ic) confirmedContext.push(`Iterations: ${ic.summary}`);

  const priorContext = confirmedContext.length > 0
    ? `\nPreviously confirmed context:\n${confirmedContext.join("\n")}\n`
    : "";

  // Cross-stage conversation context for unified flow
  const conversationContext = formatCrossStageMessages(session, stage);

  // Material context
  let materialContext = "";
  if (session.attachedMaterials.length > 0) {
    const contents = await readMaterialContents(session.attachedMaterials);
    materialContext = `\nAttached materials:\n${contents}\n`;
  }

  const stageInstructions: Record<AgentStage, string> = {
    function: `You are guiding a user through defining what their software program "${projectName}" does.
Your goal: produce a clear, concise summary of the program's core function.
Ask clarifying questions to understand:
- What problem does it solve?
- Who uses it?
- What are the main actions a user can perform?
When you have enough information, set confirmationSuggested to true and provide a 2-3 sentence summary in suggestedSummary. Be concise, bold, and direct rather than overly safe or subtle.`,

    thesis: `You are guiding a user through articulating WHY their program "${projectName}" matters.
You are continuing from the Function conversation. The user has already defined what the program does.
Your goal: produce a concise thesis statement explaining why this program exists and what makes it valuable.
Ask clarifying questions about:
- What motivated building this?
- What's the unique value or insight?
- Who benefits most and why?
When ready, set confirmationSuggested to true with a 1-2 sentence thesis in suggestedSummary. Be concise, bold, and direct.`,

    core_pillars: `You are guiding a user through identifying the Core Pillars of "${projectName}".
You are continuing from the Function and Thesis conversations. The user has already defined what the program does and why it matters.
Your goal: identify the 3-7 major enduring pillars (features, capabilities, or domains) that define this product.
Each pillar should be:
- A major capability or feature area that is central to the product
- Enduring (not a one-time task, but something the product will always have)
- Distinct from other pillars (minimal overlap)

Ask clarifying questions to identify these pillars. Listen for explicit sub-pillars the user describes — these should become nested children of the relevant pillar.

For each pillar, be prepared to identify:
- Name (short label)
- Function (what it does)
- Thesis (why it matters)

When you have identified the major pillars, set confirmationSuggested to true with a summary listing all identified pillar names in suggestedSummary. Be concise, bold, and direct.`,

    full_flow: `You are guiding a user through mapping the complete product flow of "${projectName}".
You are continuing from the Function, Thesis, and Core Pillars conversations. The user has defined what the program does, why it matters, and its major building blocks.
${session.corePillars.length > 0 ? `\nConfirmed Core Pillars: ${session.corePillars.map((p) => p.name).join(", ")}\n` : ""}
Your goal: string those Core Pillars together into a beginning-to-end user experience — the ideal product flow.
The Full-Flow should:
- Represent what the user experiences from start to finish
- Show how each Core Pillar fits into the overall journey
- Be ordered by user experience (not by technical implementation)
- Be structured as a sequence of clear steps, not a blob paragraph

Ask about:
- What does the user see first?
- How do they move through the product?
- Which pillars does each step involve?
- What does the ideal final experience look like?
When ready, set confirmationSuggested to true with a structured summary in suggestedSummary listing the flow steps in order (each step on its own line). Be concise and direct.`,

    iterations: `You are the iteration agent for "${projectName}".
Your role: compare the confirmed conceptual flow against the current codebase, and plan a sequence of achievable updates that will move the project from its current state to the desired state.
${repoHints ? `\nCurrent codebase analysis:\n${repoHints}\n` : ""}
Each planned update should be:
- Scoped to be achievable in a single AI coding pass (by Claude or Codex)
- Conceptual enough that an execution agent can plan the specific code changes
- Ordered by dependency and priority (foundational changes first)

Current to-do items: ${session.scratchpad.filter((s) => !s.completed).map((s) => `- [${s.source}] ${s.text}`).join("\n") || "(none)"}
Current planned updates: ${session.plannedUpdates.map((u, i) => `${i + 1}. ${u.title}: ${u.description}`).join("\n") || "(none)"}

Help the user refine and reorder updates. When satisfied, set confirmationSuggested to true with a brief summary in suggestedSummary.`,

    execution: `You are the execution agent for "${projectName}".
Your role: take the planned updates and help the user execute them one at a time.
Each planned update will be sent to the program's codebase for implementation.
Help the user review results, troubleshoot issues, and decide when to move to the next update.
When all planned updates are complete, set confirmationSuggested to true with a brief completion summary.`,
  };

  return `${stageInstructions[stage]}
${materialContext}${priorContext}${conversationContext}
Your response must be ONLY strict JSON (no markdown fences):
{"response": string, "confirmationSuggested": boolean, "suggestedSummary": string | null}
- "response" is your conversational reply to the user.
- "confirmationSuggested" is true only when you believe the stage is ready to be confirmed.
- "suggestedSummary" is a concise summary for confirmation (null if not suggesting confirmation).`.trim();
}

const buildProjectOutlinePrompt = ({
  project,
  repoHints,
  currentFlowchart,
}: {
  project: Project;
  repoHints: FlowchartRepoHints;
  currentFlowchart: string;
}): string => `
You are analyzing a software project for a non-technical dashboard view.

Project: "${project.name}"
Current description: ${project.description}
Current runtime command: ${project.runtimeConfig.runCommand ?? "Unknown"}
Current open URL: ${project.runtimeConfig.openUrl ?? "Unknown"}

Current system flowchart:
${currentFlowchart}

${formatFlowchartRepoHints(repoHints)}

Instructions:
- Explore the codebase in read-only mode.
- Do not change any files.
- Focus on plain-English explanations for a non-coder.
- For storedData, describe user-facing or app-managed data stores such as databases, JSON files, browser storage, uploaded assets, caches, and app-generated content.
- For connections, list external APIs, SDKs, hosted services, payment tools, auth providers, databases, and developer services that the code connects to.
- For costs, provide rough placeholder cost notes when the project appears to use a paid service. If exact pricing is unknown, say so clearly.
- For referencedEnvKeys, include any environment variables you see referenced in code or config.
- Return strict JSON only with this shape:
  {
    "storedData": [{ "label": string, "description": string, "children": [...] }],
    "connections": [{ "name": string, "kind": string, "description": string, "envKeys": string[] }],
    "costs": [{ "label": string, "amount": string | null, "description": string }],
    "referencedEnvKeys": string[]
  }
- Use empty arrays when nothing is detected.
`.trim();

// --- Director System Schemas ---

const directorPmSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "routeTo", "routeReason"],
  properties: {
    response: { type: "string" },
    routeTo: { type: ["string", "null"] },
    routeReason: { type: ["string", "null"] },
  },
} as const;

// Dan — Conversation mode
const directorDanConversationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "internalNotes", "suggestCreateProject"],
  properties: {
    response: { type: "string" },
    internalNotes: { type: ["array", "null"], items: { type: "string" } },
    suggestCreateProject: { type: "boolean" },
  },
} as const;

// Dan — Core-details mode
const directorDanCoreDetailsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "confirmationSuggested", "suggestedSummary"],
  properties: {
    response: { type: "string" },
    confirmationSuggested: { type: "boolean" },
    suggestedSummary: { type: ["string", "null"] },
    suggestedPillars: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "pillarType"],
        properties: {
          name: { type: "string" },
          pillarType: { type: "string" },
          description: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

// Dan — Vibes mode
const directorDanVibesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
    pillarDescriptions: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pillarId", "description"],
        properties: {
          pillarId: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

// Todd — Research mode
const directorToddResearchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "feasibilityAssessments"],
  properties: {
    response: { type: "string" },
    feasibilityAssessments: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "assessment", "complexity"],
        properties: {
          area: { type: "string" },
          assessment: { type: "string" },
          stackRecommendation: { type: ["string", "null"] },
          complexity: { type: "string" },
          costNotes: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

// Todd — Version Planning mode
const directorToddVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "confirmationSuggested", "versions"],
  properties: {
    response: { type: "string" },
    confirmationSuggested: { type: "boolean" },
    versions: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "description", "goals"],
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          goals: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

// Todd — Update Planning mode
const directorToddUpdateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "confirmationSuggested", "updates"],
  properties: {
    response: { type: "string" },
    confirmationSuggested: { type: "boolean" },
    updates: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "versionLabel"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          versionLabel: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
          area: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

// Ping — Programming
const directorPingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
    routedUpdates: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["updateId", "assignedTo"],
        properties: {
          updateId: { type: "string" },
          assignedTo: { type: "string" },
        },
      },
    },
    executionSteps: { type: ["array", "null"], items: { type: "string" } },
    readyToExecute: { type: "boolean" },
  },
} as const;

// Brad — Identify Goal mode
const directorBradGoalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
    goalSummary: { type: ["string", "null"] },
    relevantPillarIds: { type: ["array", "null"], items: { type: "string" } },
  },
} as const;

// Brad — Test Current-State mode
const directorBradTestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
    validationPassed: { type: ["boolean", "null"] },
    validationSummary: { type: ["string", "null"] },
    validationDetails: { type: ["string", "null"] },
  },
} as const;

// Brad — Compare mode
const directorBradCompareSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
    passed: { type: ["boolean", "null"] },
    improvementAreas: { type: ["array", "null"], items: { type: "string" } },
    comparisonSummary: { type: ["string", "null"] },
  },
} as const;

function getSchemaForDirector(directorId: DirectorId, focusMode: DirectorFocusMode | null) {
  switch (directorId) {
    case "project-manager": return directorPmSchema;
    case "creative-director":
      if (focusMode === "conversation") return directorDanConversationSchema;
      if (focusMode === "vibes") return directorDanVibesSchema;
      return directorDanCoreDetailsSchema;
    case "rd-director":
      if (focusMode === "research") return directorToddResearchSchema;
      if (focusMode === "version-planning") return directorToddVersionSchema;
      return directorToddUpdateSchema;
    case "programming-director": return directorPingSchema;
    case "validation-director":
      if (focusMode === "identify-goal") return directorBradGoalSchema;
      if (focusMode === "test-current-state") return directorBradTestSchema;
      return directorBradCompareSchema;
  }
}

function formatDirectorStatus(session: AgentSession): string {
  const parts: string[] = [];
  const fc = session.stages.function.confirmed;
  const tc = session.stages.thesis.confirmed;
  const cpc = session.stages.core_pillars.confirmed;
  const ffc = session.stages.full_flow.confirmed;
  parts.push(`Dan (Creative): Function=${fc ? "confirmed" : "pending"}, Thesis=${tc ? "confirmed" : "pending"}, Pillars=${cpc ? "confirmed" : "pending"}, Flow=${ffc ? "confirmed" : "pending"}`);
  parts.push(`Todd (R&D): Feasibility=${session.feasibilityAssessments.length > 0 ? session.feasibilityAssessments.length + " assessments" : "pending"}, Versions=${session.versions.length > 0 ? session.versions.map((v) => v.label).join("/") : "pending"}, Updates=${session.versionUpdates.length > 0 ? session.versionUpdates.length + " planned" : "pending"}`);
  const progUpdates = session.versionUpdates.filter((u) => u.status === "in_progress" || u.status === "completed");
  parts.push(`Ping (Programming): ${progUpdates.length > 0 ? progUpdates.length + " updates processed" : "waiting for approved updates"}`);
  parts.push(`Brad (Validation): ${session.validationResults.length > 0 ? session.validationResults.length + " results" : "no validations yet"}, Frequency=${session.validationFrequency}`);
  return parts.join("\n");
}

const directorSlackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response"],
  properties: {
    response: { type: "string" },
    handoffTo: { type: ["string", "null"] },
    handoffReason: { type: ["string", "null"] },
  },
} as const;

function buildSlackDirectorPrompt(
  directorId: DirectorId,
  projectName: string,
  session: AgentSession,
): string {
  const directorName = DIRECTOR_NAMES[directorId];
  const directorLabel = DIRECTOR_LABELS[directorId];
  const coreContext = formatCoreDetails(session);
  const statusContext = formatDirectorStatus(session);

  const slackHistory = (session.slackMessages ?? []).slice(-20).map((m) => {
    if (m.role === "user") return `User: ${m.content}`;
    return `${m.directorId ? DIRECTOR_NAMES[m.directorId] : "Agent"}: ${m.content}`;
  }).join("\n\n");
  const conversationSection = slackHistory ? `\nSlack channel history:\n${slackHistory}\n` : "";

  if (directorId === "project-manager") {
    return `You are Jeff, the Project Manager for "${projectName}".
You are in a team Slack channel with the user and all directors.
You are the central coordinator. Your role:
- Handle general user conversation about the project
- If the user's request requires a specialist, set handoffTo to the appropriate director ID and explain why in handoffReason
- If you can handle the message yourself, set handoffTo to null
- Be conversational and collaborative

Valid director IDs for handoff: creative-director (Dan), rd-director (Todd), programming-director (Ping), validation-director (Brad)

Current project status:
${statusContext}

${coreContext}
${conversationSection}
Respond as JSON: {"response": string, "handoffTo": string|null, "handoffReason": string|null}`;
  }

  return `You are ${directorName}, the ${directorLabel} for "${projectName}".
You have just joined the team Slack channel. The user or another director invited you.
Respond to the user's latest message directly and helpfully.
If you need to hand off to another specialist, set handoffTo to their director ID. Otherwise set handoffTo to null.
Be conversational and collaborative.

Valid director IDs for handoff: project-manager (Jeff), creative-director (Dan), rd-director (Todd), programming-director (Ping), validation-director (Brad)

Current project status:
${statusContext}

${coreContext}
${conversationSection}
Respond as JSON: {"response": string, "handoffTo": string|null, "handoffReason": string|null}`;
}

function buildDirectorPrompt(
  directorId: DirectorId,
  focusMode: DirectorFocusMode | null,
  projectName: string,
  session: AgentSession,
): string {
  const directorLabel = DIRECTOR_LABELS[directorId];
  const directorName = DIRECTOR_NAMES[directorId];

  // Build confirmed context from Creative stages
  const coreContext = formatCoreDetails(session);

  // Director's own conversation history
  const conv = session.directorConversations[directorId];
  const convHistory = conv?.messages.slice(-20).map((m) =>
    `${m.role === "user" ? "User" : directorName}: ${m.content}`
  ).join("\n\n") ?? "";

  const conversationSection = convHistory ? `\nConversation so far:\n${convHistory}\n` : "";

  switch (directorId) {
    case "project-manager":
      return `You are Jeff, the Project Manager for "${projectName}".
You are the central coordinator. You have access to all directors' notes. Your role:
- Handle general user conversation about the project
- Route requests to the correct director when the user wants to define, refine, or update something
- Maintain awareness of the overall project state
- Do NOT do deep specialist work — delegate to the appropriate director

Current project status:
${formatDirectorStatus(session)}

${coreContext}
${conversationSection}
If the user's message should be handled by a specific director, set routeTo to the director ID and explain why in routeReason.
Valid director IDs: creative-director (Dan), rd-director (Todd), programming-director (Ping), validation-director (Brad)
If you can handle the message yourself, set routeTo to null.

Respond as JSON: {"response": string, "routeTo": string|null, "routeReason": string|null}`;

    case "creative-director": {
      if (focusMode === "conversation") {
        return `You are Dan, the Creative Director for "${projectName}".
You are in Conversation mode — the user is brainstorming freely about their idea. Your role:
- Engage with the user's ideas, let them know strengths and weaknesses
- Ask subtly guiding questions to move their creativity forward
- Take internal notes about key details (the user does NOT see your notes)
- If the user discusses something that could be developed into a project, you may suggest creating a project
- If the user is just chatting casually, be a buddy — no pressure to turn it into a project

${coreContext}
${conversationSection}
Include any internal notes in internalNotes array (these are stored privately, not shown to user). Set suggestCreateProject to true if the conversation has enough substance to create a project.

Respond as JSON: {"response": string, "internalNotes": string[]|null, "suggestCreateProject": boolean}`;
      }

      if (focusMode === "vibes") {
        const pillarVibes = session.corePillars.length > 0 ? `\nCore Pillars (vibes can be attached to these):\n${session.corePillars.map((p) => {
          const vibeCount = p.vibes?.length ?? 0;
          return `- ${p.name} [${p.pillarType}]${vibeCount > 0 ? ` (${vibeCount} vibes attached)` : ""}${p.description ? ` — ${p.description}` : ""}`;
        }).join("\n")}` : "";
        return `You are Dan, the Creative Director for "${projectName}".
You are in Vibes mode — the user is diving deeper into the nested pillars, attaching images/text ("vibes") and descriptions. Your role:
- Help the user articulate the intended vibe, mood, and direction for specific pillars
- Generate descriptions for pillars to ensure no details are missed
- Users can attach image/text files as vibes to any pillar

${coreContext}
${pillarVibes}
${conversationSection}
When generating descriptions for pillars, include them in pillarDescriptions with the pillarId and description.

Respond as JSON: {"response": string, "pillarDescriptions": [{pillarId: string, description: string}]|null}`;
      }

      // Default: core-details mode
      const pillarsList = session.corePillars.length > 0
        ? `\nCurrent Pillars:\n${session.corePillars.map((p) => `- ${p.name} [${p.pillarType}]: ${p.function?.summary ?? "TBD"}`).join("\n")}`
        : "";
      return `You are Dan, the Creative Director for "${projectName}".
You are in Core-details mode — deriving the core-details of the project. Your role:
- Ask specific questions to derive the Function, Thesis, and Pillars
- Pillars have types: "core" (in main timeline), "side" (disconnected, hidden by default), "ghost" (hidden, would fundamentally change project), "tbd" (yellow, uncertain), "hard-stop" (red, conclusive end)
- Once core-details are derived confidently, provide the report to the user to confirm/edit
- After confirmation, user can "Proceed to R&D" or further specify vibes

${coreContext}
${pillarsList}
${conversationSection}
When you have enough information to suggest a summary, set confirmationSuggested to true and provide it in suggestedSummary. When suggesting pillars, include them in suggestedPillars with name, pillarType, and optional description.

Respond as JSON: {"response": string, "confirmationSuggested": boolean, "suggestedSummary": string|null, "suggestedPillars": [{name: string, pillarType: string, description?: string}]|null}`;
    }

    case "rd-director": {
      if (focusMode === "research") {
        const feasContext = session.feasibilityAssessments.length > 0
          ? `\nExisting feasibility assessments:\n${session.feasibilityAssessments.map((a) => `- ${a.area} [${a.complexity}]: ${a.assessment}`).join("\n")}`
          : "";
        return `You are Todd, the R&D Director for "${projectName}".
You are in Research mode — researching what is possible given the user's constraints. Your role:
- Assess feasibility of the concept
- Ask specific questions about budget (money, hardware, time, etc.)
- Recommend stack/technology decisions
- Lock in exactly what technical bridges/APIs are needed for the total function

${coreContext}
${feasContext}
${conversationSection}
When you have feasibility assessments to propose, include them in the feasibilityAssessments array. Each needs area, assessment, complexity (low/medium/high), stackRecommendation, and costNotes. Set to null if just chatting.

Respond as JSON: {"response": string, "feasibilityAssessments": [...]|null}`;
      }

      if (focusMode === "version-planning") {
        const versionsContext = session.versions.length > 0
          ? `\nExisting version plans:\n${session.versions.map((v) => `- ${v.label}: ${v.description} (${v.status})`).join("\n")}`
          : "";
        const feasContext = session.feasibilityAssessments.length > 0
          ? `\nFeasibility assessments:\n${session.feasibilityAssessments.map((a) => `- ${a.area} [${a.complexity}]: ${a.assessment}`).join("\n")}`
          : "";
        return `You are Todd, the R&D Director for "${projectName}".
You are in Version Planning mode — outlining the version roadmap. Your role:
- V1 features a fully functional process
- V2 features a functional user experience
- V3 features a polished releasable state

${coreContext}
${feasContext}
${versionsContext}
${conversationSection}
When you have version plans to propose, set confirmationSuggested to true and include them in the versions array. Set versions to null if just chatting.

Respond as JSON: {"response": string, "confirmationSuggested": boolean, "versions": [...]|null}`;
      }

      // Default: update-planning mode
      const versionsContext = session.versions.length > 0
        ? `\nVersion plans:\n${session.versions.map((v) => `- ${v.label}: ${v.description}\n  Goals: ${v.goals.join(", ")}`).join("\n")}`
        : "";
      const updatesContext = session.versionUpdates.length > 0
        ? `\nExisting updates:\n${session.versionUpdates.map((u) => `- [${u.status}] ${u.title}: ${u.description}`).join("\n")}`
        : "";
      return `You are Todd, the R&D Director for "${projectName}".
You are in Update Planning mode — specifying core updates from current state through each version. Your role:
- Group updates by what makes sense (all front-end updates grouped, all back-end updates grouped)
- Optimize update order based on what sections the programmer focuses on per update
- For V1: specific update plans. For V2: more general. For V3: end-state direction.

${coreContext}
${versionsContext}
${updatesContext}
${conversationSection}
When you have updates to propose, set confirmationSuggested to true and include them in the updates array. Each update needs title, description, versionLabel, and optionally area ("front-end"/"back-end"/etc). Set updates to null if just chatting.

Respond as JSON: {"response": string, "confirmationSuggested": boolean, "updates": [...]|null}`;
    }

    case "programming-director": {
      const pendingUpdates = session.versionUpdates.filter((u) => u.status === "pending" || u.status === "in_progress");
      const updatesContext = pendingUpdates.length > 0
        ? `\nCurrent iteration updates:\n${pendingUpdates.map((u) => `- [${u.id}] [${u.status}] ${u.title}: ${u.description}`).join("\n")}`
        : "\nNo updates awaiting implementation.";
      const subAgentInfo = session.dynamicSubAgents.length > 0
        ? `\nYour programming team:\n${session.dynamicSubAgents.map((a) => `- ${a.name} (${a.role})`).join("\n")}`
        : "";
      return `You are Ping, the Programming Director for "${projectName}".
You are the lead programmer. You receive the full update plan for the current iteration. Your role:
- Execute updates yourself for general work
- Assign updates to specific skilled sub-agents when specialized skills are needed
- You only need to know the current iteration plan

${coreContext}
${updatesContext}
${subAgentInfo}
${conversationSection}
When routing to sub-agents, include routedUpdates array. When ready to execute, include executionSteps and set readyToExecute. Set to null if just chatting.

Respond as JSON: {"response": string, "routedUpdates": [...]|null, "executionSteps": [...]|null, "readyToExecute": boolean}`;
    }

    case "validation-director": {
      if (focusMode === "identify-goal") {
        return `You are Brad, the Validation Director for "${projectName}".
You are in Identify Goal mode — reviewing the core-details and any attached vibes for the pillars that were just updated. Your role:
- Review the core-details of the project, including any attached vibes
- Identify what the expected state should be after the most recent updates
- Summarize the goal clearly

${coreContext}

${session.corePillars.length > 0 ? `Pillars with vibes:\n${session.corePillars.map((p) => {
  const vibeInfo = p.vibes?.length ? ` (${p.vibes.length} vibes)` : "";
  return `- ${p.name} [${p.pillarType}]${vibeInfo}${p.description ? `: ${p.description}` : ""}`;
}).join("\n")}` : ""}
${conversationSection}
Include goalSummary with a clear summary of the expected state. Include relevantPillarIds with the IDs of pillars relevant to this goal.

Respond as JSON: {"response": string, "goalSummary": string|null, "relevantPillarIds": string[]|null}`;
      }

      if (focusMode === "test-current-state") {
        return `You are Brad, the Validation Director for "${projectName}".
You are in Test Current-State mode — testing the current state of the project. Your role:
- Test functions and capture screenshots of visuals
- Report what the current state looks like
- Document any issues found

Validation results so far: ${session.validationResults.length > 0
  ? session.validationResults.map((r) => `${r.validationType}: ${r.passed ? "PASS" : "FAIL"} - ${r.summary}`).join("; ")
  : "None yet"}

${coreContext}
${conversationSection}
Include validationPassed, validationSummary, and validationDetails when reporting results. Set to null if just discussing.

Respond as JSON: {"response": string, "validationPassed": boolean|null, "validationSummary": string|null, "validationDetails": string|null}`;
      }

      // Default: compare mode
      return `You are Brad, the Validation Director for "${projectName}".
You are in Compare mode — comparing the current-state to the expected goal. Your role:
- Compare the current state (screenshots/test results) to the expected goal
- Return an objective comparison: current state vs intended goal-state
- Identify specific areas for improvement

${coreContext}

Validation results so far: ${session.validationResults.length > 0
  ? session.validationResults.map((r) => `${r.validationType}: ${r.passed ? "PASS" : "FAIL"} - ${r.summary}`).join("; ")
  : "None yet"}
${conversationSection}
Include passed (boolean), improvementAreas (specific areas that don't align with the plan), and comparisonSummary. Set to null if just discussing.

Respond as JSON: {"response": string, "passed": boolean|null, "improvementAreas": string[]|null, "comparisonSummary": string|null}`;
    }
  }
}

function findPillarById(pillars: AgentSession["corePillars"], id: string): AgentSession["corePillars"][number] | null {
  for (const p of pillars) {
    if (p.id === id) return p;
    const found = findPillarById(p.corePillars, id);
    if (found) return found;
  }
  return null;
}

export class ProgramsBackend {
  private readonly launchedAppPath = this.currentAppBundlePath();
  private readonly launchedAppUpdatedAtPromise = this.launchedAppPath
    ? this.readModifiedAt(this.launchedAppPath)
    : Promise.resolve(null);
  private appUpdatePackagingJob: Promise<void> | null = null;
  private appUpdatePackagingKey: string | null = null;
  private appUpdateFailedKey: string | null = null;
  private appUpdateBuildError: string | null = null;
  private appUpdateInstalling = false;
  private lastAppUpdateStatusJson: string | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly store: ProjectStore,
    private readonly git: GitService,
    private readonly github: GitHubService,
    private readonly runner: RunnerService,
    private readonly playwright: PlaywrightService,
    private readonly codex: CodexService,
    private readonly claude: ClaudeService,
    private readonly emit: Emit,
  ) {}

  async bootstrap(): Promise<BootstrapPayload> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const projects = await this.syncSelfRuntime(
      settings,
      await this.refreshProjectsRuntimeConfig(await this.store.listProjects()),
    );
    const runtimes = this.runner.getRuntimeMap(projects.map((project) => project.id));
    const modelCatalog = await this.readModelCatalog(settings);
    const skills = this.store.listSkills();
    const githubConfig = this.resolveGitHubClientConfig(settings);
    const auth = {
      codex: await this.codex.getAuthStatus(settings),
      claude: await this.claude.getAuthStatus(settings),
      github: await this.github.getStatus(githubConfig),
    };
    const setup = await this.buildSetupSnapshot(settings, auth.codex, auth.claude, auth.github);
    const appUpdate = await this.readAppUpdateStatus();

    return {
      settings,
      projects,
      runtimes,
      auth,
      setup,
      appUpdate,
      modelCatalog,
      skills,
    };
  }

  async readAppUpdateStatus(): Promise<AppUpdateStatus> {
    const settings = await this.store.readSettings();
    const status = await this.refreshAppUpdateStatus(settings, true);
    this.emitAppUpdateStatus(status);
    return status;
  }

  async installAppUpdate(): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    let evaluation = await this.evaluateAppUpdate(settings);
    let status = evaluation.status;
    if (!status.supported) {
      throw new Error(status.reason || "This build cannot install app updates.");
    }
    if (status.buildState === "packaging") {
      throw new Error("PROGRAMS is still preparing the latest app build.");
    }
    if (status.action === "none" || !status.currentAppPath) {
      throw new Error(status.reason || "No newer packaged app build is available.");
    }

    this.appUpdateInstalling = true;
    this.appUpdateBuildError = null;
    status = await this.refreshAppUpdateStatus(settings, false);
    this.emitAppUpdateStatus(status);
    const currentAppPath = status.currentAppPath;
    if (!currentAppPath) {
      this.appUpdateInstalling = false;
      throw new Error("PROGRAMS could not determine which app bundle is running.");
    }

    try {
      if (status.action === "restart") {
        await this.startAppRelaunch(currentAppPath);
      } else {
        if (!status.candidateAppPath) {
          throw new Error("PROGRAMS could not find the packaged app bundle to install.");
        }

        const requiresAdminPrompt =
          status.requiresAdminPrompt || !(await this.canReplaceInstalledApp(currentAppPath));

        if (requiresAdminPrompt) {
          await this.startPrivilegedAppSwap(currentAppPath, status.candidateAppPath);
        } else {
          await this.startWritableAppSwap(currentAppPath, status.candidateAppPath);
        }
      }
    } catch (error) {
      this.appUpdateInstalling = false;
      this.appUpdateFailedKey = evaluation.statusKey;
      this.appUpdateBuildError = this.formatAppUpdateInstallError(
        error,
        status.candidateAppPath,
      );
      const failedStatus = await this.refreshAppUpdateStatus(settings, false);
      this.emitAppUpdateStatus(failedStatus);
      throw new Error(this.appUpdateBuildError);
    }

    app.quit();
    return { started: true };
  }

  async readSettings(): Promise<Settings> {
    return this.store.readSettings();
  }

  async updateSettings(input: SettingsUpdateInput): Promise<Settings> {
    await this.ensureInitialized();
    const settings = await this.store.updateSettings(input);
    if (input.appSourcePath !== undefined) {
      this.appUpdateFailedKey = null;
      this.appUpdateBuildError = null;
    }
    await this.syncSelfRuntime(settings, await this.store.listProjects(), true);
    await this.emitSetupUpdated(settings);
    const appUpdateStatus = await this.refreshAppUpdateStatus(settings, true);
    this.emitAppUpdateStatus(appUpdateStatus);
    await this.emitModelCatalogUpdated(settings);
    return settings;
  }

  async listProjects(): Promise<Project[]> {
    await this.ensureInitialized();
    return this.syncSelfRuntime(
      undefined,
      await this.refreshProjectsRuntimeConfig(await this.store.listProjects()),
    );
  }

  async readProject(projectId: string): Promise<ProjectDetail> {
    await this.ensureInitialized();
    const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const { project, runtime } = await this.syncProjectRuntimeState(refreshedProject);
    const updates = await this.store.readHistory(projectId);
    const flowchartSnapshot = await this.readFlowchart(project);
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);

    return {
      project,
      updates,
      flowchart: flowchartSnapshot.flowchart,
      flowchartGraph: flowchartSnapshot.flowchartGraph,
      runtime,
      activePlan,
    };
  }

  async readHistory(projectId: string): Promise<UpdateRecord[]> {
    await this.ensureInitialized();
    return this.store.readHistory(projectId);
  }

  async readPlanView(projectId: string): Promise<string> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    return (await this.readFlowchart(project)).flowchart;
  }

  async readOutlineReport(projectId: string): Promise<ProjectOutlineReport | null> {
    await this.ensureInitialized();
    await this.requireProject(projectId);
    return this.store.readOutlineReport(projectId);
  }

  async generateOutlineReport(input: GenerateProjectOutlineReportInput): Promise<ProjectOutlineReport> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider ?? settings.advancedDefaults.provider, settings);
    const project = await this.requireProject(input.projectId);
    const provider = input.provider ?? settings.advancedDefaults.provider;
    const model = provider === "claude"
      ? input.claudeModel ?? settings.advancedDefaults.claudeModel
      : input.model ?? settings.advancedDefaults.model;
    const repoHints = await collectFlowchartRepoHints(project.localPath);
    const currentFlowchart = await this.readFlowchart(project);
    const prompt = buildProjectOutlinePrompt({
      project,
      repoHints,
      currentFlowchart: currentFlowchart.flowchart,
    });
    const rawResult = await this.aiService(provider).runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, provider, settings),
      model,
    );
    const report = parseProjectOutlineReportResponse(project.id, rawResult);

    await this.store.saveOutlineReport(report);
    this.emit({ type: "project.outlineReport", projectId: project.id, report });
    return report;
  }

  async readEnvFile(projectId: string): Promise<EnvFileSnapshot> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const path = join(project.localPath, ".env");
    const exists = await pathExists(path);
    const source = await readTextFile(path);

    return {
      projectId: project.id,
      path,
      exists,
      entries: parseEnvEntries(source),
    };
  }

  async writeEnvFile(input: WriteProjectEnvFileInput): Promise<EnvFileSnapshot> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const path = join(project.localPath, ".env");
    const content = serializeEnvEntries(input.entries);

    await writeTextFile(path, content);
    return {
      projectId: project.id,
      path,
      exists: true,
      entries: parseEnvEntries(content),
    };
  }

  async generateFlowchart(input: GenerateFlowchartInput): Promise<GenerateFlowchartResult> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);
    const repoHints = await collectFlowchartRepoHints(project.localPath);

    const prompt = `
You are analyzing a codebase to produce a structured high-level user-flow diagram.

Project: "${project.name}"
Current description: ${project.description}

${formatFlowchartRepoHints(repoHints)}

Instructions:
- Explore the codebase at the project root.
- Do not change any files.
- Model the user-visible experience and major system flow, not line-level code.
- Keep the graph compact, but do not merge major screens just to reduce node count.
${FLOWCHART_PROMPT_RULES}
${FLOWCHART_OUTPUT_CONTRACT}
`.trim();

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, input.provider, settings),
      model,
      flowchartGenerationSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));
    const snapshot = materializeFlowchartSnapshot(parsed.flowchartGraph);

    await this.writeFlowchart(project, snapshot);
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });

    return snapshot;
  }

  async planningChat(input: PlanningChatInput): Promise<PlanningChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session: PlanningSession;
    if (input.sessionId) {
      const existing = await this.store.getPlanningSession(input.sessionId);
      if (!existing) throw new Error("Planning session not found.");
      session = existing;
    } else {
      const currentFlowchart = await this.readFlowchart(project);
      session = {
        id: randomUUID(),
        projectId: input.projectId,
        provider: input.provider,
        messages: [],
        currentFlowchart: currentFlowchart.flowchart,
        currentFlowchartGraph: currentFlowchart.flowchartGraph,
        previousFlowchart: currentFlowchart.flowchart,
        previousFlowchartGraph: currentFlowchart.flowchartGraph,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const userMessage: PlanningChatMessage = {
      id: randomUUID(),
      role: "user",
      content: input.message,
      flowchart: null,
      flowchartGraph: null,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(userMessage);

    const recentMessages = session.messages.slice(-10);
    const conversationContext = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const repoHints = await collectFlowchartRepoHints(project.localPath);

    const prompt = `
You are a planning assistant helping a non-technical user update their software project "${project.name}".

Current system flowchart (Mermaid format):
${session.currentFlowchart}

Current system flowchart (structured graph JSON):
${session.currentFlowchartGraph ? JSON.stringify(session.currentFlowchartGraph, null, 2) : "null"}

${formatFlowchartRepoHints(repoHints)}

Conversation so far:
${conversationContext}

Instructions:
- Respond concisely and pragmatically about what you would change.
- If the user's request is clear enough, also produce an updated structured flowchart graph.
- Use the structured flowchart rules below when you update the graph.
${FLOWCHART_PROMPT_RULES}
- Your final answer must be ONLY strict JSON (no markdown fences):
  {"response": string, "flowchartGraph": FlowchartGraph | null}
- If no flowchart update is needed yet, set flowchartGraph to null.
`.trim();

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, input.provider, settings),
      model,
      planningChatSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));
    const nextSnapshot = parsed.flowchartGraph ? materializeFlowchartSnapshot(parsed.flowchartGraph) : null;

    const assistantMessage: PlanningChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: parsed.response,
      flowchart: nextSnapshot?.flowchart ?? null,
      flowchartGraph: nextSnapshot?.flowchartGraph ?? null,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(assistantMessage);

    if (nextSnapshot) {
      session.currentFlowchart = nextSnapshot.flowchart;
      session.currentFlowchartGraph = nextSnapshot.flowchartGraph;
    }

    session.updatedAt = new Date().toISOString();
    await this.store.savePlanningSession(session);

    return {
      sessionId: session.id,
      message: assistantMessage,
      updatedFlowchart: nextSnapshot?.flowchart ?? null,
      updatedFlowchartGraph: nextSnapshot?.flowchartGraph ?? null,
    };
  }

  async savePlannedUpdate(input: SavePlannedUpdateInput): Promise<PendingPlannedUpdate> {
    await this.ensureInitialized();
    const pending: PendingPlannedUpdate = {
      id: randomUUID(),
      projectId: input.projectId,
      flowchart: input.flowchart,
      flowchartGraph: input.flowchartGraph,
      previousFlowchart: input.previousFlowchart,
      previousFlowchartGraph: input.previousFlowchartGraph,
      description: input.description,
      createdAt: new Date().toISOString(),
    };

    await this.store.savePendingUpdate(pending);
    this.emit({ type: "project.pendingUpdate", projectId: input.projectId, pending });
    return pending;
  }

  async getPendingUpdate(projectId: string): Promise<PendingPlannedUpdate | null> {
    await this.ensureInitialized();
    return this.store.getPendingUpdate(projectId);
  }

  async applyPlannedUpdate(projectId: string): Promise<{ started: true }> {
    await this.ensureInitialized();
    const pending = await this.store.getPendingUpdate(projectId);
    if (!pending) throw new Error("No pending planned update found.");

    const settings = await this.store.readSettings();
    const prompt = `Update the codebase to match this target system flowchart:

Mermaid flowchart:
${pending.flowchart}

Structured flowchart graph:
${pending.flowchartGraph ? JSON.stringify(pending.flowchartGraph, null, 2) : "null"}

Changes described: ${pending.description}`;

    const input: StartPlanInput = {
      projectId,
      provider: settings.advancedDefaults.provider,
      prompt,
      speed: settings.defaultSpeed,
      model: settings.advancedDefaults.model,
      claudeModel: settings.advancedDefaults.claudeModel,
      reasoningEffort: settings.advancedDefaults.reasoningEffort,
      planningMode: settings.autoApprovePlans ? "auto" : "review",
      autoApprove: settings.autoApprovePlans,
      contextPaths: [],
    };

    await this.store.deletePendingUpdate(projectId);
    this.emit({ type: "project.pendingUpdate", projectId, pending: null });

    return this.startPlan(input);
  }

  // --- Agent System ---

  async getAgentSession(projectId: string): Promise<AgentSession | null> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (session) {
      // Migration safety for older sessions missing slack fields
      session.slackMessages = session.slackMessages ?? [];
      session.slackActiveDirectorId = session.slackActiveDirectorId ?? "project-manager";
    }
    return session;
  }

  private createEmptyAgentSession(projectId: string, provider: AgentSession["provider"]): AgentSession {
    const emptyStage = (): AgentStageData => ({ messages: [], confirmed: null });
    return {
      id: randomUUID(),
      projectId,
      currentStage: "function",
      conversationMode: "guided",
      stages: {
        function: emptyStage(),
        thesis: emptyStage(),
        core_pillars: emptyStage(),
        full_flow: emptyStage(),
        iterations: emptyStage(),
        execution: emptyStage(),
      },
      unifiedMessages: [],
      scratchpad: [],
      plannedUpdates: [],
      corePillars: [],
      coreDetailsChatHistory: [],
      attachedMaterials: [],
      miscMaterials: [],
      cascadePending: null,
      provider,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Director system fields
      directorConversations: {},
      versions: [],
      versionUpdates: [],
      feasibilityAssessments: [],
      validationResults: [],
      validationFrequency: "manual",
      activeDirectorId: null,
      directorProgress: {
        creative: "not-started",
        rd: "not-started",
        programming: "not-started",
        validation: "not-started",
        currentDirector: null,
      },
      creativeFocusMode: null,
      rdFocusMode: null,
      validationFocusMode: null,
      danInternalNotes: [],
      projectCategory: "general-project",
      dynamicSubAgents: [],
      slackMessages: [],
      slackActiveDirectorId: "project-manager",
      // Deprecated aliases
      agentConversations: {},
      activeAgentId: null,
    };
  }

  private async generateProjectCoreDetails(project: Project, settings: Settings, provider: AiProvider): Promise<void> {
    const existing = await this.store.getAgentSession(project.id);
    if (
      existing?.stages.function.confirmed &&
      existing?.stages.thesis.confirmed &&
      existing?.stages.core_pillars.confirmed &&
      existing?.stages.full_flow.confirmed
    ) {
      return;
    }

    const service = this.aiService(provider);
    const model = provider === "claude" ? settings.advancedDefaults.claudeModel : settings.advancedDefaults.model;

    const prompt = `Analyze the project "${project.name}" and generate concise core details.

Project description: ${project.description}

Explore the codebase as needed, then produce:
- function: One sentence — what the software does for its users.
- thesis: One sentence — the core value proposition or design philosophy.
- corePillars: 2–5 named pillars (major features/subsystems), each with a one-sentence function and thesis.
- fullFlow: 2–3 sentences describing the primary user journey end-to-end.

Your final answer must be ONLY strict JSON (no markdown fences) matching:
{"function": string, "thesis": string, "corePillars": [{"name": string, "function": string, "thesis": string}], "fullFlow": string}`;

    const rawResult = await service.runOneShot(project, settings, prompt, model, generateCoreDetailsSchema);
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    const session = existing ?? this.createEmptyAgentSession(project.id, provider);
    session.stages.function.confirmed = { summary: parsed.function, status: "assumed" };
    session.stages.thesis.confirmed = { summary: parsed.thesis, status: "assumed" };
    session.stages.full_flow.confirmed = { summary: parsed.fullFlow, status: "assumed" };
    session.stages.core_pillars.confirmed = {
      summary: `${parsed.corePillars.length} pillars`,
      status: "assumed",
    };
    session.corePillars = (parsed.corePillars as { name: string; function: string; thesis: string }[]).map((p) => ({
      id: randomUUID(),
      name: p.name,
      pillarType: "core" as const,
      function: { summary: p.function, status: "assumed" as const },
      thesis: { summary: p.thesis, status: "assumed" as const },
      corePillars: [],
      fullFlow: null,
      vibes: [],
      description: null,
      connectedPillarIds: [],
    }));
    session.updatedAt = new Date().toISOString();

    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: project.id, session });
  }

  async confirmCoreDetail(projectId: string, field: "function" | "thesis" | "core_pillars" | "full_flow"): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this project.");

    if (session.stages[field].confirmed) {
      session.stages[field].confirmed.status = "confirmed";
    }

    if (field === "core_pillars") {
      for (const pillar of session.corePillars) {
        if (pillar.function?.status === "assumed" || pillar.function?.status === "edited") {
          pillar.function.status = "confirmed";
        }
        if (pillar.thesis?.status === "assumed" || pillar.thesis?.status === "edited") {
          pillar.thesis.status = "confirmed";
        }
      }
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async agentChat(input: AgentChatInput): Promise<AgentChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
    }
    session.provider = input.provider;

    const stage = input.stage ?? session.currentStage;

    const userMessage = {
      id: randomUUID(),
      role: "user" as const,
      content: input.message,
      createdAt: new Date().toISOString(),
    };
    session.stages[stage].messages.push(userMessage);
    session.unifiedMessages.push(userMessage);

    const prompt = await buildAgentStagePrompt(stage, project.name, session);
    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, input.provider, settings),
      model,
      agentChatSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    const assistantMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      content: parsed.response,
      createdAt: new Date().toISOString(),
    };
    session.stages[stage].messages.push(assistantMessage);
    session.unifiedMessages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    return {
      sessionId: session.id,
      message: assistantMessage,
      confirmationSuggested: parsed.confirmationSuggested ?? false,
      suggestedConfirmation: parsed.suggestedSummary
        ? { summary: parsed.suggestedSummary }
        : null,
    };
  }

  async agentConfirmStage(input: AgentConfirmStageInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    session.stages[input.stage].confirmed = input.confirmation;

    // Add confirmation marker to unified conversation
    session.unifiedMessages.push({
      id: randomUUID(),
      role: "assistant" as const,
      content: `[${AGENT_STAGE_LABELS[input.stage]} confirmed: "${input.confirmation.summary}"]`,
      createdAt: new Date().toISOString(),
    });

    const currentIdx = AGENT_STAGES.indexOf(session.currentStage);
    const confirmedIdx = AGENT_STAGES.indexOf(input.stage);
    if (confirmedIdx >= currentIdx && confirmedIdx < AGENT_STAGES.length - 1) {
      session.currentStage = AGENT_STAGES[confirmedIdx + 1];
    }

    // Check if all core stages are confirmed -> switch to general mode
    const hasFunction = session.stages.function.confirmed != null;
    const hasThesis = session.stages.thesis.confirmed != null;
    const hasPillars = session.stages.core_pillars.confirmed != null;
    const hasFlow = session.stages.full_flow.confirmed != null;
    if (hasFunction && hasThesis && hasPillars && hasFlow) {
      session.conversationMode = "general";
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    // Auto-generate transition message for the next stage
    const nextStage = session.currentStage;
    if (nextStage !== input.stage) {
      try {
        const settings = await this.store.readSettings();
        const project = await this.requireProject(input.projectId);
        const service = this.aiService(session.provider);
        const model = session.provider === "claude"
          ? settings.advancedDefaults.claudeModel
          : settings.advancedDefaults.model;

        if (nextStage === "iterations") {
          // Special transition: investigate codebase and produce initial planned updates
          const repoHints = await collectFlowchartRepoHints(project.localPath);
          const formattedHints = formatFlowchartRepoHints(repoHints);

          const confirmedContext: string[] = [];
          const fc = session.stages.function.confirmed;
          if (fc) confirmedContext.push(`Function: ${fc.summary}`);
          const tc = session.stages.thesis.confirmed;
          if (tc) confirmedContext.push(`Thesis: ${tc.summary}`);
          const cpc = session.stages.core_pillars.confirmed;
          if (cpc) confirmedContext.push(`Core Pillars: ${cpc.summary}`);
          if (session.corePillars.length > 0) {
            confirmedContext.push(`Pillar Details: ${session.corePillars.map((p) => `${p.name} (${p.function?.summary ?? "TBD"})`).join(", ")}`);
          }
          const ff = session.stages.full_flow.confirmed;
          if (ff) {
            confirmedContext.push(`Full-Flow: ${ff.summary}`);
            if (ff.currentState) confirmedContext.push(`Current State: ${ff.currentState}`);
            if (ff.finalGoal) confirmedContext.push(`Final Goal: ${ff.finalGoal}`);
          }

          const iterationsPrompt = `You are the iteration agent for "${project.name}".
The user has confirmed the Function, Thesis, Core Pillars, and Full-Flow for their project.

Confirmed context:
${confirmedContext.join("\n")}

Current codebase analysis:
${formattedHints}

Your task: Compare the confirmed conceptual flow against the current codebase structure. Identify what needs to be added, changed, or restructured to achieve the desired flow. Then produce an ordered sequence of planned updates.

Each planned update should be:
- Scoped to be achievable in a single AI coding pass
- Conceptual enough that an execution agent can plan the specific code changes
- Ordered by dependency and priority (foundational changes first)
- Grouped so related work stays together (front-end together, back-end together, etc. when practical)

Introduce yourself, explain what you found in the codebase, how it compares to the desired flow, and present your initial update plan.

Your response must be ONLY strict JSON (no markdown fences):
{"response": string, "plannedUpdates": [{"title": string, "description": string}, ...], "todoMapping": []}`.trim();

          const rawResult = await service.runOneShot(
            project,
            settings,
            await this.appendProjectSkillInstructions(iterationsPrompt, project, session.provider, settings),
            model,
            agentIterationsSchema,
          );
          const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

          const autoMessage = {
            id: randomUUID(),
            role: "assistant" as const,
            content: parsed.response,
            createdAt: new Date().toISOString(),
          };
          session.stages.iterations.messages.push(autoMessage);
          session.unifiedMessages.push(autoMessage);

          if (Array.isArray(parsed.plannedUpdates) && parsed.plannedUpdates.length > 0) {
            session.plannedUpdates = parsed.plannedUpdates.map(
              (u: { title: string; description: string }, i: number) => ({
                id: randomUUID(),
                title: u.title,
                description: u.description,
                order: i,
                status: "pending" as const,
                sourceTodoIds: [],
              }),
            );
          }
        } else if (nextStage === "full_flow" && input.stage === "core_pillars") {
          // Special transition: generate structured CorePillar[] from the conversation
          const pillarPrompt = `Based on the core pillars conversation for "${project.name}", generate structured pillar data.

Function: ${session.stages.function.confirmed?.summary ?? "(not defined)"}
Thesis: ${session.stages.thesis.confirmed?.summary ?? "(not defined)"}
Core Pillars confirmed summary: ${session.stages.core_pillars.confirmed?.summary ?? "(not defined)"}

${formatCrossStageMessages(session, "core_pillars")}

Generate a JSON array of core pillars. For each pillar, provide:
- name: short label
- function: what this pillar does (1-2 sentences)
- thesis: why this pillar matters (1 sentence)
- children: array of sub-pillars if any were explicitly discussed (each with name, function, thesis), otherwise empty array

Also provide a conversational opening message for the Full-Flow stage, asking the user to describe how these pillars fit together into the beginning-to-end user experience.

Your response must be ONLY strict JSON (no markdown fences):
{"response": string, "corePillars": [{"name": string, "function": string, "thesis": string, "children": [{"name": string, "function": string, "thesis": string}, ...]}, ...]}`.trim();

          const rawResult = await service.runOneShot(
            project,
            settings,
            await this.appendProjectSkillInstructions(pillarPrompt, project, session.provider, settings),
            model,
            agentCorePillarsResultSchema,
          );
          const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

          if (Array.isArray(parsed.corePillars)) {
            session.corePillars = parsed.corePillars.map((p: { name: string; function: string; thesis: string; children?: { name: string; function: string; thesis: string }[] }) => ({
              id: randomUUID(),
              name: p.name,
              function: { summary: p.function, status: "assumed" as const },
              thesis: { summary: p.thesis, status: "assumed" as const },
              corePillars: (p.children ?? []).map((c: { name: string; function: string; thesis: string }) => ({
                id: randomUUID(),
                name: c.name,
                function: { summary: c.function, status: "assumed" as const },
                thesis: { summary: c.thesis, status: "assumed" as const },
                corePillars: [],
                fullFlow: null,
              })),
              fullFlow: null,
            }));
          }

          const autoMessage = {
            id: randomUUID(),
            role: "assistant" as const,
            content: parsed.response,
            createdAt: new Date().toISOString(),
          };
          session.stages.full_flow.messages.push(autoMessage);
          session.unifiedMessages.push(autoMessage);
        } else {
          // Normal transition: generate opening message for next stage
          const transitionPrompts: Record<string, string> = {
            thesis: `The user just confirmed the function of their program "${project.name}": "${session.stages.function.confirmed?.summary}".
Now you need to guide them through articulating WHY this program matters. Based on what they described about the function, ask a thoughtful opening question about their thesis/motivation.
Your response must be ONLY strict JSON (no markdown fences): {"response": string}`,
            core_pillars: `The user has confirmed the function and thesis of "${project.name}".
Function: ${session.stages.function.confirmed?.summary}
Thesis: ${session.stages.thesis.confirmed?.summary}
Now guide them through identifying the Core Pillars — the 3-7 major enduring features, capabilities, or domains that define this product. Ask a thoughtful opening question to help them start identifying these pillars.
Your response must be ONLY strict JSON (no markdown fences): {"response": string}`,
            full_flow: `The user has confirmed the function, thesis, and core pillars of "${project.name}".
Function: ${session.stages.function.confirmed?.summary}
Thesis: ${session.stages.thesis.confirmed?.summary}
Core Pillars: ${session.corePillars.map((p) => p.name).join(", ")}
Now guide them through mapping the complete conceptual flow from beginning to end, structured around these pillars. Ask about the ideal product flow from start to finish.
Your response must be ONLY strict JSON (no markdown fences): {"response": string}`,
          };

          const transitionPrompt = transitionPrompts[nextStage];
          if (transitionPrompt) {
            const rawResult = await service.runOneShot(
              project,
              settings,
              await this.appendProjectSkillInstructions(transitionPrompt, project, session.provider, settings),
              model,
              agentTransitionSchema,
            );
            const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

            const autoMessage = {
              id: randomUUID(),
              role: "assistant" as const,
              content: parsed.response,
              createdAt: new Date().toISOString(),
            };
            session.stages[nextStage].messages.push(autoMessage);
            session.unifiedMessages.push(autoMessage);
          }
        }

        session.updatedAt = new Date().toISOString();
        await this.store.saveAgentSession(session);
        this.emit({ type: "agent.session", projectId: input.projectId, session });
      } catch {
        // Auto-transition is best-effort; don't fail the confirmation
      }
    }

    return session;
  }

  async agentUpdateScratchpad(input: AgentUpdateScratchpadInput): Promise<AgentSession> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      const settings = await this.store.readSettings();
      session = this.createEmptyAgentSession(input.projectId, settings.advancedDefaults.provider);
    }

    session.scratchpad = input.scratchpad;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async agentSubmitTodos(input: AgentSubmitTodosInput): Promise<AgentSubmitTodosResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const unprocessedItems = session.scratchpad.filter((s) => !s.completed);
    if (unprocessedItems.length === 0) throw new Error("No unprocessed to-do items to submit.");

    const confirmedContext: string[] = [];
    const fc = session.stages.function.confirmed;
    if (fc) confirmedContext.push(`Function: ${fc.summary}`);
    const tc = session.stages.thesis.confirmed;
    if (tc) confirmedContext.push(`Thesis: ${tc.summary}`);
    const cpc = session.stages.core_pillars.confirmed;
    if (cpc) confirmedContext.push(`Core Pillars: ${cpc.summary}`);
    if (session.corePillars.length > 0) {
      confirmedContext.push(`Pillar Details: ${session.corePillars.map((p) => `${p.name} (${p.function?.summary ?? "TBD"})`).join(", ")}`);
    }
    const ff = session.stages.full_flow.confirmed;
    if (ff) {
      confirmedContext.push(`Full-Flow: ${ff.summary}`);
      if (ff.currentState) confirmedContext.push(`Current State: ${ff.currentState}`);
      if (ff.finalGoal) confirmedContext.push(`Final Goal: ${ff.finalGoal}`);
    }

    const existingUpdates = session.plannedUpdates.length > 0
      ? `\nExisting planned updates:\n${session.plannedUpdates.map((u, i) => `${i + 1}. ${u.title}: ${u.description}`).join("\n")}\n`
      : "";

    const prompt = `You are transforming loose to-do items into an ordered sequence of planned software updates for "${project.name}".

${confirmedContext.length > 0 ? `Confirmed context:\n${confirmedContext.join("\n")}\n` : ""}
${existingUpdates}
New to-do items to process (with IDs for mapping):
${unprocessedItems.map((s) => `- [id:${s.id}] [source:${s.source}] ${s.text}`).join("\n")}

Instructions:
- Transform each to-do item (and any existing planned updates) into a well-ordered sequence of planned updates.
- Each update should have a clear, actionable title and a 1-2 sentence description.
- Order them by dependency and priority (foundational changes first).
- Merge related items if they naturally belong together.
- In todoMapping, indicate which to-do item IDs contributed to each update (by update index).
- Your response must be ONLY strict JSON (no markdown fences):
  {"response": string, "plannedUpdates": [{"title": string, "description": string}, ...], "todoMapping": [{"updateIndex": number, "todoIds": [string, ...]}, ...]}
- "response" is your conversational reply explaining the plan.`.trim();

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, input.provider, settings),
      model,
      agentIterationsSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    // Build todoMapping lookup
    const todoMappingByIndex = new Map<number, string[]>();
    for (const mapping of (parsed.todoMapping ?? []) as { updateIndex: number; todoIds: string[] }[]) {
      todoMappingByIndex.set(mapping.updateIndex, mapping.todoIds ?? []);
    }

    // Restore orphaned user to-dos before replacing planned updates
    const oldUpdates = session.plannedUpdates;
    const allOldSourceTodoIds = new Set(oldUpdates.flatMap((u) => u.sourceTodoIds));

    const plannedUpdates: AgentPlannedUpdate[] = (parsed.plannedUpdates ?? []).map(
      (u: { title: string; description: string }, i: number) => ({
        id: randomUUID(),
        title: u.title,
        description: u.description,
        order: i,
        status: "pending" as const,
        sourceTodoIds: todoMappingByIndex.get(i) ?? [],
      }),
    );

    const allNewSourceTodoIds = new Set(plannedUpdates.flatMap((u) => u.sourceTodoIds));

    // Restore user-source to-dos whose parent update was removed
    for (const todoId of allOldSourceTodoIds) {
      if (!allNewSourceTodoIds.has(todoId)) {
        const todo = session.scratchpad.find((s) => s.id === todoId && s.source === "user");
        if (todo && todo.completed) {
          todo.completed = false;
        }
      }
    }

    session.plannedUpdates = plannedUpdates;

    for (const item of unprocessedItems) {
      const found = session.scratchpad.find((s) => s.id === item.id);
      if (found) found.completed = true;
    }

    const assistantMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      content: parsed.response,
      createdAt: new Date().toISOString(),
    };
    session.stages.iterations.messages.push(assistantMessage);

    if (!session.stages.iterations.confirmed) {
      session.currentStage = "iterations";
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    return {
      sessionId: session.id,
      plannedUpdates,
      message: assistantMessage,
    };
  }

  async agentReorderUpdates(input: AgentReorderUpdatesInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const reordered: AgentPlannedUpdate[] = [];
    for (let i = 0; i < input.updateIds.length; i++) {
      const update = session.plannedUpdates.find((u) => u.id === input.updateIds[i]);
      if (update) {
        reordered.push({ ...update, order: i });
      }
    }
    session.plannedUpdates = reordered;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async agentExecuteUpdate(input: AgentExecuteUpdateInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const update = session.plannedUpdates.find((u) => u.id === input.updateId);
    if (!update) throw new Error("Planned update not found.");

    update.status = "in_progress";
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    const confirmedContext: string[] = [];
    const fc = session.stages.function.confirmed;
    if (fc) confirmedContext.push(`Function: ${fc.summary}`);
    const tc = session.stages.thesis.confirmed;
    if (tc) confirmedContext.push(`Thesis: ${tc.summary}`);
    const cpc = session.stages.core_pillars.confirmed;
    if (cpc) confirmedContext.push(`Core Pillars: ${cpc.summary}`);
    if (session.corePillars.length > 0) {
      confirmedContext.push(`Pillar Details: ${session.corePillars.map((p) => `${p.name} (${p.function?.summary ?? "TBD"})`).join(", ")}`);
    }
    const ff = session.stages.full_flow.confirmed;
    if (ff) confirmedContext.push(`Full-Flow: ${ff.summary}`);

    const prompt = `${confirmedContext.length > 0 ? `Project context:\n${confirmedContext.join("\n")}\n\n` : ""}Update: ${update.title}\n\nDescription: ${update.description}`;

    const planInput: StartPlanInput = {
      projectId: input.projectId,
      provider: input.provider,
      prompt,
      speed: "normal",
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: "high",
      planningMode: "review",
      autoApprove: false,
      contextPaths: [],
    };

    return this.startPlan(planInput);
  }

  async agentResetStage(projectId: string, stage: AgentStage): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const stageIdx = AGENT_STAGES.indexOf(stage);
    const corePillarsIdx = AGENT_STAGES.indexOf("core_pillars");
    for (let i = stageIdx; i < AGENT_STAGES.length; i++) {
      session.stages[AGENT_STAGES[i]] = { messages: [], confirmed: null };
    }
    // Clear corePillars data if resetting core_pillars or any earlier stage
    if (stageIdx <= corePillarsIdx) {
      session.corePillars = [];
    }
    session.currentStage = stage;

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async deleteAgentSession(projectId: string): Promise<void> {
    await this.ensureInitialized();
    await this.store.deleteAgentSession(projectId);
    this.emit({ type: "agent.session", projectId, session: null });
  }

  async agentAttachMaterials(input: AgentAttachMaterialsInput): Promise<AgentAttachMaterialsResult> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      const settings = await this.store.readSettings();
      session = this.createEmptyAgentSession(input.projectId, settings.advancedDefaults.provider);
    }

    const attachedPaths: string[] = [];
    const failedPaths: string[] = [];

    if (input.replace) {
      session.attachedMaterials = [];
    }

    for (const filePath of input.filePaths) {
      try {
        await access(filePath, fsConstants.R_OK);
        if (!session.attachedMaterials.includes(filePath)) {
          session.attachedMaterials.push(filePath);
        }
        attachedPaths.push(filePath);
      } catch {
        failedPaths.push(filePath);
      }
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return { session, attachedPaths, failedPaths };
  }

  async agentGetCoreDetails(projectId: string): Promise<AgentCoreDetails> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(projectId);
    return {
      function: session?.stages.function.confirmed ?? null,
      thesis: session?.stages.thesis.confirmed ?? null,
      corePillars: session?.corePillars ?? [],
      fullFlow: session?.stages.full_flow.confirmed ?? null,
    };
  }

  async agentCoreDetailsChat(input: CoreDetailsChatInput): Promise<CoreDetailsChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
      await this.store.saveAgentSession(session);
      this.emit({ type: "agent.session", projectId: input.projectId, session });
    }

    const currentFunction = session.stages.function.confirmed?.summary ?? "(not defined)";
    const currentThesis = session.stages.thesis.confirmed?.summary ?? "(not defined)";
    const currentPillars = session.corePillars.length > 0
      ? session.corePillars.map((p) => p.name).join(", ")
      : "(not defined)";
    const currentFlow = session.stages.full_flow.confirmed?.summary ?? "(not defined)";

    const prompt = `You are helping the user update the core details of "${project.name}".

Current confirmed details:
- Function: ${currentFunction}
- Thesis: ${currentThesis}
- Core Pillars: ${currentPillars}
- Full-Flow: ${currentFlow}

The user wants to update these. Do NOT start from scratch — update the existing values based on what they say.
User message: "${input.message}"

If the user's message warrants updating any field, provide the updated text. Set to null if no change is needed for that field.
For updatedCorePillars: provide an array of {name, function, thesis} for ALL pillars (including unchanged ones) if any pillar needs updating, or an empty array [] if no pillar changes are needed.

Your response must be ONLY strict JSON (no markdown fences):
{"response": string, "updatedFunction": string | null, "updatedThesis": string | null, "updatedFullFlow": string | null, "updatedCorePillars": [{name: string, function: string | null, thesis: string | null}, ...]}
- "response" is your conversational reply.
- Each updated field is the new full text, or null if unchanged.
- updatedCorePillars is an empty array if no pillar changes are needed.`.trim();

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, input.provider, settings),
      model,
      agentCoreDetailsSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    const assistantMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      content: parsed.response,
      createdAt: new Date().toISOString(),
    };

    let updatedCoreDetails: AgentCoreDetails | null = null;
    const hasUpdate = parsed.updatedFunction || parsed.updatedThesis || parsed.updatedFullFlow || (Array.isArray(parsed.updatedCorePillars) && parsed.updatedCorePillars.length > 0);
    if (hasUpdate) {
      if (parsed.updatedFunction && session.stages.function.confirmed) {
        session.stages.function.confirmed.summary = parsed.updatedFunction;
      }
      if (parsed.updatedThesis && session.stages.thesis.confirmed) {
        session.stages.thesis.confirmed.summary = parsed.updatedThesis;
      }
      if (parsed.updatedFullFlow && session.stages.full_flow.confirmed) {
        session.stages.full_flow.confirmed.summary = parsed.updatedFullFlow;
      }
      if (Array.isArray(parsed.updatedCorePillars)) {
        for (const updatedPillar of parsed.updatedCorePillars as { name: string; function: string | null; thesis: string | null }[]) {
          const existing = session.corePillars.find((p) => p.name.toLowerCase() === updatedPillar.name.toLowerCase());
          if (existing) {
            if (updatedPillar.function && existing.function) {
              existing.function.summary = updatedPillar.function;
              existing.function.status = "edited";
            }
            if (updatedPillar.thesis && existing.thesis) {
              existing.thesis.summary = updatedPillar.thesis;
              existing.thesis.status = "edited";
            }
          } else {
            // New pillar added via core details chat
            session.corePillars.push({
              id: randomUUID(),
              name: updatedPillar.name,
              pillarType: "core",
              function: updatedPillar.function ? { summary: updatedPillar.function, status: "edited" } : null,
              thesis: updatedPillar.thesis ? { summary: updatedPillar.thesis, status: "edited" } : null,
              corePillars: [],
              fullFlow: null,
              vibes: [],
              description: null,
              connectedPillarIds: [],
            });
          }
        }
      }

      session.updatedAt = new Date().toISOString();
      await this.store.saveAgentSession(session);
      this.emit({ type: "agent.session", projectId: input.projectId, session });

      updatedCoreDetails = {
        function: session.stages.function.confirmed ?? null,
        thesis: session.stages.thesis.confirmed ?? null,
        corePillars: session.corePillars,
        fullFlow: session.stages.full_flow.confirmed ?? null,
      };
    }

    return { message: assistantMessage, updatedCoreDetails };
  }

  async agentSuggestUpdate(input: AgentSuggestUpdateInput): Promise<AgentSuggestUpdateResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
      await this.store.saveAgentSession(session);
      this.emit({ type: "agent.session", projectId: input.projectId, session });
    }

    // Build context from ONLY confirmed summaries — never raw messages
    const currentFunction = session.stages.function.confirmed?.summary ?? "(not defined)";
    const currentThesis = session.stages.thesis.confirmed?.summary ?? "(not defined)";
    const currentPillars = session.corePillars.length > 0
      ? session.corePillars.map((p) => p.name).join(", ")
      : "(not defined)";
    const currentFlow = session.stages.full_flow.confirmed?.summary ?? "(not defined)";

    const focusHint = input.focusArea
      ? `Focus your suggestions primarily on updating the ${input.focusArea.replace("_", " ")} field.`
      : "Determine which field(s) need updating based on the user's message.";

    const prompt = `You are helping update the core details of "${project.name}".

Current confirmed details:
- Function: ${currentFunction}
- Thesis: ${currentThesis}
- Core Pillars: ${currentPillars}
- Full-Flow: ${currentFlow}

${focusHint}

User message: "${input.message}"

Propose updates based on what the user said. Set each field to null if no change is needed for that field.
For updatedCorePillars: if any pillar changes are needed, provide ALL pillars (including unchanged ones) with their updated values; otherwise an empty array [].
Set hasProposal to false if the user is asking a question or no changes are needed.
Response must be strict JSON only (no markdown fences).`;

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;
    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, input.provider, settings),
      model,
      agentSuggestUpdateSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    // Store user message in audit trail — never used as AI context
    session.coreDetailsChatHistory.push({
      id: randomUUID(),
      role: "user",
      content: input.message,
      createdAt: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    const hasProposal = parsed.hasProposal &&
      (parsed.updatedFunction || parsed.updatedThesis || parsed.updatedFullFlow || (Array.isArray(parsed.updatedCorePillars) && parsed.updatedCorePillars.length > 0));

    return {
      aiMessage: parsed.response,
      proposal: hasProposal ? {
        id: randomUUID(),
        aiMessage: parsed.response,
        updatedFunction: parsed.updatedFunction ?? null,
        updatedThesis: parsed.updatedThesis ?? null,
        updatedCorePillars: (Array.isArray(parsed.updatedCorePillars) && parsed.updatedCorePillars.length > 0) ? parsed.updatedCorePillars : null,
        updatedFullFlow: parsed.updatedFullFlow ?? null,
      } : null,
    };
  }

  async agentApplyCoreDetails(input: AgentApplyCoreDetailsInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found.");

    const { proposal } = input;

    if (proposal.updatedFunction) {
      if (session.stages.function.confirmed) {
        session.stages.function.confirmed.summary = proposal.updatedFunction;
        session.stages.function.confirmed.status = "edited";
      } else {
        session.stages.function.confirmed = { summary: proposal.updatedFunction, status: "edited" };
      }
    }
    if (proposal.updatedThesis) {
      if (session.stages.thesis.confirmed) {
        session.stages.thesis.confirmed.summary = proposal.updatedThesis;
        session.stages.thesis.confirmed.status = "edited";
      } else {
        session.stages.thesis.confirmed = { summary: proposal.updatedThesis, status: "edited" };
      }
    }
    if (proposal.updatedFullFlow) {
      if (session.stages.full_flow.confirmed) {
        session.stages.full_flow.confirmed.summary = proposal.updatedFullFlow;
        session.stages.full_flow.confirmed.status = "edited";
      } else {
        session.stages.full_flow.confirmed = { summary: proposal.updatedFullFlow, status: "edited" };
      }
    }
    if (Array.isArray(proposal.updatedCorePillars)) {
      for (const up of proposal.updatedCorePillars) {
        const existing = session.corePillars.find((p) => p.name.toLowerCase() === up.name.toLowerCase());
        if (existing) {
          if (up.functionSummary) {
            if (existing.function) {
              existing.function.summary = up.functionSummary;
              existing.function.status = "edited";
            } else {
              existing.function = { summary: up.functionSummary, status: "edited" };
            }
          }
          if (up.thesisSummary) {
            if (existing.thesis) {
              existing.thesis.summary = up.thesisSummary;
              existing.thesis.status = "edited";
            } else {
              existing.thesis = { summary: up.thesisSummary, status: "edited" };
            }
          }
        } else {
          session.corePillars.push({
            id: randomUUID(),
            name: up.name,
            pillarType: "core",
            function: up.functionSummary ? { summary: up.functionSummary, status: "edited" } : null,
            thesis: up.thesisSummary ? { summary: up.thesisSummary, status: "edited" } : null,
            corePillars: [],
            fullFlow: null,
            vibes: [],
            description: null,
            connectedPillarIds: [],
          });
        }
      }
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async agentGenerateCascade(
    projectId: string,
    triggeredByStage: AgentStage,
    provider: AiProvider,
    model: string,
  ): Promise<CascadeProposal | null> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(projectId);
    const session = await this.store.getAgentSession(projectId);
    if (!session) return null;

    // Determine downstream stages that have existing confirmations
    const stageOrder: AgentStage[] = ["function", "thesis", "core_pillars", "full_flow", "iterations"];
    const triggeredIdx = stageOrder.indexOf(triggeredByStage);
    if (triggeredIdx < 0) return null;

    const downstreamStages = stageOrder.slice(triggeredIdx + 1).filter(
      (s) => session.stages[s]?.confirmed != null,
    );
    if (downstreamStages.length === 0) return null;

    // Build context
    const confirmedContext: string[] = [];
    for (const s of stageOrder) {
      const c = session.stages[s]?.confirmed;
      if (c) confirmedContext.push(`${AGENT_STAGE_LABELS[s]}: ${c.summary}`);
    }
    if (session.corePillars.length > 0) {
      confirmedContext.push(`Pillar Details: ${session.corePillars.map((p) => `${p.name} (${p.function?.summary ?? "TBD"})`).join(", ")}`);
    }

    const prompt = `You are updating the downstream summaries for "${project.name}" after a change to ${AGENT_STAGE_LABELS[triggeredByStage]}.

Current confirmed details:
${confirmedContext.join("\n")}

The ${AGENT_STAGE_LABELS[triggeredByStage]} was just updated. Provide updated summaries for these downstream sections that should reflect the change: ${downstreamStages.map((s) => AGENT_STAGE_LABELS[s]).join(", ")}.

For each downstream section, provide the full updated summary text that incorporates the upstream change. Only include sections that actually need updating.

Your response must be ONLY strict JSON (no markdown fences).`;

    const service = this.aiService(provider as AiProvider);
    const rawResult = await service.runOneShot(
      project,
      settings,
      await this.appendProjectSkillInstructions(prompt, project, provider, settings),
      model,
      agentCascadeSchema,
    );
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    if (!Array.isArray(parsed.cascadeUpdates) || parsed.cascadeUpdates.length === 0) return null;

    const cascade: CascadeProposal = {
      id: randomUUID(),
      triggeredByStage,
      proposedUpdates: parsed.cascadeUpdates
        .filter((u: { stage: string }) => stageOrder.includes(u.stage as AgentStage))
        .map((u: { stage: string; updatedSummary: string }) => ({
          stage: u.stage as AgentStage,
          updatedSummary: u.updatedSummary,
        })),
      createdAt: new Date().toISOString(),
    };

    session.cascadePending = cascade;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });

    return cascade;
  }

  async agentAcceptCascade(input: AgentAcceptCascadeInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found.");
    if (!session.cascadePending || session.cascadePending.id !== input.cascadeId) {
      throw new Error("No matching cascade pending.");
    }

    for (const update of session.cascadePending.proposedUpdates) {
      if (!input.acceptedStages.includes(update.stage)) continue;
      const summary = input.editedSummaries?.[update.stage] ?? update.updatedSummary;
      if (session.stages[update.stage].confirmed) {
        session.stages[update.stage].confirmed!.summary = summary;
      } else {
        session.stages[update.stage].confirmed = { summary };
      }
    }

    session.cascadePending = null;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async agentProcessTodosFromProgram(input: AgentProcessTodosInput): Promise<AgentSubmitTodosResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, settings.advancedDefaults.provider);
    }

    // Add new to-dos to scratchpad with source: "user"
    for (const text of input.newTodos) {
      if (text.trim()) {
        session.scratchpad.push({
          id: randomUUID(),
          text: text.trim(),
          completed: false,
          source: "user",
          createdAt: new Date().toISOString(),
        });
      }
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);

    // Now submit the to-dos through the regular flow
    return this.agentSubmitTodos({
      projectId: input.projectId,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
    });
  }

  // --- Director System Methods ---

  async directorChat(input: DirectorChatInput): Promise<DirectorChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
    }
    session.provider = input.provider;
    session.activeDirectorId = input.directorId;
    session.activeAgentId = input.directorId;

    // Update focus mode on session
    if (input.directorId === "creative-director" && input.focusMode) {
      session.creativeFocusMode = input.focusMode as CreativeFocusMode;
    } else if (input.directorId === "rd-director" && input.focusMode) {
      session.rdFocusMode = input.focusMode as RdFocusMode;
    } else if (input.directorId === "validation-director" && input.focusMode) {
      session.validationFocusMode = input.focusMode as ValidationFocusMode;
    }

    // Ensure this director has a conversation record
    if (!session.directorConversations[input.directorId]) {
      session.directorConversations[input.directorId] = {
        directorId: input.directorId,
        focusMode: input.focusMode,
        messages: [],
        lastActiveAt: null,
      };
    }
    // Keep agentConversations in sync
    session.agentConversations = session.directorConversations;

    const conv = session.directorConversations[input.directorId];
    conv.focusMode = input.focusMode;
    const userMessage = {
      id: randomUUID(),
      role: "user" as const,
      content: input.message,
      createdAt: new Date().toISOString(),
    };
    conv.messages.push(userMessage);
    conv.lastActiveAt = new Date().toISOString();
    session.unifiedMessages.push(userMessage);

    // Update director progress tracking
    if (input.directorId === "creative-director" && session.directorProgress.creative === "not-started") {
      session.directorProgress.creative = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    } else if (input.directorId === "rd-director" && session.directorProgress.rd === "not-started") {
      session.directorProgress.rd = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    } else if (input.directorId === "programming-director" && session.directorProgress.programming === "not-started") {
      session.directorProgress.programming = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    } else if (input.directorId === "validation-director" && session.directorProgress.validation === "not-started") {
      session.directorProgress.validation = "in-progress";
      session.directorProgress.currentDirector = input.directorId;
    }

    const prompt = buildDirectorPrompt(input.directorId, input.focusMode, project.name, session);
    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;
    const schema = getSchemaForDirector(input.directorId, input.focusMode);

    const rawResult = await service.runOneShot(project, settings, prompt, model, schema);
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    const assistantMessage = {
      id: randomUUID(),
      role: "assistant" as const,
      content: parsed.response,
      createdAt: new Date().toISOString(),
    };
    conv.messages.push(assistantMessage);
    session.unifiedMessages.push(assistantMessage);

    // Process structured data from director response
    let routeSuggestion: DirectorChatResponse["routeSuggestion"] = null;
    let structuredData: DirectorStructuredData | null = null;
    let internalNotes: string[] | null = null;
    let suggestCreateProject = false;

    // Jeff — routing
    if (input.directorId === "project-manager" && parsed.routeTo) {
      routeSuggestion = { directorId: parsed.routeTo as DirectorId, reason: parsed.routeReason ?? "" };
    }

    // Dan — Conversation mode: internal notes
    if (input.directorId === "creative-director" && input.focusMode === "conversation") {
      if (parsed.internalNotes?.length) {
        internalNotes = parsed.internalNotes;
        session.danInternalNotes.push(...parsed.internalNotes);
      }
      suggestCreateProject = parsed.suggestCreateProject ?? false;
    }

    // Dan — Vibes mode: pillar descriptions
    if (input.directorId === "creative-director" && input.focusMode === "vibes" && parsed.pillarDescriptions) {
      for (const pd of parsed.pillarDescriptions) {
        const pillar = findPillarById(session.corePillars, pd.pillarId);
        if (pillar) {
          pillar.description = pd.description;
        }
      }
    }

    // Todd — Research mode: feasibility assessments
    if (input.directorId === "rd-director" && input.focusMode === "research" && parsed.feasibilityAssessments) {
      const assessments: FeasibilityAssessment[] = parsed.feasibilityAssessments.map((a: { area: string; assessment: string; stackRecommendation?: string | null; complexity: string; costNotes?: string | null }) => ({
        id: randomUUID(),
        area: a.area,
        assessment: a.assessment,
        stackRecommendation: a.stackRecommendation ?? null,
        complexity: a.complexity as FeasibilityAssessment["complexity"],
        costNotes: a.costNotes ?? null,
        status: "assumed" as const,
      }));
      session.feasibilityAssessments = [...session.feasibilityAssessments, ...assessments];
      structuredData = { type: "feasibility", assessments };
    }

    // Todd — Version Planning mode: versions
    if (input.directorId === "rd-director" && input.focusMode === "version-planning" && parsed.versions) {
      const versions: VersionPlan[] = parsed.versions.map((v: { label: string; description: string; goals: string[] }, idx: number) => ({
        id: randomUUID(),
        label: v.label,
        description: v.description,
        goals: v.goals,
        status: "assumed" as const,
        order: idx,
      }));
      session.versions = versions;
      structuredData = { type: "versions", versions };
    }

    // Todd — Update Planning mode: updates
    if (input.directorId === "rd-director" && input.focusMode === "update-planning" && parsed.updates) {
      const updates: VersionUpdate[] = parsed.updates.map((u: { title: string; description: string; versionLabel: string; dependencies?: string[] }, idx: number) => {
        const version = session!.versions.find((v) => v.label === u.versionLabel);
        return {
          id: randomUUID(),
          versionId: version?.id ?? "",
          title: u.title,
          description: u.description,
          order: idx,
          status: "pending" as const,
          dependencies: u.dependencies ?? [],
        };
      });
      session.versionUpdates = updates;
      structuredData = { type: "versionUpdates", updates };
    }

    // Ping — routed updates & execution
    if (input.directorId === "programming-director" && parsed.routedUpdates) {
      structuredData = { type: "routedUpdates", routed: parsed.routedUpdates };
    }
    if (input.directorId === "programming-director" && parsed.executionSteps) {
      structuredData = {
        type: "executionPlan",
        updateId: "",
        steps: parsed.executionSteps,
        readyToExecute: parsed.readyToExecute ?? false,
      };
    }

    // Brad — Test mode: validation results
    if (input.directorId === "validation-director" && input.focusMode === "test-current-state" && parsed.validationPassed != null) {
      const result: ValidationResult = {
        id: randomUUID(),
        updateId: "",
        validationType: "functional",
        passed: parsed.validationPassed,
        summary: parsed.validationSummary ?? "",
        details: parsed.validationDetails ?? "",
        screenshotPaths: [],
        createdAt: new Date().toISOString(),
      };
      session.validationResults.push(result);
      structuredData = { type: "validationResult", result };
    }

    // Brad — Compare mode: comparison
    if (input.directorId === "validation-director" && input.focusMode === "compare" && parsed.passed != null) {
      structuredData = {
        type: "comparison",
        passed: parsed.passed,
        improvementAreas: parsed.improvementAreas ?? [],
        summary: parsed.comparisonSummary ?? "",
      };
    }

    // Brad — Identify Goal mode: goal summary
    if (input.directorId === "validation-director" && input.focusMode === "identify-goal" && parsed.goalSummary) {
      structuredData = {
        type: "goalSummary",
        summary: parsed.goalSummary,
        pillarIds: parsed.relevantPillarIds ?? [],
      };
    }

    // Derive project category
    session.projectCategory = this.deriveProjectCategoryFromSession(session);

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    return {
      sessionId: session.id,
      directorId: input.directorId,
      message: assistantMessage,
      routeSuggestion,
      structuredData,
      internalNotes,
      suggestCreateProject,
    };
  }

  /** @deprecated Use directorChat */
  async multiAgentChat(input: DirectorChatInput): Promise<DirectorChatResponse> {
    return this.directorChat(input);
  }

  async slackChat(input: SlackChatInput): Promise<SlackChatResponse> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) {
      session = this.createEmptyAgentSession(input.projectId, input.provider);
    }
    // Migration safety
    session.slackMessages = session.slackMessages ?? [];
    session.slackActiveDirectorId = session.slackActiveDirectorId ?? "project-manager";
    session.provider = input.provider;

    // Create user message and push immediately
    const userMessage: SlackChatMessage = {
      id: randomUUID(),
      role: "user",
      directorId: null,
      content: input.message,
      createdAt: new Date().toISOString(),
    };
    session.slackMessages.push(userMessage);

    // Determine which director responds
    const respondingDirectorId: DirectorId =
      input.targetDirectorId && input.targetDirectorId !== "project-manager"
        ? input.targetDirectorId
        : "project-manager";
    session.slackActiveDirectorId = respondingDirectorId;

    // Build prompt and call AI
    const prompt = buildSlackDirectorPrompt(respondingDirectorId, project.name, session);
    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;

    const rawResult = await service.runOneShot(project, settings, prompt, model, directorSlackSchema);
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    const assistantMessage: SlackChatMessage = {
      id: randomUUID(),
      role: "assistant",
      directorId: respondingDirectorId,
      content: parsed.response,
      createdAt: new Date().toISOString(),
    };
    session.slackMessages.push(assistantMessage);

    const handoffTo: DirectorId | null = parsed.handoffTo ?? null;
    const handoffReason: string | null = parsed.handoffReason ?? null;

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    return {
      sessionId: session.id,
      directorId: respondingDirectorId,
      message: assistantMessage,
      handoffTo,
      handoffReason,
    };
  }

  private deriveProjectCategoryFromSession(session: AgentSession): ProjectCategory {
    const fc = session.stages.function.confirmed;
    const tc = session.stages.thesis.confirmed;
    const cpc = session.stages.core_pillars.confirmed;
    const ffc = session.stages.full_flow.confirmed;
    const hasConfirmedCoreDetails = fc && tc && cpc && ffc;
    const hasCompletedV1 = session.versions.some((v) =>
      v.label.toLowerCase().includes("v1") && session.versionUpdates
        .filter((u) => u.versionId === v.id)
        .every((u) => u.status === "completed")
    );

    if (hasCompletedV1) return "program";
    if (hasConfirmedCoreDetails) return "general-project";
    return "idea-in-progress";
  }

  async deriveProjectCategory(projectId: string): Promise<ProjectCategory> {
    const session = await this.store.getAgentSession(projectId);
    if (!session) return "idea-in-progress";
    return this.deriveProjectCategoryFromSession(session);
  }

  async setDirectorFocusMode(projectId: string, directorId: DirectorId, focusMode: DirectorFocusMode): Promise<AgentSession> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(projectId);
    if (!session) throw new Error("No agent session found for this project.");

    if (directorId === "creative-director") session.creativeFocusMode = focusMode as CreativeFocusMode;
    else if (directorId === "rd-director") session.rdFocusMode = focusMode as RdFocusMode;
    else if (directorId === "validation-director") session.validationFocusMode = focusMode as ValidationFocusMode;

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId, session });
    return session;
  }

  async attachVibeToCorePillar(input: AttachVibeInput): Promise<AgentSession> {
    await this.ensureInitialized();
    let session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const pillar = findPillarById(session.corePillars, input.pillarId);
    if (!pillar) throw new Error("Core pillar not found.");

    if (!pillar.vibes) pillar.vibes = [];

    for (let i = 0; i < input.filePaths.length; i++) {
      const filePath = input.filePaths[i];
      const fileName = filePath.split("/").pop() ?? filePath;
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
      let fileType: VibeAttachment["fileType"] = "other";
      if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) fileType = "image";
      else if (["txt", "md"].includes(ext)) fileType = "text";
      else if (ext === "note") fileType = "note";

      pillar.vibes.push({
        id: randomUUID(),
        filePath,
        fileName,
        description: input.descriptions?.[i] ?? null,
        fileType,
        createdAt: new Date().toISOString(),
      });
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async removeVibeFromCorePillar(input: RemoveVibeInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const pillar = findPillarById(session.corePillars, input.pillarId);
    if (!pillar) throw new Error("Core pillar not found.");

    pillar.vibes = (pillar.vibes ?? []).filter((v) => v.id !== input.vibeId);

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async confirmAgentData(input: ConfirmAgentDataInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    if (input.dataType === "feasibility") {
      if (input.itemId) {
        const item = session.feasibilityAssessments.find((a) => a.id === input.itemId);
        if (item) item.status = "confirmed";
      } else {
        for (const a of session.feasibilityAssessments) a.status = "confirmed";
      }
    } else if (input.dataType === "versions") {
      if (input.itemId) {
        const item = session.versions.find((v) => v.id === input.itemId);
        if (item) item.status = "confirmed";
      } else {
        for (const v of session.versions) v.status = "confirmed";
      }
    } else if (input.dataType === "versionUpdates") {
      // Version updates use their own status field, no DetailStatus
    }

    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async routeUpdateToProgramming(input: RouteUpdateToProgrammingInput): Promise<{ started: true }> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    const update = session.versionUpdates.find((u) => u.id === input.updateId);
    if (!update) throw new Error("Update not found.");

    update.status = "in_progress";
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });

    // Bridge to existing execution pipeline
    return this.agentExecuteUpdate({
      projectId: input.projectId,
      updateId: input.updateId,
      provider: input.provider,
      model: input.model,
      claudeModel: input.claudeModel,
    });
  }

  async runValidation(input: RunValidationInput): Promise<ValidationResult> {
    await this.ensureInitialized();
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);

    let session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    // Try to use Playwright for screenshots if the project is running
    let screenshotPaths: string[] = [];
    const runtime = this.runner.getRuntime(input.projectId);
    if (runtime?.running && runtime.url) {
      try {
        const playwrightResult = await this.playwright.run({
          projectId: input.projectId,
          cwd: project.localPath ?? ".",
          url: runtime.url,
          actions: [],
          headless: true,
          settleMs: 2000,
        });
        screenshotPaths = playwrightResult.screenshots;
      } catch { /* Playwright not available, continue without screenshots */ }
    }

    // Ask AI to validate
    const coreContext = formatCoreDetails(session);
    const validationPrompt = input.validationType === "visual"
      ? `You are validating the visual output of "${project.name}". Compare the current state against the intended visual direction and core pillars.\n${coreContext}\n${screenshotPaths.length > 0 ? `Screenshots taken: ${screenshotPaths.length}` : "No screenshots available."}\nDoes the current output match the intended visual direction? Report any mismatches.`
      : `You are validating the functional output of "${project.name}". Test whether the latest update works correctly.\n${coreContext}\nDoes the feature work as intended? Report any issues.`;

    const service = this.aiService(input.provider);
    const model = input.provider === "claude" ? input.claudeModel : input.model;
    const rawResult = await service.runOneShot(project, settings, validationPrompt, model, directorBradTestSchema);
    const parsed = JSON.parse(rawResult.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));

    const result: ValidationResult = {
      id: randomUUID(),
      updateId: input.updateId,
      validationType: input.validationType,
      passed: parsed.validationPassed ?? true,
      summary: parsed.validationSummary ?? parsed.response,
      details: parsed.validationDetails ?? "",
      screenshotPaths,
      createdAt: new Date().toISOString(),
    };

    session.validationResults.push(result);
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return result;
  }

  async setValidationFrequency(input: SetValidationFrequencyInput): Promise<AgentSession> {
    await this.ensureInitialized();
    const session = await this.store.getAgentSession(input.projectId);
    if (!session) throw new Error("No agent session found for this program.");

    session.validationFrequency = input.frequency;
    session.updatedAt = new Date().toISOString();
    await this.store.saveAgentSession(session);
    this.emit({ type: "agent.session", projectId: input.projectId, session });
    return session;
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    await this.ensureInitialized();
    if (!input.name.trim()) {
      throw new Error("Enter a program name first.");
    }
    if (!input.parentDirectory.trim()) {
      throw new Error("Choose where the new program should live first.");
    }

    const existingProjects = await this.store.listProjects();
    const settings = await this.store.readSettings();
    const localPath = join(input.parentDirectory, input.name);
    if (existingProjects.some((project) => project.localPath === localPath)) {
      throw new Error("That project is already attached in PROGRAMS.");
    }
    if (await pathExists(localPath)) {
      throw new Error("That folder already exists. Choose a different location or attach it instead.");
    }

    await this.git.initializeRepository(localPath, "main");

    const flowchartPath = join(localPath, ".programs", "system-flow.mmd");
    const description = deriveProjectDescription(input.name, input.initialIdea);
    const starterFlowchart = createStarterFlowchart(input.name);
    await writeTextFile(
      join(localPath, "README.md"),
      `# ${input.name}\n\n${description}\n`,
    );
    await writeTextFile(flowchartPath, starterFlowchart);

    let remoteUrl: string | null = null;
    let defaultBranch = "main";
    if (input.createRemote) {
      const githubConfig = this.resolveGitHubClientConfig(settings);
      const githubStatus = await this.github.getStatus(githubConfig);
      if (!githubStatus.configured) {
        throw new Error(this.githubConfigurationMessage());
      }
      if (!githubStatus.loggedIn) {
        throw new Error("Connect GitHub before saving this program with online sync.");
      }

      const repo = await this.github.createRepository({
        client: githubConfig,
        name: slugifyRepositoryName(input.name),
        description,
        visibility: input.visibility,
      });
      remoteUrl = repo.remoteUrl;
      defaultBranch = repo.defaultBranch || "main";
      await this.git.configureRemote(localPath, remoteUrl);
    }

    const runtimeConfig = await detectRuntimeConfig(localPath);
    runtimeConfig.initialIdea = input.initialIdea || null;
    runtimeConfig.githubRepoName = slugifyRepositoryName(input.name);

    const project: Project = {
      id: randomUUID(),
      name: input.name,
      iconColor: input.iconColor,
      description,
      localPath,
      remoteUrl,
      defaultBranch,
      threadId: null,
      flowchartPath,
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig,
      lastError: null,
    };

    const commitSha = await this.git.commitAll(localPath, `Initialize ${input.name}`);
    if (remoteUrl && commitSha) {
      await this.git.push(localPath, defaultBranch, {
        remoteUrl,
        token: await this.github.getStoredToken(),
      });
    }

    await this.store.createProject(project);
    this.emit({ type: "project.updated", project });
    await this.syncSelfRuntime(settings, [...existingProjects, project], true);
    return project;
  }

  async attachProject(input: ProjectAttachInput): Promise<Project> {
    await this.ensureInitialized();
    if (!input.localPath.trim()) {
      throw new Error("Choose a project folder to attach first.");
    }
    const existingProjects = await this.store.listProjects();
    if (existingProjects.some((project) => project.localPath === input.localPath)) {
      throw new Error("That project is already attached in PROGRAMS.");
    }
    if (!(await pathExists(input.localPath))) {
      throw new Error("PROGRAMS could not find that project folder.");
    }

    const settings = await this.store.readSettings();
    const inspected = await this.git.inspectRepository(input.localPath);
    if (!inspected.isRepo) {
      await this.git.initializeRepository(input.localPath, "main");
    }

    let remoteUrl = inspected.remoteUrl;
    let defaultBranch = inspected.defaultBranch;
    const name = deriveAttachedProjectName(input.localPath);

    if (!remoteUrl && input.createRemote) {
      const githubConfig = this.resolveGitHubClientConfig(settings);
      const githubStatus = await this.github.getStatus(githubConfig);
      if (!githubStatus.configured) {
        throw new Error(this.githubConfigurationMessage());
      }
      if (!githubStatus.loggedIn) {
        throw new Error("Connect GitHub before saving this program with online sync.");
      }

      const repo = await this.github.createRepository({
        client: githubConfig,
        name: slugifyRepositoryName(name),
        description: deriveProjectDescription(name),
        visibility: input.visibility,
      });
      remoteUrl = repo.remoteUrl;
      defaultBranch = repo.defaultBranch || defaultBranch;
      await this.git.configureRemote(input.localPath, remoteUrl);
    }

    const runtimeConfig = await detectRuntimeConfig(input.localPath);
    runtimeConfig.githubRepoName = slugifyRepositoryName(name);

    const project: Project = {
      id: randomUUID(),
      name,
      iconColor: input.iconColor,
      description: deriveProjectDescription(name),
      localPath: input.localPath,
      remoteUrl,
      defaultBranch,
      threadId: null,
      flowchartPath: join(input.localPath, ".programs", "system-flow.mmd"),
      lastUpdatedAt: null,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtimeConfig,
      lastError: null,
    };

    await this.store.createProject(project);
    this.emit({ type: "project.updated", project });
    await this.syncSelfRuntime(settings, [...existingProjects, project], true);
    return project;
  }

  async renameProject(input: RenameProjectInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.store.renameProject(input.projectId, input.name.trim());
    this.emit({ type: "project.updated", project });
    return project;
  }

  async updateProject(input: UpdateProjectInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const name = input.name.trim();
    const iconColor = input.iconColor.trim();

    if (!name) {
      throw new Error("Enter a project name first.");
    }
    if (!iconColor) {
      throw new Error("Choose a project color first.");
    }

    project.name = name;
    project.iconColor = iconColor;
    project.updatedAt = new Date().toISOString();

    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }

  async unlinkProject(projectId: string): Promise<{ removed: true }> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    const activePlan = this.codex.getActivePlan(projectId) ?? this.claude.getActivePlan(projectId);
    if (activePlan) {
      throw new Error("Cancel the current update before unlinking this project.");
    }

    const runtime = await this.runner.validateRuntime(projectId);
    if (runtime.running && runtime.controllable) {
      await this.runner.stop(projectId);
    }
    await this.store.deleteProject(projectId);
    await this.syncSelfRuntime(undefined, await this.store.listProjects(), false);
    this.emit({ type: "project.removed", projectId });
    this.emit({
      type: "toast",
      level: "success",
      message: `${project.name} was removed from the dashboard.`,
    });
    return { removed: true };
  }

  async enableProjectSync(input: ProjectEnableSyncInput): Promise<Project> {
    const settings = await this.store.readSettings();
    let project = await this.requireProject(input.projectId);

    if (project.remoteUrl) {
      throw new Error("This project is already connected to GitHub.");
    }

    project = await this.updateProjectStatus(project, "syncing", null);

    try {
      const githubConfig = this.resolveGitHubClientConfig(settings);
      if (!githubConfig) {
        throw new Error(this.githubConfigurationMessage());
      }

      const githubStatus = await this.github.getStatus(githubConfig);
      if (!githubStatus.loggedIn) {
        throw new Error("Connect GitHub in Settings before enabling GitHub sync.");
      }

      const branch = (await this.git.getCurrentBranch(project.localPath)) || project.defaultBranch || "main";
      const repo = await this.github.createRepository({
        client: githubConfig,
        name: project.runtimeConfig.githubRepoName || slugifyRepositoryName(project.name),
        description: project.description,
        visibility: input.visibility,
      });

      await this.git.configureRemote(project.localPath, repo.remoteUrl);

      if (!(await this.git.hasCommit(project.localPath))) {
        const commitSha = await this.git.commitAll(project.localPath, `Initialize ${project.name}`);
        if (!commitSha) {
          throw new Error("Add at least one file before enabling GitHub sync.");
        }
      }

      await this.git.push(project.localPath, branch, {
        remoteUrl: repo.remoteUrl,
        token: await this.github.getStoredToken(),
      });

      project.remoteUrl = repo.remoteUrl;
      project.defaultBranch = branch;
      project.status = "idle";
      project.lastError = null;
      project.updatedAt = new Date().toISOString();
      await this.store.updateProject(project);
      this.emit({ type: "project.updated", project });
      this.emit({
        type: "toast",
        level: "success",
        message: "GitHub sync is enabled for this project.",
      });

      return project;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PROGRAMS could not connect this project to GitHub.";
      await this.updateProjectStatus(project, "idle", message);
      throw error;
    }
  }

  async getCodexStatus(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.getAuthStatus(settings);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async readUsage(): Promise<UsageSnapshot> {
    const settings = await this.store.readSettings();
    const [codex, claude] = await Promise.all([
      this.codex.getUsage(settings),
      this.claude.getUsage(settings),
    ]);

    return {
      codex,
      claude,
      updatedAt: new Date().toISOString(),
    };
  }

  async loginCodex(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.login(settings);
    await this.emitSetupUpdated(settings, status);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async setupCodex(): Promise<CodexAuthStatus> {
    let settings = await this.store.readSettings();

    try {
      let installation = await this.codex.inspectInstallation(settings);
      if (!installation.available || !installation.binaryPath) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Installing Codex for PROGRAMS.",
        });
        const binaryPath = await this.installCodexCli();
        settings = await this.store.updateSettings({ codexBinaryPath: binaryPath });
        installation = await this.codex.inspectInstallation(settings);
      } else if (installation.binaryPath !== settings.codexBinaryPath) {
        settings = await this.store.updateSettings({ codexBinaryPath: installation.binaryPath });
      }

      let status = await this.codex.getAuthStatus(settings);
      if (!status.loggedIn) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Opening the Codex sign-in flow.",
        });
        status = await this.codex.login(settings);
      }

      if (status.binaryPath && status.binaryPath !== settings.codexBinaryPath) {
        settings = await this.store.updateSettings({ codexBinaryPath: status.binaryPath });
      }

      await this.emitSetupUpdated(settings, status);
      await this.emitModelCatalogUpdated(settings);
      return status;
    } catch (error) {
      await this.emitSetupUpdated(settings);
      await this.emitModelCatalogUpdated(settings);
      throw error;
    }
  }

  async logoutCodex(): Promise<CodexAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.codex.logout(settings);
    await this.emitSetupUpdated(settings, status);
    await this.emitModelCatalogUpdated(settings);
    return status;
  }

  async getClaudeStatus(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    return this.claude.getAuthStatus(settings);
  }

  async setupClaude(): Promise<ClaudeAuthStatus> {
    let settings = await this.store.readSettings();

    try {
      let status = await this.claude.getAuthStatus(settings);
      if (!status.available || !status.binaryPath) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Installing Claude Code for PROGRAMS.",
        });
        await this.installClaudeCli();
        status = await this.claude.getAuthStatus(settings);
      }

      if (!status.available || !status.binaryPath) {
        await shell.openExternal(CLAUDE_DOWNLOAD_URL);
        throw new Error("PROGRAMS could not finish the Claude install automatically. It opened the official Claude Code docs.");
      }

      if (status.binaryPath !== settings.claudeBinaryPath) {
        settings = await this.store.updateSettings({ claudeBinaryPath: status.binaryPath });
      }

      const needsRepair = !status.canConnect || (status.loggedIn && !status.ready);
      if (needsRepair) {
        this.emit({
          type: "toast",
          level: "info",
          message: "Updating Claude Code for PROGRAMS.",
        });
        await this.installClaudeCli();
        status = await this.claude.getAuthStatus(settings);
      }

      if (!status.loggedIn) {
        if (!status.canConnect) {
          await shell.openExternal(CLAUDE_DOWNLOAD_URL);
          throw new Error(status.connectErrorMessage ?? "PROGRAMS could not open the Claude sign-in flow. It opened the official Claude Code docs.");
        }
        this.emit({
          type: "toast",
          level: "info",
          message: "Opening the Claude sign-in flow.",
        });
        status = await this.claude.login(settings);
      }

      if (status.binaryPath && status.binaryPath !== settings.claudeBinaryPath) {
        settings = await this.store.updateSettings({ claudeBinaryPath: status.binaryPath });
      }

      if (!status.ready) {
        await shell.openExternal(CLAUDE_DOWNLOAD_URL);
        throw new Error(status.runtimeErrorMessage ?? "PROGRAMS could not use Claude Code yet. It opened the official Claude Code docs.");
      }

      await this.emitSetupUpdated(settings, undefined, status);
      return status;
    } catch (error) {
      await this.emitSetupUpdated(settings);
      throw error;
    }
  }

  async loginClaude(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    const current = await this.claude.getAuthStatus(settings);
    if ((!current.loggedIn && !current.canConnect) || (current.loggedIn && !current.ready)) {
      return this.setupClaude();
    }
    const status = await this.claude.login(settings);
    await this.emitSetupUpdated(settings, undefined, status);
    return status;
  }

  async logoutClaude(): Promise<ClaudeAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.claude.logout(settings);
    await this.emitSetupUpdated(settings, undefined, status);
    return status;
  }

  async testClaudeConnection(): Promise<ClaudeConnectionTestResult> {
    const settings = await this.store.readSettings();
    return this.claude.testConnection(settings, settings.advancedDefaults.claudeModel);
  }

  submitClaudeLoginCode(code: string): void {
    this.claude.submitLoginCode(code);
  }

  private async readModelCatalog(settings: Settings): Promise<ModelCatalog> {
    const codex = await this.codex.getModelCatalog(settings);
    const matchesFallback =
      JSON.stringify(codex.map((option) => option.id)) ===
      JSON.stringify(DEFAULT_MODEL_CATALOG.codex.map((option) => option.id));

    return {
      codex: codex.length ? codex : DEFAULT_MODEL_CATALOG.codex,
      claude: DEFAULT_MODEL_CATALOG.claude,
      source: matchesFallback ? "fallback" : "live",
      updatedAt: new Date().toISOString(),
    };
  }

  private async emitModelCatalogUpdated(settings: Settings): Promise<void> {
    this.emit({
      type: "modelCatalog.updated",
      catalog: await this.readModelCatalog(settings),
    });
  }

  async getGitHubStatus(): Promise<GitHubAuthStatus> {
    const settings = await this.store.readSettings();
    return this.github.getStatus(this.resolveGitHubClientConfig(settings));
  }

  async inspectAttachPath(localPath: string): Promise<AttachPathInspection> {
    const normalizedPath = localPath.trim();
    if (!normalizedPath) {
      return {
        localPath: "",
        name: null,
        exists: false,
        isRepo: false,
        remoteUrl: null,
        defaultBranch: null,
      };
    }

    const exists = await pathExists(normalizedPath);
    if (!exists) {
      return {
        localPath: normalizedPath,
        name: deriveAttachedProjectName(normalizedPath),
        exists: false,
        isRepo: false,
        remoteUrl: null,
        defaultBranch: null,
      };
    }

    const inspected = await this.git.inspectRepository(normalizedPath);
    return {
      localPath: normalizedPath,
      name: deriveAttachedProjectName(normalizedPath),
      exists: true,
      isRepo: inspected.isRepo,
      remoteUrl: inspected.remoteUrl,
      defaultBranch: inspected.defaultBranch,
    };
  }

  async loginGitHub() {
    const settings = await this.store.readSettings();
    const client = this.resolveGitHubClientConfig(settings);
    if (!client) {
      throw new Error(this.githubConfigurationMessage());
    }

    return this.github.login(client);
  }

  async logoutGitHub(): Promise<GitHubAuthStatus> {
    const settings = await this.store.readSettings();
    const status = await this.github.logout(this.resolveGitHubClientConfig(settings));
    await this.emitSetupUpdated(settings, undefined, undefined, status);
    return status;
  }

  async readSetup(): Promise<SetupSnapshot> {
    return this.buildSetupSnapshot();
  }

  async refreshSetup(): Promise<SetupSnapshot> {
    const snapshot = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: snapshot });
    return snapshot;
  }

  async installGit(): Promise<{ outcome: "alreadyAvailable" | "requested" | "manualDownload" }> {
    const outcome = await this.git.promptInstall();

    if (outcome === "requested") {
      this.emit({
        type: "toast",
        level: "info",
        message: "macOS opened the Git install prompt. Confirm it, then refresh the checks.",
      });
    } else if (outcome === "alreadyAvailable") {
      this.emit({
        type: "toast",
        level: "success",
        message: "Git is already installed.",
      });
    } else {
      this.emit({
        type: "toast",
        level: "info",
        message: "PROGRAMS opened the Git download page because macOS did not start the installer automatically.",
      });
      await shell.openExternal(GIT_DOWNLOAD_URL);
    }

    const snapshot = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: snapshot });
    return { outcome };
  }

  private async installCodexCli(): Promise<string> {
    if (process.platform !== "darwin") {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("Automatic Codex setup is only available on macOS right now. PROGRAMS opened the official Codex page.");
    }

    const npmVersion = await execCommand("npm --version", process.cwd());
    if (npmVersion.code !== 0) {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not find npm to install Codex automatically. It opened the official Codex page.");
    }

    const installDir = join(app.getPath("userData"), "tools", "codex");
    await ensureDirectory(installDir);
    const installResult = await execCommand(
      `npm install --prefix "${installDir}" --no-audit --no-fund @openai/codex`,
      process.cwd(),
    );

    const binaryPath = join(installDir, "node_modules", ".bin", "codex");
    if (installResult.code !== 0 || !(await pathExists(binaryPath))) {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not install Codex automatically. It opened the official Codex page.");
    }

    return binaryPath;
  }

  private async installClaudeCli(): Promise<void> {
    if (process.platform !== "darwin") {
      await shell.openExternal(CLAUDE_DOWNLOAD_URL);
      throw new Error("Automatic Claude setup is only available on macOS right now. PROGRAMS opened the official Claude Code docs.");
    }

    const installResult = await execCommand(
      `/bin/zsh -lc 'curl -fsSL https://claude.ai/install.sh | bash'`,
      process.cwd(),
    );

    if (installResult.code !== 0) {
      await shell.openExternal(CLAUDE_DOWNLOAD_URL);
      throw new Error("PROGRAMS could not install Claude Code automatically. It opened the official Claude Code docs.");
    }
  }

  async dismissSetup(): Promise<SetupSnapshot> {
    const snapshot = await this.buildSetupSnapshot();
    if (!snapshot.isSetupComplete) {
      throw new Error("Finish the required setup steps before entering PROGRAMS.");
    }

    await this.store.updateSetupState({
      completedAt: snapshot.completedAt ?? new Date().toISOString(),
    });

    const next = await this.buildSetupSnapshot();
    this.emit({ type: "setup.updated", setup: next });
    return next;
  }

  async runProject(projectId: string) {
    await this.ensureInitialized();
    let project = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const existing = await this.syncProjectRuntimeState(project);
    project = existing.project;
    if (existing.runtime.running) {
      return existing.runtime;
    }

    project = await this.updateProjectStatus(project, "running", null);

    try {
      await this.git.ensureRepository(project.localPath, null, project.defaultBranch);
      await this.runner.install(project);
      return await this.runner.start(project);
    } catch (error) {
      await this.updateProjectStatus(
        project,
        "error",
        error instanceof Error ? error.message : "PROGRAMS could not run this project.",
      );
      throw error;
    }
  }

  async killProject(projectId: string) {
    await this.ensureInitialized();
    const validatedRuntime = await this.runner.validateRuntime(projectId);
    if (!validatedRuntime.running) {
      return validatedRuntime;
    }

    const project = await this.requireProject(projectId);
    if (validatedRuntime.source === "self") {
      const nextRuntime = EMPTY_RUNTIME(projectId);
      await this.updateProjectStatus(project, "idle", null);
      this.emit({ type: "project.runtime", projectId, runtime: nextRuntime });
      setImmediate(() => app.quit());
      return nextRuntime;
    }

    const runtime = await this.runner.stop(projectId);
    await this.updateProjectStatus(project, "idle", null);
    return runtime;
  }

  async openProject(projectId: string): Promise<boolean> {
    await this.ensureInitialized();
    const refreshedProject = await this.refreshProjectRuntimeConfig(await this.requireProject(projectId));
    const { runtime } = await this.syncProjectRuntimeState(refreshedProject);
    if (!runtime.running || !runtime.url) {
      return false;
    }

    await shell.openExternal(runtime.url);
    return true;
  }

  async handleRuntimeExit(projectId: string): Promise<void> {
    const project = await this.store.readProject(projectId);
    if (!project || project.status !== "running") {
      return;
    }

    await this.updateProjectStatus(project, "idle", null);
  }

  async handleRuntimeUrlDetected(projectId: string, url: string): Promise<void> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      return;
    }

    const nextRuntimeConfig = {
      ...project.runtimeConfig,
      lastRunUrl: url,
    };

    if (JSON.stringify(nextRuntimeConfig) === JSON.stringify(project.runtimeConfig)) {
      return;
    }

    project.runtimeConfig = nextRuntimeConfig;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
  }

  private aiService(provider: StartPlanInput["provider"]): CodexService | ClaudeService {
    return provider === "claude" ? this.claude : this.codex;
  }

  private async requireProviderReady(provider: StartPlanInput["provider"], settings: Settings): Promise<void> {
    const status = provider === "claude"
      ? await this.claude.getAuthStatus(settings)
      : await this.codex.getAuthStatus(settings);
    const message = getProviderPreflightError(provider, status);
    if (message) {
      throw new Error(message);
    }
  }

  private resolveGitHubClientConfig(settings: Settings): GitHubClientConfig | null {
    const overrideId = settings.githubClientIdOverride?.trim();
    if (overrideId) {
      return {
        clientId: overrideId,
        source: "override",
      };
    }

    const bundledId = process.env.GITHUB_CLIENT_ID?.trim();
    if (bundledId) {
      return {
        clientId: bundledId,
        source: "bundled",
      };
    }

    return null;
  }

  private getProgramsPlaywrightRunnerPath(settings: Settings): string {
    const preferredRoot = settings.appSourcePath?.trim();
    if (preferredRoot) {
      return join(preferredRoot, "scripts", "programs-playwright-runner.mjs");
    }

    return this.playwright.getRunnerScriptPath();
  }

  private async getAttachedSkill(project: Project): Promise<Skill | null> {
    const skillId = project.runtimeConfig.attachedSkillId ?? null;
    if (!skillId) {
      return null;
    }

    return this.store.readSkill(skillId);
  }

  private async buildProjectSkillInstructions(
    project: Project,
    provider: AiProvider,
    settings: Settings,
  ): Promise<string | null> {
    const skill = await this.getAttachedSkill(project);
    if (!skill) {
      return null;
    }

    if (skill.sourceProvider === "claude" && provider !== "claude") {
      return null;
    }
    if (skill.sourceProvider === "codex" && provider !== "codex") {
      return null;
    }

    if (skill.sourceType === "plugin") {
      if (provider !== "claude" || skill.installStatus !== "ready") {
        return null;
      }

      return `Claude plugin "${skill.installSlug ?? skill.name}" is installed for this program. Use it when it is relevant to the task.`;
    }

    const runnerPath = this.getProgramsPlaywrightRunnerPath(settings);
    return skill.instructions.replaceAll(USER_TESTING_RUNNER_PLACEHOLDER, runnerPath);
  }

  private async appendProjectSkillInstructions(
    prompt: string,
    project: Project,
    provider: AiProvider,
    settings: Settings,
  ): Promise<string> {
    const skillInstructions = await this.buildProjectSkillInstructions(project, provider, settings);
    if (!skillInstructions) {
      return prompt;
    }

    return `${prompt}\n\nAttached skill instructions:\n${skillInstructions}`;
  }

  async startPlan(input: StartPlanInput): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    await this.requireProviderReady(input.provider, settings);
    const project = await this.requireProject(input.projectId);
    const skillInstructions = await this.buildProjectSkillInstructions(project, input.provider, settings);
    const agentSession = await this.store.getAgentSession(input.projectId);
    const coreDetailsContext = formatCoreDetails(agentSession);
    const enrichedInput: StartPlanInput = {
      ...input,
      skillInstructions,
      coreDetailsContext: coreDetailsContext || null,
    };
    const service = this.aiService(input.provider);
    const providerLabel = input.provider === "claude" ? "Claude" : "Codex";

    if (input.planningMode === "none") {
      const executingProject = await this.updateProjectStatus(project, "executing", null);
      const draft = service.createDirectExecutionDraft(executingProject, enrichedInput);
      void this.executePlan(executingProject, settings, draft).catch(() => undefined);
      return { started: true };
    }

    await this.updateProjectStatus(project, "planning", null);

    void service
      .startPlanningTurn(project, settings, enrichedInput)
      .then(async (draft) => {
        const latest = await this.requireProject(project.id);
        latest.threadId = draft.threadId;
        latest.updatedAt = new Date().toISOString();
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });

        if (draft.autoApprove) {
          await this.executePlan(latest, settings, draft);
          return;
        }

        await this.updateProjectStatus(latest, "awaitingApproval");
      })
      .catch(async (error) => {
        const latest = await this.requireProject(project.id);
        // Persist any new threadId even on failure so we don't keep retrying a stale one.
        const activeDraft = service.getActivePlan(project.id);
        if (activeDraft?.threadId && activeDraft.threadId !== latest.threadId) {
          latest.threadId = activeDraft.threadId;
          latest.updatedAt = new Date().toISOString();
          await this.store.updateProject(latest);
        }
        await this.updateProjectStatus(
          latest,
          "error",
          error instanceof Error ? error.message : `PROGRAMS could not create a plan with ${providerLabel}.`,
        );
      });

    return { started: true };
  }

  async revisePlan(input: StartPlanInput): Promise<{ started: true }> {
    const service = this.aiService(input.provider);
    await service.interruptPlan(input.projectId);
    return this.startPlan(input);
  }

  async cancelPlan(projectId: string): Promise<{ cancelled: true }> {
    // Interrupt whichever service has an active plan
    const codexPlan = this.codex.getActivePlan(projectId);
    const claudePlan = this.claude.getActivePlan(projectId);
    if (codexPlan) await this.codex.interruptPlan(projectId);
    if (claudePlan) await this.claude.interruptPlan(projectId);
    const project = await this.requireProject(projectId);
    await this.updateProjectStatus(project, "idle");
    return { cancelled: true };
  }

  async approvePlan(input: ApprovePlanInput): Promise<{ started: true }> {
    const settings = await this.store.readSettings();
    const project = await this.requireProject(input.projectId);
    const draft = this.codex.getActivePlan(project.id) ?? this.claude.getActivePlan(project.id);
    if (!draft || draft.status !== "awaitingApproval") {
      throw new Error("There is no approved plan ready to confirm.");
    }

    await this.executePlan(project, settings, draft);

    return { started: true };
  }

  async undoUpdate(projectId: string, updateId: string): Promise<{ started: true }> {
    let project = await this.requireProject(projectId);
    const updates = await this.store.readHistory(projectId);
    const target = updates.find((item) => item.id === updateId);
    if (!target?.commitSha) {
      throw new Error("That update cannot be undone.");
    }

    project = await this.updateProjectStatus(project, "executing");
    await this.git.ensureRepository(project.localPath, null, project.defaultBranch);
    const revertSha = await this.git.revertCommit(project.localPath, target.commitSha);

    target.status = "reverted";
    target.errorMessage = null;
    await this.store.updateHistoryRecord(target);

    const flowchart = await this.readFlowchart(project);
    const undoRecord: UpdateRecord = {
      id: randomUUID(),
      projectId: project.id,
      prompt: `Undo ${target.summary}`,
      summary: `Undid: ${target.summary}`,
      commitSha: revertSha,
      flowchart: flowchart.flowchart,
      flowchartGraph: flowchart.flowchartGraph,
      createdAt: new Date().toISOString(),
      kind: "undo",
      status: "saved",
      errorMessage: null,
    };

    await this.store.addUpdateRecord(undoRecord);
    project.lastUpdatedAt = undoRecord.createdAt;
    project.status = "idle";
    project.lastError = null;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    await this.emitHistory(project.id);
    return { started: true };
  }

  async retrySync(input: RetrySyncInput): Promise<{ started: true }> {
    const project = await this.requireProject(input.projectId);
    const updates = await this.store.readHistory(input.projectId);
    const target = updates.find((item) => item.id === input.updateId);
    if (!target || target.status !== "pendingSync") {
      throw new Error("That update is not waiting to sync.");
    }

    target.status = "saved";
    target.errorMessage = null;
    await this.store.updateHistoryRecord(target);
    project.status = "idle";
    project.lastError = null;
    project.lastUpdatedAt = target.createdAt;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    await this.emitHistory(project.id);
    return { started: true };
  }

  private async executePlan(project: Project, settings: Settings, draft: PlanDraft): Promise<void> {
    await this.requireProviderReady(draft.provider, settings);
    const executingProject = await this.updateProjectStatus(project, "executing", null);
    const service = this.aiService(draft.provider);
    const providerLabel = draft.provider === "claude" ? "Claude" : "Codex";

    void service
      .executeApprovedPlan(executingProject, settings, draft)
      .then(async (result) => {
        let latest = await this.requireProject(executingProject.id);
        await this.git.ensureRepository(latest.localPath, null, latest.defaultBranch);
        await this.writeFlowchart(latest, {
          flowchart: result.flowchart,
          flowchartGraph: result.flowchartGraph,
        });
        latest.description = result.description;
        latest.threadId = result.draft.threadId;
        latest.updatedAt = new Date().toISOString();
        latest.status = "executing";
        latest.lastError = null;
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });

        result.draft.verifyingStatus = "in_progress";
        result.draft.verificationDetails = "Updating flowchart and preparing the local save.";
        result.draft.diffStats = await this.git.readWorkingTreeDiffStats(latest.localPath);
        service.syncDraft(result.draft);

        const commitSha = await this.git.commitAll(latest.localPath, result.commitMessage);
        if (!commitSha) {
          result.draft.status = "completed";
          if (result.draft.planningMode === "none" && result.draft.thinkingStatus === "in_progress") {
            result.draft.thinkingStatus = "completed";
          }
          result.draft.buildingStatus = "completed";
          result.draft.verifyingStatus = "completed";
          result.draft.verificationDetails = "No local file changes were needed.";
          service.syncDraft(result.draft);
          latest = await this.updateProjectStatus(latest, "idle", null);
          this.emit({
            type: "toast",
            level: "info",
            message: `${providerLabel} finished, but no local file changes were needed.`,
          });
          return;
        }

        const historyRecord: UpdateRecord = {
          id: randomUUID(),
          projectId: latest.id,
          prompt: draft.prompt,
          summary: result.summary,
          commitSha,
          flowchart: result.flowchart,
          flowchartGraph: result.flowchartGraph,
          createdAt: new Date().toISOString(),
          kind: "update",
          status: "saved",
          errorMessage: null,
        };
        await this.store.addUpdateRecord(historyRecord);
        void this.generateProjectCoreDetails(latest, settings, draft.provider).catch((err) => {
          console.warn("[core-details] Auto-generation failed:", err);
        });
        latest.lastUpdatedAt = historyRecord.createdAt;
        latest.status = "idle";
        latest.updatedAt = new Date().toISOString();
        latest.lastError = null;
        await this.store.updateProject(latest);
        this.emit({ type: "project.updated", project: latest });
        await this.emitHistory(latest.id);
        result.draft.status = "completed";
        if (result.draft.planningMode === "none" && result.draft.thinkingStatus === "in_progress") {
          result.draft.thinkingStatus = "completed";
        }
        result.draft.buildingStatus = "completed";
        result.draft.verifyingStatus = "completed";
        result.draft.verificationDetails = "Update saved locally.";
        service.syncDraft(result.draft);
        this.emit({
          type: "toast",
          level: "success",
          message: "Update saved locally.",
        });
      })
      .catch(async (error) => {
        const latest = await this.requireProject(executingProject.id);
        const currentDraft = service.getActivePlan(executingProject.id);
        if (currentDraft) {
          currentDraft.status = "failed";
          currentDraft.errorMessage =
            error instanceof Error ? error.message : `PROGRAMS could not finish the update with ${providerLabel}.`;
          currentDraft.verificationDetails = currentDraft.errorMessage;
          if (currentDraft.verifyingStatus === "in_progress" || currentDraft.buildingStatus === "completed") {
            currentDraft.verifyingStatus = "failed";
          } else {
            currentDraft.buildingStatus = "failed";
            if (currentDraft.planningMode === "none" && currentDraft.thinkingStatus === "in_progress") {
              currentDraft.thinkingStatus = "failed";
            }
          }
          service.syncDraft(currentDraft);
        }
        await this.updateProjectStatus(
          latest,
          "error",
          error instanceof Error ? error.message : `PROGRAMS could not finish the update with ${providerLabel}.`,
        );
      });
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.store.readProject(projectId);
    if (!project) {
      throw new Error("Project not found.");
    }
    return project;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRuntimeState();
    }

    await this.initializationPromise;
  }

  private async initializeRuntimeState(): Promise<void> {
    const settings = await this.store.readSettings();
    const projects = await this.store.listProjects();
    await this.runner.restorePersistedRuntimes(projects, settings.appSourcePath, process.env.ELECTRON_RENDERER_URL ?? null);
    await this.reconcileProjectStatuses(projects, false);
  }

  private async syncSelfRuntime(
    settingsArg?: Settings,
    projectsArg?: Project[],
    emitEvents = false,
  ): Promise<Project[]> {
    const settings = settingsArg ?? (await this.store.readSettings());
    const projects = projectsArg ?? (await this.store.listProjects());
    const changedIds = this.runner.syncSelfRuntime(
      projects,
      settings.appSourcePath,
      process.env.ELECTRON_RENDERER_URL ?? null,
    );
    const nextProjects = await this.reconcileProjectStatuses(projects, emitEvents);

    if (emitEvents) {
      for (const projectId of changedIds) {
        this.emit({
          type: "project.runtime",
          projectId,
          runtime: this.runner.getRuntime(projectId),
        });
      }
    }

    return nextProjects;
  }

  private async reconcileProjectStatuses(projects: Project[], emitEvents: boolean): Promise<Project[]> {
    const nextProjects: Project[] = [];

    for (const project of projects) {
      const runtime = this.runner.getRuntime(project.id);
      const nextStatus = this.resolveRuntimeBackedStatus(project.status, runtime.running);
      const nextLastError = runtime.running ? null : project.lastError;

      if (nextStatus === project.status && nextLastError === project.lastError) {
        nextProjects.push(project);
        continue;
      }

      const nextProject: Project = {
        ...project,
        status: nextStatus,
        lastError: nextLastError,
        updatedAt: new Date().toISOString(),
      };
      await this.store.updateProject(nextProject);
      if (emitEvents) {
        this.emit({ type: "project.updated", project: nextProject });
      }
      nextProjects.push(nextProject);
    }

    return nextProjects;
  }

  private async syncProjectRuntimeState(
    project: Project,
    emitUpdates = true,
  ): Promise<{ project: Project; runtime: RuntimeState }> {
    let runtime = await this.runner.validateRuntime(project.id);
    if (!runtime.running) {
      runtime = await this.runner.detectExternalRuntime(project);
    }
    const nextStatus = this.resolveRuntimeBackedStatus(project.status, runtime.running);
    const nextLastError = runtime.running ? null : project.lastError;

    if (nextStatus === project.status && nextLastError === project.lastError) {
      return { project, runtime };
    }

    const nextProject: Project = {
      ...project,
      status: nextStatus,
      lastError: nextLastError,
      updatedAt: new Date().toISOString(),
    };
    await this.store.updateProject(nextProject);
    if (emitUpdates) {
      this.emit({ type: "project.updated", project: nextProject });
    }

    return { project: nextProject, runtime };
  }

  private resolveRuntimeBackedStatus(status: Project["status"], runtimeRunning: boolean): Project["status"] {
    if (runtimeRunning) {
      if (status === "executing" || status === "syncing" || status === "planning" || status === "awaitingApproval") {
        return status;
      }

      return "running";
    }

    return status === "running" ? "idle" : status;
  }

  private async refreshProjectsRuntimeConfig(projects: Project[]): Promise<Project[]> {
    return Promise.all(projects.map((project) => this.refreshProjectRuntimeConfig(project)));
  }

  private async refreshProjectRuntimeConfig(project: Project): Promise<Project> {
    let detected: Project["runtimeConfig"];
    try {
      detected = await detectRuntimeConfig(project.localPath);
    } catch {
      return project;
    }

    const nextRuntimeConfig = {
      ...detected,
      openUrl: detected.openUrl ?? project.runtimeConfig.openUrl,
      lastRunUrl: project.runtimeConfig.lastRunUrl,
      initialIdea: project.runtimeConfig.initialIdea,
      githubRepoName: project.runtimeConfig.githubRepoName ?? detected.githubRepoName,
      attachedSkillId: project.runtimeConfig.attachedSkillId ?? null,
    };

    if (JSON.stringify(nextRuntimeConfig) === JSON.stringify(project.runtimeConfig)) {
      return project;
    }

    const nextProject: Project = {
      ...project,
      runtimeConfig: nextRuntimeConfig,
    };
    await this.store.updateProject(nextProject);
    return nextProject;
  }

  private async readFlowchart(project: Project): Promise<GenerateFlowchartResult> {
    return readFlowchartSnapshot(project);
  }

  private async writeFlowchart(project: Project, snapshot: GenerateFlowchartResult): Promise<void> {
    await writeFlowchartSnapshot(project, snapshot);
  }

  private async emitHistory(projectId: string): Promise<void> {
    const updates = await this.store.readHistory(projectId);
    this.emit({ type: "project.history", projectId, updates });
  }

  private async emitSetupUpdated(
    settings?: Settings,
    codex?: CodexAuthStatus,
    claudeStatus?: ClaudeAuthStatus,
    github?: GitHubAuthStatus,
  ): Promise<void> {
    const snapshot = await this.buildSetupSnapshot(settings, codex, claudeStatus, github);
    this.emit({ type: "setup.updated", setup: snapshot });
  }

  private async buildSetupSnapshot(
    settingsArg?: Settings,
    codexArg?: CodexAuthStatus,
    claudeArg?: ClaudeAuthStatus,
    githubArg?: GitHubAuthStatus,
  ): Promise<SetupSnapshot> {
    const settings = settingsArg ?? (await this.store.readSettings());
    const githubConfig = this.resolveGitHubClientConfig(settings);
    const [setupState, gitVersion, codex, claudeStatus, githubStatus] = await Promise.all([
      this.store.readSetupState(),
      this.git.getVersion(),
      codexArg ? Promise.resolve(codexArg) : this.codex.getAuthStatus(settings),
      claudeArg ? Promise.resolve(claudeArg) : this.claude.getAuthStatus(settings),
      githubArg ? Promise.resolve(githubArg) : this.github.getStatus(githubConfig),
    ]);

    const isPackagedBuild = app.isPackaged;
    const githubConfigured = Boolean(githubConfig);
    const codexInstalled = codex.available && Boolean(codex.binaryPath);
    const claudeInstalled = claudeStatus.available && Boolean(claudeStatus.binaryPath);
    const gitInstalled = Boolean(gitVersion);

    const checks: SetupCheck[] = [
      {
        id: "codexInstall",
        section: "need",
        label: "Install Codex",
        status: codexInstalled ? "confirmed" : "action_required",
        version: codex.version,
        detail: codexInstalled
          ? codex.binaryPath
            ? `Installed at ${codex.binaryPath}.`
            : "Installed and ready."
          : "Required before PROGRAMS can plan or apply changes.",
        actionLabel: codexInstalled ? null : "Install & Connect",
        actionKind: codexInstalled ? "none" : "setupCodex",
        actionTarget: null,
        secondaryActionLabel: codexInstalled ? "View" : null,
        secondaryActionKind: codexInstalled ? "openExternal" : "none",
        secondaryActionTarget: codexInstalled ? CODEX_DOWNLOAD_URL : null,
        required: true,
      },
      {
        id: "codexLogin",
        section: "need",
        label: "Connect Codex",
        status: !codexInstalled ? "info" : codex.loggedIn ? "confirmed" : "action_required",
        version: null,
        detail: !codexInstalled
          ? "Install Codex first."
          : codex.loggedIn
            ? codex.email
              ? `Confirmed as ${codex.email}.`
              : "Confirmed."
            : "PROGRAMS opens the browser sign-in flow and validates it after login.",
        actionLabel: !codexInstalled ? null : codex.loggedIn ? null : "Connect",
        actionKind: !codexInstalled ? "none" : codex.loggedIn ? "none" : "codexLogin",
        actionTarget: null,
        secondaryActionLabel: null,
        secondaryActionKind: "none",
        secondaryActionTarget: null,
        required: true,
      },
      {
        id: "claudeInstall",
        section: "assistant",
        label: "Install Claude Code",
        status: claudeInstalled ? "confirmed" : "info",
        version: claudeStatus.version,
        detail: claudeInstalled
          ? claudeStatus.binaryPath
            ? `Installed at ${claudeStatus.binaryPath}.`
            : "Installed and ready."
          : "Optional. Install and connect Claude Code to use Claude for updates.",
        actionLabel: claudeInstalled ? null : "Install & Connect",
        actionKind: claudeInstalled ? "none" : "setupClaude",
        actionTarget: null,
        secondaryActionLabel: claudeInstalled ? "View" : null,
        secondaryActionKind: claudeInstalled ? "openExternal" : "none",
        secondaryActionTarget: claudeInstalled ? CLAUDE_DOWNLOAD_URL : null,
        required: false,
      },
      {
        id: "claudeLogin",
        section: "assistant",
        label: "Connect Claude",
        status: !claudeInstalled
          ? "info"
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? "confirmed"
                : "info"
              : "action_required"
            : claudeStatus.canConnect
              ? "info"
              : "action_required",
        version: null,
        detail: !claudeInstalled
          ? "Install Claude Code first."
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? claudeStatus.email
                  ? `Confirmed as ${claudeStatus.email}.`
                  : "Confirmed and ready."
                : claudeStatus.email
                  ? `Confirmed as ${claudeStatus.email}. Update Claude Code to keep in-app sign-in compatible.`
                  : "Confirmed. Update Claude Code to keep in-app sign-in compatible."
              : claudeStatus.runtimeErrorMessage ?? "Claude needs attention before it can run in PROGRAMS."
            : claudeStatus.canConnect
              ? "Sign in to use your Claude subscription."
              : claudeStatus.connectErrorMessage ?? "Update Claude Code to connect your Claude account from PROGRAMS.",
        actionLabel: !claudeInstalled
          ? null
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? null
                : "Update Claude"
              : "Repair"
            : claudeStatus.canConnect
              ? "Connect"
              : "Update Claude",
        actionKind: !claudeInstalled
          ? "none"
          : claudeStatus.loggedIn
            ? claudeStatus.ready
              ? claudeStatus.canConnect
                ? "none"
                : "setupClaude"
              : "setupClaude"
            : claudeStatus.canConnect
              ? "claudeLogin"
              : "setupClaude",
        actionTarget: null,
        secondaryActionLabel: null,
        secondaryActionKind: "none",
        secondaryActionTarget: null,
        required: false,
      },
      {
        id: "gitInstall",
        section: "assistant",
        label: "Install Git",
        status: gitInstalled ? "confirmed" : "action_required",
        version: gitVersion,
        detail: gitInstalled
          ? "Confirmed and ready for sync."
          : "PROGRAMS can ask macOS to install it. You only confirm the system prompt.",
        actionLabel: gitInstalled ? null : "Install",
        actionKind: gitInstalled ? "none" : "installGit",
        actionTarget: null,
        secondaryActionLabel: gitInstalled ? "Refresh" : null,
        secondaryActionKind: gitInstalled ? "refresh" : "none",
        secondaryActionTarget: null,
        required: true,
      },
      {
        id: "githubConnect",
        section: "assistant",
        label: "Connect GitHub",
        status: !githubConfigured
          ? "info"
          : githubStatus.loggedIn
            ? "confirmed"
            : githubStatus.hasStoredToken
              ? "action_required"
              : "info",
        version: null,
        detail: !githubConfigured
          ? "Add a GitHub OAuth client ID in Settings first."
          : githubStatus.loggedIn
            ? githubStatus.login
              ? `Confirmed as ${githubStatus.login}. Sync uses HTTPS with the stored app token.`
              : "Confirmed and ready for HTTPS sync."
            : githubStatus.hasStoredToken
              ? githubStatus.errorMessage ?? "Reconnect GitHub to refresh the stored permissions."
              : "Connect GitHub so PROGRAMS can create and sync private repositories.",
        actionLabel: !githubConfigured ? "Open Settings" : githubStatus.loggedIn ? null : "Connect",
        actionKind: !githubConfigured ? "openSettings" : githubStatus.loggedIn ? "none" : "githubLogin",
        actionTarget: null,
        secondaryActionLabel: githubConfigured && !githubStatus.loggedIn ? "Configure App" : null,
        secondaryActionKind: githubConfigured && !githubStatus.loggedIn ? "openExternal" : "none",
        secondaryActionTarget: githubConfigured && !githubStatus.loggedIn ? "https://github.com/settings/developers" : null,
        required: false,
      },
    ];

    const isSetupComplete = checks.every((check) => !check.required || check.status === "confirmed");
    const currentCheckId = checks.find((check) => check.required && check.status !== "confirmed")?.id ?? null;

    return {
      checks,
      completedAt: setupState.completedAt,
      isSetupComplete,
      showSetupOnLaunch: false,
      currentCheckId,
      isPackagedBuild,
      githubConfigured,
    };
  }

  private emitAppUpdateStatus(status: AppUpdateStatus): void {
    const nextJson = JSON.stringify(status);
    if (nextJson === this.lastAppUpdateStatusJson) {
      return;
    }

    this.lastAppUpdateStatusJson = nextJson;
    this.emit({ type: "appUpdate.status", status });
  }

  private async refreshAppUpdateStatus(settings: Settings, autoBuild: boolean): Promise<AppUpdateStatus> {
    const evaluation = await this.evaluateAppUpdate(settings);

    if (autoBuild && evaluation.shouldPackage && evaluation.packageKey && evaluation.workspacePath) {
      this.ensureAppUpdatePackaging(settings, evaluation.workspacePath, evaluation.packageKey);
      return (await this.evaluateAppUpdate(settings)).status;
    }

    return evaluation.status;
  }

  private async evaluateAppUpdate(settings: Settings): Promise<AppUpdateEvaluation> {
    if (process.platform !== "darwin" || !app.isPackaged) {
      return {
        status: {
          supported: false,
          available: false,
          currentAppPath: null,
          candidateAppPath: null,
          workspacePath: null,
          workspaceExists: false,
          sourceUpdatedAt: null,
          launchedAppUpdatedAt: null,
          currentUpdatedAt: null,
          candidateUpdatedAt: null,
          currentRendererAssetName: null,
          currentRendererAssetUpdatedAt: null,
          candidateRendererAssetName: null,
          candidateRendererAssetUpdatedAt: null,
          rendererAssetMatch: null,
          buildState: "idle",
          buildError: null,
          requiresAdminPrompt: false,
          action: "none",
          reason: "App updates are only available from the packaged macOS app.",
        },
        shouldPackage: false,
        packageKey: null,
        statusKey: null,
        workspacePath: null,
      };
    }

    const currentAppPath = this.currentAppBundlePath();
    const launchedAppUpdatedAt = await this.launchedAppUpdatedAtPromise;
    const currentUpdatedAt = currentAppPath ? await this.readModifiedAt(currentAppPath) : null;
    const workspace = await this.readAppUpdateWorkspace(settings);
    const currentRendererAsset = await this.readRendererAssetInfo(currentAppPath);
    const candidateRendererAsset = await this.readRendererAssetInfo(workspace.candidateAppPath);
    const packageKey =
      workspace.workspaceValid && workspace.workspacePath && workspace.sourceUpdatedAt
        ? this.buildAppUpdatePackageKey(workspace.workspacePath, workspace.sourceUpdatedAt)
        : null;
    const statusKey = this.buildAppUpdateStatusKey(
      workspace.workspacePath ?? currentAppPath,
      workspace.sourceUpdatedAt ?? workspace.candidateUpdatedAt,
    );
    const candidateMatchesLatestSource = this.candidateMatchesLatestSource(
      workspace.workspaceValid,
      workspace.sourceUpdatedAt,
      workspace.candidateUpdatedAt,
    );
    const sourceIsNewer =
      workspace.workspaceValid && workspace.sourceUpdatedAt
        ? !candidateMatchesLatestSource
        : false;

    let action: AppUpdateStatus["action"] = "none";
    if (
      candidateMatchesLatestSource &&
      currentAppPath &&
      workspace.candidateAppPath &&
      workspace.candidateUpdatedAt
    ) {
      if (currentAppPath === workspace.candidateAppPath) {
        if (launchedAppUpdatedAt && this.isTimestampNewer(workspace.candidateUpdatedAt, launchedAppUpdatedAt)) {
          action = "restart";
        }
      } else if (!currentUpdatedAt || this.isTimestampNewer(workspace.candidateUpdatedAt, currentUpdatedAt)) {
        action = "install";
      }
    }

    const requiresAdminPrompt =
      action === "install" && currentAppPath ? !(await this.canReplaceInstalledApp(currentAppPath)) : false;

    let buildState: AppUpdateStatus["buildState"] = "idle";
    if (this.appUpdateInstalling) {
      buildState = "installing";
    } else if (this.appUpdatePackagingJob) {
      buildState = "packaging";
    } else if (statusKey && this.appUpdateFailedKey === statusKey) {
      buildState = "failed";
    } else if (candidateMatchesLatestSource && workspace.candidateUpdatedAt) {
      buildState = "ready";
    }

    const reason = this.describeAppUpdateStatus({
      supported: true,
      currentAppPath,
      workspace,
      sourceIsNewer,
      buildState,
      action,
      requiresAdminPrompt,
      buildError: this.appUpdateBuildError,
    });

    return {
      status: {
        supported: true,
        available: action !== "none",
        currentAppPath,
        candidateAppPath: workspace.candidateAppPath,
        workspacePath: workspace.workspacePath,
        workspaceExists: workspace.workspaceExists,
        sourceUpdatedAt: workspace.sourceUpdatedAt,
        launchedAppUpdatedAt,
        currentUpdatedAt,
        candidateUpdatedAt: workspace.candidateUpdatedAt,
        currentRendererAssetName: currentRendererAsset.assetName,
        currentRendererAssetUpdatedAt: currentRendererAsset.assetUpdatedAt,
        candidateRendererAssetName: candidateRendererAsset.assetName,
        candidateRendererAssetUpdatedAt: candidateRendererAsset.assetUpdatedAt,
        rendererAssetMatch: this.rendererAssetsMatch(currentRendererAsset, candidateRendererAsset),
        buildState,
        buildError: buildState === "failed" ? this.appUpdateBuildError : null,
        requiresAdminPrompt,
        action,
        reason,
      },
      shouldPackage:
        Boolean(packageKey) &&
        sourceIsNewer &&
        !this.appUpdatePackagingJob &&
        this.appUpdateFailedKey !== statusKey,
      packageKey,
      statusKey,
      workspacePath: workspace.workspacePath,
    };
  }

  private async ensureAppUpdatePackaging(
    settings: Settings,
    workspacePath: string,
    packageKey: string,
  ): Promise<void> {
    if (this.appUpdatePackagingJob && this.appUpdatePackagingKey === packageKey) {
      return;
    }
    if (this.appUpdatePackagingJob) {
      return;
    }

    this.appUpdatePackagingKey = packageKey;
    this.appUpdateFailedKey = null;
    this.appUpdateBuildError = null;
    const job = this.runAppUpdatePackaging(settings, workspacePath, packageKey);
    this.appUpdatePackagingJob = job;
    void this.evaluateAppUpdate(settings)
      .then((result) => this.emitAppUpdateStatus(result.status))
      .catch(() => undefined);
    void job.finally(() => {
      if (this.appUpdatePackagingJob === job) {
        this.appUpdatePackagingJob = null;
      }
    });
  }

  private async runAppUpdatePackaging(settings: Settings, workspacePath: string, packageKey: string): Promise<void> {
    try {
      const preflightError = await this.preflightAppPackaging(workspacePath);
      if (preflightError) {
        throw new Error(preflightError);
      }

      const result = await execCommand("npm run package:mac", workspacePath);
      if (result.code !== 0) {
        const message = (result.stderr || result.stdout).trim() || "PROGRAMS could not package the latest app build.";
        throw new Error(message);
      }

      await emitSettledAppUpdateStatus({
        applySettlement: () => {
          this.appUpdatePackagingJob = null;
          this.appUpdateFailedKey = null;
          this.appUpdateBuildError = null;
          this.appUpdatePackagingKey = null;
        },
        readStatus: () => this.refreshAppUpdateStatus(settings, false),
        emitStatus: (status) => this.emitAppUpdateStatus(status),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PROGRAMS could not package the latest app build.";
      await emitSettledAppUpdateStatus({
        applySettlement: () => {
          this.appUpdatePackagingJob = null;
          this.appUpdatePackagingKey = null;
          this.appUpdateFailedKey = packageKey;
          this.appUpdateBuildError = message;
        },
        readStatus: () => this.refreshAppUpdateStatus(settings, false),
        emitStatus: (status) => this.emitAppUpdateStatus(status),
      });
    }
  }

  private async preflightAppPackaging(workspacePath: string): Promise<string | null> {
    const packageJsonPath = join(workspacePath, "package.json");
    const packageJsonText = await readTextFile(packageJsonPath);
    if (!packageJsonText.trim()) {
      return "PROGRAMS could not read package.json from the configured source workspace.";
    }

    try {
      const packageJson = JSON.parse(packageJsonText) as {
        scripts?: Record<string, string>;
      };
      if (!packageJson.scripts?.["package:mac"]) {
        return "The configured source workspace is missing the package:mac build script.";
      }
    } catch {
      return "PROGRAMS could not parse package.json from the configured source workspace.";
    }

    const npmVersion = await execCommand("npm --version", workspacePath);
    if (npmVersion.code !== 0) {
      return "PROGRAMS could not find npm. Install Node.js with npm to enable in-app app packaging.";
    }

    return null;
  }

  private async readAppUpdateWorkspace(settings: Settings): Promise<AppUpdateWorkspaceInfo> {
    const workspacePath = settings.appSourcePath?.trim() || null;
    if (!workspacePath) {
      return {
        workspacePath: null,
        workspaceExists: false,
        workspaceValid: false,
        workspaceError: "Choose the PROGRAMS source workspace in Settings to enable in-app updates.",
        sourceUpdatedAt: null,
        candidateAppPath: null,
        candidateUpdatedAt: null,
      };
    }

    const workspaceExists = await pathExists(workspacePath);
    if (!workspaceExists) {
      return {
        workspacePath,
        workspaceExists: false,
        workspaceValid: false,
        workspaceError: "PROGRAMS could not find the configured source workspace.",
        sourceUpdatedAt: null,
        candidateAppPath: null,
        candidateUpdatedAt: null,
      };
    }

    const packageJsonPath = join(workspacePath, "package.json");
    const builderConfigPath = join(workspacePath, "electron-builder.yml");
    const workspaceValid = (await pathExists(packageJsonPath)) && (await pathExists(builderConfigPath));
    const candidateAppPath = await this.resolveCandidateAppPath(workspacePath);
    const candidateUpdatedAt = candidateAppPath ? await this.readModifiedAt(candidateAppPath) : null;

    if (!workspaceValid) {
      return {
        workspacePath,
        workspaceExists,
        workspaceValid: false,
        workspaceError: "The configured source workspace is missing package.json or electron-builder.yml.",
        sourceUpdatedAt: null,
        candidateAppPath,
        candidateUpdatedAt,
      };
    }

    return {
      workspacePath,
      workspaceExists,
      workspaceValid: true,
      workspaceError: null,
      sourceUpdatedAt: await this.readLatestSourceModifiedAt(workspacePath),
      candidateAppPath,
      candidateUpdatedAt,
    };
  }

  private async readLatestSourceModifiedAt(workspacePath: string): Promise<string | null> {
    let latest = 0;

    for (const relativePath of APP_UPDATE_SOURCE_FILES) {
      const absolutePath = join(workspacePath, relativePath);
      const modifiedAt = await this.readModifiedAt(absolutePath);
      if (!modifiedAt) {
        continue;
      }

      latest = Math.max(latest, new Date(modifiedAt).getTime());
    }

    for (const relativePath of APP_UPDATE_SOURCE_ROOTS) {
      latest = Math.max(latest, await this.readLatestDirectoryModifiedAt(join(workspacePath, relativePath)));
    }

    return latest > 0 ? new Date(latest).toISOString() : null;
  }

  private async readLatestDirectoryModifiedAt(path: string): Promise<number> {
    if (!(await pathExists(path))) {
      return 0;
    }

    let latest = 0;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        latest = Math.max(latest, await this.readLatestDirectoryModifiedAt(entryPath));
        continue;
      }

      const modifiedAt = await this.readModifiedAt(entryPath);
      if (!modifiedAt) {
        continue;
      }

      latest = Math.max(latest, new Date(modifiedAt).getTime());
    }

    return latest;
  }

  private async readRendererAssetInfo(appBundlePath: string | null): Promise<AppRendererAssetInfo> {
    if (!appBundlePath) {
      return {
        assetName: null,
        assetUpdatedAt: null,
      };
    }

    const assetsDir = join(appBundlePath, "Contents", "Resources", "app", "out", "renderer", "assets");
    if (!(await pathExists(assetsDir))) {
      return {
        assetName: null,
        assetUpdatedAt: null,
      };
    }

    const entries = await readdir(assetsDir, { withFileTypes: true });
    const assetName =
      entries.find((entry) => entry.isFile() && /^index-[^.]+\.js$/.test(entry.name))?.name ??
      entries.find((entry) => entry.isFile() && /^index-[^.]+\.css$/.test(entry.name))?.name ??
      null;

    if (!assetName) {
      return {
        assetName: null,
        assetUpdatedAt: null,
      };
    }

    return {
      assetName,
      assetUpdatedAt: await this.readModifiedAt(join(assetsDir, assetName)),
    };
  }

  private rendererAssetsMatch(current: AppRendererAssetInfo, candidate: AppRendererAssetInfo): boolean | null {
    if (!current.assetName || !candidate.assetName) {
      return null;
    }

    if (current.assetName !== candidate.assetName) {
      return false;
    }

    if (current.assetUpdatedAt && candidate.assetUpdatedAt) {
      return current.assetUpdatedAt === candidate.assetUpdatedAt;
    }

    return true;
  }

  private describeAppUpdateStatus({
    supported,
    currentAppPath,
    workspace,
    sourceIsNewer,
    buildState,
    action,
    requiresAdminPrompt,
    buildError,
  }: {
    supported: boolean;
    currentAppPath: string | null;
    workspace: AppUpdateWorkspaceInfo;
    sourceIsNewer: boolean;
    buildState: AppUpdateStatus["buildState"];
    action: AppUpdateStatus["action"];
    requiresAdminPrompt: boolean;
    buildError: string | null;
  }): string {
    if (!supported) {
      return "App updates are only available from the packaged macOS app.";
    }
    if (!currentAppPath) {
      return "PROGRAMS could not determine the running app bundle path.";
    }
    if (buildState === "installing") {
      return "Installing the latest PROGRAMS app build.";
    }
    if (buildState === "packaging") {
      return "PROGRAMS is packaging the latest macOS app in the background.";
    }
    if (buildState === "failed") {
      return buildError || "PROGRAMS could not prepare the latest app build.";
    }
    if (!workspace.workspacePath) {
      return workspace.workspaceError || "Choose the PROGRAMS source workspace in Settings to enable in-app updates.";
    }
    if (!workspace.workspaceExists || !workspace.workspaceValid) {
      return workspace.workspaceError || "PROGRAMS could not inspect the configured source workspace.";
    }
    if (action === "restart") {
      return "A newer build is ready. Restart PROGRAMS to load it.";
    }
    if (action === "install") {
      return requiresAdminPrompt
        ? "A newer build is ready. PROGRAMS will ask macOS for permission to replace the installed app."
        : "A newer build is ready to install.";
    }
    if (sourceIsNewer) {
      return "PROGRAMS needs to package a fresh macOS app build from the latest source changes.";
    }
    if (workspace.candidateUpdatedAt) {
      return "The installed app already matches the latest packaged build.";
    }
    return "PROGRAMS has not packaged a macOS app bundle from this workspace yet.";
  }

  private candidateMatchesLatestSource(
    workspaceValid: boolean,
    sourceUpdatedAt: string | null,
    candidateUpdatedAt: string | null,
  ): boolean {
    if (!candidateUpdatedAt) {
      return false;
    }
    if (!workspaceValid || !sourceUpdatedAt) {
      return true;
    }
    return !this.isTimestampNewer(sourceUpdatedAt, candidateUpdatedAt);
  }

  private buildAppUpdatePackageKey(workspacePath: string, sourceUpdatedAt: string): string {
    return `${workspacePath}::${sourceUpdatedAt}`;
  }

  private buildAppUpdateStatusKey(scope: string | null, timestamp: string | null): string | null {
    if (!scope) {
      return null;
    }

    return `${scope}::${timestamp ?? "unknown"}`;
  }

  private isTimestampNewer(left: string, right: string): boolean {
    return new Date(left).getTime() > new Date(right).getTime() + APP_UPDATE_FRESHNESS_WINDOW_MS;
  }

  private async canReplaceInstalledApp(appPath: string): Promise<boolean> {
    try {
      await access(dirname(appPath), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async startAppRelaunch(appPath: string): Promise<void> {
    const scriptPath = await this.createAppUpdateScript(
      "relaunch-app.sh",
      [
        "#!/bin/zsh",
        "sleep 1",
        `/usr/bin/open '${this.escapeShellPath(appPath)}'`,
      ],
    );
    this.launchDetachedScript(scriptPath);
  }

  private async startWritableAppSwap(currentAppPath: string, candidateAppPath: string): Promise<void> {
    const escapedCurrent = this.escapeShellPath(currentAppPath);
    const escapedCandidate = this.escapeShellPath(candidateAppPath);
    const escapedNext = this.escapeShellPath(`${currentAppPath}.next`);
    const escapedBackup = this.escapeShellPath(`${currentAppPath}.previous`);
    const scriptPath = await this.createAppUpdateScript(
      "install-update.sh",
      [
        "#!/bin/zsh",
        "set -e",
        "sleep 1",
        `/bin/rm -rf '${escapedNext}'`,
        `/usr/bin/ditto '${escapedCandidate}' '${escapedNext}'`,
        `/bin/rm -rf '${escapedBackup}'`,
        `/bin/mv '${escapedCurrent}' '${escapedBackup}'`,
        `/bin/mv '${escapedNext}' '${escapedCurrent}'`,
        `/usr/bin/open '${escapedCurrent}'`,
        `/bin/rm -rf '${escapedBackup}'`,
      ],
    );
    this.launchDetachedScript(scriptPath);
  }

  private async startPrivilegedAppSwap(currentAppPath: string, candidateAppPath: string): Promise<void> {
    const escapedCurrent = this.escapeShellPath(currentAppPath);
    const escapedCandidate = this.escapeShellPath(candidateAppPath);
    const escapedNext = this.escapeShellPath(`${currentAppPath}.next`);
    const escapedBackup = this.escapeShellPath(`${currentAppPath}.previous`);
    const installScript = await this.createAppUpdateScript(
      "install-update-admin.sh",
      [
        "#!/bin/zsh",
        "set -e",
        "sleep 1",
        `/bin/rm -rf '${escapedNext}'`,
        `/usr/bin/ditto '${escapedCandidate}' '${escapedNext}'`,
        `/bin/rm -rf '${escapedBackup}'`,
        `/bin/mv '${escapedCurrent}' '${escapedBackup}'`,
        `/bin/mv '${escapedNext}' '${escapedCurrent}'`,
        `/bin/rm -rf '${escapedBackup}'`,
      ],
    );
    const relaunchScript = await this.createAppUpdateScript(
      "relaunch-after-install.sh",
      [
        "#!/bin/zsh",
        "sleep 3",
        `/usr/bin/open '${escapedCurrent}'`,
      ],
    );

    await this.launchPrivilegedDetachedScript(installScript);
    this.launchDetachedScript(relaunchScript);
  }

  private async createAppUpdateScript(name: string, lines: string[]): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "programs-update-"));
    const scriptPath = join(tempDir, name);
    await writeTextFile(scriptPath, `${lines.join("\n")}\n/bin/rm -f '${this.escapeShellPath(scriptPath)}'\n`);
    return scriptPath;
  }

  private launchDetachedScript(scriptPath: string): void {
    const child = spawn("/bin/zsh", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  private async launchPrivilegedDetachedScript(scriptPath: string): Promise<void> {
    const shellCommand = `/bin/zsh '${this.escapeShellPath(scriptPath)}' >/dev/null 2>&1 &`;
    const result = await execCommand(
      `/usr/bin/osascript -e "${this.escapeAppleScriptString(
        `do shell script "${shellCommand}" with administrator privileges`,
      )}"`,
      app.getPath("home"),
    );

    if (result.code !== 0) {
      const details = `${result.stderr}\n${result.stdout}`.trim();
      throw new Error(details || "macOS did not approve the app replacement.");
    }
  }

  private currentAppBundlePath(): string | null {
    if (!app.isPackaged) {
      return null;
    }

    const macosDirectory = dirname(process.execPath);
    const contentsDirectory = dirname(macosDirectory);
    const appBundlePath = dirname(contentsDirectory);
    return appBundlePath.endsWith(".app") ? appBundlePath : null;
  }

  private async resolveCandidateAppPath(workspaceRoot: string): Promise<string | null> {
    const candidates = [
      join(workspaceRoot, "dist", "mac-arm64", "PROGRAMS.app"),
      join(workspaceRoot, "dist", "mac", "PROGRAMS.app"),
    ];
    let latestPath: string | null = null;
    let latestTimestamp = 0;

    for (const candidate of candidates) {
      const modifiedAt = await this.readModifiedAt(candidate);
      if (!modifiedAt) {
        continue;
      }

      const timestamp = new Date(modifiedAt).getTime();
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestPath = candidate;
      }
    }

    return latestPath;
  }

  private async readModifiedAt(path: string): Promise<string | null> {
    try {
      const details = await stat(path);
      return details.mtime.toISOString();
    } catch {
      return null;
    }
  }

  private escapeShellPath(value: string): string {
    return value.replace(/'/g, `'\\''`);
  }

  private escapeAppleScriptString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private formatAppUpdateInstallError(error: unknown, candidateAppPath: string | null): string {
    const baseMessage =
      error instanceof Error ? error.message : "PROGRAMS could not install the latest app build.";
    if (!candidateAppPath) {
      return baseMessage;
    }

    return `${baseMessage} Built app: ${candidateAppPath}`;
  }

  private githubConfigurationMessage(): string {
    return app.isPackaged
      ? "GitHub sign-in is not bundled in this build of PROGRAMS."
      : "GitHub sign-in is not configured for this development build yet. Add a GitHub client ID override in Developer settings or bundle GITHUB_CLIENT_ID.";
  }

  private async updateProjectStatus(
    project: Project,
    status: Project["status"],
    lastError: string | null = null,
  ): Promise<Project> {
    project.status = status;
    project.lastError = lastError;
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }

  // --- Home Scratchpad ---

  async readHomeScratchpad(): Promise<HomeScratchpadItem[]> {
    await this.ensureInitialized();
    return this.store.getHomeScratchpad();
  }

  async updateHomeScratchpad(input: { items: HomeScratchpadItem[] }): Promise<HomeScratchpadItem[]> {
    await this.ensureInitialized();
    await this.store.saveHomeScratchpad(input.items);
    return input.items;
  }

  // --- Unified To-dos ---

  async listTodos(input: ListTodosInput): Promise<UnifiedTodoItem[]> {
    await this.ensureInitialized();
    return this.store.listTodos(input.projectId ?? undefined, input.includeProcessed ?? false);
  }

  async addTodo(input: AddTodoInput): Promise<UnifiedTodoItem> {
    await this.ensureInitialized();
    const item: UnifiedTodoItem = {
      id: randomUUID(),
      text: input.text,
      projectId: input.projectId,
      completed: false,
      processedIntoPillar: false,
      source: input.source ?? "user",
      createdAt: new Date().toISOString(),
    };
    this.store.addTodo(item);
    this.emit({ type: "app.event", event: "todos.updated" } as AppEvent);
    return item;
  }

  async removeTodo(id: string): Promise<void> {
    await this.ensureInitialized();
    this.store.removeTodo(id);
    this.emit({ type: "app.event", event: "todos.updated" } as AppEvent);
  }

  async updateTodos(input: UpdateTodosInput): Promise<UnifiedTodoItem[]> {
    await this.ensureInitialized();
    this.store.saveTodos(input.items);
    this.emit({ type: "app.event", event: "todos.updated" } as AppEvent);
    return input.items;
  }

  async markTodoProcessed(id: string): Promise<void> {
    await this.ensureInitialized();
    this.store.markTodoProcessed(id);
    this.emit({ type: "app.event", event: "todos.updated" } as AppEvent);
  }

  // --- Git Sync ---

  async syncProjectToGitHub(input: GitSyncInput): Promise<GitSyncResult> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);

    if (!project.remoteUrl) {
      return { committed: false, pushed: false, commitSha: null, error: "No remote URL configured. Connect this project to GitHub first." };
    }

    const settings = await this.store.readSettings();
    const githubStatus = await this.github.getStatus(this.resolveGitHubClientConfig(settings));
    if (!githubStatus.loggedIn) {
      return { committed: false, pushed: false, commitSha: null, error: "Sign in to GitHub before syncing." };
    }

    try {
      const auth = {
        remoteUrl: project.remoteUrl,
        token: await this.github.getStoredToken(),
      };
      const message = input.commitMessage || `Sync: ${new Date().toISOString()}`;
      const commitSha = await this.git.commitAll(project.localPath, message);

      if (!commitSha) {
        // No changes to commit — check if there are unpushed commits
        try {
          await this.git.push(project.localPath, project.defaultBranch, auth);
          return { committed: false, pushed: true, commitSha: null, error: null };
        } catch {
          return { committed: false, pushed: false, commitSha: null, error: null };
        }
      }

      await this.git.push(project.localPath, project.defaultBranch, auth);
      return { committed: true, pushed: true, commitSha, error: null };
    } catch (error) {
      return {
        committed: false,
        pushed: false,
        commitSha: null,
        error: error instanceof Error ? error.message : "Sync failed.",
      };
    }
  }

  async readProjectDiffStats(projectId: string): Promise<DiffStats | null> {
    await this.ensureInitialized();
    const project = await this.requireProject(projectId);
    return this.git.readWorkingTreeDiffStats(project.localPath);
  }

  // --- Skills ---

  async listSkills(): Promise<Skill[]> {
    await this.ensureInitialized();
    return this.store.listSkills();
  }

  async readSkill(id: string): Promise<Skill | null> {
    await this.ensureInitialized();
    return this.store.readSkill(id);
  }

  async downloadSkill(input: DownloadSkillInput): Promise<Skill> {
    await this.ensureInitialized();
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(input.filePath, "utf8");

    // Parse markdown skill file
    const lines = content.split(/\r?\n/);
    let name = input.name || "";
    let description = "";
    let instructions = "";
    let currentSection = "";

    for (const line of lines) {
      const headingMatch = line.match(/^#+\s+(.+)/);
      if (headingMatch) {
        const heading = headingMatch[1].trim().toLowerCase();
        if (!name && heading) {
          name = headingMatch[1].trim();
        }
        if (heading.includes("description") || heading.includes("about")) {
          currentSection = "description";
        } else if (heading.includes("instruction") || heading.includes("prompt") || heading.includes("rules") || heading.includes("system")) {
          currentSection = "instructions";
        } else {
          currentSection = "instructions"; // default to instructions for unknown sections
        }
        continue;
      }

      if (currentSection === "description") {
        description += `${line}\n`;
      } else if (currentSection === "instructions") {
        instructions += `${line}\n`;
      } else {
        // Before any section heading, treat as instructions
        instructions += `${line}\n`;
      }
    }

    if (!name) {
      const { basename } = await import("node:path");
      name = basename(input.filePath, ".md");
    }

    const skill: Skill = {
      id: randomUUID(),
      name: name.trim(),
      description: description.trim(),
      sourceProvider: "claude",
      sourceType: "skill",
      instructions: instructions.trim() || content.trim(),
      originalFilePath: input.filePath,
      isUniversal: false,
      installStatus: "ready",
      installSlug: null,
      installPath: input.filePath,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.saveSkill(skill);
    return skill;
  }

  async installSkillCatalogItem(input: InstallSkillCatalogInput): Promise<Skill> {
    await this.ensureInitialized();
    const now = new Date().toISOString();
    const existing = this.store.listSkills().find((skill) => skill.installSlug === input.catalogId);
    const baseId = existing?.id ?? randomUUID();
    const createdAt = existing?.createdAt ?? now;

    const skill = buildCatalogSkill(input.catalogId, {
      id: baseId,
      createdAt,
      updatedAt: now,
      installStatus: "ready",
      installPath:
        input.catalogId === "user-testing-universal"
          ? this.getProgramsPlaywrightRunnerPath(await this.store.readSettings())
          : null,
    });
    this.store.saveSkill(skill);
    return skill;
  }

  async convertSkillToUniversal(input: ConvertSkillInput): Promise<Skill> {
    await this.ensureInitialized();
    const skill = this.store.readSkill(input.skillId);
    if (!skill) throw new Error("Skill not found.");

    // Strip Claude-specific references
    let instructions = skill.instructions;
    instructions = instructions.replace(/\b(Claude|Anthropic|Claude Code)\b/gi, "AI assistant");
    instructions = instructions.replace(/\b(claude-sonnet|claude-opus|claude-haiku)\b/gi, "model");

    const updated: Skill = {
      ...skill,
      sourceProvider: "universal",
      sourceType: "skill",
      isUniversal: true,
      instructions,
      installStatus: "ready",
      updatedAt: new Date().toISOString(),
    };

    this.store.saveSkill(updated);
    return updated;
  }

  async deleteSkill(id: string): Promise<void> {
    await this.ensureInitialized();
    this.store.deleteSkill(id);
  }

  async attachSkillToProject(input: AttachSkillInput): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    project.runtimeConfig = {
      ...project.runtimeConfig,
      attachedSkillId: input.skillId,
    };
    project.updatedAt = new Date().toISOString();
    await this.store.updateProject(project);
    this.emit({ type: "project.updated", project });
    return project;
  }

  async runPlaywrightTest(input: PlaywrightRunInput): Promise<PlaywrightRunResult> {
    await this.ensureInitialized();
    const project = await this.requireProject(input.projectId);
    const runtime = await this.runner.validateRuntime(project.id);
    const url = input.url?.trim() || runtime.url || project.runtimeConfig.lastRunUrl || project.runtimeConfig.openUrl;
    if (!url) {
      throw new Error("Run the project first or provide a URL before using the user-testing runner.");
    }

    return this.playwright.run({
      projectId: project.id,
      cwd: project.localPath,
      url,
      actions: input.actions ?? [],
      headless: input.headless ?? true,
      settleMs: input.settleMs ?? 1200,
    });
  }

}
