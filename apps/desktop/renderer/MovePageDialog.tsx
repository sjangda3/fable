import { useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import {
  areaFor,
  documentFolder,
  projectFor,
  sidebarPageDirectory,
} from "../../../packages/domain/index.ts";
import { Modal } from "./components.tsx";

export function MovePageDialog({
  page,
  documents,
  directories,
  onClose,
  onMove,
}: {
  page: DocumentSnapshot;
  documents: DocumentSnapshot[];
  directories: string[];
  onClose: () => void;
  onMove: (id: string, parentId: string, directory: string) => Promise<void>;
}) {
  const owner = projectFor(page, documents) ?? areaFor(page, documents),
    current = owner
      ? JSON.stringify([owner.id, sidebarPageDirectory(page, owner)])
      : "";
  const [destination, setDestination] = useState(current),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const containers = documents.filter((doc) =>
    ["project", "area"].includes(doc.kind),
  );
  return createPortal(
    <Modal title="Move page" onClose={busy ? () => {} : onClose}>
      <form
        className="create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!destination || destination === current || busy) return;
          setBusy(true);
          setError("");
          try {
            const [parentId, directory] = JSON.parse(destination) as [
              string,
              string,
            ];
            await onMove(page.id, parentId, directory);
            onClose();
          } catch (error: any) {
            setError(error.message);
            setBusy(false);
          }
        }}
      >
        <p className="field-hint">
          Move “{page.title}” to a folder in this area.
        </p>
        <label className="field-label">
          Destination
          <select
            autoFocus
            value={destination}
            disabled={busy}
            onChange={(event) => setDestination(event.target.value)}
          >
            {!current && <option value="">Choose a folder</option>}
            {containers.map((container) => {
              const base = documentFolder(container);
              return (
                <optgroup
                  label={
                    container.kind === "area"
                      ? `${container.title} notes`
                      : container.title
                  }
                  key={container.id}
                >
                  {[
                    base,
                    ...directories.filter((dir) => dir.startsWith(base + "/")),
                  ].map((directory) => (
                    <option
                      key={directory}
                      value={JSON.stringify([container.id, directory])}
                    >
                      {directory === base
                        ? "Top level"
                        : directory.slice(base.length + 1)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !destination || destination === current}
          >
            {busy ? "Moving…" : "Move page"}
          </button>
        </footer>
      </form>
    </Modal>,
    document.body,
  );
}
