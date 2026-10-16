import { useMemo, useRef, useState } from "react";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import { documentFolder } from "../../../packages/domain/index.ts";
import {
  projectFiles,
  projectSourceFolders,
  searchProjectFolders,
} from "../../../packages/domain/project-settings.ts";
import { Icon } from "../../../packages/ui/icons.tsx";
import { api } from "./api.ts";
import { Modal } from "./components.tsx";
import "./project-dialog.css";

export function ProjectDialog({
  project,
  directories,
  workspacePath,
  parent,
  onClose,
  beforeSave,
  onSaved,
  onRemove,
}: {
  project?: DocumentSnapshot;
  directories: string[];
  workspacePath: string;
  parent?: string;
  onClose: () => void;
  beforeSave: () => Promise<void>;
  onSaved: (project: DocumentSnapshot) => void | Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const creating = !project;
  const [title, setTitle] = useState(project?.title ?? "");
  const [folders, setFolders] = useState(() =>
    project ? projectSourceFolders(project) : [],
  );
  const [picker, setPicker] = useState(false),
    [query, setQuery] = useState("");
  const [action, setAction] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const name = useRef<HTMLInputElement>(null);
  const busy = action !== null;
  const available = useMemo(
    () =>
      [
        ...new Set([
          ...(project ? [documentFolder(project)] : []),
          ...directories,
        ]),
      ]
        .filter(
          (folder) =>
            !folder.startsWith(".fable") &&
            folder !== "Attachments" &&
            !folder.startsWith("Attachments/"),
        )
        .sort(),
    [directories, project?.path],
  );
  const matches = searchProjectFolders(available, query, workspacePath);
  const chooseFolder = (folder: string) => {
    setFolders((previous) => [
      folder,
      ...previous.slice(1).filter((path) => path !== folder),
    ]);
    if (creating && !title.trim()) setTitle(folder.split("/").at(-1) ?? "");
    setPicker(false);
    setQuery("");
  };
  const save = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError("Enter a project name.");
      name.current?.focus();
      return;
    }
    if (creating && !parent) {
      setError("Choose an area in the sidebar before creating a project.");
      return;
    }
    setAction("save");
    setError("");
    try {
      await beforeSave();
      if (project) {
        const state = await api.request("vault.state", undefined),
          latest = state?.documents.find((doc) => doc.id === project.id);
        if (!latest) throw new Error("This project is no longer available.");
        if (latest.revision !== project.revision)
          throw new Error(
            "This project changed while you were editing. Close and reopen it to use the latest version.",
          );
      }
      const values = {
        title: title.trim(),
        sourceFolders: folders,
        files: project ? projectFiles(project) : [],
      };
      const result = project
        ? await api.request("projects.update", {
            id: project.id,
            baseRevision: project.revision,
            ...values,
          })
        : await api.request("projects.create", {
            parent: parent!,
            ...values,
          });
      await onSaved(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this project. Try again.",
      );
      setAction(null);
    }
  };
  return (
    <Modal
      title={creating ? "Create project" : "Edit project"}
      className="project-edit-modal"
      onClose={busy ? () => {} : onClose}
    >
      <form
        className="project-edit-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="project-edit-body">
          <div className="project-name-field">
            <button
              type="button"
              className="project-browse-button"
              aria-label="Browse folder paths"
              aria-expanded={picker}
              aria-controls="project-folder-picker"
              title={folders[0] ?? "Browse folder paths"}
              disabled={busy}
              onClick={() => {
                setPicker(!picker);
                setQuery("");
              }}
            >
              <Icon name="folder" size={18} />
            </button>
            <input
              ref={name}
              autoFocus
              aria-label="Project name"
              placeholder="Project name"
              maxLength={200}
              disabled={busy}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          {picker && (
            <div className="project-folder-picker" id="project-folder-picker">
              <input
                autoFocus
                aria-label="Find a source folder"
                placeholder="Search or paste a folder path…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (matches[0]) chooseFolder(matches[0]);
                  }
                }}
              />
              <div>
                {matches.map((folder) => (
                  <button
                    type="button"
                    key={folder}
                    disabled={busy}
                    title={folder}
                    aria-pressed={folder === folders[0]}
                    onClick={() => chooseFolder(folder)}
                  >
                    <Icon name="folder" size={17} />
                    <span>{folder}</span>
                    {folder === folders[0] && <Icon name="check" size={14} />}
                  </button>
                ))}
                {!matches.length && (
                  <p>No matching folders in this workspace.</p>
                )}
              </div>
            </div>
          )}
          {error && (
            <p className="project-edit-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer
          className={`project-edit-footer ${creating ? "is-creating" : ""}`}
        >
          {!creating && onRemove && (
            <button
              type="button"
              className="project-remove-button"
              disabled={busy}
              onClick={async () => {
                setAction("remove");
                setError("");
                try {
                  await onRemove();
                  onClose();
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not remove this project.",
                  );
                  setAction(null);
                }
              }}
            >
              {action === "remove" ? "Removing…" : "Remove local project"}
            </button>
          )}
          <div>
            <button
              type="button"
              className="project-cancel-button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="project-save-button"
              disabled={busy}
            >
              {action === "save"
                ? creating
                  ? "Creating…"
                  : "Saving…"
                : creating
                  ? "Create project"
                  : "Save"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
