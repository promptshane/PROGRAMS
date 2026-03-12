import type {
  ConnectionReportItem,
  CostReportItem,
  EnvVariableEntry,
  ProjectOutlineReport,
  StoredDataNode,
} from "@shared/types";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const trimString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const dedupeStrings = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = trimString(value);
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
};

const normalizeStoredDataNode = (value: unknown): StoredDataNode | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = trimString(record.label);
  if (!label) {
    return null;
  }

  return {
    label,
    description: trimString(record.description) || null,
    children: Array.isArray(record.children)
      ? record.children
          .map((child) => normalizeStoredDataNode(child))
          .filter((child): child is StoredDataNode => child !== null)
      : [],
  };
};

const normalizeConnection = (value: unknown): ConnectionReportItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = trimString(record.name);
  if (!name) {
    return null;
  }

  return {
    name,
    kind: trimString(record.kind) || "Service",
    description: trimString(record.description) || "Connected service detected in the project.",
    envKeys: Array.isArray(record.envKeys) ? dedupeStrings(record.envKeys) : [],
  };
};

const normalizeCost = (value: unknown): CostReportItem | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = trimString(record.label);
  if (!label) {
    return null;
  }

  return {
    label,
    amount: trimString(record.amount) || null,
    description: trimString(record.description) || "Estimated usage and cost note.",
  };
};

const stripMarkdownFence = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
};

export const normalizeProjectOutlineReport = (
  projectId: string,
  payload: unknown,
  generatedAt = new Date().toISOString(),
): ProjectOutlineReport => {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const storedData = Array.isArray(record.storedData)
    ? record.storedData
        .map((item) => normalizeStoredDataNode(item))
        .filter((item): item is StoredDataNode => item !== null)
    : [];
  const connections = Array.isArray(record.connections)
    ? record.connections
        .map((item) => normalizeConnection(item))
        .filter((item): item is ConnectionReportItem => item !== null)
    : [];
  const costs = Array.isArray(record.costs)
    ? record.costs
        .map((item) => normalizeCost(item))
        .filter((item): item is CostReportItem => item !== null)
    : [];
  const referencedEnvKeys = dedupeStrings([
    ...(Array.isArray(record.referencedEnvKeys) ? record.referencedEnvKeys : []),
    ...connections.flatMap((item) => item.envKeys),
  ]);

  return {
    projectId,
    storedData,
    connections,
    costs,
    referencedEnvKeys,
    generatedAt,
  };
};

export const parseProjectOutlineReportResponse = (projectId: string, raw: string): ProjectOutlineReport => {
  const parsed = JSON.parse(stripMarkdownFence(raw)) as unknown;
  return normalizeProjectOutlineReport(projectId, parsed);
};

const unquoteEnvValue = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
};

export const parseEnvEntries = (source: string): EnvVariableEntry[] => {
  const entries = new Map<string, string>();
  const order: string[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();
    if (!(value.startsWith('"') || value.startsWith("'"))) {
      value = value.split(/\s+#/, 1)[0]?.trim() ?? "";
    }

    if (!order.includes(key)) {
      order.push(key);
    }
    entries.set(key, unquoteEnvValue(value));
  }

  return order.map((key) => ({
    key,
    value: entries.get(key) ?? "",
  }));
};

export const normalizeEnvEntries = (entries: EnvVariableEntry[]): EnvVariableEntry[] => {
  const seen = new Set<string>();
  const normalized: EnvVariableEntry[] = [];

  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value;

    if (!key && !value.trim()) {
      continue;
    }
    if (!key) {
      throw new Error("Each environment variable needs a key.");
    }
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`"${key}" is not a valid environment variable key.`);
    }
    if (seen.has(key)) {
      throw new Error(`"${key}" is listed more than once.`);
    }

    seen.add(key);
    normalized.push({ key, value });
  }

  return normalized;
};

const quoteEnvValue = (value: string): string => {
  if (value === "") {
    return '""';
  }

  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
};

export const serializeEnvEntries = (entries: EnvVariableEntry[]): string => {
  const normalized = normalizeEnvEntries(entries);
  if (normalized.length === 0) {
    return "";
  }

  return `${normalized.map((entry) => `${entry.key}=${quoteEnvValue(entry.value)}`).join("\n")}\n`;
};
