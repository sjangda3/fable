import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type HTMLMotionProps,
} from "framer-motion";
import { Icon, type IconName } from "../../../packages/ui/icons.tsx";
import { placeMenu, placeSubmenu } from "./menu-placement.ts";

export type DropdownItem = {
  id: string;
  label: string;
  icon: IconName;
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect?: () => void | Promise<void>;
  children?: DropdownEntry[];
};
export type DropdownEntry = DropdownItem | { separator: true };
const buttonsIn = (panel: HTMLDivElement | null) => [
  ...(panel?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ??
    []),
];
const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

function SubmenuSurface(
  props: HTMLMotionProps<"div"> & { ref: Ref<HTMLDivElement> },
) {
  const present = useIsPresent();
  return <motion.div {...props} inert={!present} aria-hidden={!present} />;
}

export function DropdownMenu({
  label,
  items,
  anchor,
  returnFocus,
  onClose,
  onError,
}: {
  label: string;
  items: DropdownEntry[];
  anchor: { left: number; top: number; width?: number };
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const id = useId(),
    reduced = useReducedMotion(),
    present = useIsPresent();
  const root = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    child = useRef<HTMLDivElement>(null);
  const submenuButton = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const typeahead = useRef({ text: "", at: 0 });
  const callbacks = useRef({ onClose, onError, returnFocus });
  callbacks.current = { onClose, onError, returnFocus };
  const [position, setPosition] = useState(() =>
    placeMenu(anchor, { width: anchor.width ?? 176, height: 0 }, viewport()),
  );
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [childPosition, setChildPosition] = useState({
    left: 0,
    top: 0,
    opensLeft: false,
  });
  const branch = items.find(
    (item): item is DropdownItem =>
      !("separator" in item) && item.id === submenu,
  );
  const transition = {
    duration: reduced ? 0 : 0.2,
    ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
  };
  const clearClose = () => clearTimeout(closeTimer.current);
  const closeBranch = () => {
    clearClose();
    typeahead.current = { text: "", at: 0 };
    setSubmenu(null);
  };
  const close = (restore = true) => {
    clearClose();
    if (restore && callbacks.current.returnFocus?.isConnected)
      callbacks.current.returnFocus.focus();
    callbacks.current.onClose();
  };
  useLayoutEffect(() => {
    if (!panel.current) return;
    setPosition(
      placeMenu(
        anchor,
        {
          width: panel.current.offsetWidth,
          height: panel.current.offsetHeight,
        },
        viewport(),
      ),
    );
  }, [anchor.left, anchor.top, anchor.width, items.length]);
  useLayoutEffect(() => {
    if (!branch || !child.current || !submenuButton.current || !panel.current)
      return;
    const row = submenuButton.current;
    setChildPosition(
      placeSubmenu(
        {
          left: position.left,
          right: position.left + panel.current.offsetWidth,
          top: position.top + row.offsetTop,
        },
        {
          width: child.current.offsetWidth,
          height: child.current.offsetHeight,
        },
        viewport(),
      ),
    );
  }, [submenu, position.left, position.top, branch?.children?.length]);
  useEffect(() => {
    const openerBounds = callbacks.current.returnFocus?.getBoundingClientRect();
    const frame = requestAnimationFrame(() => {
      (
        panel.current?.querySelector<HTMLButtonElement>(
          '[aria-checked="true"]:not(:disabled)',
        ) ?? buttonsIn(panel.current)[0]
      )?.focus();
    });
    const dismiss = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !callbacks.current.returnFocus?.contains(event.target as Node)
      )
        close(false);
    };
    const moved = () => close(false);
    const scroll = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      const opener = callbacks.current.returnFocus;
      const bounds = opener?.getBoundingClientRect();
      if (
        !opener?.isConnected ||
        !openerBounds ||
        !bounds ||
        Math.abs(bounds.left - openerBounds.left) > 0.5 ||
        Math.abs(bounds.top - openerBounds.top) > 0.5
      )
        close(false);
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", moved);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("fable:sidebar-scroll", scroll);
    return () => {
      cancelAnimationFrame(frame);
      clearClose();
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", moved);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("fable:sidebar-scroll", scroll);
    };
  }, []);
  const openBranch = (
    item: DropdownItem,
    button: HTMLButtonElement,
    focus = false,
  ) => {
    clearClose();
    submenuButton.current = button;
    typeahead.current = { text: "", at: 0 };
    setSubmenu(item.id);
    if (focus)
      requestAnimationFrame(() => {
        (
          child.current?.querySelector<HTMLButtonElement>(
            '[aria-checked="true"]:not(:disabled)',
          ) ?? buttonsIn(child.current)[0]
        )?.focus();
      });
  };
  const keydown = (event: KeyboardEvent<HTMLDivElement>, nested = false) => {
    const buttons = buttonsIn(nested ? child.current : panel.current);
    const current = document.activeElement as HTMLButtonElement;
    const index = buttons.indexOf(current);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
      if (!nested) closeBranch();
    } else if (event.key === "ArrowRight" && !nested) {
      const item = items.find(
        (item): item is DropdownItem =>
          !("separator" in item) && item.id === current?.dataset.menuId,
      );
      if (item?.children) {
        event.preventDefault();
        openBranch(item, current, true);
      }
    } else if (
      (event.key === "ArrowLeft" || event.key === "Escape") &&
      nested
    ) {
      event.preventDefault();
      closeBranch();
      submenuButton.current?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close();
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const now = Date.now(),
        text =
          (now - typeahead.current.at < 600 ? typeahead.current.text : "") +
          event.key.toLowerCase();
      typeahead.current = { text, at: now };
      const query = [...text].every((letter) => letter === text[0])
        ? text[0]
        : text;
      [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)]
        .find((button) =>
          button.textContent?.trim().toLowerCase().startsWith(query),
        )
        ?.focus();
      event.preventDefault();
    }
  };
  const entries = (values: DropdownEntry[], nested = false) =>
    values.map((item, index) =>
      "separator" in item ? (
        <div
          className="dropdown-separator"
          role="separator"
          key={`separator-${index}`}
        />
      ) : (
        <button
          type="button"
          key={item.id}
          className={`dropdown-item ${!nested && submenu === item.id ? "is-expanded" : ""}`}
          role={item.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.checked}
          disabled={item.disabled}
          title={item.hint}
          tabIndex={-1}
          data-menu-id={item.id}
          aria-haspopup={item.children ? "menu" : undefined}
          aria-expanded={item.children ? submenu === item.id : undefined}
          aria-controls={
            item.children && submenu === item.id ? `${id}-submenu` : undefined
          }
          onMouseEnter={(event) => {
            if (nested) {
              clearClose();
              return;
            }
            if (item.children) openBranch(item, event.currentTarget);
            else {
              clearClose();
              closeTimer.current = setTimeout(() => setSubmenu(null), 320);
            }
          }}
          onMouseLeave={() => {
            if (item.children) {
              clearClose();
              closeTimer.current = setTimeout(() => setSubmenu(null), 320);
            }
          }}
          onClick={async (event) => {
            if (item.children) {
              openBranch(item, event.currentTarget, true);
              return;
            }
            close();
            try {
              await item.onSelect?.();
            } catch (cause) {
              callbacks.current.onError(
                cause instanceof Error
                  ? cause.message
                  : "Could not complete this action.",
              );
            }
          }}
        >
          <Icon name={item.icon} size={16} />
          <span>{item.label}</span>
          {item.checked && (
            <Icon name="check" size={16} className="dropdown-trailing" />
          )}
          {item.children && (
            <Icon name="right" size={16} className="dropdown-trailing" />
          )}
        </button>
      ),
    );
  return createPortal(
    <motion.div
      ref={root}
      className="dropdown-root"
      inert={!present}
      aria-hidden={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
    >
      <motion.div
        ref={panel}
        role="menu"
        aria-label={label}
        className="dropdown-menu"
        style={{ ...position, width: anchor.width ?? 176 }}
        initial={{ y: reduced ? 0 : -4, scale: reduced ? 1 : 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={transition}
        onKeyDown={(event) => keydown(event)}
      >
        {entries(items)}
      </motion.div>
      <AnimatePresence>
        {branch?.children && (
          <SubmenuSurface
            key={branch.id}
            ref={child}
            id={`${id}-submenu`}
            role="menu"
            aria-label={branch.label}
            className="dropdown-menu dropdown-submenu"
            style={{
              left: childPosition.left,
              top: childPosition.top,
              transformOrigin: childPosition.opensLeft
                ? "top right"
                : "top left",
            }}
            initial={{
              opacity: 0,
              x: reduced ? 0 : childPosition.opensLeft ? 4 : -4,
              scale: reduced ? 1 : 0.98,
            }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            onMouseEnter={clearClose}
            onMouseLeave={() => {
              clearClose();
              closeTimer.current = setTimeout(() => setSubmenu(null), 320);
            }}
            onKeyDown={(event) => keydown(event, true)}
          >
            {entries(branch.children, true)}
          </SubmenuSurface>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
}
