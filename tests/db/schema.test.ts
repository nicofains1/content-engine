import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../src/db/migrations.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('migrations', () => {
  it('creates all tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>
    const names = tables.map(t => t.name)
    expect(names).toContain('reddit_posts')
    expect(names).toContain('content')
    expect(names).toContain('posts')
    expect(names).toContain('metrics')
    expect(names).toContain('cms')
    expect(names).toContain('learnings')
    expect(names).toContain('experiments')
    expect(names).toContain('prompt_history')
  })

  it('is idempotent', () => {
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('can insert and query reddit_posts', () => {
    db.prepare('INSERT INTO reddit_posts (id, subreddit, title, score, upvote_ratio, url) VALUES (?, ?, ?, ?, ?, ?)').run('abc123', 'todayilearned', 'TIL test', 5000, 0.95, 'https://reddit.com/r/test')
    const row = db.prepare('SELECT * FROM reddit_posts WHERE id = ?').get('abc123') as Record<string, unknown>
    expect(row.id).toBe('abc123')
    expect(row.used).toBe(0)
  })
})
