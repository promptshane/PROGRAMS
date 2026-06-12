interface ModelOption {
  id: string;
  label: string;
  detail: string | null;
}

export interface CodexModelCatalogItem {
  model: string;
  displayName?: string;
  description?: string | null;
  hidden?: boolean;
}

const CURATED_CODEX_MODEL_IDS = ["gpt-5.5", "gpt-5.5-mini"] as const;
const MAX_CURATED_MODELS = 2;

const parseModelVersion = (value: string): number[] => {
  const match = value.match(/^gpt-(\d+)(?:\.(\d+))?/i);
  if (!match) {
    return [0, 0];
  }

  return [Number(match[1] || 0), Number(match[2] || 0)];
};

const compareModelIdsDescending = (left: string, right: string): number => {
  const leftVersion = parseModelVersion(left);
  const rightVersion = parseModelVersion(right);
  for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) {
    const delta = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return right.localeCompare(left);
};

const formatCodexModelLabel = (value: string): string =>
  value
    .replace(/^gpt-/i, "GPT-")
    .split("-")
    .map((part, index) => (index < 2 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");

const toModelOption = (model: CodexModelCatalogItem): ModelOption => ({
  id: model.model,
  label: formatCodexModelLabel(model.displayName || model.model),
  detail: model.description ?? null,
});

const dedupeModelOptions = (options: ModelOption[]): ModelOption[] =>
  Array.from(new Map(options.map((option) => [option.id, option])).values());

export const selectPreferredCodexModels = (models: CodexModelCatalogItem[]): ModelOption[] => {
  const visible = models.filter((model) => !model.hidden && model.model.startsWith("gpt-"));
  const general = [...visible]
    .filter((model) => !model.model.includes("-codex"))
    .sort((left, right) => compareModelIdsDescending(left.model, right.model));
  const codex = [...visible]
    .filter((model) => model.model.includes("-codex"))
    .sort((left, right) => compareModelIdsDescending(left.model, right.model));

  const byId = new Map(visible.map((model) => [model.model, model]));
  const curated = CURATED_CODEX_MODEL_IDS
    .map((modelId) => byId.get(modelId))
    .filter((model): model is CodexModelCatalogItem => Boolean(model))
    .map(toModelOption);

  if (!curated.length) {
    return dedupeModelOptions(
      [general[0], general[1], codex[0]]
        .filter((model): model is CodexModelCatalogItem => Boolean(model))
        .map(toModelOption),
    ).slice(0, MAX_CURATED_MODELS);
  }

  const curatedIds = new Set(curated.map((option) => option.id));
  const remainingCodex = codex
    .filter((model) => !curatedIds.has(model.model))
    .map(toModelOption);
  const remainingGeneral = general
    .filter((model) => !curatedIds.has(model.model))
    .map(toModelOption);

  const filled = [...curated];
  if (!filled.some((option) => option.id.includes("-codex")) && remainingCodex[0]) {
    filled.push(remainingCodex[0]);
  }

  for (const option of [...remainingGeneral, ...remainingCodex]) {
    if (filled.length >= MAX_CURATED_MODELS) {
      break;
    }
    if (filled.some((candidate) => candidate.id === option.id)) {
      continue;
    }
    filled.push(option);
  }

  return dedupeModelOptions(filled).slice(0, MAX_CURATED_MODELS);
};
