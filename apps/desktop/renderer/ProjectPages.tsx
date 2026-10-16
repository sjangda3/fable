import { useMemo } from "react";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import { pagesFor } from "../../../packages/domain/index.ts";
import { Icon } from "../../../packages/ui/icons.tsx";
import { Count } from "./components.tsx";

export function ProjectPages({
  project,
  documents,
  onOpen,
  onCreate,
}: {
  project: DocumentSnapshot;
  documents: DocumentSnapshot[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const pages = useMemo(
    () => pagesFor(project.id, documents),
    [project.id, documents],
  );
  return (
    <section className="project-pages" aria-label={`Pages in ${project.title}`}>
      <header>
        <h2>
          Pages<Count>{pages.length}</Count>
        </h2>
        <button className="text-button" onClick={onCreate}>
          <Icon name="fileAdd" size={15} />
          New page
        </button>
      </header>
      {pages.length ? (
        <div className="project-page-list">
          {pages.map((page) => (
            <button key={page.id} onClick={() => onOpen(page.id)}>
              <Icon name="page" size={17} />
              <span>{page.title}</span>
              <Icon name="right" size={14} />
            </button>
          ))}
        </div>
      ) : (
        <p>No pages yet. Add a page to start writing.</p>
      )}
    </section>
  );
}
