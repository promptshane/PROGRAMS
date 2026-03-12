import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { z } from "zod";
import {
  FLOWCHART_OUTPUT_CONTRACT,
  FLOWCHART_PROMPT_RULES,
  collectFlowchartRepoHints,
  formatFlowchartRepoHints,
  flowchartGraphSchema,
  materializeFlowchartSnapshot,
} from "@main/utils/flowchart";
import { execCommand, getCommandEnv } from "@main/utils/process";
import type {
  ClaudeAuthStatus,
  FlowchartGraph,
  PlanDraft,
  ProviderUsage,
  Project,
  Settings,
  StartPlanInput,
} from "@shared/types";

type Emit = (
  event:
    | { type: "project.plan"; projectId: string; plan: PlanDraft | null }
    | { type: "auth.claude"; status: ClaudeAuthStatus }
    | { type: "toast"; level: "info" | "success" | "error"; message: string },
) => void;

interface ExecutionPayload {
  draft: PlanDraft;
  summary: string;
  description: string;
  flowchart: string;
  flowchartGraph: FlowchartGraph | null;
  commitMessage: string;
}

interface ClaudeDailyActivityEntry {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface ClaudeDailyModelTokenEntry {
  date: string;
  tokensByModel: Record<string, number>;
}

interface ClaudeStatsCache {
  lastComputedDate: string;
  dailyActivity: ClaudeDailyActivityEntry[];
  dailyModelTokens: ClaudeDailyModelTokenEntry[];
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string | null;
}

const planResultSchema = z.object({
  summary: z.string(),
  impact: z.string(),
  flowchartChanges: z.string(),
});

const executionResultSchema = z.object({
  summary: z.string(),
  description: z.string(),
  flowchartGraph: flowchartGraphSchema,
  commitMessage: z.string(),
});

const claudeDailyActivitySchema = z.object({
  date: z.string(),
  messageCount: z.number().int().nonnegative().catch(0),
  sessionCount: z.number().int().nonnegative().catch(0),
  toolCallCount: z.number().int().nonnegative().catch(0),
});

const claudeDailyModelTokenSchema = z.object({
  date: z.string(),
  tokensByModel: z.record(z.number().int().nonnegative()).catch({}),
});

const claudeStatsCacheSchema = z.object({
  lastComputedDate: z.string(),
  dailyActivity: z.array(claudeDailyActivitySchema).catch([]),
  dailyModelTokens: z.array(claudeDailyModelTokenSchema).catch([]),
  totalSessions: z.number().int().nonnegative().catch(0),
  totalMessages: z.number().int().nonnegative().catch(0),
  firstSessionDate: z.string().nullable().optional().catch(null),
});

const baseDeveloperInstructions = `
You are Claude operating inside PROGRAMS, a desktop control panel for AI-assisted coding.

Rules:
- Keep user-facing explanations concise and plain English.
- Never talk about git concepts like commit, push, branch, or rebase unless explicitly asked.
- Respect the project root as the only writable code area.
- When asked to plan, do not make file changes.
- When asked to execute, make the requested code changes directly in the project.
- Keep .programs/system-flow.mmd up to date as a Mermaid flowchart focused on user flow and major system responsibilities, not line-level code.
- Produce brief, clear summaries that non-technical users can understand.
`.trim();

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const formatClaudeNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)));

const parseClaudeDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const directDate = new Date(value);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const dayDate = new Date(`${value}T12:00:00`);
  if (!Number.isNaN(dayDate.getTime())) {
    return dayDate;
  }

  return null;
};

const formatClaudeDateLabel = (value: string | null): string => {
  if (!value) {
    return "Unknown date";
  }

  const date = parseClaudeDate(value);
  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
};

const parseClaudeDay = (value: string): number | null => {
  return parseClaudeDate(value)?.getTime() ?? null;
};

const sumClaudeTokens = (entry: ClaudeDailyModelTokenEntry | undefined): number =>
  Object.values(entry?.tokensByModel ?? {}).reduce((total, value) => total + value, 0);

const sumClaudeActivity = (entries: ClaudeDailyActivityEntry[]) =>
  entries.reduce(
    (summary, entry) => ({
      messageCount: summary.messageCount + entry.messageCount,
      sessionCount: summary.sessionCount + entry.sessionCount,
      toolCallCount: summary.toolCallCount + entry.toolCallCount,
    }),
    {
      messageCount: 0,
      sessionCount: 0,
      toolCallCount: 0,
    },
  );

const buildClaudeDetailLabel = (summary: ReturnType<typeof sumClaudeActivity>, lead: string): string => {
  const parts = [lead, `${formatClaudeNumber(summary.sessionCount)} sessions`, `${formatClaudeNumber(summary.messageCount)} messages`];
  if (summary.toolCallCount > 0) {
    parts.push(`${formatClaudeNumber(summary.toolCallCount)} tool calls`);
  }
  return parts.join(" · ");
};

const formatContextPaths = (contextPaths: string[]): string =>
  contextPaths.length
    ? `Priority files and folders for this turn:\n${contextPaths.map((path) => `- ${path}`).join("\n")}`
    : "No extra files were selected for this turn.";

const buildPlanningPrompt = (project: Project, prompt: string, contextPaths: string[]): string => `
${baseDeveloperInstructions}

Plan a change for the project "${project.name}".

Current project description:
${project.description}

Requested change:
${prompt}

${formatContextPaths(contextPaths)}

Instructions:
- Explore the codebase as needed.
- Do not change any files.
- Produce a concise implementation plan.
- Include the expected user-visible impact.
- Describe how the system flowchart should change.
- Your final answer must be ONLY strict JSON (no markdown fences) matching this schema:
  {"summary": string, "impact": string, "flowchartChanges": string}
`.trim();

const buildExecutionPrompt = async (project: Project, draft: PlanDraft): Promise<string> => {
  const repoHints = await collectFlowchartRepoHints(project.localPath);
  return `
${baseDeveloperInstructions}

Implement the approved update for "${project.name}".

Original request:
${draft.prompt}

Approved plan:
${draft.explanation}

Plan steps:
${draft.steps.map((step) => `- ${step.step}`).join("\n") || "- Use the approved plan above."}

${formatContextPaths(draft.contextPaths)}

${formatFlowchartRepoHints(repoHints)}

Requirements:
- Make the code changes now.
- Return an updated structured system flowchart that matches the final user-visible flow after your code changes.
- Keep the project description current and user-facing.
- Your final answer must be ONLY strict JSON (no markdown fences) matching this schema:
  {"summary": string, "description": string, "flowchartGraph": FlowchartGraph, "commitMessage": string}
- Use these flowchart rules:
${FLOWCHART_PROMPT_RULES}
- ${FLOWCHART_OUTPUT_CONTRACT}
- The summary must be one or two short sentences for the update history.
- The commitMessage must be short and action-oriented.
`.trim();
};

export class ClaudeService {
  private readonly planDrafts = new Map<string, PlanDraft>();
  private readonly activeProcesses = new Map<string, ChildProcess>();

  constructor(private readonly emit: Emit) {}

  getActivePlan(projectId: string): PlanDraft | null {
    return this.planDrafts.get(projectId) ?? null;
  }

  clearPlan(projectId: string): void {
    this.planDrafts.delete(projectId);
    this.emit({ type: "project.plan", projectId, plan: null });
  }

  async getUsage(settings: Settings): Promise<ProviderUsage> {
    const auth = await this.getAuthStatus(settings);
    const statsCache = await this.readStatsCache();
    if (statsCache) {
      const latestActivity = statsCache.dailyActivity.at(-1);
      const latestTokenEntry = statsCache.dailyModelTokens.at(-1);
      const latestTokens = sumClaudeTokens(latestTokenEntry);

      const latestDayTimestamp = parseClaudeDay(statsCache.lastComputedDate);
      const recentActivity =
        latestDayTimestamp === null
          ? statsCache.dailyActivity
          : statsCache.dailyActivity.filter((entry) => {
              const entryDay = parseClaudeDay(entry.date);
              return entryDay !== null && latestDayTimestamp - entryDay <= 6 * DAY_IN_MS;
            });
      const recentTokenEntries =
        latestDayTimestamp === null
          ? statsCache.dailyModelTokens
          : statsCache.dailyModelTokens.filter((entry) => {
              const entryDay = parseClaudeDay(entry.date);
              return entryDay !== null && latestDayTimestamp - entryDay <= 6 * DAY_IN_MS;
            });
      const recentTokens = recentTokenEntries.reduce((total, entry) => total + sumClaudeTokens(entry), 0);
      const recentActivitySummary = sumClaudeActivity(recentActivity);
      const latestActivitySummary = latestActivity ? sumClaudeActivity([latestActivity]) : sumClaudeActivity([]);

      const windows = [
        {
          label: "Latest Day",
          usedPercent: null,
          valueLabel: `${formatClaudeNumber(latestTokens)} tokens`,
          detail: buildClaudeDetailLabel(latestActivitySummary, formatClaudeDateLabel(statsCache.lastComputedDate)),
          resetsAt: null,
          windowDurationMins: null,
        },
        {
          label: "Last 7 Days",
          usedPercent: null,
          valueLabel: `${formatClaudeNumber(recentTokens)} tokens`,
          detail: buildClaudeDetailLabel(recentActivitySummary, "Recent activity"),
          resetsAt: null,
          windowDurationMins: null,
        },
        {
          label: "All Time",
          usedPercent: null,
          valueLabel: `${formatClaudeNumber(statsCache.totalSessions)} sessions`,
          detail: `${formatClaudeNumber(statsCache.totalMessages)} messages since ${formatClaudeDateLabel(statsCache.firstSessionDate)}`,
          resetsAt: null,
          windowDurationMins: null,
        },
      ];

      let note = `Local Claude Code history from stats cache, updated ${formatClaudeDateLabel(statsCache.lastComputedDate)}.`;
      if (!auth.available) {
        note = `${note} Install Claude Code to refresh it here.`;
      } else if (!auth.loggedIn) {
        note = `${note} Sign in to Claude Code to refresh it here.`;
      } else {
        note = `${note} Live plan-limit percentages and reset timers are not exposed in this local cache yet.`;
      }

      return {
        status: "ready",
        windows,
        note,
      };
    }

    if (!auth.available) {
      return {
        status: "requiresInstall",
        windows: [],
        note: "Install Claude Code to see connection status here.",
      };
    }

    if (!auth.loggedIn) {
      return {
        status: "requiresLogin",
        windows: [],
        note: "Connect Claude to use Claude from PROGRAMS.",
      };
    }

    return {
      status: "unsupported",
      windows: [],
      note: "PROGRAMS could not find Claude usage history yet. Use Claude Code once, then reopen Usage.",
    };
  }

  async getAuthStatus(settings: Settings): Promise<ClaudeAuthStatus> {
    const binaryPath = await this.detectBinaryPath(settings);
    if (!binaryPath) {
      return {
        available: false,
        loggedIn: false,
        binaryPath: null,
        version: null,
        errorMessage: "Claude Code CLI is not installed.",
      };
    }

    const versionResult = await execCommand(`"${binaryPath}" --version`, process.cwd());
    const version =
      versionResult.code === 0
        ? versionResult.stdout.trim() || null
        : null;

    // Check auth by running a minimal command
    const authResult = await execCommand(
      `"${binaryPath}" -p "respond with ok" --max-turns 1 --output-format json 2>/dev/null`,
      process.cwd(),
    );
    const loggedIn = authResult.code === 0;

    return {
      available: true,
      loggedIn,
      binaryPath,
      version,
      errorMessage: loggedIn ? null : "Claude Code is not signed in.",
    };
  }

  async login(settings: Settings): Promise<ClaudeAuthStatus> {
    const binaryPath = await this.detectBinaryPath(settings);
    if (!binaryPath) {
      throw new Error("Install Claude Code CLI before signing in. Run: npm install -g @anthropic-ai/claude-code");
    }

    // Open the Claude login flow in the user's browser
    const commandEnv = await getCommandEnv();
    const child = spawn(binaryPath, ["login"], {
      env: commandEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Collect any URLs from stdout/stderr and open them
    const handleLine = (line: string) => {
      const urlMatch = line.match(/https:\/\/\S+/);
      if (urlMatch) {
        // The login command outputs a URL - we let the CLI handle opening it
      }
    };

    readline.createInterface({ input: child.stdout }).on("line", handleLine);
    readline.createInterface({ input: child.stderr }).on("line", handleLine);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Claude sign-in timed out. Try again."));
      }, 120000);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("Claude sign-in failed. Try again."));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const status = await this.getAuthStatus(settings);
    this.emit({ type: "auth.claude", status });
    return status;
  }

  async runOneShot(
    project: Project,
    settings: Settings,
    prompt: string,
    model: string,
    _outputSchema?: Record<string, unknown>,
  ): Promise<string> {
    const binaryPath = await this.requireBinaryPath(settings);
    const commandEnv = await getCommandEnv();

    return new Promise<string>((resolve, reject) => {
      const args = [
        "-p", prompt,
        "--model", model,
        "--print",
        "--max-turns", "5",
        "--output-format", "stream-json",
      ];

      const child = spawn(binaryPath, args, {
        cwd: project.localPath,
        env: commandEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const chunks: string[] = [];

      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        chunks.push(line);
      });

      readline.createInterface({ input: child.stderr }).on("line", () => {
        // Drain stderr
      });

      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error("Claude could not complete the request."));
          return;
        }

        try {
          const finalText = this.extractFinalResult(chunks);
          resolve(finalText);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Claude returned an unexpected result."));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }

  async startPlanningTurn(project: Project, settings: Settings, input: StartPlanInput): Promise<PlanDraft> {
    const binaryPath = await this.requireBinaryPath(settings);
    const commandEnv = await getCommandEnv();

    const draft: PlanDraft = {
      projectId: project.id,
      provider: "claude",
      threadId: null,
      turnId: null,
      prompt: input.prompt,
      speed: input.speed,
      model: input.model,
      claudeModel: input.claudeModel,
      reasoningEffort: input.reasoningEffort,
      autoApprove: input.autoApprove,
      contextPaths: [...input.contextPaths],
      status: "planning",
      explanation: "Claude is building the plan.",
      steps: [],
      summary: null,
      impact: null,
      flowchartChanges: null,
      diff: null,
      finalText: null,
      errorMessage: null,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.planDrafts.set(project.id, draft);
    this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });

    return new Promise<PlanDraft>((resolve, reject) => {
      const prompt = buildPlanningPrompt(project, input.prompt, input.contextPaths);
      const args = [
        "-p", prompt,
        "--model", input.claudeModel,
        "--print",
        "--max-turns", "5",
        "--output-format", "stream-json",
      ];

      const child = spawn(binaryPath, args, {
        cwd: project.localPath,
        env: commandEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcesses.set(project.id, child);
      const chunks: string[] = [];

      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        chunks.push(line);
        this.handleStreamEvent(project.id, draft, line);
      });

      readline.createInterface({ input: child.stderr }).on("line", () => {
        // Drain stderr
      });

      child.on("exit", (code) => {
        this.activeProcesses.delete(project.id);

        if (code !== 0) {
          draft.status = "failed";
          draft.errorMessage = "Claude could not complete the plan.";
          draft.lastUpdatedAt = new Date().toISOString();
          this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
          reject(new Error(draft.errorMessage));
          return;
        }

        try {
          const finalText = this.extractFinalResult(chunks);
          const parsed = planResultSchema.parse(parseJsonFromText(finalText));
          draft.status = "awaitingApproval";
          draft.summary = parsed.summary;
          draft.impact = parsed.impact;
          draft.flowchartChanges = parsed.flowchartChanges;
          draft.finalText = finalText;
          draft.errorMessage = null;
          draft.lastUpdatedAt = new Date().toISOString();
          this.planDrafts.set(project.id, draft);
          this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
          resolve({ ...draft });
        } catch (error) {
          draft.status = "failed";
          draft.errorMessage =
            error instanceof Error ? error.message : "Claude returned an unexpected result.";
          draft.lastUpdatedAt = new Date().toISOString();
          this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
          reject(error instanceof Error ? error : new Error("Claude returned an unexpected result."));
        }
      });

      child.on("error", (err) => {
        this.activeProcesses.delete(project.id);
        draft.status = "failed";
        draft.errorMessage = err.message;
        draft.lastUpdatedAt = new Date().toISOString();
        this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
        reject(err);
      });
    });
  }

  async executeApprovedPlan(project: Project, settings: Settings, draft: PlanDraft): Promise<ExecutionPayload> {
    const binaryPath = await this.requireBinaryPath(settings);
    const commandEnv = await getCommandEnv();

    return new Promise<ExecutionPayload>(async (resolve, reject) => {
      const prompt = await buildExecutionPrompt(project, draft);
      const args = [
        "-p", prompt,
        "--model", draft.claudeModel,
        "--max-turns", "20",
        "--output-format", "stream-json",
        "--allowedTools", "Edit,Write,Bash(npm install:*),Bash(npx:*),Read,Glob,Grep",
      ];

      const child = spawn(binaryPath, args, {
        cwd: project.localPath,
        env: commandEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcesses.set(project.id, child);
      const chunks: string[] = [];

      draft.status = "executing";
      draft.errorMessage = null;
      draft.lastUpdatedAt = new Date().toISOString();
      this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });

      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        chunks.push(line);
        this.handleStreamEvent(project.id, draft, line);
      });

      readline.createInterface({ input: child.stderr }).on("line", () => {
        // Drain stderr
      });

      child.on("exit", (code) => {
        this.activeProcesses.delete(project.id);

        if (code !== 0) {
          draft.status = "failed";
          draft.errorMessage = "Claude could not finish the update.";
          draft.lastUpdatedAt = new Date().toISOString();
          this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
          reject(new Error(draft.errorMessage));
          return;
        }

        try {
          const finalText = this.extractFinalResult(chunks);
          const parsed = executionResultSchema.parse(parseJsonFromText(finalText));
          const flowchartSnapshot = materializeFlowchartSnapshot(parsed.flowchartGraph);
          draft.status = "completed";
          draft.summary = parsed.summary;
          draft.finalText = finalText;
          draft.errorMessage = null;
          draft.lastUpdatedAt = new Date().toISOString();
          this.planDrafts.set(project.id, draft);
          this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
          resolve({
            draft: { ...draft },
            summary: parsed.summary,
            description: parsed.description,
            flowchart: flowchartSnapshot.flowchart,
            flowchartGraph: flowchartSnapshot.flowchartGraph,
            commitMessage: parsed.commitMessage,
          });
        } catch (error) {
          draft.status = "failed";
          draft.errorMessage =
            error instanceof Error ? error.message : "Claude returned an unexpected result.";
          draft.lastUpdatedAt = new Date().toISOString();
          this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
          reject(error instanceof Error ? error : new Error("Claude returned an unexpected result."));
        }
      });

      child.on("error", (err) => {
        this.activeProcesses.delete(project.id);
        draft.status = "failed";
        draft.errorMessage = err.message;
        draft.lastUpdatedAt = new Date().toISOString();
        this.emit({ type: "project.plan", projectId: project.id, plan: { ...draft } });
        reject(err);
      });
    });
  }

  async interruptPlan(projectId: string): Promise<void> {
    const child = this.activeProcesses.get(projectId);
    if (child) {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited
        }
      }, 3000);
      this.activeProcesses.delete(projectId);
    }
    this.clearPlan(projectId);
  }

  private handleStreamEvent(projectId: string, draft: PlanDraft, line: string): void {
    try {
      const event = JSON.parse(line) as { type?: string; content?: string; message?: { content?: string }; subtype?: string };
      if (event.type === "assistant" && event.content) {
        draft.explanation = event.content;
        draft.lastUpdatedAt = new Date().toISOString();
        this.emit({ type: "project.plan", projectId, plan: { ...draft } });
      } else if (event.type === "content_block_delta" || event.subtype === "text") {
        // Streaming text update
        const text = event.content || "";
        if (text) {
          draft.explanation = text;
          draft.lastUpdatedAt = new Date().toISOString();
          this.emit({ type: "project.plan", projectId, plan: { ...draft } });
        }
      }
    } catch {
      // Not JSON or unexpected format — ignore
    }
  }

  private extractFinalResult(chunks: string[]): string {
    // Walk backward through stream events to find the final result message
    for (let i = chunks.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(chunks[i]) as { type?: string; result?: string; content?: string; message?: { content?: string } };
        // stream-json format: look for the result event
        if (event.type === "result" && event.result) {
          return event.result;
        }
        // Fallback: look for assistant message content containing JSON
        const text = event.content || event.message?.content || "";
        if (text && (text.includes('"summary"') || text.includes('"flowchartGraph"'))) {
          return text;
        }
      } catch {
        // Not JSON
        const raw = chunks[i].trim();
        if (raw && (raw.includes('"summary"') || raw.includes('"flowchartGraph"'))) {
          return raw;
        }
      }
    }

    // Last resort: concatenate all non-event text
    throw new Error("Claude did not return a valid result.");
  }

  private async detectBinaryPath(settings: Settings): Promise<string | null> {
    if (settings.claudeBinaryPath && (await this.isExecutable(settings.claudeBinaryPath))) {
      return settings.claudeBinaryPath;
    }

    // Check PATH
    const result = await execCommand("command -v claude", process.cwd());
    const pathBinary = result.stdout.trim();
    if (result.code === 0 && pathBinary && (await this.isExecutable(pathBinary))) {
      return pathBinary;
    }

    // Check common npm global locations
    const candidates = [
      "/usr/local/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
      `${process.env.HOME}/.npm-global/bin/claude`,
    ];
    for (const candidate of candidates) {
      if (await this.isExecutable(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async isExecutable(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async requireBinaryPath(settings: Settings): Promise<string> {
    const binaryPath = await this.detectBinaryPath(settings);
    if (!binaryPath) {
      throw new Error("Install Claude Code CLI before using Claude in PROGRAMS. Run: npm install -g @anthropic-ai/claude-code");
    }
    return binaryPath;
  }

  private async readStatsCache(): Promise<ClaudeStatsCache | null> {
    if (!process.env.HOME) {
      return null;
    }

    try {
      const raw = await readFile(join(process.env.HOME, ".claude", "stats-cache.json"), "utf8");
      const parsed = claudeStatsCacheSchema.parse(JSON.parse(raw));
      if (
        parsed.dailyActivity.length === 0 &&
        parsed.dailyModelTokens.length === 0 &&
        parsed.totalSessions === 0 &&
        parsed.totalMessages === 0
      ) {
        return null;
      }

      return {
        lastComputedDate: parsed.lastComputedDate,
        dailyActivity: parsed.dailyActivity.sort((left, right) => left.date.localeCompare(right.date)),
        dailyModelTokens: parsed.dailyModelTokens.sort((left, right) => left.date.localeCompare(right.date)),
        totalSessions: parsed.totalSessions,
        totalMessages: parsed.totalMessages,
        firstSessionDate: parsed.firstSessionDate ?? null,
      };
    } catch {
      return null;
    }
  }
}

const parseJsonFromText = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const stripped = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(stripped);
  }

  return JSON.parse(trimmed);
};
