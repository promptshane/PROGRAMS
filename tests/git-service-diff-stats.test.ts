import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { GitService, countDiffAddedLines } from "../src/main/services/git-service.ts";
import { execFileCommand } from "../src/main/utils/process.ts";

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await execFileCommand("git", args, cwd);
  assert.equal(result.code, 0, result.stderr || result.stdout);
};

const createRepo = async (t: { after: (fn: () => Promise<void>) => void }): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "programs-diff-stats-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  await runGit(dir, ["init", "--initial-branch", "main"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "user.name", "PROGRAMS Test"]);
  return dir;
};

test("countDiffAddedLines matches git's line-add accounting for new files", () => {
  assert.equal(countDiffAddedLines(""), 0);
  assert.equal(countDiffAddedLines("a\nb\nc\n"), 3);
  assert.equal(countDiffAddedLines("a\nb\nc"), 3); // no trailing newline
  assert.equal(countDiffAddedLines("solo"), 1);
  assert.equal(countDiffAddedLines("\n"), 1);
});

test("readWorkingTreeDiffStats counts brand-new untracked files", async (t) => {
  const git = new GitService();
  const dir = await createRepo(t);

  // Commit a baseline tracked file so the repo has history.
  await writeFile(join(dir, "tracked.txt"), "one\ntwo\n", "utf8");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "baseline"]);

  // Modify the tracked file (+1 / -1) and add a brand-new untracked file (+3).
  await writeFile(join(dir, "tracked.txt"), "one\nTWO-CHANGED\n", "utf8");
  await writeFile(join(dir, "fresh.txt"), "a\nb\nc\n", "utf8");

  const stats = await git.readWorkingTreeDiffStats(dir);
  assert.ok(stats, "expected diff stats");
  assert.equal(stats?.added, 4); // 1 from modified tracked + 3 from new untracked
  assert.equal(stats?.removed, 1);
});

test("readWorkingTreeDiffStats reports new-file-only changes that git diff would miss", async (t) => {
  const git = new GitService();
  const dir = await createRepo(t);

  await writeFile(join(dir, "tracked.txt"), "unchanged\n", "utf8");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "baseline"]);

  // Only change is a new file — `git diff --numstat` alone would return nothing.
  await writeFile(join(dir, "added.txt"), "x\ny\n", "utf8");

  const stats = await git.readWorkingTreeDiffStats(dir);
  assert.ok(stats, "new untracked files must surface in diff stats");
  assert.equal(stats?.added, 2);
  assert.equal(stats?.removed, 0);
});

test("readWorkingTreeDiffStats skips ignored and binary untracked files", async (t) => {
  const git = new GitService();
  const dir = await createRepo(t);

  await writeFile(join(dir, ".gitignore"), "ignored.txt\n", "utf8");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "baseline"]);

  // Gitignored file must not be counted (exclude-standard).
  await writeFile(join(dir, "ignored.txt"), "skip\nme\nplease\n", "utf8");
  // Binary untracked file (contains NUL) must be skipped like git's "-" numstat.
  await writeFile(join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  // A normal new text file should still count.
  await writeFile(join(dir, "real.txt"), "line\n", "utf8");

  const stats = await git.readWorkingTreeDiffStats(dir);
  assert.ok(stats);
  assert.equal(stats?.added, 1); // only real.txt
  assert.equal(stats?.removed, 0);
});

test("untrackIgnoredFiles untracks already-committed ignored files but keeps them on disk", async (t) => {
  const git = new GitService();
  const dir = await createRepo(t);

  // Commit real source AND a node_modules tree before any .gitignore exists.
  await writeFile(join(dir, "index.js"), "console.log(1)\n", "utf8");
  await mkdir(join(dir, "node_modules", "left-pad"), { recursive: true });
  await writeFile(join(dir, "node_modules", "left-pad", "index.js"), "module.exports = 1\n", "utf8");
  await writeFile(join(dir, "dist.js"), "bundled\n", "utf8");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "baseline with artifacts"]);

  // Add ignore rules, then run the cleanup.
  await writeFile(join(dir, ".gitignore"), "node_modules/\ndist.js\n", "utf8");
  const count = await git.untrackIgnoredFiles(dir);
  assert.equal(count, 2); // node_modules/left-pad/index.js + dist.js

  await git.commitStaged(dir, "Stop tracking 2 generated files (node_modules, build output)");

  // The ignored files are untracked in git...
  const tracked = await execFileCommand("git", ["ls-files"], dir);
  assert.equal(tracked.code, 0);
  assert.match(tracked.stdout, /index\.js/);
  assert.doesNotMatch(tracked.stdout, /node_modules/);
  assert.doesNotMatch(tracked.stdout, /dist\.js/);

  // ...but still present on disk.
  assert.equal(existsSync(join(dir, "node_modules", "left-pad", "index.js")), true);
  assert.equal(existsSync(join(dir, "dist.js")), true);
});

test("untrackIgnoredFiles is a no-op when nothing tracked is ignored", async (t) => {
  const git = new GitService();
  const dir = await createRepo(t);

  await writeFile(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  await writeFile(join(dir, "index.js"), "console.log(1)\n", "utf8");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "clean baseline"]);

  const count = await git.untrackIgnoredFiles(dir);
  assert.equal(count, 0);
  // commitStaged should report nothing to commit.
  assert.equal(await git.commitStaged(dir, "noop"), null);
});
