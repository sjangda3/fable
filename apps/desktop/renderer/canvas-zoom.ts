export const MIN_ZOOM = 25;
export const MAX_ZOOM = 200;
export const clampZoom = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)) : 100;

type Point = { x: number; y: number };
type Origin = { left: number; top: number };
export interface CanvasAnchor {
  page: Point;
  viewport: Point;
}

/** Remember the page point beneath the mouse or viewport center before scaling. */
export function captureCanvasAnchor(
  viewport: Origin,
  paper: Origin,
  point: Point,
  scale: number,
): CanvasAnchor {
  return {
    page: {
      x: (point.x - paper.left) / scale,
      y: (point.y - paper.top) / scale,
    },
    viewport: { x: point.x - viewport.left, y: point.y - viewport.top },
  };
}

/** Reposition the canvas so that the remembered page point stays in place. */
export function restoreCanvasAnchor(
  anchor: CanvasAnchor,
  viewport: Origin,
  paper: Origin,
  scroll: Origin,
  scale: number,
): Origin {
  return {
    left:
      scroll.left +
      paper.left +
      anchor.page.x * scale -
      viewport.left -
      anchor.viewport.x,
    top:
      scroll.top +
      paper.top +
      anchor.page.y * scale -
      viewport.top -
      anchor.viewport.y,
  };
}
