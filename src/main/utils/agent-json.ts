export class AgentJsonParseError extends Error {
  public readonly agentLabel: string;
  public readonly context: string;
  public readonly rawSnippet: string;

  constructor(agentLabel: string, rawSnippet: string, context: string) {
    super(
      `${agentLabel} returned conversational text instead of the required JSON format (${context}). First 200 chars: ${rawSnippet.slice(0, 200)}`,
    );
    this.name = "AgentJsonParseError";
    this.agentLabel = agentLabel;
    this.context = context;
    this.rawSnippet = rawSnippet;
  }
}

/**
 * Safely parse JSON from an agent response. Trims markdown code fences,
 * attempts to extract a balanced `{...}` substring first (tolerates prose
 * wrapping), then falls back to parsing the whole cleaned string. Throws
 * `AgentJsonParseError` with a friendly message instead of the raw SyntaxError
 * if no valid JSON can be extracted.
 */
export const parseAgentJsonResponse = <T = Record<string, unknown>>(
  raw: string,
  opts: { agentLabel: string; context: string },
): T => {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1)) as T;
    } catch {
      // fall through to full-string parse
    }
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AgentJsonParseError(opts.agentLabel, cleaned, opts.context);
  }
};
