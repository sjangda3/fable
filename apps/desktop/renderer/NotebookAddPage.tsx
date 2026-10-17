import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { Icon } from "../../../packages/ui/icons.tsx";
import {
  advancePageScroll,
  emptyPageScroll,
  PAGE_SCROLL_IDLE,
  releasePageScroll,
} from "./page-scroll.ts";

export function NotebookAddPage({
  onAdd,
  disabled,
  pageCount,
}: {
  onAdd(): void;
  disabled: boolean;
  pageCount: number;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const gesture = useRef({ ...emptyPageScroll });
  const add = useRef(onAdd);
  const rebound = useRef<{ stop(): void } | null>(null);
  const reducedMotion = useReducedMotion();
  add.current = onAdd;
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    rebound.current?.stop();
    gesture.current.distance = 0;
    setProgress(0);
  }, [pageCount]);
  useEffect(() => {
    const canvas = button.current?.closest<HTMLElement>(".document-canvas");
    if (!canvas || disabled) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      clearTimeout(idle);
      gesture.current.distance = 0;
      setProgress(0);
    };
    const release = () => {
      const result = releasePageScroll(gesture.current, performance.now());
      gesture.current = result.state;
      setProgress(0);
      if (!result.rebound) return;
      rebound.current?.stop();
      const top = Math.max(0, canvas.scrollTop - result.rebound);
      if (reducedMotion) canvas.scrollTop = top;
      else
        rebound.current = animate(canvas.scrollTop, top, {
          type: "spring",
          stiffness: 360,
          damping: 28,
          mass: 0.7,
          onUpdate: (value) => {
            canvas.scrollTop = value;
          },
        });
    };
    const interrupt = () => {
      rebound.current?.stop();
      rebound.current = null;
      reset();
    };
    const wheel = (event: WheelEvent) => {
      rebound.current?.stop();
      rebound.current = null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        reset();
        return;
      }
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas.clientHeight
            : 1);
      const atEnd =
        canvas.scrollHeight - canvas.clientHeight - canvas.scrollTop <= 2;
      const result = advancePageScroll(
        gesture.current,
        delta,
        atEnd,
        performance.now(),
      );
      gesture.current = result.state;
      setProgress(result.progress);
      clearTimeout(idle);
      if (delta > 0 && atEnd) event.preventDefault();
      if (result.add) add.current();
      else if (result.progress) idle = setTimeout(release, PAGE_SCROLL_IDLE);
    };
    const scroll = () => {
      if (canvas.scrollHeight - canvas.clientHeight - canvas.scrollTop > 2)
        reset();
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("scroll", scroll, { passive: true });
    canvas.addEventListener("pointerdown", interrupt);
    canvas.addEventListener("keydown", interrupt);
    return () => {
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("scroll", scroll);
      canvas.removeEventListener("pointerdown", interrupt);
      canvas.removeEventListener("keydown", interrupt);
      clearTimeout(idle);
      rebound.current?.stop();
    };
  }, [disabled, reducedMotion]);
  const percent = Math.round(progress * 100);
  return (
    <button
      ref={button}
      type="button"
      className="notebook-add-page"
      aria-label="Add page"
      aria-description={
        progress
          ? `Scroll progress ${percent} percent. Keep scrolling down to add a page.`
          : "Click to add a page, or keep scrolling down at the end of the notebook."
      }
      onClick={onAdd}
      disabled={disabled}
    >
      <span
        className="notebook-add-fill"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />
      <Icon name="fileAdd" size={16} />
      <span>Add page</span>
      <span className="notebook-add-hint" aria-hidden="true">
        {progress ? `${percent}%` : "Scroll to add"}
      </span>
      <span
        className="notebook-add-track"
        role="progressbar"
        aria-label="Scroll to add a page"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </span>
    </button>
  );
}
