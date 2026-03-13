export function FlowchartControls({
  zoomLevel,
  maxZoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoomLevel: number;
  maxZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const isFullyZoomedOut = zoomLevel >= maxZoom;
  const isFullyZoomedIn = zoomLevel <= 1;

  return (
    <div className="flowchartControls">
      <button
        className="flowchartControlBtn"
        onClick={onZoomIn}
        disabled={isFullyZoomedIn}
        aria-label="Zoom in (show fewer nodes)"
        title="Zoom in"
      >
        +
      </button>
      <button
        className="flowchartControlBtn"
        onClick={onZoomOut}
        disabled={isFullyZoomedOut}
        aria-label="Zoom out (show more nodes)"
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
