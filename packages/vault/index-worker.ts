import { parentPort, workerData } from "node:worker_threads";
import { SearchIndex } from "./search-index.ts";
import { parseMarkdown, revisionOf } from "../markdown/index.ts";
import type { DocumentSnapshot } from "../contracts/index.ts";
const index = new SearchIndex(workerData.database);
const cache = new Map(index.snapshots().map((d) => [d.path, d]));
parentPort!.on("message", ({ id, method, value }) => {
  try {
    let result: unknown;
    if (method === "parse")
      result = value.map(
        (f: { path: string; raw: string; modifiedAt: string }) => {
          const old = cache.get(f.path),
            doc =
              old?.revision === revisionOf(f.raw)
                ? old
                : parseMarkdown(f.path, f.raw, f.modifiedAt);
          cache.set(f.path, doc);
          return doc;
        },
      );
    else if (method === "replace") {
      index.replace(value);
      result = true;
    } else if (method === "query") result = index.query(value);
    else if (method === "close") {
      index.close();
      result = true;
    } else throw new Error("Unknown index operation.");
    parentPort!.postMessage({ id, result });
  } catch (e: any) {
    parentPort!.postMessage({ id, error: e.message });
  }
});
