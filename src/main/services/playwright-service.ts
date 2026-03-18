import { randomUUID } from "node:crypto";
import { app } from "electron";
import { join } from "node:path";
import type { PlaywrightAction, PlaywrightRunResult } from "@shared/types";
import { ensureDirectory, pathExists, readTextFile } from "@main/utils/fs";
import { execFileCommand } from "@main/utils/process";

export class PlaywrightService {
  getRunnerScriptPath(): string {
    return join(app.getAppPath(), "scripts", "programs-playwright-runner.mjs");
  }

  async run(input: {
    projectId: string;
    cwd: string;
    url: string;
    actions: PlaywrightAction[];
    headless: boolean;
    settleMs: number;
  }): Promise<PlaywrightRunResult> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const outputDir = join(app.getPath("userData"), "playwright-runs", input.projectId, runId);
    await ensureDirectory(outputDir);

    const scriptPath = this.getRunnerScriptPath();
    if (!(await pathExists(scriptPath))) {
      throw new Error(`PROGRAMS could not find its Playwright runner at ${scriptPath}.`);
    }

    const result = await execFileCommand(
      process.execPath,
      [scriptPath, "--url", input.url, "--output-dir", outputDir, "--actions-json", JSON.stringify(input.actions), "--settle-ms", String(input.settleMs), ...(input.headless ? [] : ["--headed"])],
      input.cwd,
      {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    );

    const completedAt = new Date().toISOString();
    const screenshots = await this.readFileList(outputDir, "screenshots.json");
    const consoleMessages = await this.readFileList(outputDir, "console.json");
    const pageErrors = await this.readFileList(outputDir, "page-errors.json");
    const textSnapshot = await readTextFile(join(outputDir, "text-snapshot.txt"), "");
    const renderGameText = await readTextFile(join(outputDir, "render-game-to-text.txt"), "");

    return {
      runId,
      projectId: input.projectId,
      url: input.url,
      outputDir,
      screenshots,
      consoleMessages,
      pageErrors,
      textSnapshot: textSnapshot || null,
      renderGameText: renderGameText || null,
      startedAt,
      completedAt,
      success: result.code === 0,
      errorMessage: result.code === 0 ? null : result.stderr.trim() || result.stdout.trim() || "Playwright run failed.",
    };
  }

  private async readFileList(outputDir: string, fileName: string): Promise<string[]> {
    const filePath = join(outputDir, fileName);
    const raw = await readTextFile(filePath, "[]");
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }
}
