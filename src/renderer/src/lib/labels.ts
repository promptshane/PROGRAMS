import type {
  PlanDraft,
  StatusTone,
  UpdateRecord,
} from "@shared/types";

export function labelForSetupStatus(status: StatusTone): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "action_required":
      return "Needs action";
    case "neutral":
      return "Ready";
    case "info":
      return "Info";
  }
}

export function labelForPlanStatus(status: PlanDraft["status"]): string {
  switch (status) {
    case "planning":
      return "Building the plan";
    case "awaitingApproval":
      return "Ready to confirm";
    case "executing":
      return "Applying the approved update";
    case "completed":
      return "Update finished";
    case "failed":
      return "Update needs attention";
  }
}

export function labelForUpdateStatus(status: UpdateRecord["status"]): string {
  switch (status) {
    case "saved":
      return "saved";
    case "reverted":
      return "reverted";
    case "failed":
      return "failed";
    case "executing":
      return "saving";
    case "planned":
      return "planned";
  }
}

export const humanizeSnakeCase = (value: string | null | undefined): string =>
  value ? value.replace(/_/g, " ") : "unknown";
