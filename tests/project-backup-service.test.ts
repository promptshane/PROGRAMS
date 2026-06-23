import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  BACKUP_EXCLUDED_DIRECTORY_NAMES,
  BUILD_ARTIFACT_GITIGNORE_RULES,
  ensureProjectGitignoreSecretRules,
  isSecretLikePath,
  ProjectBackupService,
  SECRET_GITIGNORE_RULES,
} from "../src/main/services/project-backup-service.ts";
import { createEmptyProjectRelationshipSummary, type Project } from "../src/shared/types.ts";

const createProject = (localPath: string): Project => ({
  id: "project-1",
  name: "Safety Test App",
  iconColor: "#0EA5E9",
  description: "Test project",
  localPath,
  threadId: null,
  lastUpdatedAt: null,
  status: "idle",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  runtimeConfig: {
    packageManager: "unknown",
    installCommand: null,
    runCommand: null,
    openUrl: null,
    lastRunUrl: null,
    initialIdea: null,
    assignedPort: null,
    launch: null,
  },
  lastError: null,
  githubConnection: null,
  relationship: createEmptyProjectRelationshipSummary(),
});

test("project backups are timestamped and readable as latest", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "programs-backups-test-"));
  const projectPath = join(root, "project");
  const backupRoot = join(root, "backups");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(projectPath, { recursive: true });
  await writeFile(join(projectPath, "README.md"), "original\n", "utf8");

  const service = new ProjectBackupService(backupRoot);
  const backup = await service.createProjectBackup(createProject(projectPath), "Before AI edit");
  const latest = await service.readLastProjectBackup("project-1");

  assert.equal(backup.reason, "Before AI edit");
  assert.match(backup.backupPath, /Safety-Test-App_\d{4}-\d{2}-\d{2}T/);
  assert.equal(latest?.backupPath, backup.backupPath);
  assert.equal(await readFile(join(backup.projectPath, "README.md"), "utf8"), "original\n");
});

test("project backups skip generated folders while preserving source, git, and local config files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "programs-backup-filter-test-"));
  const projectPath = join(root, "project");
  const backupRoot = join(root, "backups");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(join(projectPath, "src"), { recursive: true });
  await mkdir(join(projectPath, ".git"), { recursive: true });
  await writeFile(join(projectPath, "src", "index.ts"), "export const ok = true;\n", "utf8");
  await writeFile(join(projectPath, ".env.local"), "SECRET=kept-in-local-backup\n", "utf8");
  await writeFile(join(projectPath, ".git", "config"), "[core]\n", "utf8");

  for (const directoryName of BACKUP_EXCLUDED_DIRECTORY_NAMES) {
    await mkdir(join(projectPath, directoryName), { recursive: true });
    await writeFile(join(projectPath, directoryName, "generated.txt"), "skip me\n", "utf8");
  }

  const service = new ProjectBackupService(backupRoot);
  const backup = await service.createProjectBackup(createProject(projectPath), "Before download");

  assert.equal(await readFile(join(backup.projectPath, "src", "index.ts"), "utf8"), "export const ok = true;\n");
  assert.equal(await readFile(join(backup.projectPath, ".env.local"), "utf8"), "SECRET=kept-in-local-backup\n");
  assert.equal(await readFile(join(backup.projectPath, ".git", "config"), "utf8"), "[core]\n");

  for (const directoryName of BACKUP_EXCLUDED_DIRECTORY_NAMES) {
    assert.equal(existsSync(join(backup.projectPath, directoryName)), false, directoryName);
  }
});

test("project backup failures remove the partial backup folder and report the copy error", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "programs-backup-failure-test-"));
  const projectPath = join(root, "project");
  const backupRoot = join(root, "backups");
  const lockedFilePath = join(projectPath, "src", "locked.txt");
  t.after(async () => {
    await chmod(lockedFilePath, 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(join(projectPath, "src"), { recursive: true });
  await writeFile(join(projectPath, "src", "index.ts"), "export const ok = true;\n", "utf8");
  await writeFile(lockedFilePath, "cannot copy\n", "utf8");
  await chmod(lockedFilePath, 0o000);

  const service = new ProjectBackupService(backupRoot);
  await assert.rejects(
    () => service.createProjectBackup(createProject(projectPath), "Before download"),
    /Could not create project backup:/,
  );

  const projectBackupRoot = join(backupRoot, "project-1");
  const entries = await readdir(projectBackupRoot).catch(() => []);
  assert.deepEqual(entries, []);
  assert.equal(await service.readLastProjectBackup("project-1"), null);
});

test("restoreLastProjectBackup overwrites current files and keeps a pre-restore backup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "programs-restore-test-"));
  const projectPath = join(root, "project");
  const backupRoot = join(root, "backups");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(projectPath, { recursive: true });
  await writeFile(join(projectPath, "app.txt"), "good\n", "utf8");

  const service = new ProjectBackupService(backupRoot);
  const project = createProject(projectPath);
  const originalBackup = await service.createProjectBackup(project, "Before AI edit");

  await writeFile(join(projectPath, "app.txt"), "broken\n", "utf8");
  const result = await service.restoreLastProjectBackup(project);

  assert.equal(result.restoredBackup.backupPath, originalBackup.backupPath);
  assert.equal(result.preRestoreBackup.reason, "Before restoring backup");
  assert.equal(await readFile(join(projectPath, "app.txt"), "utf8"), "good\n");
  assert.equal(await readFile(join(result.preRestoreBackup.projectPath, "app.txt"), "utf8"), "broken\n");
});

test("secret path detection matches obvious local secret files", () => {
  for (const filePath of [
    ".env",
    ".env.local",
    "keys/private.pem",
    "keys/private.key",
    "google-service-account.json",
    "app-credentials.json",
    "gmail-token.json",
  ]) {
    assert.equal(isSecretLikePath(filePath), true, filePath);
  }

  for (const filePath of ["src/app.ts", "package.json", "docs/token-handling.md"]) {
    assert.equal(isSecretLikePath(filePath), false, filePath);
  }
});

test("ensureProjectGitignoreSecretRules appends required safety rules", async (t) => {
  const projectPath = await mkdtemp(join(tmpdir(), "programs-gitignore-test-"));
  t.after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  await writeFile(join(projectPath, ".gitignore"), "node_modules\n", "utf8");
  await ensureProjectGitignoreSecretRules(projectPath);
  const gitignore = await readFile(join(projectPath, ".gitignore"), "utf8");

  assert.equal(existsSync(join(projectPath, ".gitignore")), true);
  for (const rule of SECRET_GITIGNORE_RULES) {
    assert.match(gitignore, new RegExp(`^${rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
  // Build artifacts must also be ignored so `git add -A` doesn't sweep in
  // node_modules/dist and produce inflated save summaries.
  for (const rule of BUILD_ARTIFACT_GITIGNORE_RULES) {
    assert.match(gitignore, new RegExp(`^${rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});
