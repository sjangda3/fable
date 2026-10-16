import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { parseDocument, LineCounter, isMap } from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import {
  FableError,
  metadataSchema,
  type DocumentSnapshot,
  type TaskRef,
  type TextEdit,
  type DocumentMetadata,
} from "../contracts/index.ts";

const parser = unified().use(remarkParse).use(remarkGfm);
export const revisionOf = (raw: string | Uint8Array) =>
  createHash("sha256").update(raw).digest("hex");
export function frontmatter(raw: string) {
  const match = /^(?:\uFEFF)?---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/.exec(
    raw,
  );
  if (!match) return null;
  const offset = match[0].indexOf("\n") + 1;
  const yaml = parseDocument(match[1] ?? "", {
    keepSourceTokens: true,
    lineCounter: new LineCounter(),
  });
  return { yaml, offset, length: match[0].length, source: match[1] ?? "" };
}
export function applyEdits(raw: string, edits: TextEdit[]) {
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let end = 0;
  for (const e of sorted) {
    if (e.from < end || e.from > e.to || e.to > raw.length)
      throw new FableError(
        "VALIDATION",
        "The text changes overlap or are outside the document.",
      );
    end = e.to;
  }
  return [...sorted]
    .reverse()
    .reduce(
      (text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to),
      raw,
    );
}
export function patchMetadata(
  raw: string,
  values: Record<string, unknown>,
): string {
  const fm = frontmatter(raw),
    eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const scalar = (value: unknown): string =>
    value === undefined ? "null" : JSON.stringify(value);
  if (!fm) {
    if (/^(?:\uFEFF)?---\r?\n/.test(raw))
      throw new FableError(
        "INVALID_METADATA",
        "Close the YAML frontmatter before changing properties.",
      );
    return `---${eol}fable:${eol}${Object.entries(values)
      .map(([key, value]) => `  ${key}: ${scalar(value)}`)
      .join(eol)}${eol}---${eol}${eol}${raw}`;
  }
  if (fm.yaml.errors.length)
    throw new FableError(
      "INVALID_METADATA",
      "Fix the YAML frontmatter before changing document properties.",
    );
  const edits: TextEdit[] = [];
  const fable = fm.yaml.get("fable", true) as
    import("yaml").YAMLMap | undefined;
  if (fable && !isMap(fable))
    throw new FableError(
      "INVALID_METADATA",
      "The fable property must contain a YAML mapping.",
    );
  if (!fable) {
    const insert = `${fm.source.length ? eol : ""}fable:${eol}${Object.entries(
      values,
    )
      .map(([k, v]) => `  ${k}: ${scalar(v)}`)
      .join(eol)}${fm.source.length ? "" : eol}`;
    return applyEdits(raw, [
      {
        from: fm.offset + fm.source.length,
        to: fm.offset + fm.source.length,
        insert,
      },
    ]);
  }
  const additions: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const existing = fable.get(key, true);
    if (existing?.range) {
      edits.push({
        from: fm.offset + existing.range[0],
        to: fm.offset + existing.range[1],
        insert: scalar(value),
      });
    } else additions.push(`  ${key}: ${scalar(value)}`);
  }
  if (additions.length) {
    if (fable.flow) {
      const insert =
        (fable.items.length ? ", " : "") +
        additions.map((line) => line.trim()).join(", ");
      const at = fm.offset + fable.range![1] - 1;
      edits.push({ from: at, to: at, insert });
      return applyEdits(raw, edits);
    }
    const lastPair = fable.items.at(-1);
    const last = lastPair?.value;
    const range = (last as { range?: [number, number, number] } | undefined)
      ?.range;
    const at = range?.[2] ?? fable.range?.[1] ?? fm.source.length;
    const hasNewline = raw[fm.offset + at - 1] === "\n";
    const insert =
      (hasNewline ? "" : eol) +
      additions.join(eol) +
      (at < fm.source.length ? eol : "");
    edits.push({ from: fm.offset + at, to: fm.offset + at, insert });
  }
  return applyEdits(raw, edits);
}

export function parseMarkdown(
  path: string,
  raw: string,
  modifiedAt = new Date().toISOString(),
): DocumentSnapshot {
  const fm = frontmatter(raw),
    diagnostics: string[] = [];
  let info: unknown;
  try {
    info = fm?.yaml.toJS()?.fable;
  } catch {
    diagnostics.push("The YAML frontmatter could not be read.");
  }
  if (fm?.yaml.errors.length)
    diagnostics.push(...fm.yaml.errors.map((e) => e.message));
  const parsed = metadataSchema.safeParse(info);
  if (info && !parsed.success)
    diagnostics.push(
      "Some Fable properties are unsupported. Source content is preserved.",
    );
  const id = parsed.success ? parsed.data.id : `unmanaged:${path}`;
  const metadata: DocumentMetadata = parsed.success
    ? parsed.data
    : metadataSchema.parse({ id });
  const bodyOffset = fm?.length ?? 0,
    body = raw.slice(bodyOffset),
    revision = revisionOf(raw);
  const root: any = parser.parse(body);
  const titleNode = root.children.find(
    (n: any) => n.type === "heading" && n.depth === 1,
  );
  const plain = (node: any): string =>
    node.value ?? (node.children ?? []).map(plain).join("");
  const title = titleNode
    ? plain(titleNode)
    : path.split("/").at(-1)!.replace(/\.md$/i, "");
  const tasks: TaskRef[] = [];
  const visit = (node: any, depth = 0, context?: string) => {
    if (node.type === "heading" && node.depth > 1) context = plain(node);
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const from = bodyOffset + node.position.start.offset,
        to = bodyOffset + node.position.end.offset;
      const source = raw.slice(from, to),
        checkbox = /\[[ xX]\]/.exec(source);
      if (checkbox) {
        const annotation = /<!--\s*fable:task\s+(\{[^\n]*?\})\s*-->/.exec(
          source.split(/\r?\n/)[0],
        );
        let meta: Record<string, any> = {};
        if (annotation) {
          try {
            meta = JSON.parse(annotation[1]);
          } catch {
            diagnostics.push(
              `Invalid task annotation on line ${node.position.start.line}.`,
            );
          }
        }
        const firstLine = source
          .split(/\r?\n/)[0]
          .replace(/^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s*/, "")
          .replace(/<!--\s*fable:task.*?-->/g, "")
          .trim();
        const checkFrom = from + checkbox.index + 1;
        tasks.push({
          id:
            typeof meta.id === "string" && meta.id.length
              ? meta.id
              : `line:${from}`,
          documentId: id,
          title: firstLine,
          done: node.checked,
          from,
          to,
          checkFrom,
          checkTo: checkFrom + 1,
          line: raw.slice(0, from).split("\n").length,
          depth,
          context,
          due: typeof meta.due === "string" ? meta.due : undefined,
          status: node.checked
            ? "done"
            : ["todo", "waiting", "ready", "doing"].includes(meta.status)
              ? meta.status
              : "todo",
          completedAt:
            typeof meta.completed_at === "string"
              ? meta.completed_at
              : undefined,
          baseRevision: revision,
        });
      }
    }
    let currentContext = context;
    for (const child of node.children ?? []) {
      if (child.type === "heading") currentContext = plain(child);
      visit(child, depth + (node.type === "listItem" ? 1 : 0), currentContext);
    }
  };
  if (metadata.kind !== "conversation") visit(root);
  const identityCounts = new Map<string, number>();
  for (const task of tasks)
    identityCounts.set(task.id, (identityCounts.get(task.id) ?? 0) + 1);
  for (const task of tasks)
    if (identityCounts.get(task.id)! > 1) {
      diagnostics.push(
        `Duplicate task identity on line ${task.line}. Its reference uses the source position until edited.`,
      );
      task.id = `line:${task.from}`;
    }
  return {
    id,
    path,
    title,
    kind: metadata.kind,
    raw,
    body,
    revision,
    metadata,
    tasks,
    modifiedAt,
    diagnostics,
    managed: parsed.success,
  };
}
export function manageDocument(document: DocumentSnapshot) {
  if (document.managed) return document.raw;
  return patchMetadata(document.raw, {
    schema: 1,
    id: randomUUID(),
    kind: document.kind,
  });
}
/** Rebase real Markdown destinations; prose, fenced examples, and inline code stay byte-identical. */
export function relativeLinkEdits(
  document: DocumentSnapshot,
  nextSourcePath: string,
  moved: { from: string; to: string },
): TextEdit[] {
  const root: any = parser.parse(document.body),
    offset = document.raw.length - document.body.length,
    edits: TextEdit[] = [];
  const sourceMoved =
    path.posix.dirname(document.path) !== path.posix.dirname(nextSourcePath);
  const visit = (node: any) => {
    if (
      ["link", "image", "definition"].includes(node.type) &&
      typeof node.url === "string"
    ) {
      const url: string = node.url;
      if (
        !url.startsWith("#") &&
        !url.startsWith("/") &&
        !/^[a-z][a-z\d+.-]*:/i.test(url)
      ) {
        const split = url.search(/[?#]/),
          pathname = split < 0 ? url : url.slice(0, split),
          suffix = split < 0 ? "" : url.slice(split);
        let decoded: string;
        try {
          decoded = decodeURIComponent(pathname);
        } catch {
          return;
        }
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(document.path), decoded),
        );
        if (sourceMoved || target === moved.from) {
          const nextTarget = target === moved.from ? moved.to : target;
          let relative = path.posix.relative(
            path.posix.dirname(nextSourcePath),
            nextTarget,
          );
          if (pathname.startsWith("./") && !relative.startsWith("."))
            relative = "./" + relative;
          const next =
            relative.split("/").map(encodeURIComponent).join("/") + suffix;
          const from = offset + node.position.start.offset,
            fragment = document.raw.slice(
              from,
              offset + node.position.end.offset,
            );
          const opening =
            node.type === "definition"
              ? /^\[[^\]]+\]:\s*<?/.exec(fragment)
              : /^!?\[[\s\S]*?\]\(\s*<?/.exec(fragment);
          const at = opening ? fragment.indexOf(url, opening[0].length) : -1;
          if (at >= 0 && next !== url)
            edits.push({
              from: from + at,
              to: from + at + url.length,
              insert: next,
            });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return edits;
}
export function toggleTask(
  document: DocumentSnapshot,
  taskId: string,
  done: boolean,
) {
  const task = document.tasks.find((t) => t.id === taskId);
  if (!task)
    throw new FableError(
      "STALE_REVISION",
      "This task moved. Refresh the document and try again.",
    );
  const source = document.raw.slice(task.from, task.to);
  const annotation = /<!--\s*fable:task\s+(\{[^\n]*?\})\s*-->/.exec(
    source.split(/\r?\n/)[0],
  );
  const meta = annotation ? JSON.parse(annotation[1]) : { id: randomUUID() };
  if (meta.id !== task.id) meta.id = randomUUID();
  meta.status = done ? "done" : "todo";
  if (done) meta.completed_at = new Date().toISOString();
  else delete meta.completed_at;
  const edits: TextEdit[] = [
    { from: task.checkFrom, to: task.checkTo, insert: done ? "x" : " " },
  ];
  if (annotation)
    edits.push({
      from: task.from + annotation.index,
      to: task.from + annotation.index + annotation[0].length,
      insert: `<!-- fable:task ${JSON.stringify(meta)} -->`,
    });
  else {
    const lineEnd = document.raw.indexOf("\n", task.from),
      at =
        lineEnd < 0
          ? task.to
          : document.raw[lineEnd - 1] === "\r"
            ? lineEnd - 1
            : lineEnd;
    edits.push({
      from: at,
      to: at,
      insert: ` <!-- fable:task ${JSON.stringify(meta)} -->`,
    });
  }
  return applyEdits(document.raw, edits);
}
export function moveTask(
  document: DocumentSnapshot,
  taskId: string,
  beforeTaskId: string,
) {
  const task = document.tasks.find((t) => t.id === taskId),
    target = document.tasks.find((t) => t.id === beforeTaskId);
  if (!task || !target)
    throw new FableError(
      "STALE_REVISION",
      "A task moved. Refresh before reordering it.",
    );
  if (task.id === target.id) return document.raw;
  const parentOf = (t: TaskRef) =>
    document.tasks
      .filter((p) => p.depth < t.depth && p.from < t.from && p.to >= t.to)
      .at(-1)?.id;
  if (
    task.depth !== target.depth ||
    parentOf(task) !== parentOf(target) ||
    task.context !== target.context
  )
    throw new FableError(
      "VALIDATION",
      "Reorder tasks within the same source list.",
    );
  const raw = document.raw,
    start = raw.lastIndexOf("\n", task.from - 1) + 1;
  let end = task.to;
  if (raw.slice(end, end + 2) === "\r\n") end += 2;
  else if (raw[end] === "\n") end++;
  const destination = raw.lastIndexOf("\n", target.from - 1) + 1;
  if (destination >= start && destination < end)
    throw new FableError("VALIDATION", "A task cannot be moved inside itself.");
  const block = raw.slice(start, end),
    eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return applyEdits(raw, [
    { from: start, to: end, insert: "" },
    {
      from: destination,
      to: destination,
      insert: block.endsWith("\n") ? block : block + eol,
    },
  ]);
}
