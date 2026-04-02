import { useState } from "react";
import { sortPillarsByOrder } from "@shared/pillar-flow";
import type { AgentCoreDetails, AgentSession, CorePillar } from "@shared/types";

export function CoreDetailsReport({
  coreDetails,
}: {
  coreDetails: AgentCoreDetails | null;
}) {
  const safeCoreDetails: AgentCoreDetails = coreDetails ?? {
    function: null,
    thesis: null,
    corePillars: [],
    fullFlow: null,
    threads: [],
  };

  const functionSummary = safeCoreDetails.function?.summary.trim() ? safeCoreDetails.function.summary : "Not yet defined.";
  const thesisSummary = safeCoreDetails.thesis?.summary.trim() ? safeCoreDetails.thesis.summary : "Not yet defined.";
  const fullFlowSummary = safeCoreDetails.fullFlow?.summary.trim() ? safeCoreDetails.fullFlow.summary : "Not yet defined.";
  const isFunctionAssumed = safeCoreDetails.function?.status === "assumed" || safeCoreDetails.function?.status === "edited";
  const isThesisAssumed = safeCoreDetails.thesis?.status === "assumed" || safeCoreDetails.thesis?.status === "edited";
  const isFullFlowAssumed = safeCoreDetails.fullFlow?.status === "assumed" || safeCoreDetails.fullFlow?.status === "edited";

  return (
    <div className="coreDetailsReport">
      <article className="coreDetailCard coreDetailsReportSection">
        <h4>Function</h4>
        <p className={`coreDetailValue${isFunctionAssumed ? " assumedText" : ""}`}>{functionSummary}</p>
      </article>
      <article className="coreDetailCard coreDetailsReportSection">
        <h4>Thesis</h4>
        <p className={`coreDetailValue${isThesisAssumed ? " assumedText" : ""}`}>{thesisSummary}</p>
      </article>
      <article className="coreDetailCard coreDetailsReportSection coreDetailsReportSection-pillars">
        <h4>Core Pillars</h4>
        {safeCoreDetails.corePillars.length > 0 ? (
          <ConceptThreadList pillars={safeCoreDetails.corePillars} />
        ) : (
          <p className="coreDetailEmpty">No core pillars have been confirmed yet.</p>
        )}
      </article>
      <article className="coreDetailCard coreDetailsReportSection coreDetailsReportSection-flow">
        <h4>Full flow</h4>
        {safeCoreDetails.fullFlow ? (
          <>
            <p className={`coreDetailValue${isFullFlowAssumed ? " assumedText" : ""}`}>{fullFlowSummary}</p>
            {safeCoreDetails.fullFlow.currentState ? (
              <div className="pillarDetailRow">
                <span className="pillarDetailLabel">Current state</span>
                <span className={isFullFlowAssumed ? "assumedText" : ""}>{safeCoreDetails.fullFlow.currentState}</span>
              </div>
            ) : null}
            {safeCoreDetails.fullFlow.finalGoal ? (
              <div className="pillarDetailRow">
                <span className="pillarDetailLabel">Final goal</span>
                <span className={isFullFlowAssumed ? "assumedText" : ""}>{safeCoreDetails.fullFlow.finalGoal}</span>
              </div>
            ) : null}
            {safeCoreDetails.fullFlow.steps && safeCoreDetails.fullFlow.steps.length > 0 ? (
              <ol className="flowStepList">
                {safeCoreDetails.fullFlow.steps.map((step) => (
                  <li key={step.id} className="flowStepItem">
                    <div>
                      <div>{step.description}</div>
                      {step.pillarIds.length > 0 ? (
                        <div className="flowStepPillars">
                          {step.pillarIds.map((pillarId) => {
                            const pillar = safeCoreDetails.corePillars.find((candidate) => candidate.id === pillarId);
                            return pillar ? (
                              <span key={pillarId} className="flowStepPillarTag">
                                {pillar.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : (
          <p className="coreDetailEmpty">Not yet defined.</p>
        )}
      </article>
    </div>
  );
}

export function CoreDetailsContent({
  agentSession,
}: {
  agentSession: AgentSession | null;
}) {
  const coreDetails: AgentCoreDetails = {
    function: agentSession?.stages.function.confirmed ?? null,
    thesis: agentSession?.stages.thesis.confirmed ?? null,
    corePillars: agentSession?.corePillars ?? [],
    fullFlow: agentSession?.stages.full_flow.confirmed ?? null,
    threads: [],
  };

  return <CoreDetailsReport coreDetails={coreDetails} />;
}

export function ConceptThreadItem({ pillar, depth }: { pillar: CorePillar; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = pillar.corePillars.length > 0;

  return (
    <article
      className="conceptThreadCard"
      style={{ marginLeft: depth > 0 ? depth * 16 : 0 }}
    >
      <div
        className="conceptThreadTitleRow conceptThreadTitleRow--toggle"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" || e.key === " " ? setExpanded((v) => !v) : undefined}
      >
        <span className={`conceptThreadChevron${expanded ? " conceptThreadChevron--open" : ""}${!hasChildren ? " conceptThreadChevron--hidden" : ""}`}>›</span>
        <h5 className="conceptThreadTitle">{pillar.name}</h5>
        {pillar.function?.status === "assumed" ? (
          <span className="pillarStatusBadge pillarStatusBadge--assumed">assumed</span>
        ) : null}
        <span className="conceptThreadBadgeGroup">
          {hasChildren ? (
            <span className="pillarStatusBadge pillarStatusBadge--nested">NESTED</span>
          ) : pillar.pillarType === "tbd" ? (
            <span className="pillarStatusBadge pillarStatusBadge--tbd">TBD</span>
          ) : (
            <span className="pillarStatusBadge pillarStatusBadge--end">END</span>
          )}
        </span>
      </div>
      {expanded ? (
        <>
          <div className="conceptThreadMeta">
            {pillar.function?.summary ? (
              <div className="conceptThreadMetaRow">
                <span className="pillarDetailLabel">Role</span>
                <span className={pillar.function.status === "assumed" ? "assumedText" : ""}>{pillar.function.summary}</span>
              </div>
            ) : null}
            {pillar.thesis?.summary ? (
              <div className="conceptThreadMetaRow">
                <span className="pillarDetailLabel">Why it matters</span>
                <span className={pillar.thesis.status === "assumed" ? "assumedText" : ""}>{pillar.thesis.summary}</span>
              </div>
            ) : null}
            {pillar.fullFlow?.summary ? (
              <div className="conceptThreadMetaRow">
                <span className="pillarDetailLabel">Experience</span>
                <span className={pillar.fullFlow.status === "assumed" ? "assumedText" : ""}>{pillar.fullFlow.summary}</span>
              </div>
            ) : null}
            {pillar.description ? (
              <p className="conceptThreadDescription">{pillar.description}</p>
            ) : null}
          </div>
          {hasChildren ? (
            <ConceptThreadList pillars={pillar.corePillars} depth={depth + 1} />
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export function ConceptThreadList({
  pillars,
  depth = 0,
}: {
  pillars: CorePillar[];
  depth?: number;
}) {
  return (
    <div className="conceptThreadList">
      {sortPillarsByOrder(pillars).map((pillar) => (
        <ConceptThreadItem key={pillar.id} pillar={pillar} depth={depth} />
      ))}
    </div>
  );
}

export type CorePillarsView = "Linear" | "Threads" | "Total";

export function ConceptOverview({
  concept,
  title,
  emptyLabel,
}: {
  concept: AgentCoreDetails | null;
  title?: string;
  emptyLabel: string;
}) {
  const [pillarsView, setPillarsView] = useState<CorePillarsView>("Threads");

  if (!concept) {
    return <p className="coreDetailEmpty">{emptyLabel}</p>;
  }

  return (
    <div className="conceptOverview">
      {title ? <h5 className="conceptOverviewTitle">{title}</h5> : null}
      <div className="conceptOverviewGrid">
        <article className="coreDetailCard">
          <h4>Function</h4>
          <p className="coreDetailValue">{concept.function?.summary ?? "Not yet defined."}</p>
        </article>
        <article className="coreDetailCard">
          <h4>Thesis</h4>
          <p className="coreDetailValue">{concept.thesis?.summary ?? "Not yet defined."}</p>
        </article>
        <article className="coreDetailCard coreDetailCard-full">
          <h4>User Experience</h4>
          <p className="coreDetailValue">
            {concept.fullFlow?.summary ?? "The full experience has not been described yet."}
          </p>
        </article>
        <article className="coreDetailCard coreDetailCard-full">
          <div className="corePillarsCardHeader">
            <h4>Core-Pillars</h4>
            <div className="corePillarsToggle">
              {(["Linear", "Threads", "Total"] as CorePillarsView[]).map((opt) => (
                <button
                  key={opt}
                  className={`corePillarsToggleBtn${pillarsView === opt ? " corePillarsToggleBtn--active" : ""}`}
                  onClick={() => setPillarsView(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          {concept.corePillars.length > 0 ? (
            <ConceptThreadList pillars={concept.corePillars} />
          ) : (
            <p className="coreDetailEmpty">No core-pillars have been locked in yet.</p>
          )}
        </article>
      </div>
    </div>
  );
}
