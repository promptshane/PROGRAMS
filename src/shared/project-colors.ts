export const DEFAULT_PROJECT_ICON_COLORS = [
  "#FB7185",
  "#F97316",
  "#F59E0B",
  "#10B981",
  "#14B8A6",
  "#0EA5E9",
  "#3B82F6",
  "#64748B",
] as const;

export const FALLBACK_PROJECT_ICON_COLOR = DEFAULT_PROJECT_ICON_COLORS[5];

export interface ProjectColorRecord {
  id?: string | null;
  iconColor: string;
}

export const normalizeProjectIconColor = (value: string | null | undefined): string | null => {
  const match = value?.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) {
    return null;
  }

  const [, hex] = match;
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((part) => `${part}${part}`)
      .join("")
      .toUpperCase()}`;
  }

  return `#${hex.toUpperCase()}`;
};

export const collectUsedProjectIconColors = <T extends ProjectColorRecord>(
  projects: readonly T[],
  excludeProjectId: string | null = null,
): Set<string> => {
  const used = new Set<string>();

  for (const project of projects) {
    if (excludeProjectId && project.id === excludeProjectId) {
      continue;
    }

    const normalized = normalizeProjectIconColor(project.iconColor);
    if (normalized) {
      used.add(normalized);
    }
  }

  return used;
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const l = Math.max(0, Math.min(100, lightness)) / 100;

  if (s === 0) {
    const channel = Math.round(l * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    return `#${channel}${channel}${channel}`;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const red = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const green = Math.round(hueToRgb(p, q, h) * 255);
  const blue = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);

  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
};

const buildGeneratedProjectIconColor = (generatedIndex: number): string => {
  const hue = (generatedIndex * 53 + 17) % 360;
  const saturation = 72 - (generatedIndex % 4) * 4;
  const lightness = 54 + (generatedIndex % 3) * 6;
  return hslToHex(hue, saturation, lightness);
};

const getProjectIconColorCandidate = (index: number): string =>
  index < DEFAULT_PROJECT_ICON_COLORS.length
    ? DEFAULT_PROJECT_ICON_COLORS[index]
    : buildGeneratedProjectIconColor(index - DEFAULT_PROJECT_ICON_COLORS.length);

export const pickAvailableProjectIconColor = (
  usedColors: Iterable<string>,
  preferredColor: string | null | undefined = null,
): string => {
  const normalizedUsed = new Set<string>();
  for (const color of usedColors) {
    const normalized = normalizeProjectIconColor(color);
    if (normalized) {
      normalizedUsed.add(normalized);
    }
  }

  const preferred = normalizeProjectIconColor(preferredColor);
  if (preferred && !normalizedUsed.has(preferred)) {
    return preferred;
  }

  for (let index = 0; index < 4096; index += 1) {
    const candidate = normalizeProjectIconColor(getProjectIconColorCandidate(index));
    if (candidate && !normalizedUsed.has(candidate)) {
      return candidate;
    }
  }

  return FALLBACK_PROJECT_ICON_COLOR;
};
