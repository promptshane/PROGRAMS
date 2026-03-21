type JsonSchemaProperty = Record<string, unknown>;
type JsonSchemaProperties = Record<string, JsonSchemaProperty>;

const buildStrictObjectSchema = <T extends JsonSchemaProperties>(properties: T) => ({
  type: "object" as const,
  additionalProperties: false as const,
  required: Object.keys(properties) as Array<Extract<keyof T, string>>,
  properties,
});

const toddFeasibilityAssessmentSchema = buildStrictObjectSchema({
  area: { type: "string" },
  assessment: { type: "string" },
  stackRecommendation: { type: ["string", "null"] },
  complexity: { type: "string" },
  costNotes: { type: ["string", "null"] },
});

const toddVersionItemSchema = buildStrictObjectSchema({
  label: { type: "string" },
  description: { type: "string" },
  goals: {
    type: "array" as const,
    items: { type: "string" },
  },
});

const toddUpdateItemSchema = buildStrictObjectSchema({
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
});

const pingRawReportSchema = buildStrictObjectSchema({
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

export const directorPmSchema = buildStrictObjectSchema({
  response: { type: "string" },
  routeTo: { type: ["string", "null"] },
  routeReason: { type: ["string", "null"] },
});

export const directorToddResearchSchema = buildStrictObjectSchema({
  response: { type: "string" },
  feasibilityAssessments: {
    type: ["array", "null"] as const,
    items: toddFeasibilityAssessmentSchema,
  },
});

export const directorToddVersionSchema = buildStrictObjectSchema({
  response: { type: "string" },
  confirmationSuggested: { type: "boolean" },
  versions: {
    type: ["array", "null"] as const,
    items: toddVersionItemSchema,
  },
});

export const directorToddUpdateSchema = buildStrictObjectSchema({
  response: { type: "string" },
  confirmationSuggested: { type: "boolean" },
  updates: {
    type: ["array", "null"] as const,
    items: toddUpdateItemSchema,
  },
});

export const directorPingSchema = buildStrictObjectSchema({
  response: { type: "string" },
  status: { type: "string" },
  zhResponse: { type: "string" },
  enTranslation: { type: "string" },
  rawReport: {
    ...pingRawReportSchema,
    type: ["object", "null"] as const,
  },
});

export const directorBradGoalSchema = buildStrictObjectSchema({
  response: { type: "string" },
  goalSummary: { type: ["string", "null"] },
  relevantPillarIds: {
    type: ["array", "null"] as const,
    items: { type: "string" },
  },
});

export const directorBradTestSchema = buildStrictObjectSchema({
  response: { type: "string" },
  validationPassed: { type: ["boolean", "null"] },
  validationSummary: { type: ["string", "null"] },
  validationDetails: { type: ["string", "null"] },
});

export const directorBradCompareSchema = buildStrictObjectSchema({
  response: { type: "string" },
  passed: { type: ["boolean", "null"] },
  improvementAreas: {
    type: ["array", "null"] as const,
    items: { type: "string" },
  },
  comparisonSummary: { type: ["string", "null"] },
});
