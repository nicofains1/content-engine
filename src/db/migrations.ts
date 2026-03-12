import type Database from 'better-sqlite3'
import { ALL_TABLES, ALL_INDEXES } from './schema.js'

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}

export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.transaction(() => {
    for (const sql of ALL_TABLES) {
      db.prepare(sql).run()
    }
    for (const sql of ALL_INDEXES) {
      db.prepare(sql).run()
    }

    // v2: add eval columns to content table
    if (!columnExists(db, 'content', 'eval_score')) {
      db.prepare('ALTER TABLE content ADD COLUMN eval_score INTEGER').run()
      db.prepare('ALTER TABLE content ADD COLUMN eval_pass INTEGER').run()
      db.prepare('ALTER TABLE content ADD COLUMN eval_reason TEXT').run()
    }

    // v3: add plan column to cms table
    if (!columnExists(db, 'cms', 'plan')) {
      db.prepare('ALTER TABLE cms ADD COLUMN plan TEXT').run()
    }
  })()
}
