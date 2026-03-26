import { buildStrictObjectSchema, toddVersionItemSchema, toddUpdateItemSchema, pingRawReportSchema } from "./shared-schema.ts";

const toddFeasibilityAssessmentSchema = buildStrictObjectSchema({
  area: { type: "string" },
  assessment: { type: "string" },
  stackRecommendation: { type: ["string", "null"] },
  complexity: { type: "string" },
  costNotes: { type: ["string", "null"] },
});

export const directorPmSchema = buildStrictObjectSchema({
  response: { type: "string" },
  routeTo: { type: ["string", "null"] },
  routeReason: { type: ["string", "null"] },
});

export const directorToddResearchSchema = buildStrictObjectSchema({
  response: { type: "string" },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
  feasibilityAssessments: {
    type: ["array", "null"] as const,
    items: toddFeasibilityAssessmentSchema,
  },
  notesToAppend: {
    type: "array" as const,
    items: { type: "string" },
  },
});

export const directorToddVersionSchema = buildStrictObjectSchema({
  response: { type: "string" },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
  confirmationSuggested: { type: "boolean" },
  versions: {
    type: ["array", "null"] as const,
    items: toddVersionItemSchema,
  },
  notesToAppend: {
    type: "array" as const,
    items: { type: "string" },
  },
});

export const directorToddUpdateSchema = buildStrictObjectSchema({
  response: { type: "string" },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
  confirmationSuggested: { type: "boolean" },
  updates: {
    type: ["array", "null"] as const,
    items: toddUpdateItemSchema,
  },
  notesToAppend: {
    type: "array" as const,
    items: { type: "string" },
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

export const directorPongGoalSchema = buildStrictObjectSchema({
  response: { type: "string" },
  zhResponse: { type: "string" },
  enTranslation: { type: "string" },
  goalSummary: { type: ["string", "null"] },
  relevantPillarIds: {
    type: ["array", "null"] as const,
    items: { type: "string" },
  },
});

export const directorPongTestSchema = buildStrictObjectSchema({
  response: { type: "string" },
  zhResponse: { type: "string" },
  enTranslation: { type: "string" },
  validationPassed: { type: ["boolean", "null"] },
  validationSummary: { type: ["string", "null"] },
  validationDetails: { type: ["string", "null"] },
});

export const directorPongCompareSchema = buildStrictObjectSchema({
  response: { type: "string" },
  zhResponse: { type: "string" },
  enTranslation: { type: "string" },
  passed: { type: ["boolean", "null"] },
  improvementAreas: {
    type: ["array", "null"] as const,
    items: { type: "string" },
  },
  comparisonSummary: { type: ["string", "null"] },
});
