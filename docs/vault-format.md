# Vault format, schema 1

The folder is authoritative. Opening existing Markdown does not rewrite it. App-managed relationships use stable IDs; users may keep their own directory structure.

```text
Areas/Work.md
Goals/Understand my resources.md
Projects/Folio Remake 2026.md
Notes/Design references.md
Conversations/Portfolio planning.md
Attachments/reference.png
.fable/views.md
.fable/history/<operation>.md
.fable/journal/<operation>.md
.fable/sync.md
.fable/sync-bases/
```

```md
---
fable:
  schema: 1
  id: 17165187-bd99-487a-a5bb-1f6ef362ed47
  kind: project
  parent: 6e082f1f-17c5-4231-9333-213819a2d44f
  status: todo
  rank: a0
---

# Folio Remake 2026

- [ ] Gather references
```

Kinds: `area`, `goal`, `project`, `note`, `insight`, `conversation`. Statuses: `todo`, `waiting`, `ready`, `doing`, `done`. Other fields include `start`, `due`, `depends_on`, and `completed_at`. Unknown frontmatter remains intact. The first H1 is the title; the filename is the fallback. Editing a heading does not rename a file.

Areas are roots. New projects belong directly to an Area; notes inherit their Area through their project or another parent note. Older Goal → Area relationships remain readable, including projects under Goals, without rewriting the source files. Missing parents appear in the Unassigned area; cycles and duplicate identities block managed writes until repaired.

The sidebar's area selector scopes projects, notes, search, and AI context. New project documents default to `Projects/<Area>/<Project>.md`. Project notes and subfolders default to the directory beside the project document with its `.md` suffix removed. Area notes default to `Notes/<Area>/`. Folder creation makes ordinary directories; an empty folder stays local until it contains synchronized files. File locations are defaults, and stable parent IDs determine ownership even when users move files.

Pages inside a project are `kind: note` Markdown documents whose parent ID points to that project or one of its pages. There is no separate page database or format migration. The New page flow requires a project and validates its destination folder. The project's Pages list includes nested pages and excludes saved AI conversations.

Sidebar sibling order is stored in the `sidebarOrder` JSON field inside `.fable/views.md`. Each key encodes the item kind, owning area/project ID, and containing directory; its value lists document IDs or folder paths. Missing entries keep their default order, and deleted entries are ignored. Ordering never changes filenames or rewrites note contents. These preferences use the existing encrypted sync path.

Moving a page uses a revision-guarded file move, rebases relative links, repairs incoming Markdown links, and updates its parent when crossing project/area boundaries. A pending editor draft is saved first. The move and link repairs share a recovery journal and can be undone. Name collisions and stale revisions preserve existing files. Folder dragging reorders siblings; it does not relocate directory subtrees. A page with child notes must have those notes moved first before moving it to a different owner.

Tasks remain in their original document. Plain GFM checkboxes work without annotations. Stable task properties use a hidden-in-preview HTML comment:

```md
- [ ] Gather references <!-- fable:task {"id":"69063da8-7d59-4d74-aeb8-adb2703a0c12","due":"2026-10-15"} -->
```

The checkbox is authoritative for completion. Completing a task patches its exact source character and records completion time in its annotation. Task references carry source offsets and the base revision, so duplicate wording does not select the wrong task. Full task blocks, including nested content, move together.

Writes use SHA-256 revisions, a same-directory temporary file, fsync, and atomic replacement. Multi-file changes save a Markdown recovery journal before writing any affected file. Recovery preserves unexpected external content and writes conflict copies instead of replacing it. Undo checks that the applied version is still current; it never overwrites newer work.

SQLite, parsed snapshots, and sync checkpoints are caches. Removing the search cache rebuilds it from Markdown. `.fable/history` contains user recovery data and should be backed up with the folder. Device checkpoints and merge bases are not synchronized. Portable view preferences are Markdown; provider credentials and sync encryption keys live outside the folder.

The editor keeps unsaved text after save failures. External changes reload a clean editor; a dirty editor offers preserving the draft as another Markdown note or using the file version. Native close waits for a successful save. Unsupported syntax remains in source mode.
