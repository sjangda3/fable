# Encrypted sync, protocol 1

Sync is optional. Source files are saved locally before networking begins. A failed upload does not undo or block a local edit.

## Encryption boundary

Each vault has a random 256-bit key. The client encrypts a JSON payload containing path, contents, binary/text marker, and deletion state using libsodium XChaCha20-Poly1305 with a fresh 192-bit nonce. Associated data binds the vault ID, object ID, and revision ID. Binary file contents are base64 inside that encrypted payload. Descriptive paths, note text, and attachments are never uploaded in plaintext.

Object identities are keyed HMACs using a separately derived identity key. Neither source document IDs nor guessable unkeyed path hashes are uploaded. Device labels use an OS name and opaque ID suffix, never the vault folder name.

The server sees account ownership, opaque identities, ciphertext length, timestamps, parent revisions, device identity/name, and an ordered sequence. Traffic timing and file sizes are not hidden. The recovery key is the vault key encoded for transfer. It is stored locally with Electron safeStorage, outside the vault. Provider credentials never enter this system.

## Push and pull

1. Create an outbox record with a stable revision ID, file hash, and expected parent; persist it in the device's Markdown checkpoint.
2. Reserve quota and receive a signed upload URL.
3. Upload ciphertext to private object storage.
4. Commit against the expected head in a database transaction protected by account and vault locks.
5. Record the server sequence, checkpoint, and merge base.
6. Other devices pull ordered batches, decrypt, validate, apply durably, and only then advance their cursor.

Repeated retries retain their revision ID. Server commits are idempotent. A stale expected head cannot replace a newer revision. Polling every 30 seconds and after local edits discovers remote work; realtime notifications are not required for correctness and are not enabled in this build.

Restoring a connection runs in the background so an unreachable server cannot hold up local startup. Network failures retry automatically. Incoming batches load one encrypted payload at a time and checkpoint each applied file; outgoing attachments are also read and uploaded individually. Closing a vault aborts its transport and clears the active connection before another folder opens.

## Conflicts and recovery

Non-overlapping text edits use a three-way merge from the retained base. Overlapping edits preserve local content and a normal Markdown conflict copy with a new ID. Binary conflicts preserve both files. Delete-versus-edit retains edited content. Rename collisions do not replace the destination. No timestamp selects a winner.

Markdown files, ordinary non-hidden attachments in any folder, and the allowlisted `.fable/views.md` / `.fable/vault.md` configurations synchronize. Provider settings, credentials, keys, caches, local journals, merge bases, device checkpoints, and hidden folders do not. Symlinks are never followed.

Deleting a checkpoint reconstructs state by replaying encrypted history; local differences remain protected. An unsupported protocol pauses sync and keeps local work available. Device revocation invalidates its server session, including storage reads. It cannot remove files a device already downloaded.

## Limits and retention

Defaults are 1 GB per account, including retained revisions and upload reservations, and 50 MB per original attachment. Ciphertext uploads allow up to 100 MB to cover encoding/encryption overhead. Five pending reservations are allowed. Expired uncommitted uploads are removed after their signed URLs have expired; quota is released only after storage deletion succeeds. A retry of the same reservation does not consume another slot.

Committed history and tombstones are retained indefinitely in this build, exceeding the 30-day minimum. This trades storage for conservative recovery. No history garbage collector is enabled before a device acknowledgment and retention implementation has been validated.

Operators may change account quota and pending reservations in `fable_private.limits`. Raising the original-file limit additionally requires changing the client limit, database checks, bucket limit, and Edge Function validation together.

## Server authorization

The Edge Function verifies the bearer token with Supabase Auth, extracts its signed session ID, and then checks live session/device ownership. Identity fields are never taken from request-body user IDs. Service-only mutation RPCs validate ownership again. Authenticated clients have read-only RLS access to their own vaults and ciphertext; anonymous clients receive no access. Every object and cursor lookup is scoped to a vault.

The migration's ownership, service-only mutation, idempotency, expected-head, and revocation behaviors are tested against real PostgreSQL. A deployed Auth/Storage/Edge round trip and independent security review remain release gates.
