import { useState } from "react";
import { api } from "./api.ts";
import type {
  DocumentSnapshot,
  DocumentKind,
  WorkStatus,
  TaskRef,
} from "../../../packages/contracts/index.ts";
import { statuses } from "../../../packages/contracts/index.ts";
import {
  taskGroups,
  statusLabels,
  formatDate,
} from "../../../packages/domain/index.ts";
import { Icon } from "../../../packages/ui/icons.tsx";
import {
  Title,
  Count,
  StatusIcon,
  IconButton,
  EmptyState,
} from "./components.tsx";

interface ViewProps {
  documents: DocumentSnapshot[];
  open: (id: string, line?: number) => void;
  create: (kind: DocumentKind, parent?: string, status?: WorkStatus) => void;
  error: (message: string) => void;
}
export function ProjectsView({
  documents,
  open,
  create,
  error,
  move,
  hiddenColumns,
  onColumns,
}: {
  hiddenColumns: WorkStatus[];
  onColumns: (columns: WorkStatus[]) => void;
  move: (id: string, status: WorkStatus, parent?: string) => Promise<void>;
} & ViewProps) {
  const [over, setOver] = useState<string | null>(null);
  const projects = documents.filter((d) => d.kind === "project"),
    hideDone = hiddenColumns.includes("done"),
    columns = statuses.filter((s) => !hiddenColumns.includes(s));
  const groups = [
    ...documents
      .filter(
        (d) =>
          ["area", "goal"].includes(d.kind) &&
          projects.some((p) => p.metadata.parent === d.id),
      )
      .map((d) => ({ id: d.id, title: d.title })),
  ];
  if (
    projects.some(
      (project) =>
        !project.metadata.parent ||
        !groups.some((group) => group.id === project.metadata.parent),
    )
  )
    groups.unshift({ id: "none", title: "Unassigned" });
  if (!projects.length)
    return (
      <div className="board-page">
        <Title count={0}>Projects</Title>
        <EmptyState
          icon="projects"
          title="Give an idea a place to grow"
          action={() => create("project")}
          label="Create a project"
        >
          Projects bring your notes and next steps together.
        </EmptyState>
      </div>
    );
  return (
    <section className="board-page" aria-label="Projects board">
      <div className="board-title">
        <Title count={projects.length}>Projects</Title>
        <IconButton
          icon="sort"
          label={hideDone ? "Show completed column" : "Hide completed column"}
          onClick={() =>
            onColumns(
              hideDone
                ? hiddenColumns.filter((s) => s !== "done")
                : [...hiddenColumns, "done"],
            )
          }
        />
      </div>
      <div className="board-scroll">
        <div
          className="board-canvas"
          style={{ "--columns": columns.length } as React.CSSProperties}
        >
          <div className="board-columns">
            {columns.map((status) => (
              <div className="column-heading" key={status}>
                <StatusIcon status={status} size={14} />
                <span>{statusLabels[status]}</span>
                <Count>
                  {projects.filter((p) => p.metadata.status === status).length}
                </Count>
              </div>
            ))}
          </div>
          {groups.map((group) => (
            <div className="board-group" key={group.id}>
              <div className="board-group-label">
                <span className="group-pill">{group.title}</span>
              </div>
              <div className="board-lanes">
                {columns.map((status) => {
                  const cards = projects.filter(
                    (d) =>
                      d.metadata.status === status &&
                      (group.id === "none"
                        ? !d.metadata.parent ||
                          !documents.some((p) => p.id === d.metadata.parent)
                        : d.metadata.parent === group.id),
                  );
                  const cell = `${group.id}:${status}`;
                  return (
                    <div
                      className={`board-lane ${over === cell ? "drag-over" : ""}`}
                      key={status}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setOver(cell);
                      }}
                      onDragLeave={() => setOver(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOver(null);
                        const id = e.dataTransfer.getData(
                          "application/fable-project",
                        );
                        if (id)
                          move(
                            id,
                            status,
                            group.id === "none" ? undefined : group.id,
                          ).catch((e) => error(e.message));
                      }}
                      aria-label={`${group.title}, ${statusLabels[status]}`}
                    >
                      {cards.map((card) => (
                        <article
                          className="project-card"
                          key={card.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              "application/fable-project",
                              card.id,
                            );
                            e.dataTransfer.effectAllowed = "move";
                          }}
                        >
                          <button
                            className="project-card-open"
                            onClick={() => open(card.id)}
                          >
                            <StatusIcon
                              status={card.metadata.status}
                              size={16}
                            />
                            <span className="card-content">
                              <span className="card-title">{card.title}</span>
                              {card.metadata.depends_on.length > 0 && (
                                <span className="card-description">
                                  Depends on:{" "}
                                  {card.metadata.depends_on
                                    .map(
                                      (id) =>
                                        documents.find((d) => d.id === id)
                                          ?.title ?? "Missing project",
                                    )
                                    .join(", ")}
                                </span>
                              )}
                              {group.id !== "none" && (
                                <span className="card-description">
                                  Parent: {group.title}
                                </span>
                              )}
                              {(card.metadata.start || card.metadata.due) && (
                                <span className="card-dates">
                                  {card.metadata.start && (
                                    <span>
                                      <Icon name="calendar" size={11} />
                                      {formatDate(card.metadata.start)}
                                    </span>
                                  )}
                                  {card.metadata.due && (
                                    <span>
                                      <Icon name="flag" size={11} />
                                      {formatDate(card.metadata.due)}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          </button>
                          <span className="card-drag">
                            <Icon name="drag" size={13} />
                          </span>
                        </article>
                      ))}
                      <button
                        className="lane-add"
                        onClick={() =>
                          create(
                            "project",
                            group.id === "none" ? undefined : group.id,
                            status,
                          )
                        }
                      >
                        <Icon name="add" size={14} />
                        New project
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export function TasksView({
  documents,
  open,
  create,
  toggle,
  completed = false,
  error: propsError,
}: {
  toggle: (task: TaskRef) => Promise<void>;
  completed?: boolean;
} & ViewProps) {
  const groups = taskGroups(documents, completed),
    count = groups.reduce((n, g) => n + g.tasks.length, 0),
    [pending, setPending] = useState<Set<string>>(new Set());
  return (
    <section className="reading-page tasks-page">
      <Title count={count}>{completed ? "Completed tasks" : "Tasks"}</Title>
      {!groups.length ? (
        <EmptyState
          icon={completed ? "completed" : "tasks"}
          title={
            completed
              ? "A little progress, kept here"
              : "Make room for your next step"
          }
          action={completed ? undefined : () => create("note")}
          label="Create a note"
        >
          {completed
            ? "Completed tasks will appear here."
            : "Write a checkbox in any note, or press ⌘ ⇧ N to capture a task."}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section
            className="task-group"
            key={group.id}
            aria-label={group.title}
          >
            <div className="task-group-heading">
              <button
                className="group-pill"
                onClick={() => {
                  if (group.id !== "unassigned") open(group.id);
                }}
                disabled={group.id === "unassigned"}
              >
                {group.title}
              </button>
              <IconButton
                icon="add"
                label={`Add task to ${group.title}`}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("fable:add-task", {
                      detail: group.id === "unassigned" ? undefined : group.id,
                    }),
                  )
                }
              />
            </div>
            <div className="task-list">
              {group.tasks.map((task) => (
                <div
                  className={`task-row ${task.done ? "completed-task" : ""}`}
                  key={`${task.documentId}:${task.id}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/fable-task",
                      JSON.stringify({
                        documentId: task.documentId,
                        taskId: task.id,
                        baseRevision: task.baseRevision,
                      }),
                    );
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/fable-task"))
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    try {
                      const from = JSON.parse(
                        e.dataTransfer.getData("application/fable-task"),
                      );
                      if (from.documentId !== task.documentId)
                        throw new Error(
                          "Reorder tasks within their source note.",
                        );
                      void api
                        .request("tasks.move", {
                          ...from,
                          beforeTaskId: task.id,
                        })
                        .catch((e) => propsError(e.message));
                    } catch (e: any) {
                      propsError(e.message);
                    }
                  }}
                >
                  <button
                    className="task-checkbox"
                    role="checkbox"
                    aria-checked={task.done}
                    aria-label={`${task.done ? "Reopen" : "Complete"} ${task.title}`}
                    disabled={pending.has(task.id)}
                    onClick={async () => {
                      setPending((p) => new Set(p).add(task.id));
                      try {
                        await toggle(task);
                      } finally {
                        setPending((p) => {
                          const n = new Set(p);
                          n.delete(task.id);
                          return n;
                        });
                      }
                    }}
                  >
                    {task.done && <Icon name="check" size={12} />}
                  </button>
                  <button
                    className="task-text"
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    onKeyDown={(e) => {
                      if (
                        !e.altKey ||
                        !["ArrowUp", "ArrowDown"].includes(e.key)
                      )
                        return;
                      e.preventDefault();
                      const siblings =
                          documents
                            .find((d) => d.id === task.documentId)
                            ?.tasks.filter(
                              (t) =>
                                t.depth === task.depth &&
                                t.context === task.context,
                            ) ?? [],
                        index = siblings.findIndex((t) => t.id === task.id),
                        other =
                          siblings[index + (e.key === "ArrowUp" ? -1 : 1)];
                      if (other)
                        void api
                          .request("tasks.move", {
                            documentId: task.documentId,
                            taskId: e.key === "ArrowUp" ? task.id : other.id,
                            beforeTaskId:
                              e.key === "ArrowUp" ? other.id : task.id,
                            baseRevision: task.baseRevision,
                          })
                          .catch((e) => propsError(e.message));
                    }}
                    onClick={() => open(task.documentId, task.line)}
                  >
                    <span>{task.title}</span>
                    {task.context &&
                      task.context !== "Tasks" &&
                      task.context !== "Next steps" &&
                      task.context !==
                        documents.find((d) => d.id === task.documentId)
                          ?.title && <small>{task.context}</small>}
                  </button>
                  {task.due && (
                    <span className="task-due">{formatDate(task.due)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
export function GoalsView({ documents, open, create }: ViewProps) {
  const goals = documents.filter(
      (d) => d.kind === "goal" && d.metadata.status !== "done",
    ),
    ids = new Set(goals.map((d) => d.id));
  const rows = (
    parent: string | null,
    depth = 0,
    seen = new Set<string>(),
  ): React.ReactNode =>
    goals
      .filter((d) =>
        parent
          ? d.metadata.parent === parent
          : !d.metadata.parent || !ids.has(d.metadata.parent),
      )
      .map((goal) => {
        if (seen.has(goal.id)) return null;
        const next = new Set(seen).add(goal.id);
        const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(goal.body);
        const linked = link
          ? documents.find((d) => d.title === link[1])
          : undefined;
        return (
          <div className="goal-branch" key={goal.id}>
            <div
              className={`goal-row ${link ? "has-reference" : ""}`}
              style={{ "--depth": depth } as React.CSSProperties}
            >
              {depth > 0 && (
                <span
                  className={`tree-elbow ${goal.metadata.depends_on.length ? "with-arrow" : ""}`}
                />
              )}
              <button className="goal-open" onClick={() => open(goal.id)}>
                <Icon name="goals" size={20} />
                <span>{goal.title}</span>
              </button>
              {link && (
                <button
                  className="goal-reference"
                  onClick={() => linked && open(linked.id)}
                  disabled={!linked}
                >
                  <Icon name="note" size={14} />
                  {link[1]}
                </button>
              )}
            </div>
            {rows(goal.id, depth + 1, next)}
          </div>
        );
      });
  return (
    <section className="outline-page">
      <Title count={goals.length}>Goals</Title>
      {goals.length ? (
        <div className="goal-tree">{rows(null)}</div>
      ) : (
        <EmptyState
          icon="goals"
          title="What would you like to work toward?"
          action={() => create("goal")}
          label="Create a goal"
        >
          A goal can connect a few projects to a bigger intention.
        </EmptyState>
      )}
    </section>
  );
}
export function NotesView({
  documents,
  open,
  create,
  areas = false,
}: ViewProps & { areas?: boolean }) {
  const notes = documents.filter((d) =>
    areas
      ? d.kind === "area"
      : ["note", "insight", "conversation"].includes(d.kind),
  );
  return (
    <section className="reading-page notes-page">
      <div className="list-title">
        <Title count={notes.length}>{areas ? "Areas" : "Notes"}</Title>
        <IconButton
          icon="add"
          label={areas ? "New area" : "New note"}
          onClick={() => create(areas ? "area" : "note")}
        />
      </div>
      {notes.length ? (
        <div className="document-list">
          {notes.map((note) => (
            <button
              key={note.id}
              className="document-list-row"
              onClick={() => open(note.id)}
            >
              <Icon name={areas ? "areas" : "note"} size={19} />
              <span>
                <strong>{note.title}</strong>
                <small>
                  {areas
                    ? `${documents.filter((d) => d.metadata.parent === note.id).length} connected goals and notes`
                    : note.body
                        .replace(/^#.*\n/, "")
                        .replace(/[#*>`_\[\]]/g, "")
                        .trim()
                        .split("\n")[0]
                        ?.slice(0, 110) || "A little room to think."}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={areas ? "areas" : "note"}
          title={
            areas
              ? "A few things worth caring for"
              : "A fresh page, whenever you need it"
          }
          action={() => create(areas ? "area" : "note")}
          label={areas ? "Create an area" : "Write your first note"}
        >
          {areas
            ? "Group the ongoing parts of your life."
            : "Your notes are saved as Markdown in your own folder."}
        </EmptyState>
      )}
    </section>
  );
}
export function InsightsView({ documents, open }: ViewProps) {
  const projects = documents.filter((d) => d.kind === "project"),
    tasks = documents.flatMap((d) => d.tasks),
    done = tasks.filter((t) => t.done),
    stalled = projects.filter((d) => d.metadata.status === "waiting");
  return (
    <section className="reading-page insights-page">
      <Title>Insights</Title>
      <p className="view-intro">A quiet look at where things stand.</p>
      <div className="insight-stats">
        {[
          { label: "Open tasks", value: tasks.length - done.length },
          {
            label: "Active projects",
            value: projects.filter((d) => d.metadata.status !== "done").length,
          },
          {
            label: "Completed projects",
            value: projects.filter((d) => d.metadata.status === "done").length,
          },
        ].map((stat) => (
          <div key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      <h2 className="section-heading">Your projects</h2>
      <div className="status-distribution">
        {statuses.map((status) => (
          <div key={status}>
            <StatusIcon status={status} size={15} />
            <span>{statusLabels[status]}</span>
            <span className="distribution-track">
              <span
                style={{
                  width: `${projects.length ? (projects.filter((d) => d.metadata.status === status).length / projects.length) * 100 : 0}%`,
                }}
              />
            </span>
            <span>
              {projects.filter((d) => d.metadata.status === status).length}
            </span>
          </div>
        ))}
      </div>
      <h2 className="section-heading">Waiting for a next step</h2>
      <div className="insight-list">
        {stalled.length ? (
          stalled.map((d) => (
            <button key={d.id} onClick={() => open(d.id)}>
              <StatusIcon status="waiting" />
              <span>{d.title}</span>
              <Icon name="right" size={15} />
            </button>
          ))
        ) : (
          <p className="muted">Nothing is waiting right now.</p>
        )}
      </div>
      <p className="quiet-note">
        <Icon name="computer" size={14} />
        Calculated on this device from your Markdown files.
      </p>
    </section>
  );
}
export function CompletedView(
  props: ViewProps & {
    restore: (doc: DocumentSnapshot) => Promise<void>;
    toggle: (task: TaskRef) => Promise<void>;
  },
) {
  const done = props.documents.filter(
    (d) => ["project", "goal"].includes(d.kind) && d.metadata.status === "done",
  );
  return (
    <div className="completed-page">
      <section className="reading-page completed-projects">
        <Title count={done.length}>Completed</Title>
        <p className="view-intro">Finished work, with room to return to it.</p>
        {done.map((d) => (
          <div className="completed-row" key={d.id}>
            <button onClick={() => props.open(d.id)}>
              <Icon name="completed" size={18} />
              {d.title}
            </button>
            <button className="text-button" onClick={() => props.restore(d)}>
              Reopen
            </button>
          </div>
        ))}
      </section>
      <TasksView {...props} completed />
    </div>
  );
}
