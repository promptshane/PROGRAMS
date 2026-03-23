import type {
  CreativeFocusMode,
  DirectorFocusMode,
  DirectorId,
  RdFocusMode,
  ValidationFocusMode,
} from "../../shared/types.ts";
import { resolveSlackDirectorMode } from "./slack-flow.ts";

const matchesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const CREATIVE_VIBES_PATTERNS = [
  /\bvibe(s)?\b/i,
  /\bmood\b/i,
  /\baesthetic(s)?\b/i,
  /\bvisual\b/i,
  /\bpalette\b/i,
  /\bcolor(s)?\b/i,
  /\bstyle\b/i,
  /\blook and feel\b/i,
  /\binspiration\b/i,
  /\breference(s)?\b/i,
  /\bimage(s)?\b/i,
  /\bscreenshot(s)?\b/i,
  /\bart\b/i,
] as const;

const CREATIVE_CONVERSATION_PATTERNS = [
  /\bbrainstorm(ing)?\b/i,
  /\bexplore\b/i,
  /\bdiscuss(ion)?\b/i,
  /\bchat\b/i,
  /\btalk\b/i,
  /\bwhat if\b/i,
  /\bidea(s)?\b/i,
  /\bthink through\b/i,
  /\bimagine\b/i,
  /\bmaybe\b/i,
] as const;

const VALIDATION_TEST_PATTERNS = [
  /\btest(ing)?\b/i,
  /\bcheck(ing)?\b/i,
  /\binspect(ing|ion)?\b/i,
  /\bverify(ing|ication)?\b/i,
  /\breproduce(ing|tion)?\b/i,
  /\bcurrent state\b/i,
  /\bscreenshot(s)?\b/i,
  /\bbug(s)?\b/i,
  /\bfail(ure|ed|ing)?\b/i,
] as const;

const VALIDATION_COMPARE_PATTERNS = [
  /\bcompare\b/i,
  /\bdifference(s)?\b/i,
  /\bgap(s)?\b/i,
  /\bagainst\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bmissing\b/i,
  /\bcontrast\b/i,
  /\bcurrent\s+vs\b/i,
] as const;

const VALIDATION_GOAL_PATTERNS = [
  /\bgoal(s)?\b/i,
  /\bexpected\b/i,
  /\bintended\b/i,
  /\bdesired state\b/i,
  /\bsuccess criteria\b/i,
  /\bwhat should\b/i,
  /\bwhat is the goal\b/i,
  /\boutcome\b/i,
  /\btarget\b/i,
  /\bdefine\b/i,
] as const;

const resolveCreativeDirectorFocusMode = (message: string): CreativeFocusMode => {
  const normalized = message.trim();
  if (matchesAny(normalized, CREATIVE_VIBES_PATTERNS)) {
    return "vibes";
  }
  if (matchesAny(normalized, CREATIVE_CONVERSATION_PATTERNS)) {
    return "conversation";
  }
  return "core-details";
};

const resolveRdDirectorFocusMode = (message: string): RdFocusMode => {
  const slackMode = resolveSlackDirectorMode("rd-director", message);
  if (slackMode === "version-planning") {
    return "version-planning";
  }
  if (slackMode === "update-planning") {
    return "update-planning";
  }
  return "research";
};

const resolveValidationDirectorFocusMode = (message: string): ValidationFocusMode => {
  const normalized = message.trim();
  if (matchesAny(normalized, VALIDATION_TEST_PATTERNS)) {
    return "test-current-state";
  }
  if (matchesAny(normalized, VALIDATION_COMPARE_PATTERNS)) {
    return "compare";
  }
  if (matchesAny(normalized, VALIDATION_GOAL_PATTERNS)) {
    return "identify-goal";
  }
  return "compare";
};

export const resolveDirectorChatFocusMode = (
  directorId: DirectorId,
  message: string,
  explicitFocusMode: DirectorFocusMode | null,
): DirectorFocusMode | null => {
  if (explicitFocusMode) {
    return explicitFocusMode;
  }

  switch (directorId) {
    case "creative-director":
      return resolveCreativeDirectorFocusMode(message);
    case "rd-director":
      return resolveRdDirectorFocusMode(message);
    case "validation-director":
      return resolveValidationDirectorFocusMode(message);
    default:
      return null;
  }
};
