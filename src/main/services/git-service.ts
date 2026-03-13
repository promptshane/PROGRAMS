import { dirname, join } from "node:path";
import { ensureDirectory, pathExists } from "@main/utils/fs";
import { execCommand } from "@main/utils/process";
import type { DiffStats } from "@shared/types";

export interface GitRemoteInfo {
  isRepo: boolean;
  remoteUrl: string | null;
  defaultBranch: string;
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

  async inspectRepository(localPath: string): Promise<GitRemoteInfo> {
    const repoCheck = await execCommand("git rev-parse --is-inside-work-tree", localPath);
    if (repoCheck.code !== 0) {
      return {
        isRepo: false,
        remoteUrl: null,
        defaultBranch: "main",
      };
    }

    const remoteResult = await execCommand("git remote get-url origin", localPath);
    const remoteUrl = remoteResult.code === 0 ? remoteResult.stdout.trim() : null;
    const branchResult = await execCommand(
      "git symbolic-ref refs/remotes/origin/HEAD --short",
      localPath,
    );
    const currentBranchResult = await execCommand("git branch --show-current", localPath);
    const defaultBranch =
      branchResult.code === 0 && branchResult.stdout.trim()
        ? branchResult.stdout.trim().split("/").pop() ?? "main"
        : currentBranchResult.code === 0 && currentBranchResult.stdout.trim()
          ? currentBranchResult.stdout.trim()
        : "main";

    return {
      isRepo: true,
      remoteUrl,
      defaultBranch,
    };
  }

  async initializeRepository(localPath: string, defaultBranch = "main"): Promise<void> {
    await ensureDirectory(localPath);
    const initResult = await execCommand(`git init -b ${defaultBranch}`, localPath);
    if (initResult.code !== 0) {
      throw new Error(initResult.stderr || "Could not initialize the local Git repository.");
    }
  }

  async configureRemote(localPath: string, remoteUrl: string): Promise<void> {
    const currentRemote = await execCommand("git remote get-url origin", localPath);
    if (currentRemote.code === 0) {
      const setResult = await execCommand(`git remote set-url origin "${remoteUrl}"`, localPath);
      if (setResult.code !== 0) {
        throw new Error(setResult.stderr || "Could not update the GitHub connection.");
      }
      return;
    }

    const addResult = await execCommand(`git remote add origin "${remoteUrl}"`, localPath);
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr || "Could not connect the project to GitHub.");
    }
  }

  async cloneRepository(remoteUrl: string, localPath: string): Promise<void> {
    await ensureDirectory(dirname(localPath));
    const cloneResult = await execCommand(`git clone "${remoteUrl}" "${localPath}"`, process.cwd());
    if (cloneResult.code !== 0) {
      throw new Error(cloneResult.stderr || "Could not download the latest project from GitHub.");
    }
  }

  async hasRemoteBranch(localPath: string, branch: string): Promise<boolean> {
    const result = await execCommand(`git ls-remote --heads origin ${branch}`, localPath);
    return result.code === 0 && result.stdout.trim().length > 0;
  }

  async fetch(localPath: string): Promise<void> {
    const result = await execCommand("git fetch origin", localPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Could not check GitHub for the latest version.");
    }
  }

  async hasUncommittedChanges(localPath: string): Promise<boolean> {
    const result = await execCommand("git status --porcelain", localPath);
    return result.stdout.trim().length > 0;
  }

  async fastForward(localPath: string, branch: string): Promise<void> {
    const hasBranch = await this.hasRemoteBranch(localPath, branch);
    if (!hasBranch) {
      return;
    }

    const checkoutResult = await execCommand(`git checkout ${branch}`, localPath);
    if (checkoutResult.code !== 0) {
      throw new Error(checkoutResult.stderr || `Could not switch to ${branch}.`);
    }

    const mergeResult = await execCommand(`git merge --ff-only origin/${branch}`, localPath);
    if (mergeResult.code !== 0) {
      throw new Error(mergeResult.stderr || "Could not fast-forward to the latest GitHub version.");
    }
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

  async push(localPath: string, branch: string): Promise<void> {
    const result = await execCommand(`git push -u origin ${branch}`, localPath);
    if (result.code !== 0) {
      throw new Error(result.stderr || "Could not sync this update to GitHub.");
    }
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

  async ensureRepository(localPath: string, remoteUrl: string | null, defaultBranch: string): Promise<void> {
    if (!(await pathExists(join(localPath, ".git")))) {
      if (remoteUrl) {
        if (!(await pathExists(localPath))) {
          await this.cloneRepository(remoteUrl, localPath);
          return;
        }

        await this.initializeRepository(localPath, defaultBranch);
        await this.configureRemote(localPath, remoteUrl);
        return;
      }

      await this.initializeRepository(localPath, defaultBranch);
      return;
    }

    if (remoteUrl) {
      await this.configureRemote(localPath, remoteUrl);
    }
  }
}
