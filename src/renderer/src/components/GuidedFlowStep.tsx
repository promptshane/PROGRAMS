import type { GuidedOption } from "../hooks/useGuidedFlowchart";
import type { FlowchartNode } from "@shared/types";

const KIND_LABELS: Record<string, string> = {
  entry: "Entry Point",
  page: "Page",
  action: "User Action",
  system: "System Process",
};

export function GuidedFlowStep({
  currentNode,
  options,
  canGoBack,
  onNavigate,
  onBack,
}: {
  currentNode: FlowchartNode;
  options: GuidedOption[];
  canGoBack: boolean;
  onNavigate: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="guidedFlowStep">
      {canGoBack ? (
        <button className="flowchartBackBtn" onClick={onBack} aria-label="Go back">
          ← Back
        </button>
      ) : null}

      <div className="guidedFlowRow">
        {/* Current node card */}
        <div className="guidedFlowCurrentCard">
          <span className="guidedFlowCurrentKind">
            {KIND_LABELS[currentNode.kind] ?? currentNode.kind}
          </span>
          <span className="guidedFlowCurrentLabel">{currentNode.label}</span>
          {currentNode.description.trim() ? (
            <p className="guidedFlowCurrentDesc">{currentNode.description}</p>
          ) : null}
        </div>

        {options.length > 0 ? (
          <>
            <div className="guidedFlowArrow">→</div>

            {/* Options */}
            <div className="guidedFlowOptions">
              <span className="guidedFlowOptionsLabel">What happens next</span>
              {options.map((opt) => (
                <button
                  key={opt.nodeId}
                  className="guidedFlowOption"
                  onClick={() => onNavigate(opt.nodeId)}
                  title={opt.node.description}
                >
                  {opt.edgeLabel ? (
                    <span className="guidedFlowOptionEdge">{opt.edgeLabel}</span>
                  ) : null}
                  <span className="guidedFlowOptionLabel">{opt.node.label}</span>
                  <span className="guidedFlowOptionKind">
                    {KIND_LABELS[opt.node.kind] ?? opt.node.kind}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="guidedFlowEnd">End of flow — no further steps from here</div>
        )}
      </div>
    </div>
  );
}
