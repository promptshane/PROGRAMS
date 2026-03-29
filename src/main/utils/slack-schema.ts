import { buildStrictObjectSchema, toddVersionItemSchema, toddUpdateItemSchema, pingRawReportSchema } from "./shared-schema.ts";

export const directorSlackSchema = buildStrictObjectSchema({
  response: { type: "string" },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
});

export const researchSlackSchema = buildStrictObjectSchema({
  response: { type: "string" },
  generalSummary: { type: ["string", "null"] },
  projectSummary: { type: ["string", "null"] },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
  notesToAppend: {
    type: "array" as const,
    items: { type: "string" },
  },
});

export const toddVersionSlackSchema = buildStrictObjectSchema({
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

export const toddUpdateSlackSchema = buildStrictObjectSchema({
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

const danDraftPillarSchema = buildStrictObjectSchema({
  name: { type: "string" },
  pillarType: { type: "string" },
  parentName: { type: ["string", "null"] },
  function: { type: ["string", "null"] },
  thesis: { type: ["string", "null"] },
  fullFlow: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  assumptionText: { type: ["string", "null"] },
  assumptionSource: { type: ["string", "null"] },
  order: { type: "number" },
  connectedPillarNames: {
    type: "array" as const,
    items: { type: "string" },
  },
  threadMemberships: {
    type: ["array", "null"] as const,
    items: buildStrictObjectSchema({
      threadName: { type: "string" },
      role: { type: ["string", "null"] },
    }),
  },
  endState: { type: ["string", "null"] },
});

const danDraftCoreDetailsSchema = buildStrictObjectSchema({
  function: { type: ["string", "null"] },
  thesis: { type: ["string", "null"] },
  fullFlow: { type: ["string", "null"] },
  pillars: {
    type: "array" as const,
    items: danDraftPillarSchema,
  },
  threads: {
    type: ["array", "null"] as const,
    items: buildStrictObjectSchema({
      name: { type: "string" },
      description: { type: ["string", "null"] },
    }),
  },
});

const danDraftOperationSchema = {
  type: "object" as const,
  additionalProperties: false as const,
  required: ["type"] as const,
  properties: {
    type: { type: "string" },
    target: { type: ["string", "null"] },
    value: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    previousName: { type: ["string", "null"] },
    parentName: { type: ["string", "null"] },
    pillarType: { type: ["string", "null"] },
    function: { type: ["string", "null"] },
    thesis: { type: ["string", "null"] },
    fullFlow: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    assumptionText: { type: ["string", "null"] },
    assumptionSource: { type: ["string", "null"] },
    order: { type: ["number", "null"] },
    connectedPillarNames: {
      type: ["array", "null"] as const,
      items: { type: "string" },
    },
    threadMemberships: {
      type: ["array", "null"] as const,
      items: {
        type: "object" as const,
        additionalProperties: false as const,
        required: ["threadName"] as const,
        properties: {
          threadName: { type: "string" },
          role: { type: ["string", "null"] },
        },
      },
    },
    endState: { type: ["string", "null"] },
  },
};

export const danSlackSchema = buildStrictObjectSchema({
  response: { type: "string" },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
  notesToAppend: {
    type: "array" as const,
    items: { type: "string" },
  },
  rawMemoriesToAppend: {
    type: ["array", "null"] as const,
    items: buildStrictObjectSchema({
      content: { type: "string" },
      relatedPillarNames: {
        type: "array" as const,
        items: { type: "string" },
      },
    }),
  },
  conversationStatus: { type: "string" },
  draftChangeSummary: {
    type: "array" as const,
    items: { type: "string" },
  },
  draftOperations: {
    type: "array" as const,
    items: danDraftOperationSchema,
  },
  draftCoreDetails: {
    ...danDraftCoreDetailsSchema,
    type: ["object", "null"] as const,
  },
  presenceAction: { type: "string" },
  toddHandoffNotesToAppend: {
    type: "array" as const,
    items: { type: "string" },
  },
});

export const pingSlackSchema = buildStrictObjectSchema({
  response: { type: "string" },
  handoffTo: { type: ["string", "null"] },
  handoffReason: { type: ["string", "null"] },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
  status: { type: "string" },
  zhResponse: { type: "string" },
  enTranslation: { type: "string" },
  rawReport: {
    ...pingRawReportSchema,
    type: ["object", "null"] as const,
  },
});

export const refreshScanSchema = buildStrictObjectSchema({
  response: { type: "string" },
  scanSummary: { type: "string" },
  same: { type: "array" as const, items: { type: "string" } },
  updated: { type: "array" as const, items: { type: "string" } },
  detectedFeatures: { type: "array" as const, items: { type: "string" } },
  currentState: { type: ["string", "null"] },
  passToCreativeDirector: { type: ["string", "null"] },
});

const corePillarItemSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    function: { type: ["string", "null"] },
    thesis: { type: ["string", "null"] },
    order: { type: "number" },
    children: {
      type: "array" as const,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          function: { type: ["string", "null"] },
          order: { type: "number" },
        },
        required: ["name", "order"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "order"],
  additionalProperties: false,
};

export const refreshMappingSchema = buildStrictObjectSchema({
  response: { type: "string" },
  currentCorePillars: {
    type: "array" as const,
    items: corePillarItemSchema,
  },
  same: { type: "array" as const, items: { type: "string" } },
  updated: { type: "array" as const, items: { type: "string" } },
  currentState: { type: ["string", "null"] },
  idealState: { type: ["string", "null"] },
});
