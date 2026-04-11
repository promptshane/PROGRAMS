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

export const toddSuccessChainStepSchema = buildStrictObjectSchema({
  title: { type: "string" },
  description: { type: "string" },
  satisfied: { type: "boolean" },
});

export const toddNextUpdateSchema = buildStrictObjectSchema({
  title: { type: "string" },
  description: { type: "string" },
  pillarIds: {
    type: "array" as const,
    items: { type: "string" },
  },
  currentStateContext: { type: ["string", "null"] },
  successDefinition: { type: ["string", "null"] },
  partialSuccessDefinition: { type: ["string", "null"] },
  partialFailureDefinition: { type: ["string", "null"] },
  failureDefinition: { type: ["string", "null"] },
  updateKind: { type: ["string", "null"] as const },
  simplificationMode: { type: ["string", "null"] as const },
  structuralReason: { type: ["string", "null"] },
  supportsNextStep: { type: ["string", "null"] },
  skillsNeeded: {
    type: "array" as const,
    items: { type: "string" },
  },
  dependencies: {
    type: "array" as const,
    items: { type: "string" },
  },
});

export const toddCurrentStateItemSchema = buildStrictObjectSchema({
  id: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  pillarIds: { type: "array" as const, items: { type: "string" } },
  itemStatus: { type: "string", enum: ["done", "tbd"] },
});

export const toddEndStateItemSchema = buildStrictObjectSchema({
  id: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  pillarIds: { type: "array" as const, items: { type: "string" } },
});

export const toddPathwayItemSchema = buildStrictObjectSchema({
  id: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  pillarIds: { type: "array" as const, items: { type: "string" } },
  updateKind: { type: "string", enum: ["create", "expand", "refine"] },
  order: { type: "number" },
});

export const toddPriorityUpdateSchema = buildStrictObjectSchema({
  id: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  pillarIds: { type: "array" as const, items: { type: "string" } },
  updateKind: { type: "string", enum: ["create", "expand", "refine"] },
  currentStateContext: { type: "string" },
  successDefinition: { type: ["string", "null"] },
  partialSuccessDefinition: { type: ["string", "null"] },
  partialFailureDefinition: { type: ["string", "null"] },
  failureDefinition: { type: ["string", "null"] },
});

export const toddRoadmapSchema = buildStrictObjectSchema({
  currentState: { type: "array" as const, items: toddCurrentStateItemSchema },
  endState: { type: "array" as const, items: toddEndStateItemSchema },
  pathway: { type: "array" as const, items: toddPathwayItemSchema },
  priorityUpdate: { ...toddPriorityUpdateSchema, type: ["object", "null"] as const },
  generatedAt: { type: "string" },
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
