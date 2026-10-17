import { forwardRef, useEffect, useId, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  LayoutGroup,
  motion,
  useIsPresent,
  useReducedMotion,
  type HTMLMotionProps,
} from "framer-motion";
import { Icon, type IconName } from "../../../packages/ui/icons.tsx";
import { IconButton } from "./components.tsx";
import { DropdownMenu } from "./DropdownMenu.tsx";

export interface PageTab {
  id: string;
  title: string;
  icon: IconName;
}

const TabSurface = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function TabSurface(props, ref) {
    const present = useIsPresent();
    return (
      <motion.div
        {...props}
        ref={ref}
        inert={!present}
        aria-hidden={!present}
      />
    );
  },
);

export function PageTabs({
  tabs,
  active,
  sidebarHidden,
  aiOpen,
  onSelect,
  onClose,
  onNew,
  onShowSidebar,
  onToggleAI,
  onError,
}: {
  tabs: PageTab[];
  active: string;
  sidebarHidden: boolean;
  aiOpen: boolean;
  onSelect: (id: string) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onNew: () => void;
  onShowSidebar: () => void;
  onToggleAI: () => void;
  onError: (message: string) => void;
}) {
  const id = useId(),
    reduced = useReducedMotion(),
    list = useRef<HTMLDivElement>(null),
    menuTrigger = useRef<HTMLButtonElement>(null);
  const scrollAnimation = useRef<{ stop: () => void } | null>(null);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const transition = {
    duration: reduced ? 0 : 0.2,
    ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
  };

  useEffect(() => {
    const container = list.current;
    if (!container) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selected = container.querySelector<HTMLElement>(
          ".tab.active:not([inert])",
        );
        if (!selected) return;
        scrollAnimation.current?.stop();
        const left = selected.offsetLeft - 4,
          right = selected.offsetLeft + selected.offsetWidth + 4,
          current = container.scrollLeft,
          target =
            left < current
              ? Math.max(0, left)
              : right > current + container.clientWidth
                ? right - container.clientWidth
                : current;
        if (Math.abs(target - current) < 1) return;
        if (reduced) container.scrollLeft = target;
        else
          scrollAnimation.current = animate(current, target, {
            duration: 0.2,
            ease: [0.32, 0.72, 0, 1],
            onUpdate: (value) => {
              container.scrollLeft = value;
            },
          });
      });
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    const selected = container.querySelector(".tab.active:not([inert])");
    if (selected) observer.observe(selected);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollAnimation.current?.stop();
    };
  }, [active, tabs.length, reduced]);

  const focusSelected = () =>
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLButtonElement>(
          '.tab:not([inert]) [role="tab"][aria-selected="true"]',
        )
        ?.focus({ preventScroll: true }),
    );
  const select = async (tabId: string, focus = false) => {
    try {
      await onSelect(tabId);
      if (focus) focusSelected();
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : "Could not open this page.",
      );
    }
  };
  const close = async (tabId: string, surface: HTMLElement) => {
    const restoreFocus = surface.contains(window.document.activeElement);
    try {
      await onClose(tabId);
      if (restoreFocus) focusSelected();
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : "Could not close this tab.",
      );
    }
  };
  const openMenu = () => {
    const bounds = menuTrigger.current?.getBoundingClientRect();
    if (bounds)
      setAnchor({
        left: bounds.right - 224,
        top: bounds.bottom + 4,
        width: 224,
      });
  };

  return (
    <LayoutGroup id={id}>
      <div className="tab-strip">
        {sidebarHidden && (
          <IconButton
            icon="sidebar"
            label="Show sidebar"
            variant="plain"
            onClick={onShowSidebar}
          />
        )}
        <motion.div
          ref={list}
          className="page-tabs"
          role="tablist"
          aria-label="Open pages"
          layoutScroll
          onWheel={() => scrollAnimation.current?.stop()}
          onPointerDown={() => scrollAnimation.current?.stop()}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {tabs.map((tab, index) => (
              <TabSurface
                key={tab.id}
                layout={reduced ? false : "position"}
                className={`tab ${active === tab.id ? "active" : ""}`}
                initial={{ opacity: 0, y: reduced ? 0 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -4 }}
                transition={transition}
              >
                {active === tab.id && (
                  <motion.span
                    className="tab-selection"
                    layoutId="tab-selection"
                    transition={transition}
                    aria-hidden="true"
                  />
                )}
                <motion.button
                  type="button"
                  className="tab-trigger"
                  role="tab"
                  aria-selected={active === tab.id}
                  aria-controls="main-content"
                  tabIndex={active === tab.id ? 0 : -1}
                  title={tab.title}
                  animate={{ opacity: active === tab.id ? 1 : 0.5 }}
                  whileHover={{ opacity: 1 }}
                  whileTap={{ opacity: 0.65 }}
                  transition={transition}
                  onClick={() => void select(tab.id)}
                  onKeyDown={(event) => {
                    if (event.altKey || event.metaKey || event.ctrlKey) return;
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : (index +
                                (event.key === "ArrowRight" ? 1 : -1) +
                                tabs.length) %
                              tabs.length;
                      void select(tabs[next].id, true);
                    } else if (
                      event.key === "Delete" ||
                      event.key === "Backspace"
                    ) {
                      event.preventDefault();
                      void close(tab.id, event.currentTarget.parentElement!);
                    }
                  }}
                >
                  <Icon name={tab.icon} size={14} />
                  <span>{tab.title}</span>
                </motion.button>
                <IconButton
                  icon="close"
                  label={`Close ${tab.title} tab`}
                  size={12}
                  variant="plain"
                  tabIndex={active === tab.id ? 0 : -1}
                  onClick={(event) =>
                    void close(tab.id, event.currentTarget.parentElement!)
                  }
                />
              </TabSurface>
            ))}
          </AnimatePresence>
        </motion.div>
        <motion.button
          type="button"
          layout={reduced ? false : "position"}
          className="icon-button icon-button-plain"
          aria-label="New tab"
          title="New tab"
          transition={transition}
          onClick={onNew}
        >
          <Icon name="add" size={16} />
        </motion.button>
        <div className="titlebar-drag-space" />
        <button
          ref={menuTrigger}
          type="button"
          className={`icon-button icon-button-plain tab-list-trigger ${anchor ? "is-active" : ""}`}
          aria-label="All open pages"
          title="All open pages"
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          onClick={() => (anchor ? setAnchor(null) : openMenu())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <motion.span
            animate={{ rotate: anchor ? 180 : 0 }}
            transition={transition}
          >
            <Icon name="down" size={14} />
          </motion.span>
        </button>
        <IconButton
          icon="panel"
          label="Toggle AI assistant (⌘ J)"
          variant="plain"
          aria-pressed={aiOpen}
          className={aiOpen ? "is-active" : ""}
          onClick={onToggleAI}
        />
        <AnimatePresence>
          {anchor && (
            <DropdownMenu
              label="All open pages"
              anchor={anchor}
              returnFocus={menuTrigger.current}
              onClose={() => setAnchor(null)}
              onError={onError}
              items={tabs.map((tab) => ({
                id: tab.id,
                label: tab.title,
                icon: tab.icon,
                checked: tab.id === active,
                onSelect: () => select(tab.id, true),
              }))}
            />
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
