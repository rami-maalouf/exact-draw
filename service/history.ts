import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export type Revision = { id: string; createdAt: string; source: string; version: string };
export type Record = { id: string; path: string; originalPath: string | null; deletedAt: string | null };
export type Transfer = { id: string; source: string; destination: string; temporary: string; version: string; kind: 'move' | 'trash' | 'restore'; deletedAt: string | null };

export class History {
  private db: Database;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, 'documents.sqlite'), { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, originalPath TEXT, deletedAt TEXT);
      CREATE TABLE IF NOT EXISTS revisions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, documentId TEXT NOT NULL, createdAt TEXT NOT NULL, source TEXT NOT NULL, version TEXT NOT NULL, bytes TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revisions_document ON revisions(documentId, sequence);
      CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, source TEXT NOT NULL, destination TEXT NOT NULL, temporary TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL, deletedAt TEXT);
    `);
  }
  close() { this.db.close(); }
  find(path: string) { return this.db.query<Record, [string]>('SELECT * FROM documents WHERE path = ?').get(path); }
  get(id: string) { return this.db.query<Record, [string]>('SELECT * FROM documents WHERE id = ?').get(id); }
  register(path: string): Record {
    const existing = this.find(path);
    if (existing) return existing;
    const record = { id: randomUUID(), path, originalPath: null, deletedAt: null };
    this.db.query('INSERT INTO documents (id, path) VALUES (?, ?)').run(record.id, path);
    return record;
  }
  record(id: string, bytes: string, version: string, source: string, force = false) {
    this.db.transaction(() => {
      const latest = this.db.query<{ version: string }, [string]>('SELECT version FROM revisions WHERE documentId = ? ORDER BY sequence DESC LIMIT 1').get(id);
      if (!force && latest?.version === version) return;
      this.db.query('INSERT INTO revisions (id, documentId, createdAt, source, version, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, new Date().toISOString(), source, version, bytes);
      this.db.query('DELETE FROM revisions WHERE documentId = ? AND sequence NOT IN (SELECT sequence FROM revisions WHERE documentId = ? ORDER BY sequence DESC LIMIT 50)').run(id, id);
    })();
  }
  list(id: string): Revision[] {
    return this.db.query<Revision, [string]>('SELECT id, createdAt, source, version FROM revisions WHERE documentId = ? ORDER BY sequence DESC').all(id);
  }
  revision(id: string, revisionId: string) {
    return this.db.query<Revision & { bytes: string }, [string, string]>('SELECT id, createdAt, source, version, bytes FROM revisions WHERE documentId = ? AND id = ?').get(id, revisionId);
  }
  trash() { return this.db.query<Record, []>('SELECT * FROM documents WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC').all(); }
  pending() { return this.db.query<Transfer, []>('SELECT * FROM transfers').all(); }
  begin(transfer: Transfer) {
    this.db.query('INSERT INTO transfers (id, source, destination, temporary, version, kind, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(transfer.id, transfer.source, transfer.destination, transfer.temporary, transfer.version, transfer.kind, transfer.deletedAt);
  }
  cancel(id: string) { this.db.query('DELETE FROM transfers WHERE id = ?').run(id); }
  finish(transfer: Transfer) {
    this.db.transaction(() => {
      // a missing file at a reused destination must not inherit the old document's identity.
      this.db.query("UPDATE documents SET path = 'missing:' || id WHERE path = ? AND id != ?").run(transfer.destination, transfer.id);
      this.db.query('UPDATE documents SET path = ?, originalPath = ?, deletedAt = ? WHERE id = ?').run(transfer.destination, transfer.kind === 'trash' ? transfer.source : null, transfer.deletedAt, transfer.id);
      this.cancel(transfer.id);
    })();
  }
  fresh(path: string) {
    this.db.query("UPDATE documents SET path = 'missing:' || id WHERE path = ?").run(path);
    return this.register(path);
  }
}
