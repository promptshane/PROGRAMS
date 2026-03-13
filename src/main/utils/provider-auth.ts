import type { AiProvider, ClaudeAuthStatus, CodexAuthStatus } from "@shared/types";

export const getProviderPreflightError = (
  provider: AiProvider,
  status: CodexAuthStatus | ClaudeAuthStatus,
): string | null => {
  if (!status.available) {
    return status.errorMessage ?? `Install ${provider === "claude" ? "Claude Code" : "Codex"} first.`;
  }

  if (provider === "codex") {
    const codex = status as CodexAuthStatus;
    if (!codex.loggedIn) {
      return codex.errorMessage ?? "Connect Codex before using it in PROGRAMS.";
    }
    return null;
  }

  const claude = status as ClaudeAuthStatus;
  if (!claude.loggedIn) {
    return claude.connectErrorMessage ?? claude.errorMessage ?? "Connect Claude before using it in PROGRAMS.";
  }

  if (!claude.ready) {
    return claude.runtimeErrorMessage ?? claude.errorMessage ?? "Claude needs attention before it can run in PROGRAMS.";
  }

  return null;
};
