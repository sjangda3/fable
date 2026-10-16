# Fable

A quiet desktop home for notes, projects, goals, and tasks. Your files. Your AI. Your data.

Fable uses Electron, React, TypeScript, CodeMirror 6, SQLite FTS5, and **Hugeicons**. Your Markdown folder is authoritative; the database is a disposable search cache. Local editing, organization, attachments, history, and search require no account or network.

This is a working **0.1 development build**, not a signed public release. macOS Apple Silicon has been exercised locally. Windows and Intel Mac builds have CI configurations but still need clean-machine verification. The encrypted sync service is included; no hosted service is deployed or silently enabled. The current Claude login on the development machine needs renewal before inference can pass.

## Run

Requires Node 22.14+ and npm. Use a native Mac or Windows development environment for Electron and its native dependencies.

```sh
npm ci
npm run desktop
```

Choose a folder, or explore the example workspace. The example is real, persistent Markdown and reproduces the reference projects and task lists.

For a browser development preview backed by a local sample folder:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. This loopback preview uses `.fable-dev/personal`; folder selection and OS credential protection belong to the desktop app. Do not expose the preview server publicly or use it to store production sync credentials.

## What works

- Area-name dropdown, area-scoped projects and notes, expandable project folders, note/folder creation, and project detail cards on hover or focus. Sidebar transitions use Framer Motion and respect reduced motion.
- Projects contain pages. Create a page from the project, its sidebar folder, or Cmd/Ctrl+N while working in it. Pages are ordinary Markdown notes with stable project ownership; existing project notes appear as pages automatically.
- Drag project folders, sibling folders, and pages to reorder them. Drop pages on a folder or another project to move them. Closed destinations open on hover, and the sidebar scrolls near its edges. Framer Motion animates insertion feedback and layout changes. Alt+Up/Down reorders a focused item; Alt+M or a page’s hover menu opens the folder chooser.
- Resizable sidebar, file/bookmark modes, document/view tabs, history navigation, quick open, and local search. Search and AI note context follow the selected area.
- Nested goal outlines, a project board grouped by parent goal, global task groups, local insights, and completed work with restore actions.
- Live Markdown and source modes, checkboxes, images, links, find/replace, autosave, conflict preservation, and native attachments.
- Completing a task patches its original Markdown. Task reordering moves the full block, including nested content; drag within a source list or use Alt+Up/Down on a task title.
- Guarded writes, atomic replacement, recoverable multi-file operations, Markdown history, and guarded undo.
- Subscription runtime detection and model discovery for Codex and Claude. Codex inference has passed a live check. AI proposals require review and are saved with the conversation as Markdown.
- XChaCha20-Poly1305 encrypted revision sync, automatic text merges, preserved conflict files, encrypted attachments, email-code authentication, device management, and hosted/self-hosted endpoint configuration.

## AI

Install and sign in to the official `codex` or `claude` runtime separately. Open Settings → AI connections. You can set an executable path if detection misses your installation. Fable uses provider-owned authentication and does not copy provider credentials into the vault or switch to API billing.

Choose notes explicitly in the assistant panel. Changes are proposed against known source revisions, reviewed, and applied through the same vault service as manual edits. Rejected proposals leave source documents untouched. Conversations, errors, interrupted responses, and proposals are Markdown files.

See [provider connections](docs/provider-connections.md), including runtime limitations and the public-distribution eligibility gate.

## Encrypted sync

Local work needs no sync account. Deploy the included Supabase migration and Edge Function using the [self-hosting guide](docs/self-hosting.md), then enter the endpoint and public client key in Settings → Sync. For a hosted build, set the two public `VITE_FABLE_SYNC_*` build variables in [.env.example](.env.example).

Keep the recovery key outside your vault. Account recovery cannot decrypt a vault without it. Plain local Markdown remains readable independently of Fable and the server.

See the [vault format](docs/vault-format.md) and [sync protocol](docs/sync-protocol.md).

## Checks and packaging

```sh
npm run typecheck
npm test
npm run build
npm run benchmark
npm run package
npm run make
npm run smoke
npm run smoke:sidebar
```

`npm run make` creates a Mac ZIP or Windows Squirrel installer and ZIP on the native platform. Build output is in `out/`. Signing uses environment variables documented in [release checks](docs/release-checks.md); unsigned development packages remain unsigned.

Provider discovery is read-only and makes no inference request:

```sh
npx tsx scripts/check-providers.ts
```

An explicit live inference check uses the signed-in subscriptions and their limits:

```sh
npx tsx scripts/check-providers.ts --inference
```

The [verification report](docs/verification.md) distinguishes tests run locally from remaining release gates. Original application code is MIT licensed. Dependencies retain their own licenses; the Claude runtime is separately installed.
