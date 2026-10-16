import { Worker } from "node:worker_threads";
import path from "node:path";
import type { DocumentSnapshot, SearchResult } from "../contracts/index.ts";

/** Parsing and SQLite stay off Electron's event loop. The worker owns a disposable cache. */
export class Indexer {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (e: Error) => void }
  >();
  private failure?: Error;
  constructor(database: string) {
    this.worker = new Worker(
      process.env.FABLE_INDEXER_WORKER ||
        path.resolve(".vite/build/index-worker.cjs"),
      { workerData: { database } },
    );
    this.worker.on("message", (value) => {
      const p = this.pending.get(value.id);
      if (p) {
        this.pending.delete(value.id);
        value.error
          ? p.reject(new Error(value.error))
          : p.resolve(value.result);
      }
    });
    this.worker.on("error", (value) => {
      const error = value instanceof Error ? value : new Error(String(value));
      this.failure = error;
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    });
  }
  private request<T>(method: string, value?: unknown): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, value });
    });
  }
  parse(files: { path: string; raw: string; modifiedAt: string }[]) {
    return this.request<DocumentSnapshot[]>("parse", files);
  }
  replace(documents: DocumentSnapshot[]) {
    return this.request<void>("replace", documents);
  }
  query(query: string) {
    return this.request<SearchResult[]>("query", query);
  }
  async close() {
    try {
      await this.request("close");
    } finally {
      await this.worker.terminate();
    }
  }
}
