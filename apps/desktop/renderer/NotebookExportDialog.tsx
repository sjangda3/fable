import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Icon } from "../../../packages/ui/icons.tsx";
import { Modal } from "./components.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";
import {
  pdfFilename,
  selectedExportPages,
  type NotebookExportPage,
} from "./notebook-export.ts";

export function NotebookExportDialog({
  title,
  path,
  pages,
  onClose,
}: {
  title: string;
  path: string;
  pages: NotebookExportPage[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(
    () => new Set(pages.map((page) => page.number)),
  );
  const [state, setState] = useState<"pick" | "working" | "done">("pick");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const disposed = useRef(false);
  const reduced = useReducedMotion();
  const transition = {
    duration: reduced ? 0 : 0.2,
    ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
  };
  const count = selected.size;
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);
  const toggle = (number: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
    setError("");
  };
  const download = async () => {
    if (busy.current || !count) return;
    busy.current = true;
    setState("working");
    setError("");
    try {
      const { createNotebookPDF } = await import("./NotebookPDF.tsx");
      const blob = await createNotebookPDF({
        title,
        path,
        pages: selectedExportPages(pages, selected),
      });
      if (disposed.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = pdfFilename(title);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState("done");
    } catch {
      if (disposed.current) return;
      setError("Could not create your PDF. Please try again.");
      setState("pick");
    } finally {
      busy.current = false;
    }
  };

  return createPortal(
    <Modal title="Download PDF" className="pdf-export-modal" onClose={onClose}>
      <AnimatePresence initial={false} mode="wait">
        {state === "done" ? (
          <motion.div
            key="done"
            className="pdf-export-success"
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <div className="pdf-success-stack" aria-hidden="true">
              {[-1, 0, 1].map((direction) => (
                <motion.span
                  key={direction}
                  initial={{ rotate: 0, x: 0, y: reduced ? 0 : 12 }}
                  animate={{
                    rotate: reduced ? 0 : direction * 10,
                    x: reduced ? 0 : direction * 12,
                    y: !reduced && direction === 0 ? -4 : 0,
                  }}
                  transition={transition}
                >
                  {direction === 0 && <Icon name="check" size={24} />}
                </motion.span>
              ))}
            </div>
            <h3>Your pages, ready to go.</h3>
            <p role="status">
              {count} {count === 1 ? "page" : "pages"} packed into one PDF.
            </p>
            <button
              autoFocus
              type="button"
              className="pdf-download-button"
              onClick={onClose}
            >
              Done
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="picker"
            className="pdf-export-picker"
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <div className="pdf-export-intro">
              <p title={title}>{title}</p>
              <span>Pick the pages you want to take with you.</span>
            </div>
            <div className="pdf-selection-bar">
              <span aria-live="polite" aria-atomic="true">
                <motion.strong
                  key={count}
                  initial={{ opacity: 0, y: reduced ? 0 : 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={transition}
                >
                  {count}
                </motion.strong>
                {` of ${pages.length} selected`}
              </span>
              <button
                type="button"
                disabled={state === "working"}
                onClick={() =>
                  setSelected(
                    count === pages.length
                      ? new Set()
                      : new Set(pages.map((page) => page.number)),
                  )
                }
              >
                {count === pages.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div
              className="pdf-page-grid"
              role="group"
              aria-label="Pages to download"
              aria-busy={state === "working"}
            >
              {pages.map((page, index) => {
                const checked = selected.has(page.number);
                return (
                  <motion.button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`Page ${page.number}`}
                    key={page.number}
                    className={`pdf-page-card ${checked ? "is-selected" : ""}`}
                    disabled={state === "working"}
                    initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={
                      reduced || state === "working"
                        ? undefined
                        : { y: -4, rotate: index % 2 ? 1 : -1 }
                    }
                    whileTap={
                      reduced || state === "working"
                        ? undefined
                        : { scale: 0.97, rotate: 0 }
                    }
                    transition={transition}
                    onClick={() => toggle(page.number)}
                  >
                    <span className="pdf-page-paper">
                      <span
                        className="pdf-page-preview"
                        aria-hidden="true"
                        inert
                      >
                        {page.raw.trim() && (
                          <DocumentPreview
                            raw={page.raw}
                            path={path}
                            title={`Page ${page.number}`}
                          />
                        )}
                      </span>
                      <motion.span
                        className="pdf-page-check"
                        animate={{
                          backgroundColor: checked ? "#000000" : "#ffffff",
                          borderColor: checked ? "#000000" : "#dedede",
                        }}
                        transition={transition}
                        aria-hidden="true"
                      >
                        <motion.span
                          animate={{
                            opacity: checked ? 1 : 0,
                            scale: checked ? 1 : 0.5,
                          }}
                          transition={transition}
                        >
                          <Icon name="check" size={12} />
                        </motion.span>
                      </motion.span>
                    </span>
                    <span className="pdf-page-label">Page {page.number}</span>
                  </motion.button>
                );
              })}
            </div>
            {error && (
              <p className="pdf-export-error" role="alert">
                {error}
              </p>
            )}
            <footer className="pdf-export-footer">
              <span>
                {count ? "One PDF. In page order." : "Pick at least one page."}
              </span>
              <button
                type="button"
                className="pdf-download-button"
                disabled={!count || state === "working"}
                onClick={() => void download()}
              >
                <Icon
                  name={state === "working" ? "waiting" : "download"}
                  size={16}
                />
                {state === "working" ? "Making your PDF…" : "Download PDF"}
              </button>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>,
    document.body,
  );
}
