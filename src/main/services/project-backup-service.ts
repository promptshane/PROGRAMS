import { cp, lstat, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { Project, ProjectBackupInfo, RestoreProjectBackupResult } from "@shared/types";
import { ensureDirectory, pathExists } from "../utils/fs.ts";

export const SECRET_GITIGNORE_RULES = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*service-account*.json",
  "*credentials*.json",
  "*token*.json",
  ".programs-backups/",
  "programs-backups/",
  "project-backups/",
] as const;

const BACKUP_METADATA_FILE = "backup.json";

export const BACKUP_EXCLUDED_DIRECTORY_NAMES = [
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".programs-backups",
  "programs-backups",
  "project-backups",
] as const;

const backupExcludedDirectoryNames = new Set<string>(BACKUP_EXCLUDED_DIRECTORY_NAMES);

const sanitizeBackupNamePart = (value: string): string => {
  const cleaned = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "project";
};

const formatBackupTimestamp = (date = new Date()): string =>
  date.toISOString().replace(/[:.]/g, "-");

const normalizePathForMatch = (value: string): string =>
  value.split("\\").join("/").trim().toLowerCase();

const formatErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : fallback;

const shouldCopyBackupPath = async (projectPath: string, sourcePath: string): Promise<boolean> => {
  const relativePath = relative(projectPath, sourcePath);
  if (!relativePath || relativePath === ".") {
    return true;
  }

  const stats = await lstat(sourcePath);
  if (!stats.isDirectory()) {
    return true;
  }

  return !backupExcludedDirectoryNames.has(basename(sourcePath).toLowerCase());
};

export const isSecretLikePath = (filePath: string): boolean => {
  const normalized = normalizePathForMatch(filePath);
  const filename = basename(normalized);
  if (!filename) {
    return false;
  }

  if (filename === ".env" || filename.startsWith(".env.")) {
    return true;
  }
  if (filename.endsWith(".pem") || filename.endsWith(".key")) {
    return true;
  }
  if (filename.endsWith(".json")) {
    return filename.includes("service-account")
      || filename.includes("credentials")
      || filename.includes("token");
  }

  return false;
};

export const formatSecretBlockMessage = (files: string[]): string => {
  const visible = files.slice(0, 8);
  const suffix = files.length > visible.length ? ` and ${files.length - visible.length} more` : "";
  return `GitHub save blocked because secret-looking files would be included: ${visible.join(", ")}${suffix}`;
};

export const ensureProjectGitignoreSecretRules = async (projectPath: string): Promise<void> => {
  const gitignorePath = join(projectPath, ".gitignore");
  let current = "";
  try {
    current = await readFile(gitignorePath, "utf8");
  } catch {
    current = "";
  }

  const existingRules = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  const missingRules = SECRET_GITIGNORE_RULES.filter((rule) => !existingRules.has(rule));
  if (missingRules.length === 0) {
    return;
  }

  const trimmed = current.replace(/\s+$/g, "");
  const prefix = trimmed ? `${trimmed}\n\n` : "";
  const next = `${prefix}# Local secrets and PROGRAMS safety backups\n${missingRules.join("\n")}\n`;
  await writeFile(gitignorePath, next, "utf8");
};

const parseBackupMetadata = (value: string): ProjectBackupInfo | null => {
  try {
    const parsed = JSON.parse(value) as Partial<ProjectBackupInfo>;
    if (
      typeof parsed.projectId !== "string"
      || typeof parsed.projectName !== "string"
      || typeof parsed.originalPath !== "string"
      || typeof parsed.createdAt !== "string"
      || typeof parsed.reason !== "string"
      || typeof parsed.backupPath !== "string"
      || typeof parsed.projectPath !== "string"
    ) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      projectName: parsed.projectName,
      originalPath: parsed.originalPath,
      createdAt: parsed.createdAt,
      reason: parsed.reason,
      backupPath: parsed.backupPath,
      projectPath: parsed.projectPath,
    };
  } catch {
    return null;
  }
};

export class ProjectBackupService {
  private readonly backupRoot: string;

  constructor(backupRoot: string) {
    this.backupRoot = backupRoot;
  }

  getBackupRoot(): string {
    return this.backupRoot;
  }

  private getProjectBackupRoot(projectId: string): string {
    return join(this.backupRoot, projectId);
  }

  async createProjectBackup(project: Project, reason: string): Promise<ProjectBackupInfo> {
    if (!(await pathExists(project.localPath))) {
      throw new Error("Project folder not found.");
    }

    const createdAt = new Date().toISOString();
    const folderName = `${sanitizeBackupNamePart(project.name)}_${formatBackupTimestamp(new Date(createdAt))}`;
    const projectBackupRoot = this.getProjectBackupRoot(project.id);
    let backupPath = join(projectBackupRoot, folderName);
    let collisionIndex = 1;
    while (await pathExists(backupPath)) {
      backupPath = join(projectBackupRoot, `${folderName}-${collisionIndex}`);
      collisionIndex += 1;
    }
    const projectPath = join(backupPath, "project");
    try {
      await ensureDirectory(backupPath);
      await cp(project.localPath, projectPath, {
        recursive: true,
        force: true,
        filter: (sourcePath) => shouldCopyBackupPath(project.localPath, sourcePath),
      });

      const metadata: ProjectBackupInfo = {
        projectId: project.id,
        projectName: project.name,
        originalPath: project.localPath,
        createdAt,
        reason,
        backupPath,
        projectPath,
      };
      await writeFile(join(backupPath, BACKUP_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      return metadata;
    } catch (error) {
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Could not create project backup: ${formatErrorMessage(error, "Unknown backup error.")}`);
    }
  }

  async readLastProjectBackup(projectId: string): Promise<ProjectBackupInfo | null> {
    const root = this.getProjectBackupRoot(projectId);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }

    const backups: ProjectBackupInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const metadataPath = join(root, entry.name, BACKUP_METADATA_FILE);
      try {
        const metadata = parseBackupMetadata(await readFile(metadataPath, "utf8"));
        if (metadata) {
          backups.push(metadata);
        }
      } catch {
        continue;
      }
    }

    backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return backups[0] ?? null;
  }

  async restoreLastProjectBackup(project: Project): Promise<RestoreProjectBackupResult> {
    const targetBackup = await this.readLastProjectBackup(project.id);
    if (!targetBackup) {
      throw new Error("No backup found for this project.");
    }
    if (!(await pathExists(targetBackup.projectPath))) {
      throw new Error("The latest backup is missing its project files.");
    }

    const preRestoreBackup = await this.createProjectBackup(project, "Before restoring backup");
    await rm(project.localPath, { recursive: true, force: true });
    await ensureDirectory(dirname(project.localPath));
    await cp(targetBackup.projectPath, project.localPath, {
      recursive: true,
      force: true,
    });

    // Touch the restored directory by reading metadata so callers get a clear
    // failure if the copy did not materialize.
    await stat(project.localPath);

    return {
      restoredBackup: targetBackup,
      preRestoreBackup,
    };
  }
}
