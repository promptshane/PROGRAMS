import { spawn } from "node:child_process";
import { join } from "node:path";
import * as readline from "node:readline";
import { ensureDirectory, pathExists } from "../utils/fs.ts";
import { execCommand, execFileCommand, getCommandEnv } from "../utils/process.ts";
import type { DiffStats, GithubAuthStatus } from "@shared/types";

export interface GitRepositoryInfo {
  isRepo: boolean;
}

export interface GithubDownloadResult {
  status: "downloaded" | "up-to-date";
  remoteRef: string;
  remoteBranch: string | null;
  commitSha: string;
}

export type GitInstallRequestResult = "alreadyAvailable" | "requested" | "manualDownload";

interface CommandResultLike {
  code: number;
  stdout: string;
  stderr: string;
}

const readCommandErrorMessage = (stdout: string, stderr: string, fallback: string): string => {
  const message = stderr.trim() || stdout.trim();
  return message || fallback;
};

export const parseGithubAuthStatusResult = (
  statusResult: CommandResultLike,
  version: string | null,
): GithubAuthStatus => {
  if (statusResult.code !== 0) {
    return {
      available: true,
      loggedIn: false,
      username: null,
      tokenSource: null,
      scopes: null,
      version,
      errorMessage: readCommandErrorMessage(statusResult.stdout, statusResult.stderr, "GitHub auth status failed."),
    };
  }

  try {
    const parsed = JSON.parse(statusResult.stdout) as {
      hosts?: Record<string, Array<{
        state?: string;
        active?: boolean;
        login?: string;
        tokenSource?: string;
        scopes?: string;
        error?: string;
      }>>;
    };
    const accounts = parsed.hosts?.["github.com"] ?? [];
    const active = accounts.find((a) => a.active) ?? accounts[0] ?? null;
    if (!active || active.state !== "success") {
      return {
        available: true,
        loggedIn: false,
        username: active?.login ?? null,
        tokenSource: active?.tokenSource ?? null,
        scopes: active?.scopes ?? null,
        version,
        errorMessage: active?.error?.trim() || null,
      };
    }

    return {
      available: true,
      loggedIn: true,
      username: active.login ?? null,
      tokenSource: active.tokenSource ?? null,
      scopes: active.scopes ?? null,
      version,
      errorMessage: null,
    };
  } catch {
    return {
      available: true,
      loggedIn: false,
      username: null,
      tokenSource: null,
      scopes: null,
      version,
      errorMessage: "Could not parse gh auth status.",
    };
  }
};

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

  async stageAll(localPath: string): Promise<void> {
    const addResult = await execCommand("git add -A", localPath);
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr || "Could not prepare the update.");
    }
  }

  async getStagedDiffSummary(
    localPath: string,
  ): Promise<{ files: number; added: number; removed: number } | null> {
    const result = await execCommand("git diff --cached --numstat", localPath);
    if (result.code !== 0) {
      return null;
    }

    let files = 0;
    let added = 0;
    let removed = 0;

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
      files += 1;
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
    }

    return files > 0 ? { files, added, removed } : null;
  }

  async commitAll(localPath: string, message: string): Promise<string | null> {
    await this.stageAll(localPath);

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

  async previewCommit(localPath: string, commitSha: string): Promise<{ previewedSha: string; headShaBeforePreview: string }> {
    const headResult = await execCommand("git rev-parse HEAD", localPath);
    if (headResult.code !== 0) {
      throw new Error("Could not read the current HEAD commit.");
    }
    const headSha = headResult.stdout.trim();

    const stashResult = await execCommand(
      `git stash push --include-untracked -m "programs-preview-stash"`,
      localPath,
    );
    if (stashResult.code !== 0) {
      throw new Error(stashResult.stderr || "Could not stash current changes before preview.");
    }

    const checkoutResult = await execCommand(`git checkout ${commitSha} -- .`, localPath);
    if (checkoutResult.code !== 0) {
      await execCommand("git stash pop", localPath).catch(() => undefined);
      throw new Error(checkoutResult.stderr || "Could not apply the old version to the working tree.");
    }

    return { previewedSha: commitSha, headShaBeforePreview: headSha };
  }

  async restoreFromPreview(localPath: string): Promise<void> {
    const checkoutResult = await execCommand("git checkout HEAD -- .", localPath);
    if (checkoutResult.code !== 0) {
      throw new Error(checkoutResult.stderr || "Could not restore files to current HEAD.");
    }

    const stashListResult = await execCommand("git stash list", localPath);
    const hasStash =
      stashListResult.code === 0 &&
      stashListResult.stdout.includes("programs-preview-stash");

    if (hasStash) {
      const popResult = await execCommand("git stash pop", localPath);
      if (popResult.code !== 0) {
        throw new Error(popResult.stderr || "Could not restore stashed changes.");
      }
    }
  }

  async ensureRepository(localPath: string, defaultBranch = "main"): Promise<void> {
    if (!(await pathExists(join(localPath, ".git")))) {
      await this.initializeRepository(localPath, defaultBranch);
    }
  }

  async pullFromRemote(localPath: string): Promise<void> {
    const remoteUrl = await this.getRemoteOriginUrl(localPath);
    if (!remoteUrl) return;
    await execCommand("git pull", localPath);
  }

  private async readRemoteCommitSha(localPath: string, remoteRef: string): Promise<string | null> {
    const result = await execFileCommand("git", ["rev-parse", "--verify", `${remoteRef}^{commit}`], localPath);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  private async readUpstreamRemoteRef(localPath: string): Promise<string | null> {
    const result = await execFileCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      localPath,
    );
    const upstream = result.code === 0 ? result.stdout.trim() : "";
    return upstream.startsWith("origin/") ? upstream : null;
  }

  private async readOriginHeadRemoteRef(localPath: string): Promise<string | null> {
    const result = await execFileCommand("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], localPath);
    const ref = result.code === 0 ? result.stdout.trim() : "";
    return ref.startsWith("refs/remotes/origin/")
      ? `origin/${ref.slice("refs/remotes/origin/".length)}`
      : null;
  }

  private async readOriginDefaultRemoteRef(localPath: string): Promise<string | null> {
    const result = await execFileCommand("git", ["remote", "show", "origin"], localPath);
    if (result.code !== 0) {
      return null;
    }
    const match = result.stdout.match(/HEAD branch:\s*(\S+)/);
    const branch = match?.[1];
    return branch && branch !== "(unknown)" ? `origin/${branch}` : null;
  }

  private async resolveGithubDownloadTarget(
    localPath: string,
  ): Promise<{ remoteRef: string; remoteBranch: string | null; commitSha: string }> {
    const candidates = [
      await this.readUpstreamRemoteRef(localPath),
      await this.readOriginHeadRemoteRef(localPath),
      await this.readOriginDefaultRemoteRef(localPath),
      "origin/main",
      "origin/master",
    ];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);

      const commitSha = await this.readRemoteCommitSha(localPath, candidate);
      if (commitSha) {
        return {
          remoteRef: candidate,
          remoteBranch: candidate.startsWith("origin/") ? candidate.slice("origin/".length) : null,
          commitSha,
        };
      }
    }

    throw new Error("Could not find a GitHub branch to download. Check that the repository has a main branch.");
  }

  async previewGithubDownload(localPath: string): Promise<GithubDownloadResult> {
    const remoteUrl = await this.getRemoteOriginUrl(localPath);
    if (!remoteUrl) {
      throw new Error("No remote is configured for this project.");
    }

    const fetchResult = await execFileCommand("git", ["fetch", "--prune", "origin"], localPath);
    if (fetchResult.code !== 0) {
      throw new Error(fetchResult.stderr || "Could not download the latest GitHub code.");
    }

    const target = await this.resolveGithubDownloadTarget(localPath);
    const headSha = await this.getHeadCommitSha(localPath);
    const hasLocalChanges = await this.hasUncommittedChanges(localPath);
    if (headSha === target.commitSha && !hasLocalChanges) {
      return {
        ...target,
        status: "up-to-date",
      };
    }

    return {
      ...target,
      status: "downloaded",
    };
  }

  async downloadFromGithub(localPath: string, plannedDownload?: GithubDownloadResult): Promise<GithubDownloadResult> {
    const target = plannedDownload ?? await this.previewGithubDownload(localPath);
    if (target.status === "up-to-date") {
      return target;
    }

    const resetResult = await execFileCommand("git", ["reset", "--hard", target.remoteRef], localPath);
    if (resetResult.code !== 0) {
      throw new Error(resetResult.stderr || "Could not replace local files with the GitHub version.");
    }

    const cleanResult = await execFileCommand("git", ["clean", "-fd"], localPath);
    if (cleanResult.code !== 0) {
      throw new Error(cleanResult.stderr || "Could not remove local-only files after downloading from GitHub.");
    }

    if (target.remoteBranch) {
      const checkoutResult = await execFileCommand("git", ["checkout", "-B", target.remoteBranch, target.remoteRef], localPath);
      if (checkoutResult.code !== 0) {
        throw new Error(checkoutResult.stderr || "Downloaded from GitHub, but could not switch to the downloaded branch.");
      }
      await execFileCommand("git", ["branch", "--set-upstream-to", target.remoteRef, target.remoteBranch], localPath);
    }

    return {
      ...target,
      status: "downloaded",
    };
  }

  async setupGitCredentialHelper(): Promise<void> {
    await execCommand("gh auth setup-git", process.cwd());
  }

  async getGithubStatus(): Promise<GithubAuthStatus> {
    const versionResult = await execCommand("gh --version", process.cwd());
    if (versionResult.code !== 0) {
      return {
        available: false,
        loggedIn: false,
        username: null,
        tokenSource: null,
        scopes: null,
        version: null,
        errorMessage: readCommandErrorMessage(versionResult.stdout, versionResult.stderr, "GitHub CLI is not installed."),
      };
    }
    const version = versionResult.stdout.split("\n")[0]?.trim() ?? null;

    const statusResult = await execCommand("gh auth status --json hosts", process.cwd());
    return parseGithubAuthStatusResult(statusResult, version);
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

    await this.setupGitCredentialHelper();
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
    if (result.code === 0) {
      return;
    }

    const looksBehind = /\b(rejected|non-fast-forward|fetch first|behind)\b/i.test(
      result.stderr,
    );
    if (!looksBehind) {
      throw new Error(result.stderr || "Could not push to GitHub.");
    }

    const rebaseResult = await execCommand("git pull --rebase", localPath);
    if (rebaseResult.code !== 0) {
      await execCommand("git rebase --abort", localPath);
      throw new Error(
        "Could not save: the remote has changes that conflict with yours. Resolve them in your editor and try again.",
      );
    }

    const retry = await execCommand("git push -u origin HEAD", localPath);
    if (retry.code !== 0) {
      throw new Error(retry.stderr || "Could not push to GitHub after rebase.");
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
