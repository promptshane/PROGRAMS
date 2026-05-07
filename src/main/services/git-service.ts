import { spawn } from "node:child_process";
import { join } from "node:path";
import * as readline from "node:readline";
import { ensureDirectory, pathExists } from "../utils/fs.ts";
import { execCommand, getCommandEnv } from "../utils/process.ts";
import type { DiffStats, GithubAuthStatus } from "@shared/types";

export interface GitRepositoryInfo {
  isRepo: boolean;
}

export type GitInstallRequestResult = "alreadyAvailable" | "requested" | "manualDownload";

export class GitService {
  async readWorkingTreeDiffStats(localPath: string): Promise<DiffStats | null> {
    const result = await execCommand("git diff --numstat", localPath);
    if (result.code !== 0) {
      return null;
    }

    let added = 0;
    let removed = 0;
    let sawTextDiff = false;

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const [addedRaw, removedRaw] = trimmed.split("\t");
      if (!addedRaw || !removedRaw || addedRaw === "-" || removedRaw === "-") {
        continue;
      }

      const nextAdded = Number(addedRaw);
      const nextRemoved = Number(removedRaw);
      if (!Number.isFinite(nextAdded) || !Number.isFinite(nextRemoved)) {
        continue;
      }

      added += nextAdded;
      removed += nextRemoved;
      sawTextDiff = true;
    }

    return sawTextDiff ? { added, removed } : null;
  }

  async readWorkingTreeChangedFiles(localPath: string): Promise<string[]> {
    const result = await execCommand("git status --short --untracked-files=all", localPath);
    if (result.code !== 0) {
      return [];
    }

    const files = new Set<string>();
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let filePath = line.slice(3).trim();
      if (!filePath) {
        continue;
      }
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").at(-1)?.trim() ?? filePath;
      }
      if (filePath.startsWith("\"") && filePath.endsWith("\"")) {
        filePath = filePath.slice(1, -1);
      }
      if (filePath) {
        files.add(filePath);
      }
    }

    return [...files];
  }

  async isAvailable(): Promise<boolean> {
    const result = await execCommand("git --version", process.cwd());
    return result.code === 0;
  }

  async getVersion(): Promise<string | null> {
    const result = await execCommand("git --version", process.cwd());
    return result.code === 0 ? result.stdout.trim() : null;
  }

  async promptInstall(): Promise<GitInstallRequestResult> {
    if (await this.isAvailable()) {
      return "alreadyAvailable";
    }

    const result = await execCommand("xcode-select --install", process.cwd());
    const output = `${result.stdout}
${result.stderr}`.toLowerCase();
    if (result.code === 0 || output.includes("install requested")) {
      return "requested";
    }

    if (output.includes("already installed") || output.includes("command line developer tools are already installed")) {
      return "alreadyAvailable";
    }

    return "manualDownload";
  }

  async inspectRepository(localPath: string): Promise<GitRepositoryInfo> {
    const repoCheck = await execCommand("git rev-parse --is-inside-work-tree", localPath);
    if (repoCheck.code !== 0) {
      return {
        isRepo: false,
      };
    }

    return {
      isRepo: true,
    };
  }

  async initializeRepository(localPath: string, defaultBranch = "main"): Promise<void> {
    await ensureDirectory(localPath);
    const initResult = await execCommand(`git init -b ${defaultBranch}`, localPath);
    if (initResult.code !== 0) {
      throw new Error(initResult.stderr || "Could not initialize the local Git repository.");
    }
  }

  async hasUncommittedChanges(localPath: string): Promise<boolean> {
    const result = await execCommand("git status --porcelain", localPath);
    return result.stdout.trim().length > 0;
  }

  async commitAll(localPath: string, message: string): Promise<string | null> {
    const addResult = await execCommand("git add -A", localPath);
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr || "Could not prepare the update.");
    }

    const statusResult = await execCommand("git status --porcelain", localPath);
    if (!statusResult.stdout.trim()) {
      return null;
    }

    const commitResult = await execCommand(
      `git commit -m "${message.replace(/"/g, '\\"')}"`,
      localPath,
    );
    if (commitResult.code !== 0) {
      throw new Error(commitResult.stderr || "Could not save the update history.");
    }

    const shaResult = await execCommand("git rev-parse HEAD", localPath);
    if (shaResult.code !== 0) {
      throw new Error("The update was saved, but the version ID could not be read.");
    }

    return shaResult.stdout.trim();
  }

  async hasCommit(localPath: string): Promise<boolean> {
    const result = await execCommand("git rev-parse --verify HEAD", localPath);
    return result.code === 0;
  }

  async getCurrentBranch(localPath: string): Promise<string | null> {
    const result = await execCommand("git branch --show-current", localPath);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  async revertCommit(localPath: string, commitSha: string): Promise<string> {
    const revertResult = await execCommand(`git revert --no-edit ${commitSha}`, localPath);
    if (revertResult.code !== 0) {
      throw new Error(revertResult.stderr || "Could not undo this update cleanly.");
    }

    const shaResult = await execCommand("git rev-parse HEAD", localPath);
    if (shaResult.code !== 0) {
      throw new Error("The undo completed, but the new version ID could not be read.");
    }

    return shaResult.stdout.trim();
  }

  async ensureRepository(localPath: string, defaultBranch = "main"): Promise<void> {
    if (!(await pathExists(join(localPath, ".git")))) {
      await this.initializeRepository(localPath, defaultBranch);
    }
  }

  async getGithubStatus(): Promise<GithubAuthStatus> {
    const versionResult = await execCommand("gh --version", process.cwd());
    if (versionResult.code !== 0) {
      return { available: false, loggedIn: false, username: null, tokenSource: null, scopes: null, version: null, errorMessage: null };
    }
    const version = versionResult.stdout.split("\n")[0]?.trim() ?? null;

    const statusResult = await execCommand("gh auth status --json hosts", process.cwd());
    if (statusResult.code !== 0) {
      return { available: true, loggedIn: false, username: null, tokenSource: null, scopes: null, version, errorMessage: null };
    }

    try {
      const parsed = JSON.parse(statusResult.stdout) as {
        hosts?: Record<string, Array<{ state: string; active: boolean; login: string; tokenSource: string; scopes: string }>>;
      };
      const accounts = parsed.hosts?.["github.com"] ?? [];
      const active = accounts.find((a) => a.active) ?? accounts[0] ?? null;
      if (!active || active.state !== "success") {
        return { available: true, loggedIn: false, username: null, tokenSource: null, scopes: null, version, errorMessage: null };
      }
      return { available: true, loggedIn: true, username: active.login, tokenSource: active.tokenSource, scopes: active.scopes, version, errorMessage: null };
    } catch {
      return { available: true, loggedIn: false, username: null, tokenSource: null, scopes: null, version, errorMessage: "Could not parse gh auth status." };
    }
  }

  async loginGithub(openExternal: (url: string) => Promise<void>): Promise<GithubAuthStatus> {
    const commandEnv = await getCommandEnv();
    const child = spawn("gh", ["auth", "login", "--web", "--git-protocol", "https"], {
      env: commandEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Write Enter to confirm the "Press Enter to open..." prompt
    child.stdin.write("\n");

    const urlPattern = /https?:\/\/github\.com\/[^\s]+/;
    let urlOpened = false;

    const processLine = (line: string): void => {
      if (!urlOpened) {
        const match = line.match(urlPattern);
        if (match) {
          urlOpened = true;
          void openExternal(match[0]);
        }
      }
    };

    readline.createInterface({ input: child.stdout }).on("line", processLine);
    readline.createInterface({ input: child.stderr }).on("line", processLine);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("GitHub sign-in timed out. Try again."));
      }, 120_000);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("GitHub sign-in failed. Try again."));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    return this.getGithubStatus();
  }

  async logoutGithub(): Promise<GithubAuthStatus> {
    const status = await this.getGithubStatus();
    if (!status.available || !status.loggedIn || !status.username) {
      return status;
    }
    await execCommand(`gh auth logout --hostname github.com --user ${status.username}`, process.cwd());
    return this.getGithubStatus();
  }

  async getRemoteOriginUrl(localPath: string): Promise<string | null> {
    const result = await execCommand("git remote get-url origin", localPath);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  async createAndPushToGithub(localPath: string, repoName: string, isPrivate: boolean): Promise<string> {
    const hasCommits = await this.hasCommit(localPath);
    if (!hasCommits) {
      throw new Error("Cannot publish to GitHub — the project has no commits yet.");
    }
    const visibility = isPrivate ? "--private" : "--public";
    const result = await execCommand(
      `gh repo create "${repoName}" --source=. ${visibility} --push --remote=origin`,
      localPath,
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "Could not publish to GitHub.");
    }
    const remoteUrl = await this.getRemoteOriginUrl(localPath);
    if (!remoteUrl) {
      throw new Error("Repository created but remote URL could not be read.");
    }
    return remoteUrl;
  }

  async pushToExistingGithub(localPath: string): Promise<void> {
    const result = await execCommand("git push -u origin HEAD", localPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Could not push to GitHub.");
    }
  }

  async getDiffStatsSinceCommit(localPath: string, fromSha: string): Promise<DiffStats | null> {
    const result = await execCommand(`git log --numstat ${fromSha}..HEAD`, localPath);
    if (result.code !== 0) {
      return null;
    }

    let added = 0;
    let removed = 0;
    let sawTextDiff = false;

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parts = trimmed.split("\t");
      if (parts.length < 2) {
        continue;
      }
      const [addedRaw, removedRaw] = parts;
      if (!addedRaw || !removedRaw || addedRaw === "-" || removedRaw === "-") {
        continue;
      }
      const nextAdded = Number(addedRaw);
      const nextRemoved = Number(removedRaw);
      if (!Number.isFinite(nextAdded) || !Number.isFinite(nextRemoved)) {
        continue;
      }
      added += nextAdded;
      removed += nextRemoved;
      sawTextDiff = true;
    }

    return sawTextDiff ? { added, removed } : null;
  }

  async getUnpushedCommitStats(localPath: string): Promise<DiffStats | null> {
    const result = await execCommand("git log --numstat @{u}..HEAD", localPath);
    if (result.code !== 0 || !result.stdout.trim()) {
      return null;
    }

    let added = 0;
    let removed = 0;
    let sawTextDiff = false;

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("\t");
      if (parts.length < 2) continue;
      const [addedRaw, removedRaw] = parts;
      if (!addedRaw || !removedRaw || addedRaw === "-" || removedRaw === "-") continue;
      const nextAdded = Number(addedRaw);
      const nextRemoved = Number(removedRaw);
      if (!Number.isFinite(nextAdded) || !Number.isFinite(nextRemoved)) continue;
      added += nextAdded;
      removed += nextRemoved;
      sawTextDiff = true;
    }

    return sawTextDiff ? { added, removed } : null;
  }

  async getHeadCommitSha(localPath: string): Promise<string | null> {
    const result = await execCommand("git rev-parse HEAD", localPath);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }
}
