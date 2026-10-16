import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { patchMetadata } from "../markdown/index.ts";
import type { DocumentKind, WorkStatus } from "../contracts/index.ts";

export const sampleId = (label: string) => {
  const h = createHash("sha256")
    .update(`fable-reference:${label}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export async function seedVault(root: string) {
  try {
    await fs.access(path.join(root, ".fable/sample.md"));
    return;
  } catch {
    /* create the explicitly selected sample */
  }
  const write = async (
    title: string,
    kind: DocumentKind,
    rank: string,
    body = "",
    extra: Record<string, unknown> = {},
  ) => {
    const folders = {
      area: "Areas",
      goal: "Goals",
      project: "Projects",
      note: "Notes",
      insight: "Insights",
      conversation: "Conversations",
    };
    const relative = `${folders[kind]}/${title.replaceAll("/", "—")}.md`,
      absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const raw = patchMetadata(`# ${title}\n\n${body}`, {
      schema: 1,
      id: sampleId(title),
      kind,
      status: "todo",
      rank,
      ...(["project", "note"].includes(kind)
        ? { parent: sampleId("Personal") }
        : kind === "goal"
          ? { parent: sampleId("Creative work") }
          : {}),
      ...extra,
    });
    await fs.writeFile(absolute, raw, { flag: "wx" }).catch((e: any) => {
      if (e.code !== "EEXIST") throw e;
    });
  };
  await write("Personal", "area", "00");
  await write("Creative work", "area", "01");
  await write(
    "Understand my Resources",
    "goal",
    "10",
    "Make thoughtful use of my time, attention, and tools.\n",
    { parent: sampleId("Personal"), status: "waiting" },
  );
  await write(
    "Build Productivity Tool with Insights",
    "goal",
    "11",
    "A quieter place to think, plan, and follow through.\n",
    { parent: sampleId("Understand my Resources"), status: "waiting" },
  );
  await write(
    "Animation Composer",
    "goal",
    "12",
    "Explore animation through deliberate practice.\n\n[After Effects Wiki](../Notes/After%20Effects%20Wiki.md)\n",
  );
  await write("Apartment Cover Letter", "goal", "13");
  await write("Design as Art", "goal", "14", "", {
    parent: sampleId("Apartment Cover Letter"),
    depends_on: [sampleId("Apartment Cover Letter")],
  });
  await write("Concrete thoughts", "goal", "15");
  await write("Client — Hera", "goal", "16", "", {
    parent: sampleId("Concrete thoughts"),
  });
  await write("Deutschlandticket Trips Tracker", "goal", "17", "", {
    parent: sampleId("Client — Hera"),
  });
  const folioTasks = [
    "Gather references",
    "Document the best aspects and feedback",
    "Journal what I want",
    "Break it down",
    "Scope the parts with Codex",
    "Create MVP",
    "Refine MVP manually",
    "Create a Design system from the initial polish",
    "Create skills for agents",
    "Build the parts using scope with Agents",
    "Test with people, get feedback",
    "Publish",
    "Announce",
  ];
  const horizonTasks = [
    "S: show deadline in the sidebar",
    "XL: impact, effort, urgency → Priority",
    "M: add new button with modal",
    "XL: contextual command bar",
    "L: Estimate based on size of task",
    'S: Always selecting "Areas" in sidebar',
    "L: In Kanban: Allow me to hide individual columns and then bring them back",
    "M: Remember my last view",
    "S: Keep keyboard focus after completion",
    "L: Review the weekly progress view",
  ];
  const checklist = (items: string[], fixes = false) =>
    items
      .map(
        (t, i) =>
          `${fixes && i === 5 ? "\n\n## Fixes\n\n" : ""}- [ ] ${t} <!-- fable:task ${JSON.stringify({ id: sampleId(t) })} -->`,
      )
      .join("\n") + "\n";
  const project = async (
    title: string,
    rank: string,
    status: WorkStatus,
    body = "",
    extra: Record<string, unknown> = {},
  ) => write(title, "project", rank, body, { status, ...extra });
  await project(
    "Folio Remake 2026",
    "20",
    "todo",
    `A portfolio that reflects how I think and work.\n\n## Tasks\n\n${checklist(folioTasks)}`,
  );
  await project(
    "horizon for Obsidian",
    "21",
    "waiting",
    `A focused productivity layer for a folder of Markdown files.\n\n## Tasks\n\n${checklist(horizonTasks, true)}`,
    {
      parent: sampleId("Build Productivity Tool with Insights"),
      start: "2026-10-04",
      due: "2026-10-18",
    },
  );
  await project(
    "Decks for Talon One",
    "19",
    "todo",
    "Prepare a clear, concise presentation.\n",
    { due: "2026-10-15", parent: sampleId("Creative work") },
  );
  await project(
    "Dream Job",
    "23",
    "waiting",
    "Collect roles and keep a thoughtful application shortlist.\n",
    { start: "2026-05-01", due: "2027-07-10" },
  );
  await project(
    "Sublet NAU6 Apartment",
    "24",
    "waiting",
    "Coordinate the handover and confirm the dates.\n",
    { depends_on: [sampleId("Move to Susana's Apartment")], due: "2026-10-31" },
  );
  await project(
    "Indian Banks NRO",
    "25",
    "ready",
    "Keep the documents and next steps together.\n",
  );
  await project(
    "India 2026 with Susana",
    "26",
    "doing",
    `## Tasks\n\n${checklist(["Check passport dates", "Book the flights", "Make a shared itinerary", "Research places to stay", "Arrange airport transfers", "Confirm travel insurance"])}`,
    { start: "2026-10-01" },
  );
  await project(
    "Move to Susana's Apartment",
    "27",
    "doing",
    `## Tasks\n\n${checklist(["Confirm the moving date", "Sort books and papers", "Pack the studio", "Arrange a van", "Update the address", "Return the apartment keys"])}`,
    { start: "2026-08-19" },
  );
  for (const [i, title] of [
    "A calmer workspace",
    "Summer reading list",
    "Studio archive",
    "Personal website notes",
  ].entries())
    await project(
      title,
      `3${i}`,
      "done",
      "A finished project, kept for reference.\n",
      {
        parent: sampleId("Build Productivity Tool with Insights"),
        completed_at: "2026-10-12T12:00:00.000Z",
      },
    );
  await write(
    "After Effects Wiki",
    "note",
    "40",
    "A living collection of animation references.\n\n## Timing\n\nStart with the feeling. Adjust the curve until the motion has the right weight.\n\n## References\n\nKeep examples close to the work they inform.\n",
    { parent: sampleId("Animation Composer") },
  );
  await write(
    "A place for your thoughts",
    "note",
    "41",
    "Fable keeps your notes in a folder you choose. Each note is a Markdown file you can read, edit, and move with any app.\n\n## Make yourself at home\n\nUse **⌘ N** to write a note, **⌘ K** to find a command, and **⌘ J** to open your AI assistant. On Windows, use Ctrl.\n\nYour tasks are ordinary Markdown checkboxes. Your projects and goals are notes with a little metadata. Everything stays useful offline.\n\n> Your files. Your AI. Your data.\n",
  );
  await fs.mkdir(path.join(root, ".fable"), { recursive: true });
  for (const [title, body] of [
    [
      "Design references",
      "Collect the details worth keeping: quiet navigation, readable type, and room to think.",
    ],
    [
      "Portfolio structure",
      "Start with the work. Give each project a short introduction, a clear process, and an honest result.",
    ],
    [
      "Writing the introduction",
      "A few words about what I make and how I approach the work.",
    ],
  ])
    await write(title, "note", "42", body + "\n", {
      parent: sampleId("Folio Remake 2026"),
    });
  await write(
    "Travel details",
    "note",
    "43",
    "Keep flights, places to stay, and the shared itinerary together.\n",
    { parent: sampleId("India 2026 with Susana") },
  );
  await write(
    "Presentation outline",
    "note",
    "44",
    "A simple beginning, the work itself, and the next step.\n",
    { parent: sampleId("Decks for Talon One") },
  );
  await fs.writeFile(
    path.join(root, ".fable/sample.md"),
    "# Reference workspace\n\nThis sample is stored as real Markdown. Changes here persist locally.\n",
  );
}
