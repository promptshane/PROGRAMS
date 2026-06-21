import { randomUUID } from "node:crypto";
import type {
  HomeChatMessage,
  HomeDelivery,
  HomeDeliveryNature,
  HomeNewProjectProposal,
  HomeRoutingPlan,
  ProjectDigest,
} from "../../shared/types.ts";
import { parseAgentJsonResponse } from "./agent-json.ts";

/**
 * JSON schema for the homepage agent's routing decision. The agent decides
 * which existing project (if any) each part of the user's note belongs to,
 * drafts a relay message for that project's manager (Jeff), asks clarifying
 * questions when ambiguous, and proposes new projects only when nothing fits.
 */
export const HOME_ROUTING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "clarifyingQuestions", "deliveries", "newProjectProposals"],
  properties: {
    reply: { type: "string" },
    clarifyingQuestions: { type: "array", items: { type: "string" } },
    deliveries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["projectId", "newProjectName", "content", "nature", "reason"],
        properties: {
          projectId: { type: ["string", "null"] },
          newProjectName: { type: ["string", "null"] },
          content: { type: "string" },
          nature: { type: "string", enum: ["creative", "technical", "general"] },
          reason: { type: "string" },
        },
      },
    },
    newProjectProposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "initialIdea", "reason"],
        properties: {
          name: { type: "string" },
          initialIdea: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const HOME_AGENT_LABEL = "Home";

const formatDigest = (digest: ProjectDigest): string =>
  [
    `- Project "${digest.name}" (id: ${digest.projectId})`,
    `    What it is: ${digest.description || "No description yet."}`,
    `    Where it's at: ${digest.whereItsAt}`,
    `    Where it's going: ${digest.whereItsGoing}`,
  ].join("\n");

const formatRecentMessages = (messages: HomeChatMessage[]): string => {
  if (messages.length === 0) {
    return "(no prior conversation)";
  }
  return messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "You" : "Home"}: ${message.content}`)
    .join("\n");
};

export const buildHomeAgentPrompt = (
  digests: ProjectDigest[],
  recentMessages: HomeChatMessage[],
  userMessage: string,
): string => {
  const projectBlock =
    digests.length > 0
      ? digests.map(formatDigest).join("\n\n")
      : "(no projects exist yet)";

  return `You are the front desk / concierge for a workspace of software projects. The user talks to ONLY you. They may ramble or paste daily notes covering several projects at once. Your job is to figure out which project each piece of the note belongs to and relay it to that project's manager (Jeff), who will route it onward to the right specialist.

Here is every project and roughly where it is at:

${projectBlock}

Recent conversation with you:
${formatRecentMessages(recentMessages)}

The user just said:
"""
${userMessage}
"""

Decide how to route this. Follow these rules:
- Break the note into the distinct pieces of information it contains. Each piece that clearly belongs to an existing project becomes one delivery for that project.
- For each delivery, write "content" as a clean, self-contained relay message addressed to that project's manager — preserve the user's intent and useful detail, but make it readable on its own.
- Tag each delivery's "nature": "creative" for concept/idea/story/design updates (these go to Dan), "technical" for engineering/architecture/bug/implementation updates (these go to Todd), or "general" for coordination/status/anything else.
- When a piece is ambiguous (you cannot confidently pick a project, or the meaning is unclear), DO NOT guess. Add a specific question to "clarifyingQuestions" instead of creating a delivery for it.
- Only when a piece clearly describes something that is NOT any existing project, add an entry to "newProjectProposals" with a concise "name" and an "initialIdea" seeded from the note. Then add a matching delivery whose "projectId" is null and whose "newProjectName" exactly equals the proposal's "name".
- For deliveries to existing projects, set "projectId" to the project's id and "newProjectName" to null.
- "reply" is a short, friendly summary to the user of what you understood and what you plan to do. Do not claim anything was sent — nothing is sent until the user confirms.
- If you have nothing to route and only need clarification, return empty "deliveries" and "newProjectProposals" with your questions in "clarifyingQuestions".

Return ONLY strict JSON matching the schema. Do not omit any field; use empty arrays where nothing applies.`;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizeNature = (value: unknown): HomeDeliveryNature =>
  value === "creative" || value === "technical" ? value : value === "general" ? "general" : "general";

/**
 * Parse and normalize the raw model output into a HomeRoutingPlan. Deliveries
 * that reference a new project are linked to their proposal by name so the
 * backend can create the project first, then deliver into it.
 */
export const parseHomeRoutingResponse = (raw: string): HomeRoutingPlan => {
  const parsed = parseAgentJsonResponse<Record<string, unknown>>(raw, {
    agentLabel: HOME_AGENT_LABEL,
    context: "home routing turn",
  });

  const proposalsRaw = Array.isArray(parsed.newProjectProposals) ? parsed.newProjectProposals : [];
  const proposals: HomeNewProjectProposal[] = [];
  const proposalIdByName = new Map<string, string>();
  for (const item of proposalsRaw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = asString(record.name).trim();
    if (!name) continue;
    const id = randomUUID();
    proposalIdByName.set(name.toLowerCase(), id);
    proposals.push({
      id,
      name,
      initialIdea: asString(record.initialIdea).trim() || name,
      reason: asString(record.reason).trim(),
    });
  }

  const deliveriesRaw = Array.isArray(parsed.deliveries) ? parsed.deliveries : [];
  const deliveries: HomeDelivery[] = [];
  for (const item of deliveriesRaw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const content = asString(record.content).trim();
    if (!content) continue;
    const projectId = asString(record.projectId).trim();
    const newProjectName = asString(record.newProjectName).trim();
    const proposalId = newProjectName ? proposalIdByName.get(newProjectName.toLowerCase()) ?? null : null;
    deliveries.push({
      id: randomUUID(),
      projectId,
      projectName: projectId ? "" : newProjectName,
      newProjectProposalId: proposalId,
      content,
      nature: normalizeNature(record.nature),
      reason: asString(record.reason).trim(),
      status: "proposed",
    });
  }

  return {
    id: randomUUID(),
    reply: asString(parsed.reply).trim() || "Here's what I picked up.",
    clarifyingQuestions: asStringArray(parsed.clarifyingQuestions).map((q) => q.trim()).filter(Boolean),
    deliveries,
    newProjectProposals: proposals,
  };
};
