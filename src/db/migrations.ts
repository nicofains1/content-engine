import type Database from 'better-sqlite3'
import { ALL_TABLES, ALL_INDEXES } from './schema.js'

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
  })()
}
