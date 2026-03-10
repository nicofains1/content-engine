import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { runMigrations } from './migrations.js'
import { loadConfig } from '../config/index.js'
import type { ContentStatus, PostStatus } from '../types/index.js'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    const config = loadConfig()
    const dbPath = join(config.paths.dataDir, 'content-engine.db')
    mkdirSync(dirname(dbPath), { recursive: true })
    _db = new Database(dbPath)
    runMigrations(_db)
  }
  return _db
}

export function isRedditPostProcessed(db: Database.Database, postId: string): boolean {
  const row = db.prepare('SELECT id FROM reddit_posts WHERE id = ?').get(postId)
  return !!row
}

export function insertRedditPost(db: Database.Database, post: {
  id: string; subreddit: string; title: string; score: number;
  upvote_ratio: number; url: string
}): void {
  db.prepare(`
    INSERT OR IGNORE INTO reddit_posts (id, subreddit, title, score, upvote_ratio, url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(post.id, post.subreddit, post.title, post.score, post.upvote_ratio, post.url)
}

export function markRedditPostUsed(db: Database.Database, postId: string): void {
  db.prepare('UPDATE reddit_posts SET used = 1 WHERE id = ?').run(postId)
}

export function insertContent(db: Database.Database, content: {
  id: string; reddit_post_id: string; cm_id: string; script: string;
  caption: string; hashtags: string; voice: string; background_clip: string;
  music_track: string
}): void {
  db.prepare(`
    INSERT INTO content (id, reddit_post_id, cm_id, script, caption, hashtags, voice, background_clip, music_track, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating')
  `).run(content.id, content.reddit_post_id, content.cm_id, content.script,
    content.caption, content.hashtags, content.voice, content.background_clip, content.music_track)
}

export function updateContentStatus(db: Database.Database, id: string, status: ContentStatus, updates?: {
  script_path?: string; audio_path?: string; subtitle_path?: string;
  video_path?: string; duration_seconds?: number; error?: string
}): void {
  const sets = ['status = ?', "updated_at = datetime('now')"]
  const vals: unknown[] = [status]

  if (updates) {
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v) }
    }
  }
  vals.push(id)
  db.prepare(`UPDATE content SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function getReadyContent(db: Database.Database): Record<string, unknown> | null {
  return db.prepare(`
    SELECT c.* FROM content c
    WHERE c.status = 'ready'
    AND NOT EXISTS (
      SELECT 1 FROM posts p
      WHERE p.content_id = c.id AND p.platform = 'youtube'
    )
    ORDER BY c.created_at ASC
    LIMIT 1
  `).get() as Record<string, unknown> | null
}

export function insertPost(db: Database.Database, post: {
  content_id: string; platform: string
}): number {
  const result = db.prepare(`
    INSERT INTO posts (content_id, platform) VALUES (?, ?)
  `).run(post.content_id, post.platform)
  return result.lastInsertRowid as number
}

export function updatePost(db: Database.Database, id: number, status: PostStatus, updates?: {
  platform_post_id?: string; url?: string; error?: string; posted_at?: string
}): void {
  const sets = ['status = ?']
  const vals: unknown[] = [status]

  if (updates) {
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v) }
    }
  }
  vals.push(id)
  db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function getPostedYouTubeVideos(db: Database.Database): Array<{ id: number; platform_post_id: string; cm_id: string }> {
  return db.prepare(`
    SELECT p.id, p.platform_post_id, c.cm_id
    FROM posts p
    JOIN content c ON c.id = p.content_id
    WHERE p.platform = 'youtube' AND p.status = 'posted' AND p.platform_post_id IS NOT NULL
  `).all() as Array<{ id: number; platform_post_id: string; cm_id: string }>
}

export function insertMetric(db: Database.Database, metric: {
  post_id: number; views: number; likes: number; comments: number; shares: number
}): void {
  db.prepare(`
    INSERT INTO metrics (post_id, views, likes, comments, shares)
    VALUES (?, ?, ?, ?, ?)
  `).run(metric.post_id, metric.views, metric.likes, metric.comments, metric.shares)
}

export function updateCMStats(db: Database.Database, cmId: string, stats: {
  total_views: number; total_likes: number; total_comments: number;
  avg_views: number; best_video_views: number; videos_generated: number
}): void {
  db.prepare(`
    UPDATE cms SET
      total_views = ?, total_likes = ?, total_comments = ?,
      avg_views = ?, best_video_views = ?, videos_generated = ?
    WHERE id = ?
  `).run(stats.total_views, stats.total_likes, stats.total_comments,
    stats.avg_views, stats.best_video_views, stats.videos_generated, cmId)
}

export function getAllActiveCMs(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM cms WHERE status != 'dead'").all() as Array<Record<string, unknown>>
}

export function insertCM(db: Database.Database, cm: {
  id: string; generation: number; parent_id?: string; genome: string; status: string
}): void {
  db.prepare(`
    INSERT INTO cms (id, generation, parent_id, genome, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(cm.id, cm.generation, cm.parent_id ?? null, cm.genome, cm.status)
}
