import { basename } from "node:path";
import { exec } from "node:child_process";
import { app } from "electron";
import type { SystemHealthProcess, SystemHealthSeverity, SystemHealthSnapshot } from "@shared/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function runCmd(cmd: string, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

// ── icon cache (path → base64 data URL) ──────────────────────────────────────

const iconCache = new Map<string, string>();

async function getIconForPath(execPath: string): Promise<string | undefined> {
  const cached = iconCache.get(execPath);
  if (cached !== undefined) return cached;
  try {
    const img = await app.getFileIcon(execPath, { size: "normal" });
    const dataUrl = img.toDataURL();
    iconCache.set(execPath, dataUrl);
    return dataUrl;
  } catch {
    iconCache.set(execPath, ""); // don't retry failed paths
    return undefined;
  }
}

// ── name extraction from full executable path ─────────────────────────────────

function extractAppBundlePath(fullPath: string): string {
  // "/Applications/DaVinci Resolve.app/Contents/MacOS/..." → "/Applications/DaVinci Resolve.app"
  const appMatch = fullPath.match(/^(.*?\.app)\//);
  return appMatch ? appMatch[1] : fullPath;
}

function extractDisplayName(fullPath: string): string {
  const appMatch = fullPath.match(/([^/]+)\.app\//);
  if (appMatch) return appMatch[1]; // "DaVinci Resolve"
  return basename(fullPath.split(" ")[0] ?? fullPath); // take first word (strip args), then basename
}

// ── process parsing ───────────────────────────────────────────────────────────

interface RawProcess {
  pid: number;
  cpu: number;
  mem: number;
  comm: string; // kernel-truncated name (up to 15 chars)
}

function parseRawProcesses(psOutput: string): RawProcess[] {
  // ps -Ao pid,%cpu,%mem,comm -r | head -20
  const lines = psOutput.trim().split("\n").slice(1);
  const results: RawProcess[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const pid = parseInt(parts[0], 10);
    const cpu = parseFloat(parts[1]);
    const mem = parseFloat(parts[2]);
    const comm = parts.slice(3).join(" ");
    if (!isNaN(pid) && !isNaN(cpu) && cpu > 0) {
      results.push({ pid, cpu, mem: isNaN(mem) ? 0 : mem, comm });
    }
    if (results.length >= 10) break;
  }
  return results;
}

// Build a pid→fullPath map from "ps -Ao pid,command -r"
function parseFullPaths(psCommandOutput: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = psCommandOutput.trim().split("\n").slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) continue;
    const pid = parseInt(trimmed.slice(0, spaceIdx), 10);
    const fullCommand = trimmed.slice(spaceIdx + 1).trim();
    if (!isNaN(pid) && fullCommand) {
      map.set(pid, fullCommand);
    }
  }
  return map;
}

async function buildProcessList(
  rawProcesses: RawProcess[],
  fullPaths: Map<number, string>,
): Promise<SystemHealthProcess[]> {
  const top5 = rawProcesses.slice(0, 5);

  const iconResults = await Promise.all(
    top5.map(async (proc) => {
      const fullCommand = fullPaths.get(proc.pid) ?? "";
      const execPath = fullCommand.split(" ")[0] ?? "";
      const iconPath = execPath.includes(".app/") ? extractAppBundlePath(execPath) : execPath;
      const displayName = execPath ? extractDisplayName(fullCommand) : proc.comm;
      const iconDataUrl = execPath ? await getIconForPath(iconPath) : undefined;
      return { proc, displayName, iconDataUrl: iconDataUrl || undefined };
    }),
  );

  return iconResults.map(({ proc, displayName, iconDataUrl }) => ({
    pid: proc.pid,
    name: proc.comm,
    displayName,
    iconDataUrl,
    cpu: proc.cpu,
    mem: proc.mem,
  }));
}

// ── CPU from top ──────────────────────────────────────────────────────────────

function parseCpuFromTop(topOutput: string): number | null {
  // "CPU usage: 20.4% user, 20.4% sys, 59.90% idle"
  const idleMatch = topOutput.match(/(\d+(?:\.\d+)?)%\s*idle/i);
  if (!idleMatch) return null;
  return Math.round(100 - parseFloat(idleMatch[1]));
}

// ── memory ────────────────────────────────────────────────────────────────────

function parseMemoryPressure(mpOutput: string): {
  level: "normal" | "warning" | "critical" | null;
  usedPercent: number | null;
} {
  if (!mpOutput) return { level: null, usedPercent: null };

  let level: "normal" | "warning" | "critical" | null = null;
  let usedPercent: number | null = null;

  const freeMatch = mpOutput.match(/memory free percentage:\s*(\d+)%/i);
  if (freeMatch) {
    usedPercent = 100 - parseInt(freeMatch[1], 10);
  }

  const statusMatch = mpOutput.match(/memory status:\s*(\w+)/i);
  if (statusMatch) {
    const s = statusMatch[1].toUpperCase();
    if (s === "CRITICAL") level = "critical";
    else if (s === "WARN") level = "warning";
    else if (s === "OK" || s === "NORMAL") level = "normal";
  }

  if (level === null && usedPercent !== null) {
    if (usedPercent >= 95) level = "critical";
    else if (usedPercent >= 80) level = "warning";
    else level = "normal";
  }

  return { level, usedPercent };
}

// ── swap ──────────────────────────────────────────────────────────────────────

function parseSwap(sysctlOutput: string): { usedMb: number | null; totalMb: number | null } {
  if (!sysctlOutput) return { usedMb: null, totalMb: null };
  const totalMatch = sysctlOutput.match(/total\s*=\s*([\d.]+)([MG])/i);
  const usedMatch = sysctlOutput.match(/used\s*=\s*([\d.]+)([MG])/i);
  const toMb = (val: number, unit: string) => unit.toUpperCase() === "G" ? val * 1024 : val;
  return {
    totalMb: totalMatch ? toMb(parseFloat(totalMatch[1]), totalMatch[2]) : null,
    usedMb: usedMatch ? toMb(parseFloat(usedMatch[1]), usedMatch[2]) : null,
  };
}

// ── thermal ───────────────────────────────────────────────────────────────────

function parseThermal(pmsetOutput: string): "nominal" | "fair" | "serious" | "critical" {
  // Empty thermlog = no throttling events = nominal
  if (!pmsetOutput.trim()) return "nominal";

  const matches = [...pmsetOutput.matchAll(/Thermal Pressure\s*[:\|]\s*(\w+)/gi)];
  if (matches.length === 0) return "nominal";

  const last = matches[matches.length - 1][1].toLowerCase();
  if (last === "critical") return "critical";
  if (last === "serious") return "serious";
  if (last === "fair") return "fair";
  return "nominal";
}

// ── severity ──────────────────────────────────────────────────────────────────

function computeSeverity(
  cpuPercent: number | null,
  memPressure: "normal" | "warning" | "critical" | null,
  thermalState: "nominal" | "fair" | "serious" | "critical",
): SystemHealthSeverity {
  if (
    (cpuPercent !== null && cpuPercent > 90) ||
    memPressure === "critical" ||
    thermalState === "critical"
  ) return "Severe";

  if (
    (cpuPercent !== null && cpuPercent > 75) ||
    memPressure === "warning" ||
    thermalState === "serious"
  ) return "Heavy";

  if (
    (cpuPercent !== null && cpuPercent > 50) ||
    thermalState === "fair"
  ) return "Moderate";

  return "Normal";
}

// ── public API ────────────────────────────────────────────────────────────────

export async function collectSystemHealth(): Promise<SystemHealthSnapshot> {
  const [psCommOutput, psCommandOutput, topOutput, mpOutput, swapOutput, thermOutput] = await Promise.all([
    runCmd("ps -Ao pid,%cpu,%mem,comm -r | head -20"),
    runCmd("ps -Ao pid,command -r | head -20"),
    runCmd("top -l 1 -n 0 -s 0 | grep 'CPU usage'"),
    runCmd("memory_pressure"),
    runCmd("sysctl vm.swapusage"),
    runCmd("pmset -g thermlog | tail -n 50"),
  ]);

  const rawProcesses = parseRawProcesses(psCommOutput);
  const fullPaths = parseFullPaths(psCommandOutput);
  const topProcesses = await buildProcessList(rawProcesses, fullPaths);

  const cpuPercent = parseCpuFromTop(topOutput);
  const { level: memoryPressureLevel, usedPercent: memoryUsedPercent } = parseMemoryPressure(mpOutput);
  const { usedMb: swapUsedMb, totalMb: swapTotalMb } = parseSwap(swapOutput);
  const thermalState = parseThermal(thermOutput);
  const severity = computeSeverity(cpuPercent, memoryPressureLevel, thermalState);

  return {
    cpuPercent,
    memoryUsedPercent,
    memoryPressureLevel,
    swapUsedMb,
    swapTotalMb,
    thermalState,
    topProcesses,
    severity,
    collectedAt: new Date().toISOString(),
  };
}
