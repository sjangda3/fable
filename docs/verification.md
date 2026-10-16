# Verification report

Checked locally on 2026-10-16, macOS arm64, Node 22.14.0. This is a working 0.1 development build. The complete version-one release criteria in the build plan have not all passed.

## Automated checks

| Check                                        | Local result                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript                                   | `npm run typecheck` passed                                                                          |
| Unit/integration tests                       | `npm test`: 68 tests across nine files passed                                                       |
| Production renderer and desktop bundles      | `npm run build` passed; the existing Mac ZIP predates the latest sidebar changes                    |
| Sidebar renderer smoke                       | `npm run smoke:sidebar` passed against the production renderer, real preload and temporary vault    |
| Packaged Electron smoke                      | Rendered Projects view, isolated preload bridge, live vault worker, and libsodium encryption passed |
| Installed provider discovery in packaged app | Codex subscription / 7 models; Claude subscription / 5 models                                       |
| Edge Function                                | `npx deno check supabase/functions/sync/index.ts` passed                                            |
| Dependency audit                             | `npm audit --audit-level=low`: zero reported vulnerabilities                                        |
| Database authorization                       | Migration and `tests/integration/backend-access.sql` passed against isolated PostgreSQL 17          |

File tests cover byte-preserving frontmatter patches, comments/quotes/unknown properties, LF/CRLF, malformed metadata, duplicate tasks and IDs, full nested task moves, hierarchy validation, guarded saves, external-edit races, relative-link-aware renames, interrupted multi-file writes, recovery, preserved drafts, undo collisions, and cache reconstruction. Live-preview selection cannot accidentally delete hidden frontmatter. Conversation checkboxes do not become tasks until proposed changes are applied.

Sync tests use two independent vault clients with real encryption and an in-memory revision server. They cover fresh nonces, authenticated identities, tamper/wrong-key rejection, opaque server object IDs, merge/conflict copies, renames, deletion versus edits, attachments, portable preferences, offline retries, reconstruction, lazy downloads with per-file checkpoints, interrupted attachment scans, duplicate document IDs, and switching vaults without carrying the old connection. Local startup is tested with a sync restore that never resolves.

The PostgreSQL tests exercise actual grants, RLS ownership boundaries, service-only mutation, expected-head checks, idempotency, reservation cleanup, and session/device revocation. They use test Auth/Storage schema fixtures. They are **not** a deployed Supabase Auth, Storage, SMTP, and Edge Runtime integration test.

## Interface and live checks

The integrated browser exercised the real loopback service, rather than mock browser storage:

- Task completion changed the original checkbox, reduced Tasks 35 to 34, and undo restored 35.
- Created a note, edited and autosaved through CodeMirror, navigated away and back, and checked the saved Markdown and local search result.
- Bookmarked a note and verified the portable Markdown configuration.
- Renamed a note through Properties and returned it to its original path, preserving its body.
- Restored a prior version through local history.
- Sent a selected sample note to the authenticated Codex runtime, reviewed its proposal, applied it, and undid it back to the exact original body. Rejection left source content unchanged. Conversations were saved as Markdown.
- Confirmed that the installed Claude runtime's revoked OAuth login is shown as an authentication failure. Catalog discovery alone does not mark inference as verified.

Manual visual checks at a 1324 × 1040 logical viewport covered the board, tasks, and goals. Proof captures are saved locally in `artifacts/visual/`. They establish a reviewable implementation; no automated one-logical-pixel fidelity result is claimed. The combined example vault includes eight goals so it can reproduce both the outline and expanded navigation examples.

All live content changes were made in generated example vaults. No personal vault was opened or rewritten.

The subsequent sidebar revision was checked in the integrated browser: no profile control or global navigation rows remain in the sidebar; the area dropdown scopes projects and notes; project detail cards show real counts and paths; hover controls create actual folders and Markdown notes. Created `References/Motion studies.md` under a project, switched between Personal and Creative work, and reopened the original note. Created a Reading area and a project bound to it. Additional tests cover nested area ownership, legacy goal ancestry without source rewriting, scoped project filenames, safe folder creation, directory reopening, saved area selection, and conversation ownership.

Project pages were then verified through the browser: created Project brief from the project sidebar, confirmed its Page editor and project membership, opened the project Pages list, and verified the saved Markdown file. New tests cover collecting nested pages, excluding conversations and other projects, reopening pages, and rejecting invalid owners or destinations.

A stopped development preview caused folder creation to report `Failed to fetch`. After restarting the local service, real HTTP checks confirmed folder and nested-folder creation, directories on disk and in the returned sidebar state, and duplicate-name rejection. Temporary check folders were removed. Transport tests cover a clear service-unavailable error, no automatic mutation replay, a successful later retry, and preservation of server validation errors.

The drag revision adds tests for persisted project/folder/page order, stale settings, invalid siblings, order before preview truncation, physical page moves, link repair, identity/ownership, collision protection, external edits, undo, and encrypted preference synchronization. An Electron smoke harness loads the production UI with its actual preload and file service, dispatches HTML drag events, verifies insertion/inside indicators, hover expansion, folder/project/page reordering, moves across folders/projects, keyboard reordering, and saving an unsaved editor draft before moving. This simulates drag events rather than OS mouse gestures. The in-app browser was used to inspect the sidebar at 1324 × 1040, open a page and its Move page dialog, and verify destination choices and cancellation; native pointer dragging in that browser was not automated.

## Performance

Latest serial benchmark (`artifacts/benchmark.json`):

| Measurement                                  |          Result |
| -------------------------------------------- | --------------: |
| Notes / tasks                                | 10,000 / 50,000 |
| Initial open after parsed-cache invalidation |        7,324 ms |
| Warm vault open                              |        1,190 ms |
| Indexed search p95, 200 queries              |         3.21 ms |
| Task grouping                                |         7.20 ms |

These are local vault-service timings. They do not measure full application startup, renderer frame times, or typing during simultaneous sync. Warm-open timings varied under parallel packaging load; the two-second application-launch criterion remains unverified. The production build also reports a large renderer chunk; code splitting remains an optimization candidate.

## Remaining work before version one

- Renew Claude's official-runtime login and verify live inference, cancellation, and review/apply/undo through that provider. Confirm distribution eligibility for both provider integrations.
- Deploy a hosted and a Docker self-hosted Supabase stack and run the full two-computer Auth/Storage/Edge suite. No hosted service has been deployed. The local machine's Docker daemon was unavailable.
- Complete selected-text-only AI replacement; the current proposal workflow operates on explicitly selected whole notes.
- Add a dedicated conflict comparison/acknowledgment workflow and remote version-history browser. Conflict copies are preserved and openable now; local version history and undo are implemented.
- Validate large-vault rendering and background progress, keyboard/screen-reader behavior, and platform-specific visual baselines. The board currently exposes a Done-column toggle; arbitrary per-column hiding is not yet exposed.
- Run native Windows x64 and Intel Mac checks, macOS 14 clean-machine checks, installers/upgrades/rollback, signing, notarization, and Gatekeeper/SmartScreen checks. CI is configured for the native targets but has not been pushed or executed remotely.

The Mac ZIP is an unsigned development artifact. See [release checks](release-checks.md), [provider connections](provider-connections.md), and [self-hosting](self-hosting.md). No public release or remote deployment was performed.
