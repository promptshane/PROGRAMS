import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeAuthStatus,
  buildClaudePrintArgs,
  parseClaudeCliFeatures,
  parseClaudeLocalAuthMetadata,
} from "../src/main/utils/claude-cli.ts";

test("parseClaudeLocalAuthMetadata reads the signed-in account", () => {
  const metadata = parseClaudeLocalAuthMetadata(`{
    "oauthAccount": {
      "emailAddress": "caseyshane28@gmail.com",
      "displayName": "KC",
      "billingType": "stripe_subscription"
    }
  }`);

  assert.deepEqual(metadata, {
    loggedIn: true,
    email: "caseyshane28@gmail.com",
    displayName: "KC",
    planType: "Subscription",
  });
});

test("parseClaudeCliFeatures detects auth commands and verbose stream-json support", () => {
  const features = parseClaudeCliFeatures(`
Commands:
  auth                                              Manage authentication
  update                                            Check for updates

Options:
  --json-schema                                     Enforce a JSON schema
  --output-format <format>                          Output format
  --permission-mode <mode>                          Select permission behavior
  --print                                           Print response and exit
  --verbose                                         Override verbose mode
`);

  assert.deepEqual(features, {
    supportsAuthCommands: true,
    supportsStreamJsonVerbose: true,
    supportsJsonSchema: true,
    supportsPermissionMode: true,
  });
});

test("buildClaudePrintArgs includes native schema and permission mode when requested", () => {
  const args = buildClaudePrintArgs({
    prompt: "Say ok",
    model: "sonnet",
    settingsArg: "{\"effortLevel\":\"medium\"}",
    maxTurns: 5,
    allowedTools: "Read,Write",
    jsonSchema: {
      type: "object",
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    },
    permissionMode: "plan",
  });

  assert.deepEqual(args, [
    "-p",
    "Say ok",
    "--model",
    "sonnet",
    "--settings",
    "{\"effortLevel\":\"medium\"}",
    "--json-schema",
    "{\"type\":\"object\",\"required\":[\"ok\"],\"properties\":{\"ok\":{\"type\":\"boolean\"}}}",
    "--permission-mode",
    "plan",
    "--print",
    "--verbose",
    "--max-turns",
    "5",
    "--output-format",
    "stream-json",
    "--allowedTools",
    "Read,Write",
  ]);
});

test("buildClaudeAuthStatus handles signed-in, signed-out, incompatible, and runtime-error states", () => {
  const signedIn = buildClaudeAuthStatus({
    available: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.20",
    cliAuth: {
      loggedIn: true,
      authMethod: "oauth",
      apiProvider: "claude.ai",
    },
    localAuth: {
      loggedIn: true,
      email: "user@example.com",
      displayName: "User",
      planType: "Subscription",
    },
    features: {
      supportsAuthCommands: true,
      supportsStreamJsonVerbose: true,
      supportsJsonSchema: true,
      supportsPermissionMode: true,
    },
  });
  assert.equal(signedIn.loggedIn, true);
  assert.equal(signedIn.ready, true);
  assert.equal(signedIn.canConnect, true);
  assert.equal(signedIn.email, "user@example.com");
  assert.equal(signedIn.errorMessage, null);

  const signedOut = buildClaudeAuthStatus({
    available: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.20",
    localAuth: null,
    features: {
      supportsAuthCommands: true,
      supportsStreamJsonVerbose: true,
      supportsJsonSchema: true,
      supportsPermissionMode: true,
    },
  });
  assert.equal(signedOut.loggedIn, false);
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.canConnect, true);
  assert.equal(signedOut.errorMessage, "Claude Code is not signed in.");

  const incompatibleConnect = buildClaudeAuthStatus({
    available: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.20",
    localAuth: null,
    features: {
      supportsAuthCommands: false,
      supportsStreamJsonVerbose: true,
      supportsJsonSchema: true,
      supportsPermissionMode: true,
    },
  });
  assert.equal(incompatibleConnect.loggedIn, false);
  assert.equal(incompatibleConnect.canConnect, false);
  assert.match(incompatibleConnect.connectErrorMessage ?? "", /update claude code/i);

  const runtimeError = buildClaudeAuthStatus({
    available: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.20",
    cliAuth: {
      loggedIn: true,
      authMethod: "oauth",
      apiProvider: "claude.ai",
    },
    localAuth: {
      loggedIn: true,
      email: "user@example.com",
      displayName: "User",
      planType: "Subscription",
    },
    features: {
      supportsAuthCommands: true,
      supportsStreamJsonVerbose: false,
      supportsJsonSchema: true,
      supportsPermissionMode: true,
    },
  });
  assert.equal(runtimeError.loggedIn, true);
  assert.equal(runtimeError.ready, false);
  assert.match(runtimeError.runtimeErrorMessage ?? "", /update claude code/i);
});
