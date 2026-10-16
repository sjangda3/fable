import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { Icon, type IconName } from "../../../packages/ui/icons.tsx";
import type { WorkStatus } from "../../../packages/contracts/index.ts";
export function IconButton({
  icon,
  label,
  size = 18,
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  size?: number;
  variant?: "default" | "plain";
}) {
  return (
    <button
      type="button"
      className={`icon-button ${variant === "plain" ? "icon-button-plain" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
export function StatusIcon({
  status,
  size = 17,
}: {
  status: WorkStatus;
  size?: number;
}) {
  return (
    <span className={`status-icon status-${status}`}>
      <Icon name={status} size={status === "doing" ? size - 5 : size} />
    </span>
  );
}
export function Count({ children }: { children: ReactNode }) {
  return <span className="count">{children}</span>;
}
export function Title({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <h1 className="view-heading">
      {children}
      {count !== undefined && <Count>{count}</Count>}
    </h1>
  );
}
export function EmptyState({
  icon,
  title,
  children,
  action,
  label,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={28} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && (
        <button className="button primary" onClick={action}>
          {label}
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const root = box.current;
      (
        root?.querySelector<HTMLElement>(
          "[autofocus], input, textarea, select",
        ) ?? root?.querySelector<HTMLElement>("button")
      )?.focus();
    }, 20);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab") {
        const nodes = box.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton icon="close" label={`Close ${title}`} onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
