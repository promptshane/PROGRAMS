import { useState, type ReactNode } from "react";
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

  return (
    <div className="coreDetailsReport">
      <ConceptOverview concept={safeCoreDetails} emptyLabel="Not yet defined." />
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

function ConceptOverviewSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`agentSummaryDetails conceptOverviewDetails${className ? ` ${className}` : ""}`}>
      <summary>{title}</summary>
      <div className="conceptOverviewDetailsBody">
        {children}
      </div>
    </details>
  );
}

export function ConceptOverview({
  concept,
  title,
  emptyLabel,
}: {
  concept: AgentCoreDetails | null;
  title?: string;
  emptyLabel: string;
}) {
  if (!concept) {
    return <p className="coreDetailEmpty">{emptyLabel}</p>;
  }

  const rootTitle = title?.trim() || "Core Details";
  const functionSummary = concept.function?.summary.trim() ? concept.function.summary : "Not yet defined.";
  const thesisSummary = concept.thesis?.summary.trim() ? concept.thesis.summary : "Not yet defined.";
  const fullFlowSummary = concept.fullFlow?.summary.trim() ? concept.fullFlow.summary : "Not yet defined.";
  const isFunctionAssumed = concept.function?.status === "assumed" || concept.function?.status === "edited";
  const isThesisAssumed = concept.thesis?.status === "assumed" || concept.thesis?.status === "edited";
  const isFullFlowAssumed = concept.fullFlow?.status === "assumed" || concept.fullFlow?.status === "edited";

  return (
    <div className="conceptOverview">
      <details className="agentSummaryDetails conceptOverviewDetails conceptOverviewDetails--root">
        <summary>{rootTitle}</summary>
        <div className="conceptOverviewDetailsBody">
          <ConceptOverviewSection title="Function" className="conceptOverviewDetails--function">
            <p className={`coreDetailValue${isFunctionAssumed ? " assumedText" : ""}`}>{functionSummary}</p>
          </ConceptOverviewSection>

          <ConceptOverviewSection title="Thesis" className="conceptOverviewDetails--thesis">
            <p className={`coreDetailValue${isThesisAssumed ? " assumedText" : ""}`}>{thesisSummary}</p>
          </ConceptOverviewSection>

          <ConceptOverviewSection title="User Experience" className="conceptOverviewDetails--experience">
            <p className={`coreDetailValue${isFullFlowAssumed ? " assumedText" : ""}`}>{fullFlowSummary}</p>
            {concept.fullFlow ? (
              <>
                {concept.fullFlow.currentState ? (
                  <div className="pillarDetailRow">
                    <span className="pillarDetailLabel">Current state</span>
                    <span className={isFullFlowAssumed ? "assumedText" : ""}>{concept.fullFlow.currentState}</span>
                  </div>
                ) : null}
                {concept.fullFlow.finalGoal ? (
                  <div className="pillarDetailRow">
                    <span className="pillarDetailLabel">Final goal</span>
                    <span className={isFullFlowAssumed ? "assumedText" : ""}>{concept.fullFlow.finalGoal}</span>
                  </div>
                ) : null}
                {concept.fullFlow.steps && concept.fullFlow.steps.length > 0 ? (
                  <ol className="flowStepList">
                    {concept.fullFlow.steps.map((step) => (
                      <li key={step.id} className="flowStepItem">
                        <div>
                          <div>{step.description}</div>
                          {step.pillarIds.length > 0 ? (
                            <div className="flowStepPillars">
                              {step.pillarIds.map((pillarId) => {
                                const pillar = concept.corePillars.find((candidate) => candidate.id === pillarId);
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
            ) : null}
          </ConceptOverviewSection>

          <ConceptOverviewSection title="Core-Pillars" className="conceptOverviewDetails--pillars">
            {concept.corePillars.length > 0 ? (
              <ConceptThreadList pillars={concept.corePillars} />
            ) : (
              <p className="coreDetailEmpty">No core-pillars have been locked in yet.</p>
            )}
          </ConceptOverviewSection>
        </div>
      </details>
    </div>
  );
}
