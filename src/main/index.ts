import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { ProgramsBackend } from "@main/backend";
import { registerIpc } from "@main/ipc";
import { ClaudeService } from "@main/services/claude-service";
import { CodexService } from "@main/services/codex-service";
import { GitService } from "@main/services/git-service";
import { PlaywrightService } from "@main/services/playwright-service";
import { ProjectStore } from "@main/services/project-store";
import { RunnerService } from "@main/services/runner-service";
import type { AppEvent } from "@shared/types";

let mainWindow: BrowserWindow | null = null;
let appUpdatePollInterval: NodeJS.Timeout | null = null;
let appUpdatePollInFlight = false;

const isDevelopment = !app.isPackaged;
const APP_UPDATE_POLL_INTERVAL_MS = 30_000;

const emitToWindows = (event: AppEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("app.event", event);
  }
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 780,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1318",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (isDevelopment) {
    console.log("[PROGRAMS] renderer target:", process.env.ELECTRON_RENDERER_URL ?? "file://renderer");

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[PROGRAMS] did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });

    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[PROGRAMS] did-finish-load");
    });

    mainWindow.webContents.on("console-message", (details) => {
      console.log("[PROGRAMS][renderer]", {
        level: details.level,
        message: details.message,
        line: details.lineNumber,
        sourceId: details.sourceId,
      });
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("[PROGRAMS] render-process-gone", details);
    });
  }
};

const startAppUpdatePolling = (backend: ProgramsBackend): void => {
  if (process.platform !== "darwin" || !app.isPackaged || appUpdatePollInterval) {
    return;
  }

  const poll = () => {
    if (appUpdatePollInFlight) {
      return;
    }
    appUpdatePollInFlight = true;
    void backend.readAppUpdateStatus()
      .catch((error: unknown) => {
        console.warn("[PROGRAMS] app update poll failed", error);
      })
      .finally(() => {
        appUpdatePollInFlight = false;
      });
  };

  appUpdatePollInterval = setInterval(poll, APP_UPDATE_POLL_INTERVAL_MS);
  appUpdatePollInterval.unref?.();
};

void app.whenReady().then(async () => {
  app.setName("PROGRAMS");

  const store = new ProjectStore();
  await store.initialize();

  const gitService = new GitService();
  const runnerService = new RunnerService(emitToWindows);
  const playwrightService = new PlaywrightService();
  const codexService = new CodexService(emitToWindows);
  const claudeService = new ClaudeService(emitToWindows, (url) => shell.openExternal(url));
  const backend = new ProgramsBackend(
    store,
    gitService,
    runnerService,
    playwrightService,
    codexService,
    claudeService,
    emitToWindows,
  );
  runnerService.setOnRuntimeExit((projectId) => backend.handleRuntimeExit(projectId));
  runnerService.setOnRuntimeUrlDetected((projectId, url) => backend.handleRuntimeUrlDetected(projectId, url));

  registerIpc(backend);
  startAppUpdatePolling(backend);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (appUpdatePollInterval) {
    clearInterval(appUpdatePollInterval);
    appUpdatePollInterval = null;
  }
});
