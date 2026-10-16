import { useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  statuses,
  type DocumentSnapshot,
  type TaskRef,
  type WorkStatus,
} from "../../../packages/contracts/index.ts";
import {
  statusLabels,
  taskProjectFor,
} from "../../../packages/domain/index.ts";
import { Icon } from "../../../packages/ui/icons.tsx";
import { Count, IconButton, StatusIcon, Title } from "./components.tsx";

type TaskChanges = { status?: WorkStatus; projectId?: string | null };
const dragType = "application/fable-task-card";
const keyFor = (task: TaskRef) => `${task.documentId}:${task.id}`;

export function TaskBoard({
  documents,
  open,
  create,
  update,
  error,
}: {
  documents: DocumentSnapshot[];
  open: (id: string, line?: number) => void;
  create: (status?: WorkStatus, projectId?: string) => void;
  update: (task: TaskRef, values: TaskChanges) => Promise<void>;
  error: (message: string) => void;
}) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState("all");
  const [over, setOver] = useState<WorkStatus | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const { projects, tasks } = useMemo(() => {
    const lookup = new Map(documents.map((doc) => [doc.id, doc]));
    return {
      projects: documents.filter((doc) => doc.kind === "project"),
      tasks: documents.flatMap((doc) =>
        doc.tasks.map((task) => ({
          task,
          source: doc,
          project: taskProjectFor(task, doc, lookup),
        })),
      ),
    };
  }, [documents]);
  const selectedFilter =
    filter === "all" ||
    filter === "none" ||
    projects.some((p) => p.id === filter)
      ? filter
      : "all";
  const visible = tasks.filter(
    ({ project }) =>
      selectedFilter === "all" || (project?.id ?? "none") === selectedFilter,
  );
  const addTask = (status?: WorkStatus) =>
    create(
      status,
      projects.some((project) => project.id === selectedFilter)
        ? selectedFilter
        : undefined,
    );
  const change = async (task: TaskRef, values: TaskChanges) => {
    const key = keyFor(task);
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    try {
      await update(task, values);
    } catch (cause) {
      error(
        cause instanceof Error ? cause.message : "Could not update this task.",
      );
    } finally {
      pendingRef.current.delete(key);
      setPending(new Set(pendingRef.current));
    }
  };
  return (
    <section className="board-page task-board" aria-label="Tasks board">
      <div className="board-title">
        <Title count={visible.length}>Tasks</Title>
        <div className="task-board-actions">
          <select
            aria-label="Filter tasks by project"
            value={selectedFilter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            <option value="none">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          <button className="button primary" onClick={() => addTask()}>
            <Icon name="add" size={16} />
            New task
          </button>
        </div>
      </div>
      <div className="board-scroll">
        <LayoutGroup>
          <div className="task-board-columns">
            {statuses.map((status) => {
              const items = visible.filter(
                ({ task }) => task.status === status,
              );
              return (
                <section
                  key={status}
                  className={`task-board-column ${over === status ? "task-drag-over" : ""}`}
                  aria-label={`${statusLabels[status]} tasks`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(dragType)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOver(status);
                  }}
                  onDragLeave={(e) => {
                    if (
                      !e.currentTarget.contains(e.relatedTarget as Node | null)
                    )
                      setOver(null);
                  }}
                  onDrop={(e) => {
                    if (!e.dataTransfer.types.includes(dragType)) return;
                    e.preventDefault();
                    setOver(null);
                    setDragging(null);
                    const key = e.dataTransfer.getData(dragType);
                    const entry = tasks.find(
                      ({ task }) => keyFor(task) === key,
                    );
                    if (entry && entry.task.status !== status)
                      void change(entry.task, { status });
                  }}
                >
                  <div className="column-heading">
                    <StatusIcon status={status} size={16} />
                    <h2>{statusLabels[status]}</h2>
                    <Count>{items.length}</Count>
                    <IconButton
                      variant="plain"
                      icon="add"
                      size={16}
                      label={`Add task in ${statusLabels[status]}`}
                      onClick={() => addTask(status)}
                    />
                  </div>
                  <div className="task-board-lane">
                    <AnimatePresence initial={false} mode="popLayout">
                      {items.map(({ task, source, project }) => {
                        const key = keyFor(task),
                          busy = pending.has(key);
                        return (
                          <motion.article
                            key={key}
                            layout={reduced ? false : "position"}
                            className={`task-card ${dragging === key ? "task-card-dragging" : ""}`}
                            aria-label={task.title}
                            aria-busy={busy}
                            initial={{ opacity: 0, y: reduced ? 0 : 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{
                              duration: reduced ? 0 : 0.2,
                              ease: [0.32, 0.72, 0, 1],
                            }}
                          >
                            <div
                              className="task-card-heading"
                              draggable={!busy}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData(dragType, key);
                                setDragging(key);
                              }}
                              onDragEnd={() => {
                                setDragging(null);
                                setOver(null);
                              }}
                            >
                              <button
                                className="task-checkbox"
                                role="checkbox"
                                aria-checked={task.done}
                                aria-label={`${task.done ? "Reopen" : "Complete"} ${task.title}`}
                                disabled={busy}
                                onClick={() =>
                                  void change(task, {
                                    status: task.done ? "todo" : "done",
                                  })
                                }
                              >
                                {task.done && <Icon name="check" size={12} />}
                              </button>
                              <button
                                className={`task-card-title ${task.done ? "task-card-done" : ""}`}
                                onClick={() => open(source.id, task.line)}
                              >
                                {task.title || "Untitled task"}
                              </button>
                            </div>
                            <div className="task-card-controls">
                              <label className="task-project-picker">
                                <Icon name="folder" size={14} />
                                <select
                                  aria-label={`Project for ${task.title}`}
                                  disabled={busy}
                                  value={project?.id ?? ""}
                                  onChange={(e) =>
                                    void change(task, {
                                      projectId: e.target.value || null,
                                    })
                                  }
                                >
                                  <option value="">No project</option>
                                  {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.title}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <select
                                className="task-status-picker"
                                aria-label={`Status for ${task.title}`}
                                disabled={busy}
                                value={task.status}
                                onChange={(e) =>
                                  void change(task, {
                                    status: e.target.value as WorkStatus,
                                  })
                                }
                              >
                                {statuses.map((value) => (
                                  <option key={value} value={value}>
                                    {statusLabels[value]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </motion.article>
                        );
                      })}
                    </AnimatePresence>
                    {!items.length && (
                      <p className="task-lane-empty">No tasks</p>
                    )}
                    <button
                      className="task-board-add"
                      onClick={() => addTask(status)}
                    >
                      <Icon name="add" size={16} />
                      New task
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </LayoutGroup>
      </div>
    </section>
  );
}
