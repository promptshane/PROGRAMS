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
  --output-format <format>                          Output format
  --print                                           Print response and exit
  --verbose                                         Override verbose mode
`);

  assert.deepEqual(features, {
    supportsAuthCommands: true,
    supportsStreamJsonVerbose: true,
  });
});

test("buildClaudePrintArgs always includes verbose stream-json output", () => {
  const args = buildClaudePrintArgs({
    prompt: "Say ok",
    model: "sonnet",
    settingsArg: "{\"effortLevel\":\"medium\"}",
    maxTurns: 5,
    allowedTools: "Read,Write",
  });

  assert.deepEqual(args, [
    "-p",
    "Say ok",
    "--model",
    "sonnet",
    "--settings",
    "{\"effortLevel\":\"medium\"}",
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
    },
  });
  assert.equal(runtimeError.loggedIn, true);
  assert.equal(runtimeError.ready, false);
  assert.match(runtimeError.runtimeErrorMessage ?? "", /update claude code/i);
});
