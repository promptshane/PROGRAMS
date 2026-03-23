export function FlowchartControls({
  scale,
  minScale,
  maxScale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  minScale: number;
  maxScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const isAtMin = scale <= minScale + 0.001;
  const isAtMax = scale >= maxScale - 0.001;

  return (
    <div className="flowchartControls">
      <button
        className="flowchartControlBtn"
        onClick={onZoomIn}
        disabled={isAtMax}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
      <button
        className="flowchartControlBtn"
        onClick={onZoomOut}
        disabled={isAtMin}
        aria-label="Zoom out"
        title="Zoom out"
      >
        &minus;
      </button>
      <button
        className="flowchartControlBtn flowchartControlBtn--reset"
        onClick={onReset}
        aria-label="Reset view"
        title="Reset view"
      >
        Reset
      </button>
    </div>
  );
}
