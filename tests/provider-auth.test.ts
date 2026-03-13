import assert from "node:assert/strict";
import test from "node:test";
import { getProviderPreflightError } from "../src/main/utils/provider-auth.ts";

test("getProviderPreflightError allows a ready Codex connection", () => {
  const result = getProviderPreflightError("codex", {
    available: true,
    loggedIn: true,
    binaryPath: "/Applications/Codex.app/Contents/Resources/codex",
    version: "0.115.0-alpha.11",
    email: "user@example.com",
    planType: "Plus",
    authMode: "chatgpt",
    errorMessage: null,
  });

  assert.equal(result, null);
});

test("getProviderPreflightError returns codex auth failures", () => {
  const result = getProviderPreflightError("codex", {
    available: true,
    loggedIn: false,
    binaryPath: "/Applications/Codex.app/Contents/Resources/codex",
    version: "0.115.0-alpha.11",
    email: null,
    planType: null,
    authMode: null,
    errorMessage: "Connect Codex first.",
  });

  assert.equal(result, "Connect Codex first.");
});

test("getProviderPreflightError returns claude connection and runtime failures", () => {
  const connectFailure = getProviderPreflightError("claude", {
    available: true,
    loggedIn: false,
    ready: false,
    canConnect: false,
    binaryPath: "/Users/example/.local/bin/claude",
    version: "2.1.20",
    email: null,
    displayName: null,
    planType: null,
    errorMessage: "Update Claude Code to connect your Claude account from PROGRAMS.",
    runtimeErrorMessage: null,
    connectErrorMessage: "Update Claude Code to connect your Claude account from PROGRAMS.",
  });
  assert.match(connectFailure ?? "", /update claude code/i);

  const runtimeFailure = getProviderPreflightError("claude", {
    available: true,
    loggedIn: true,
    ready: false,
    canConnect: true,
    binaryPath: "/Users/example/.local/bin/claude",
    version: "2.1.20",
    email: "user@example.com",
    displayName: "User",
    planType: "Subscription",
    errorMessage: "Update Claude Code to use Claude from PROGRAMS.",
    runtimeErrorMessage: "Update Claude Code to use Claude from PROGRAMS.",
    connectErrorMessage: null,
  });
  assert.match(runtimeFailure ?? "", /use claude from programs/i);
});
