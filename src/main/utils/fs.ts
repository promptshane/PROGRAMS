import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const ensureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true });
};

export const writeTextFile = async (path: string, content: string): Promise<void> => {
  await ensureDirectory(dirname(path));
  await writeFile(path, content, "utf8");
};

export const readTextFile = async (path: string, fallback = ""): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
};

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const isSubPath = (parentPath: string, candidatePath: string): boolean => {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  return candidate === parent || candidate.startsWith(`${parent}/`);
};
