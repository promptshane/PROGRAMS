import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const aliasRoots = new Map([
  ["@main/", resolvePath(projectRoot, "src/main")],
  ["@shared/", resolvePath(projectRoot, "src/shared")],
  ["@renderer/", resolvePath(projectRoot, "src/renderer/src")],
]);

const tryResolveTsFile = (absolutePath) => {
  const directTs = `${absolutePath}.ts`;
  if (existsSync(directTs)) {
    return pathToFileURL(directTs).href;
  }

  const indexTs = resolvePath(absolutePath, "index.ts");
  if (existsSync(indexTs)) {
    return pathToFileURL(indexTs).href;
  }

  return null;
};

export async function resolve(specifier, context, defaultResolve) {
  for (const [prefix, root] of aliasRoots.entries()) {
    if (specifier.startsWith(prefix)) {
      const target = tryResolveTsFile(resolvePath(root, specifier.slice(prefix.length)));
      if (target) {
        return { url: target, shortCircuit: true };
      }
    }
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../"))
    && !/\.[a-z0-9]+$/i.test(specifier)
    && context.parentURL
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const target = tryResolveTsFile(resolvePath(parentDir, specifier));
    if (target) {
      return { url: target, shortCircuit: true };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
