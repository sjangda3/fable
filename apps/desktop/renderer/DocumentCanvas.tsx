import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { IconButton } from "./components.tsx";
import {
  captureCanvasAnchor,
  restoreCanvasAnchor,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  type CanvasAnchor,
} from "./canvas-zoom.ts";

interface PanOrigin {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

export function DocumentCanvas({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const zoomTarget = useRef(100);
  const zoomAnchor = useRef<CanvasAnchor | null>(null);
  const [paperHeight, setPaperHeight] = useState(960);
  const pan = useRef<PanOrigin | null>(null);
  const suppressClick = useRef(false);
  const [hand, setHand] = useState(false);
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const handActive = hand || space;

  const zoomTo = (value: number, point?: { x: number; y: number }) => {
    const canvas = viewport.current,
      page = paper.current;
    const next = clampZoom(value);
    if (!canvas || !page || next === zoomTarget.current) return;
    const viewBounds = canvas.getBoundingClientRect(),
      pageBounds = page.getBoundingClientRect();
    zoomAnchor.current = captureCanvasAnchor(
      viewBounds,
      pageBounds,
      point ?? {
        x: viewBounds.left + canvas.clientWidth / 2,
        y: viewBounds.top + canvas.clientHeight / 2,
      },
      pageBounds.width / page.offsetWidth,
    );
    zoomTarget.current = next;
    setZoom(next);
  };
  const zoomIn = () => zoomTo((Math.floor(zoomTarget.current / 25) + 1) * 25);
  const zoomOut = () => zoomTo((Math.ceil(zoomTarget.current / 25) - 1) * 25);
  useLayoutEffect(() => {
    const canvas = viewport.current,
      page = paper.current,
      anchor = zoomAnchor.current;
    if (!canvas || !page || !anchor) return;
    const position = restoreCanvasAnchor(
      anchor,
      canvas.getBoundingClientRect(),
      page.getBoundingClientRect(),
      {
        left: canvas.scrollLeft,
        top: canvas.scrollTop,
      },
      zoom / 100,
    );
    canvas.scrollLeft = position.left;
    canvas.scrollTop = position.top;
    zoomAnchor.current = null;
  }, [zoom]);
  useLayoutEffect(() => {
    const page = paper.current;
    if (!page) return;
    const measure = () => setPaperHeight(page.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = viewport.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas.clientHeight
            : 1);
      zoomTo(zoomTarget.current * Math.exp(-delta * 0.002), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);

  const centerPage = () => {
    const canvas = viewport.current;
    if (!canvas) return;
    canvas.scrollTo({
      left: (canvas.scrollWidth - canvas.clientWidth) / 2,
      top: 0,
      behavior: "instant",
    });
  };
  useLayoutEffect(() => centerPage(), []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, button, [contenteditable="true"], [role="menu"]',
        )
      )
        return;
      if (
        (event.metaKey || event.ctrlKey) &&
        ["+", "=", "-", "0"].includes(event.key)
      ) {
        event.preventDefault();
        if (event.key === "0") zoomTo(100);
        else if (event.key === "-") zoomOut();
        else zoomIn();
      } else if (
        event.code === "Space" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setSpace(true);
      } else if (event.key === "Escape") {
        setHand(false);
        setSpace(false);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpace(false);
    };
    const reset = () => {
      setSpace(false);
      setDragging(false);
      pan.current = null;
      suppressClick.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    // Search and selection tools use portals; their React events still reach here.
    if (
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target)
    )
      return;
    if (event.button !== 0 && event.button !== 1) return;
    if (event.pointerType === "touch" && !handActive) return;
    const onPaper =
      event.target instanceof Element &&
      event.target.closest(".document-paper");
    if (
      !onPaper &&
      event.target instanceof Element &&
      event.target.closest("button, a, input, textarea, select")
    )
      return;
    if (!handActive && event.button !== 1 && onPaper) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pan.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    };
    suppressClick.current = true;
    setDragging(true);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const origin = pan.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.scrollLeft = origin.left - (event.clientX - origin.x);
    event.currentTarget.scrollTop = origin.top - (event.clientY - origin.y);
  };
  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    pan.current = null;
    setDragging(false);
    if (event.type === "pointercancel") suppressClick.current = false;
    else
      requestAnimationFrame(() => {
        suppressClick.current = false;
      });
  };
  return (
    <div className="document-playground">
      <div
        ref={viewport}
        className={`document-canvas ${handActive ? "is-hand-tool" : ""} ${dragging ? "is-panning" : ""}`}
        role="region"
        aria-label="Page canvas"
        tabIndex={0}
        onPointerDownCapture={startPan}
        onPointerMoveCapture={movePan}
        onPointerUpCapture={stopPan}
        onPointerCancelCapture={stopPan}
        onLostPointerCapture={() => {
          pan.current = null;
          setDragging(false);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className="document-workspace"
          style={
            {
              "--page-zoom": zoom / 100,
              "--page-height": `${paperHeight}px`,
            } as CSSProperties
          }
        >
          <div className="notebook-frame">
            <div ref={paper} className="notebook-sheets">
              {children}
            </div>
          </div>
        </div>
      </div>
      <div
        className="canvas-tools"
        role="toolbar"
        aria-label="Canvas navigation"
      >
        <IconButton
          icon="cursor"
          label="Select and edit"
          size={16}
          aria-pressed={!hand}
          onClick={() => setHand(false)}
        />
        <IconButton
          icon="hand"
          label="Hand tool"
          title="Hand tool · Hold Space outside text to pan"
          size={16}
          aria-pressed={hand}
          onClick={() => setHand(!hand)}
        />
        <span className="canvas-tools-divider" />
        <IconButton
          icon="divider"
          label="Zoom out"
          size={16}
          disabled={zoom <= MIN_ZOOM}
          onClick={zoomOut}
        />
        <button
          type="button"
          className="canvas-zoom-value"
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100%"
          onClick={() => zoomTo(100)}
        >
          {Math.round(zoom)}%
        </button>
        <IconButton
          icon="add"
          label="Zoom in"
          size={16}
          disabled={zoom >= MAX_ZOOM}
          onClick={zoomIn}
        />
      </div>
    </div>
  );
}
