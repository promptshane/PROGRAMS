type JsonSchemaProperty = Record<string, unknown>;
type JsonSchemaProperties = Record<string, JsonSchemaProperty>;

export const buildStrictObjectSchema = <T extends JsonSchemaProperties>(properties: T) => ({
  type: "object" as const,
  additionalProperties: false as const,
  required: Object.keys(properties) as Array<Extract<keyof T, string>>,
  properties,
});

export const toddVersionItemSchema = buildStrictObjectSchema({
  label: { type: "string" },
  description: { type: "string" },
  goals: {
    type: "array" as const,
    items: { type: "string" },
  },
});

export const toddUpdateItemSchema = buildStrictObjectSchema({
  title: { type: "string" },
  description: { type: "string" },
  versionLabel: { type: "string" },
  dependencies: {
    type: "array" as const,
    items: { type: "string" },
  },
  area: { type: ["string", "null"] },
  skillsNeeded: {
    type: "array" as const,
    items: { type: "string" },
  },
  updateKind: {
    type: "string",
    enum: ["create", "expand", "refine", "simplify"],
  },
  simplificationMode: {
    type: ["string", "null"] as const,
    enum: ["inline", "staged", "overhaul", null],
  },
  structuralReason: { type: ["string", "null"] },
  supportsNextStep: { type: ["string", "null"] },
});

export const pingRawReportSchema = buildStrictObjectSchema({
  summary: { type: "string" },
  changedFiles: {
    type: "array" as const,
    items: { type: "string" },
  },
  blocker: { type: ["string", "null"] },
  unexpectedNotes: {
    type: "array" as const,
    items: { type: "string" },
  },
});
