import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";

type Snapshot = Pick<DocumentSnapshot, "revision" | "raw" | "modifiedAt">;

/** File events and save responses can arrive in different orders. */
export function snapshotDisposition(
  current: Snapshot,
  incoming: Snapshot,
  pendingRaw?: string,
  acknowledgedRevisions: ReadonlySet<string> = new Set(),
) {
  if (
    acknowledgedRevisions.has(incoming.revision) &&
    Date.parse(incoming.modifiedAt) < Date.parse(current.modifiedAt)
  )
    return "ignore";
  if (
    incoming.revision === current.revision ||
    incoming.raw === current.raw ||
    incoming.raw === pendingRaw
  )
    return "acknowledge";
  return "external";
}
