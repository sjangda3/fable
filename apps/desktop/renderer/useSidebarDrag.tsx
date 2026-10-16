import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { SidebarReorder } from "../../../packages/contracts/index.ts";
import {
  planSidebarDrop,
  type SidebarDrop,
  type SidebarItem,
} from "./sidebar-drag.ts";

const itemKey = (item: SidebarItem) => `${item.kind}:${item.id}`;
export function useSidebarDrag({
  onReorder,
  onMovePage,
  onExpand,
}: {
  onReorder: (request: Omit<SidebarReorder, "revision">) => Promise<void>;
  onMovePage: (
    id: string,
    parentId: string,
    directory: string,
  ) => Promise<void>;
  onExpand: (key: string) => void;
}) {
  const [active, setActive] = useState<string | null>(null),
    [over, setOver] = useState<{
      key: string;
      position: "before" | "after" | "inside";
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [announcement, announce] = useState("");
  const source = useRef<SidebarItem | null>(null),
    pending = useRef(false),
    endedAt = useRef(-Infinity),
    expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    expandTarget = useRef<string | undefined>(undefined),
    scroll = useRef<HTMLElement | null>(null),
    pointer = useRef({ x: 0, y: 0 }),
    reduced = useReducedMotion();
  const clearExpand = () => {
    clearTimeout(expandTimer.current);
    expandTarget.current = undefined;
  };
  const reset = () => {
    if (source.current) endedAt.current = performance.now();
    clearExpand();
    source.current = null;
    setActive(null);
    setOver(null);
  };
  useEffect(() => () => clearTimeout(expandTimer.current), []);
  useEffect(() => {
    if (!active) return;
    let frame: number;
    const track = (event: globalThis.DragEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const tick = () => {
      const element = scroll.current;
      if (element) {
        const rect = element.getBoundingClientRect(),
          { x, y } = pointer.current;
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          const edge = 40;
          if (y < rect.top + edge)
            element.scrollTop -= 8 * (1 - (y - rect.top) / edge);
          else if (y > rect.bottom - edge)
            element.scrollTop += 8 * (1 - (rect.bottom - y) / edge);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("dragover", track);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("dragover", track);
    };
  }, [active]);

  const perform = async (plan: SidebarDrop, title: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    announce(`Moving ${title}`);
    try {
      if (plan.kind === "reorder") await onReorder(plan.request);
      else await onMovePage(plan.pageId, plan.parentId, plan.directory);
      announce(`${title} moved`);
    } catch (error: any) {
      setError(error.message);
      announce(`Could not move ${title}`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const bind = (item: SidebarItem, expandKey?: string) => ({
    draggable: item.kind !== "root" && !busy,
    "data-sidebar-id": item.id,
    "data-sidebar-kind": item.kind,
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (event.detail > 0 && performance.now() - endedAt.current < 200) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (
        pending.current ||
        item.kind === "root" ||
        (event.target as Element).closest(".icon-button")
      ) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      source.current = item;
      scroll.current =
        event.currentTarget.closest<HTMLElement>(".sidebar-scroll");
      pointer.current = { x: event.clientX, y: event.clientY };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-fable-sidebar", itemKey(item));
      event.dataTransfer.setData("text/plain", item.title);
      setError("");
      setActive(itemKey(item));
      announce(
        `Dragging ${item.title}. Drop between siblings to reorder${item.kind === "page" ? ", or on a folder to move" : ""}.`,
      );
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!source.current || pending.current) return;
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect(),
        position =
          event.clientY < rect.top + rect.height / 2 ? "before" : "after",
        plan = planSidebarDrop(source.current, item, position);
      if (!plan) {
        event.dataTransfer.dropEffect = "none";
        setOver(null);
        clearExpand();
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver({
        key: itemKey(item),
        position: plan.kind === "move" ? "inside" : position,
      });
      if (
        plan.kind === "move" &&
        expandKey &&
        expandTarget.current !== expandKey
      ) {
        clearExpand();
        expandTarget.current = expandKey;
        expandTimer.current = setTimeout(() => onExpand(expandKey), 550);
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null))
        return;
      setOver((current) => (current?.key === itemKey(item) ? null : current));
      clearExpand();
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const dragging = source.current;
      if (!dragging || pending.current) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect(),
        plan = planSidebarDrop(
          dragging,
          item,
          event.clientY < rect.top + rect.height / 2 ? "before" : "after",
        );
      reset();
      if (!plan) return;
      if (plan.kind === "move" && expandKey) onExpand(expandKey);
      void perform(plan, dragging.title);
    },
    onDragEnd: reset,
  });
  const keyboard = (
    event: KeyboardEvent<HTMLElement>,
    item: SidebarItem,
    siblings: SidebarItem[],
  ) => {
    if (
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (pending.current) return;
    const index = siblings.findIndex(
        (sibling) => itemKey(sibling) === itemKey(item),
      ),
      target = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (!target) return;
    const plan = planSidebarDrop(
      item,
      target,
      event.key === "ArrowUp" ? "before" : "after",
    );
    if (plan) void perform(plan, item.title);
  };
  const indicator = (item: SidebarItem) => (
    <AnimatePresence>
      {over?.key === itemKey(item) && (
        <motion.span
          key={over.position}
          className={`sidebar-drop-indicator drop-${over.position}`}
          initial={{ opacity: 0, scaleX: reduced ? 1 : 0.96 }}
          animate={{ opacity: 1, scaleX: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}
          aria-hidden="true"
        />
      )}
    </AnimatePresence>
  );
  return {
    bind,
    keyboard,
    indicator,
    active,
    busy,
    error,
    announcement,
    reset,
  };
}
