import type { AgentCoreDetails, AgentSession, HardMemoryReportMetadata } from "@shared/types";

export const resolveDanHardMemoryReportDraft = (
  report: HardMemoryReportMetadata,
  session: AgentSession | null,
): AgentCoreDetails | null => {
  if (report.dataType !== "danDraftCoreDetails") {
    return null;
  }

  if (report.draftCoreDetails) {
    return report.draftCoreDetails;
  }

  return session?.danMemory.draftConcept ?? session?.danDraftCoreDetails ?? null;
};
