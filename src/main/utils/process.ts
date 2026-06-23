import { execFile, spawn } from "node:child_process";
import { delimiter } from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAC_GUI_PATHS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

let cachedCommandEnv: Promise<NodeJS.ProcessEnv> | null = null;

const uniquePathEntries = (entries: Array<string | null | undefined>): string => {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    for (const part of entry.split(delimiter)) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      values.push(trimmed);
    }
  }

  return values.join(delimiter);
};

const readLoginShellPath = async (): Promise<string | null> => {
  if (process.platform !== "darwin") {
    return null;
  }

  const shellPath = process.env.SHELL || "/bin/zsh";
  const markerStart = "__PROGRAMS_PATH_START__";
  const markerEnd = "__PROGRAMS_PATH_END__";

  return new Promise((resolve) => {
    execFile(
      shellPath,
      ["-lc", `printf '${markerStart}%s${markerEnd}' "$PATH"`],
      { env: process.env },
      (error, stdout) => {
        if (error && !stdout) {
          resolve(null);
          return;
        }

        const output = stdout.toString();
        const start = output.indexOf(markerStart);
        const end = output.indexOf(markerEnd);
        if (start === -1 || end === -1 || end <= start) {
          resolve(null);
          return;
        }

        resolve(output.slice(start + markerStart.length, end).trim() || null);
      },
    );
  });
};

const buildCommandEnv = async (env: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> => {
  const home = env.HOME || process.env.HOME || "";
  const loginShellPath = await readLoginShellPath();
  const commonPaths = [
    ...MAC_GUI_PATHS,
    home ? `${home}/.npm-global/bin` : undefined,
    home ? `${home}/.local/bin` : undefined,
    home ? `${home}/.bun/bin` : undefined,
    home ? `${home}/.cargo/bin` : undefined,
    home ? `${home}/.volta/bin` : undefined,
  ];

  return {
    ...env,
    PATH: uniquePathEntries([loginShellPath, env.PATH, process.env.PATH, ...commonPaths]),
  };
};

export const getCommandEnv = async (): Promise<NodeJS.ProcessEnv> => {
  if (!cachedCommandEnv) {
    cachedCommandEnv = buildCommandEnv().then((env) => {
      if (env.PATH) {
        process.env.PATH = env.PATH;
      }

      return env;
    });
  }

  return cachedCommandEnv;
};

export const execCommand = async (
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecResult> => {
  const resolvedEnv = env === process.env ? await getCommandEnv() : await buildCommandEnv(env);

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: resolvedEnv,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
};

// Like execCommand, but writes `input` to the child's stdin. Used for git
// commands that accept pathspecs via `--pathspec-from-file=-`, which avoids
// argument-length limits when the list of paths is large (e.g. node_modules).
export const execCommandWithInput = async (
  command: string,
  cwd: string,
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecResult> => {
  const resolvedEnv = env === process.env ? await getCommandEnv() : await buildCommandEnv(env);

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: resolvedEnv,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });

    child.stdin.on("error", () => {
      // Child may exit before consuming stdin; the close handler reports the code.
    });
    child.stdin.end(input);
  });
};

export const execFileCommand = async (
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecResult> => {
  const resolvedEnv = env === process.env ? await getCommandEnv() : await buildCommandEnv(env);

  return new Promise((resolve) => {
    execFile(file, args, { cwd, env: resolvedEnv }, (error, stdout, stderr) => {
      resolve({
        code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
};
