// Tool sessions, kept in SQLite so History can list them and open any one
// again as it was. A session is what a tool page held in its tab (its
// link, files, options, results and steps), saved from its first real
// action on (a lookup, a run) and updated as it changes.
//
// Dropped files are saved by reference: the preload hands over each file's
// path, which is stored here under a random token, and the page only ever
// sees the token, with the file's name and size. A run resolves the token
// back to the path, so a page can never name a path of its own.
//
// Uses Node's own node:sqlite, which Electron's Node has, so there is no
// native module to rebuild. No Electron import, so the integration tests
// can use it with plain Node.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  FilePreview,
  SavedFile,
  SessionInput,
  SessionMeta,
  SessionStatus,
  SessionRecord,
  SessionSummary,
} from '../../shared/types';

/** Bumped with each change to the tables; see `migrate`. */
const version = 3;

type Row = {
  id: string;
  tool_id: string;
  title: string;
  summary: string;
  meta: string;
  state: string;
  created_at: number;
  updated_at: number;
};

export class SessionStore {
  private db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // Readers never wait on the writer, and a crash never half-writes.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private migrate() {
    const { user_version: current } = this.db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number };
    if (current >= version) return;
    if (current < 1) this.createTables();
    if (current < 2) {
      // What History shows of each session (see SessionMeta), and each
      // saved file's picture and length, made once.
      this.db.exec(`
        ALTER TABLE sessions ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE files ADD COLUMN preview TEXT;
      `);
    }
    if (current < 3) {
      // Pictures were kept 240px wide, blurry on History's larger cards:
      // files' previews are made again, at the new size, when next asked
      // for, and each session's picture is redone once (see
      // staleThumbnails), keeping its place in History.
      this.db.exec(`
        ALTER TABLE sessions ADD COLUMN thumbnail_stale INTEGER NOT NULL DEFAULT 0;
        UPDATE sessions SET thumbnail_stale = 1
          WHERE json_extract(meta, '$.thumbnail') IS NOT NULL;
        UPDATE files SET preview = NULL;
      `);
    }
    this.db.exec(`PRAGMA user_version = ${version}`);
  }

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        -- The page's tab state, as JSON.
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_update
        ON sessions (updated_at DESC);
      CREATE TABLE IF NOT EXISTS files (
        token TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Adds or updates a session; it keeps the time it was first saved, and
   * its last-updated time unless its state changed.
   */
  save(input: SessionInput): SessionSummary {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, tool_id, title, summary, meta, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           tool_id = excluded.tool_id,
           title = excluded.title,
           summary = excluded.summary,
           meta = excluded.meta,
           state = excluded.state,
           -- Only work done in it moves it in History: a page re-saving
           -- what it was opened with (or how its runs ended, or a new
           -- picture) keeps its time.
           updated_at = CASE WHEN sessions.state = excluded.state
             THEN sessions.updated_at ELSE excluded.updated_at END`,
      )
      .run(
        input.id,
        input.toolId,
        input.title,
        input.summary,
        JSON.stringify(input.meta),
        input.state,
        now,
        now,
      );
    return this.get(input.id)!;
  }

  /** The latest sessions first, without their state. */
  list(limit = 500): SessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, tool_id, title, summary, meta, created_at, updated_at
           FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit) as Omit<Row, 'state'>[];
    return rows.map(summaryOf);
  }

  get(id: string): SessionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? { ...summaryOf(row), state: row.state } : null;
  }

  /**
   * Records how run `jobId` stands in the session it belongs to, if any.
   * True when a session changed.
   */
  setJobStatus(jobId: string, status: SessionStatus): boolean {
    const key = `$.jobs."${jobId.replace(/"/g, '')}"`;
    const { changes } = this.db
      .prepare(
        `UPDATE sessions SET meta = json_set(meta, ?, ?)
           WHERE json_extract(meta, ?) IS NOT NULL
             AND json_extract(meta, ?) != ?`,
      )
      .run(key, status, key, key, status);
    return Number(changes) > 0;
  }

  /** Sessions whose picture is to be made again, with their state. */
  staleThumbnails(): { id: string; state: string }[] {
    return this.db
      .prepare('SELECT id, state FROM sessions WHERE thumbnail_stale = 1')
      .all() as { id: string; state: string }[];
  }

  /**
   * Gives a session a new picture (or, with null, keeps the one it has)
   * and marks it done, without moving it in History.
   */
  setThumbnail(id: string, thumbnail: string | null) {
    this.db
      .prepare(
        `UPDATE sessions SET thumbnail_stale = 0,
           meta = CASE WHEN ? IS NULL THEN meta
             ELSE json_set(meta, '$.thumbnail', ?) END
         WHERE id = ?`,
      )
      .run(thumbnail, thumbnail, id);
  }

  /** A saved file's preview, if it has been made. */
  preview(token: string): FilePreview | null {
    const row = this.db
      .prepare('SELECT preview FROM files WHERE token = ?')
      .get(token) as { preview: string | null } | undefined;
    return row?.preview ? (JSON.parse(row.preview) as FilePreview) : null;
  }

  setPreview(token: string, preview: FilePreview) {
    this.db
      .prepare('UPDATE files SET preview = ? WHERE token = ?')
      .run(JSON.stringify(preview), token);
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Forgets every session, and the files they referred to. */
  clear() {
    this.db.exec('DELETE FROM sessions; DELETE FROM files;');
    // Gives the space back to the disk; deleted rows otherwise keep it. In
    // WAL mode the compacted pages land in the -wal file first, so it is
    // checkpointed and truncated too.
    this.db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  }

  /**
   * A token for a file the user dropped or picked; the same file always
   * gets the same token. `filePath` should come from the preload, never
   * from the page.
   */
  addFile(
    filePath: string,
    file: { name: string; size: number; type: string },
  ): SavedFile {
    const existing = this.db
      .prepare('SELECT token FROM files WHERE path = ?')
      .get(filePath) as { token: string } | undefined;
    const token = existing?.token ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO files (token, path, name, size, type, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET
           name = excluded.name, size = excluded.size, type = excluded.type,
           -- A file that has changed gets a new preview.
           preview = CASE WHEN files.size = excluded.size
             THEN files.preview ELSE NULL END`,
      )
      .run(token, filePath, file.name, file.size, file.type, Date.now());
    return {
      kind: 'saved-file',
      token,
      name: file.name,
      size: file.size,
      type: file.type,
    };
  }

  /** Where a saved file's token points, or null for an unknown token. */
  filePath(token: string): string | null {
    const row = this.db
      .prepare('SELECT path FROM files WHERE token = ?')
      .get(token) as { path: string } | undefined;
    return row?.path ?? null;
  }

  close() {
    this.db.close();
  }
}

const summaryOf = (row: Omit<Row, 'state'>): SessionSummary => ({
  id: row.id,
  toolId: row.tool_id,
  title: row.title,
  summary: row.summary,
  meta: parseMeta(row.meta),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function parseMeta(text: string): SessionMeta {
  try {
    const meta = JSON.parse(text) as unknown;
    return meta && typeof meta === 'object' ? (meta as SessionMeta) : {};
  } catch {
    return {};
  }
}
