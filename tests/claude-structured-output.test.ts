import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeService } from "../src/main/services/claude-service.ts";

const extractFinalResult = (chunks: string[]): unknown => {
  const service = new ClaudeService(() => {});
  return (service as unknown as { extractFinalResult(lines: string[]): unknown }).extractFinalResult(chunks);
};

test("Claude structured parsing accepts explicit string result payloads", () => {
  const payload = extractFinalResult([
    JSON.stringify({
      type: "result",
      is_error: false,
      result: "{\"summary\":\"Plan ready\",\"impact\":\"Users get the update.\"}",
    }),
  ]);

  assert.equal(payload, "{\"summary\":\"Plan ready\",\"impact\":\"Users get the update.\"}");
});

test("Claude structured parsing accepts explicit object result payloads", () => {
  const payload = extractFinalResult([
    JSON.stringify({
      type: "result",
      is_error: false,
      result: {
        summary: "Plan ready",
        impact: "Users get the update.",
      },
    }),
  ]);

  assert.deepEqual(payload, {
    summary: "Plan ready",
    impact: "Users get the update.",
  });
});

test("Claude structured parsing accepts structured content embedded in the final result event", () => {
  const payload = extractFinalResult([
    JSON.stringify({
      type: "result",
      is_error: false,
      result: "",
      message: {
        content: [
          {
            type: "tool_use",
            name: "StructuredOutput",
            input: {
              summary: "Plan ready",
              impact: "Users get the update.",
            },
          },
        ],
      },
    }),
  ]);

  assert.deepEqual(payload, {
    summary: "Plan ready",
    impact: "Users get the update.",
  });
});

test("Claude structured parsing falls back to earlier assistant structured output after an empty success result event", () => {
  const payload = extractFinalResult([
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "StructuredOutput",
            input: {
              summary: "Plan ready",
              impact: "Users get the update.",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "result",
      is_error: false,
      result: "",
    }),
  ]);

  assert.deepEqual(payload, {
    summary: "Plan ready",
    impact: "Users get the update.",
  });
});

test("Claude structured parsing still throws for true error result events", () => {
  assert.throws(
    () =>
      extractFinalResult([
        JSON.stringify({
          type: "result",
          is_error: true,
          result: "Not logged in",
        }),
      ]),
    /not logged in/i,
  );
});

test("Claude structured parsing still fails cleanly when no fallback payload exists", () => {
  assert.throws(
    () =>
      extractFinalResult([
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Still thinking..." }],
          },
        }),
        JSON.stringify({
          type: "result",
          is_error: false,
          result: "",
        }),
      ]),
    /result event without a valid payload/i,
  );
});
