import Database from "better-sqlite3";
import type { DocumentSnapshot, SearchResult } from "../contracts/index.ts";

/** Disposable FTS index. No authoritative user data lives here. */
export class SearchIndex {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(id UNINDEXED, title, path, body, tokenize='unicode61');`,
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS snapshots (path TEXT PRIMARY KEY, revision TEXT NOT NULL, snapshot TEXT NOT NULL)",
    );
    // Bump when parser semantics change. Cached task references are never authoritative.
    if (this.db.pragma("user_version", { simple: true }) !== 1) {
      this.db.exec(
        "DELETE FROM documents; DELETE FROM snapshots; PRAGMA user_version=1",
      );
    }
  }
  snapshots(): DocumentSnapshot[] {
    return (
      this.db.prepare("SELECT snapshot FROM snapshots").all() as {
        snapshot: string;
      }[]
    ).map((row) => JSON.parse(row.snapshot));
  }
  replace(documents: DocumentSnapshot[]) {
    const previous = new Map(
      (
        this.db.prepare("SELECT path,revision FROM snapshots").all() as {
          path: string;
          revision: string;
        }[]
      ).map((d) => [d.path, d.revision]),
    );
    const current = new Set(documents.map((d) => d.path));
    this.db.transaction(() => {
      const insert = this.db.prepare(
        "INSERT INTO documents(id,title,path,body) VALUES(?,?,?,?)",
      );
      const snapshot = this.db.prepare(
        "INSERT OR REPLACE INTO snapshots(path,revision,snapshot) VALUES(?,?,?)",
      );
      const remove = this.db.prepare("DELETE FROM documents WHERE path=?"),
        removeSnapshot = this.db.prepare("DELETE FROM snapshots WHERE path=?");
      for (const old of previous.keys())
        if (!current.has(old)) {
          remove.run(old);
          removeSnapshot.run(old);
        }
      for (const d of documents)
        if (previous.get(d.path) !== d.revision) {
          if (previous.has(d.path)) remove.run(d.path);
          insert.run(d.id, d.title, d.path, d.body);
          snapshot.run(d.path, d.revision, JSON.stringify(d));
        }
    })();
  }
  query(value: string): SearchResult[] {
    const terms = value.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
    if (!terms.length) return [];
    const query = terms
      .map((t) => `"${t.replaceAll('"', '""')}"*`)
      .join(" AND ");
    return this.db
      .prepare(
        `SELECT id AS documentId, title, path, snippet(documents,3,'','',' … ',24) AS excerpt FROM documents WHERE documents MATCH ? ORDER BY bm25(documents,0,8,3,1) LIMIT 60`,
      )
      .all(query) as SearchResult[];
  }
  close() {
    this.db.close();
  }
}
