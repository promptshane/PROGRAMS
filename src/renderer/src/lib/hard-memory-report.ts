import type { AgentCoreDetails, AgentSession, HardMemoryReportMetadata } from "@shared/types";

export const resolveDanHardMemoryReportDraft = (
  report: HardMemoryReportMetadata,
  session: AgentSession | null,
): AgentCoreDetails | null => {
  if (report.dataType !== "danDraftCoreDetails") {
    return null;
  }

  if (report.reportStage === "soft") {
    return report.draftCoreDetails ?? session?.danMemory?.draftConcept ?? session?.danDraftCoreDetails ?? null;
  }

  return report.draftCoreDetails;
};
