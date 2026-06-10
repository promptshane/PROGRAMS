import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { GitService } from "../src/main/services/git-service.ts";
import { execFileCommand } from "../src/main/utils/process.ts";

const runGit = async (cwd: string, args: string[]): Promise<string> => {
  const result = await execFileCommand("git", args, cwd);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

const configureUser = async (cwd: string): Promise<void> => {
  await runGit(cwd, ["config", "user.email", "test@example.com"]);
  await runGit(cwd, ["config", "user.name", "PROGRAMS Test"]);
};

const commitAll = async (cwd: string, message: string): Promise<string> => {
  await runGit(cwd, ["add", "-A"]);
  await runGit(cwd, ["commit", "-m", message]);
  return runGit(cwd, ["rev-parse", "HEAD"]);
};

const createRemoteFixture = async (
  t: { after: (fn: () => Promise<void>) => void },
  branch = "main",
): Promise<{ root: string; remote: string; source: string; local: string }> => {
  const root = await mkdtemp(join(tmpdir(), "programs-git-download-test-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const remote = join(root, "remote.git");
  const source = join(root, "source");
  const local = join(root, "local");

  await runGit(root, ["init", "--bare", "--initial-branch", branch, remote]);
  await mkdir(source, { recursive: true });
  await runGit(source, ["init", "--initial-branch", branch]);
  await configureUser(source);
  await writeFile(join(source, ".gitignore"), ".env\nnode_modules/\n", "utf8");
  await writeFile(join(source, "app.txt"), "remote v1\n", "utf8");
  await commitAll(source, "Initial remote version");
  await runGit(source, ["remote", "add", "origin", remote]);
  await runGit(source, ["push", "-u", "origin", branch]);
  await runGit(root, ["clone", "--branch", branch, remote, local]);
  await configureUser(local);

  return { root, remote, source, local };
};

test("downloadFromGithub replaces tracked files, removes local-only files, and preserves ignored files", async (t) => {
  const { source, local } = await createRemoteFixture(t);
  const service = new GitService();

  await writeFile(join(source, "app.txt"), "remote v2\n", "utf8");
  const remoteSha = await commitAll(source, "Remote update");
  await runGit(source, ["push", "origin", "main"]);

  await writeFile(join(local, "app.txt"), "local v2\n", "utf8");
  await writeFile(join(local, "local-only.txt"), "delete me\n", "utf8");
  await writeFile(join(local, ".env"), "keep me\n", "utf8");

  const result = await service.downloadFromGithub(local);

  assert.equal(result.status, "downloaded");
  assert.equal(result.commitSha, remoteSha);
  assert.equal(await readFile(join(local, "app.txt"), "utf8"), "remote v2\n");
  assert.equal(existsSync(join(local, "local-only.txt")), false);
  assert.equal(await readFile(join(local, ".env"), "utf8"), "keep me\n");
  assert.equal(await runGit(local, ["status", "--porcelain", "--untracked-files=all"]), "");
});

test("downloadFromGithub returns up-to-date for a clean repo matching origin", async (t) => {
  const { local } = await createRemoteFixture(t);
  const service = new GitService();

  const remoteSha = await runGit(local, ["rev-parse", "HEAD"]);
  const result = await service.downloadFromGithub(local);

  assert.equal(result.status, "up-to-date");
  assert.equal(result.commitSha, remoteSha);
  assert.equal(await runGit(local, ["status", "--porcelain", "--untracked-files=all"]), "");
});

test("downloadFromGithub falls back to the remote default branch when no upstream exists", async (t) => {
  const { root, remote } = await createRemoteFixture(t, "trunk");
  const local = join(root, "local-no-upstream");
  const service = new GitService();

  await mkdir(local, { recursive: true });
  await runGit(local, ["init", "--initial-branch", "scratch"]);
  await runGit(local, ["remote", "add", "origin", remote]);

  const result = await service.downloadFromGithub(local);

  assert.equal(result.status, "downloaded");
  assert.equal(result.remoteBranch, "trunk");
  assert.equal(await readFile(join(local, "app.txt"), "utf8"), "remote v1\n");
  assert.equal(await runGit(local, ["branch", "--show-current"]), "trunk");
});
