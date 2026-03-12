export interface FlowchartHintItem {
  file: string;
  label: string;
}

export interface FlowchartHintGroup {
  file: string;
  source: string;
  items: string[];
}

const ACTION_VERBS = new Set(["create", "open", "import", "save", "export", "generate", "archive", "delete"]);

const dedupeStrings = (values: string[]): string[] => Array.from(new Set(values));

const splitQuotedValues = (value: string): string[] =>
  dedupeStrings(
    Array.from(value.matchAll(/["']([^"']+)["']/g), (match) => match[1].trim()).filter(Boolean),
  );

const humanizeActionName = (value: string): string => {
  const source = value.replace(/^handle/, "");
  const tokens = source.match(/[A-Z]?[a-z0-9]+/g) ?? [];
  return tokens.map((token) => token.toLowerCase()).join(" ");
};

export const extractNavigationHintsFromText = (filePath: string, text: string): FlowchartHintGroup[] => {
  const hints: FlowchartHintGroup[] = [];
  const seen = new Set<string>();

  const pushHint = (source: string, items: string[]) => {
    const normalizedItems = dedupeStrings(items.map((item) => item.trim()).filter(Boolean));
    if (normalizedItems.length < 2) {
      return;
    }

    const key = `${source}:${normalizedItems.join("|")}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    hints.push({ file: filePath, source, items: normalizedItems });
  };

  const unionPattern = /const\s+\[(\w+),\s*set\w+\]\s*=\s*useState<([\s\S]{1,240}?)>\(/g;
  for (const match of text.matchAll(unionPattern)) {
    const variableName = match[1];
    if (!/(view|tab|screen|page|section|mode)/i.test(variableName)) {
      continue;
    }
    const values = splitQuotedValues(match[2]);
    pushHint(`state ${variableName}`, values);
  }

  const arrayPattern = /\[((?:\s*["'][^"']+["']\s*,?){2,})\]\s+as const/g;
  for (const match of text.matchAll(arrayPattern)) {
    const values = splitQuotedValues(match[1]);
    if (!values.length) {
      continue;
    }
    const contextWindow = text.slice(Math.max(0, (match.index ?? 0) - 60), Math.min(text.length, (match.index ?? 0) + match[0].length + 60));
    if (/(tab|view|screen|page|section|mode|map\s*\(\s*\(\w+\)\s*=>)/i.test(contextWindow) || /App\.(t|j)sx?$/i.test(filePath)) {
      pushHint("const array", values);
    }
  }

  return hints;
};

export const extractActionHintsFromText = (filePath: string, text: string): FlowchartHintItem[] => {
  const hints: FlowchartHintItem[] = [];
  const seen = new Set<string>();
  const functionPattern = /\bfunction\s+(handle[A-Z]\w+|(?:create|open|import|save|export|generate|archive|delete)[A-Z]\w*)\s*\(/g;
  const constPattern =
    /\bconst\s+(handle[A-Z]\w+|(?:create|open|import|save|export|generate|archive|delete)[A-Z]\w*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|[A-Za-z_]\w*\s*=>)/g;
  const matches = [
    ...Array.from(text.matchAll(functionPattern)),
    ...Array.from(text.matchAll(constPattern)),
  ];

  for (const match of matches) {
    const label = humanizeActionName(match[1]);
    const [verb] = label.split(" ");
    if (!ACTION_VERBS.has(verb)) {
      continue;
    }
    const key = `${filePath}:${label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hints.push({ file: filePath, label });
  }

  return hints;
};
