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

export function getStaleYouTubePosts(db: Database.Database, staleHours = 12): Array<{ id: number; platform_post_id: string; cm_id: string }> {
  return db.prepare(`
    SELECT p.id, p.platform_post_id, c.cm_id
    FROM posts p
    JOIN content c ON c.id = p.content_id
    WHERE p.platform = 'youtube'
      AND p.status = 'posted'
      AND p.platform_post_id IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM metrics m WHERE m.post_id = p.id)
        OR (
          SELECT MAX(m.collected_at) FROM metrics m WHERE m.post_id = p.id
        ) < datetime('now', '-' || ? || ' hours')
      )
  `).all(staleHours) as Array<{ id: number; platform_post_id: string; cm_id: string }>
}

export function getCMVideoStats(db: Database.Database, cmId: string): {
  total_views: number; total_likes: number; total_comments: number;
  avg_views: number; best_video_views: number; videos_generated: number
} {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(latest.views), 0) as total_views,
      COALESCE(SUM(latest.likes), 0) as total_likes,
      COALESCE(SUM(latest.comments), 0) as total_comments,
      COALESCE(AVG(latest.views), 0) as avg_views,
      COALESCE(MAX(latest.views), 0) as best_video_views,
      COUNT(DISTINCT p.id) as videos_generated
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views, likes, comments
      FROM metrics
      WHERE id IN (
        SELECT MAX(id) FROM metrics GROUP BY post_id
      )
    ) latest ON latest.post_id = p.id
    WHERE c.cm_id = ? AND p.platform = 'youtube' AND p.status = 'posted'
  `).get(cmId) as any
  return {
    total_views: row.total_views ?? 0,
    total_likes: row.total_likes ?? 0,
    total_comments: row.total_comments ?? 0,
    avg_views: row.avg_views ?? 0,
    best_video_views: row.best_video_views ?? 0,
    videos_generated: row.videos_generated ?? 0,
  }
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

export function getDailyMetrics(db: Database.Database, dateStr: string): {
  totalViews: number
  totalLikes: number
  totalComments: number
  videosPosted: number
  bestVideoTitle: string | null
  bestVideoViews: number
} {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(latest.views), 0) as totalViews,
      COALESCE(SUM(latest.likes), 0) as totalLikes,
      COALESCE(SUM(latest.comments), 0) as totalComments,
      COUNT(DISTINCT p.id) as videosPosted,
      MAX(latest.views) as bestVideoViews
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views, likes, comments
      FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND date(p.posted_at) = ?
  `).get(dateStr) as {
    totalViews: number; totalLikes: number; totalComments: number
    videosPosted: number; bestVideoViews: number
  }

  const bestRow = db.prepare(`
    SELECT c.script
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND date(p.posted_at) = ?
    ORDER BY latest.views DESC
    LIMIT 1
  `).get(dateStr) as { script: string } | undefined

  return {
    totalViews: row.totalViews ?? 0,
    totalLikes: row.totalLikes ?? 0,
    totalComments: row.totalComments ?? 0,
    videosPosted: row.videosPosted ?? 0,
    bestVideoViews: row.bestVideoViews ?? 0,
    bestVideoTitle: bestRow ? bestRow.script.slice(0, 80).replace(/\n/g, ' ') : null,
  }
}

export function getWeeklyMetrics(db: Database.Database): {
  totalViews: number
  videosPosted: number
  avgViews: number
  bestVideoTitle: string | null
  bestVideoViews: number
  cmStats: Array<{ cmId: string; avgViews: number; videos: number }>
  prevWeekAvgViews: number
} {
  const weekRow = db.prepare(`
    SELECT
      COALESCE(SUM(latest.views), 0) as totalViews,
      COUNT(DISTINCT p.id) as videosPosted,
      COALESCE(AVG(latest.views), 0) as avgViews,
      MAX(latest.views) as bestVideoViews
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND p.posted_at >= datetime('now', '-7 days')
  `).get() as { totalViews: number; videosPosted: number; avgViews: number; bestVideoViews: number }

  const bestRow = db.prepare(`
    SELECT c.script
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND p.posted_at >= datetime('now', '-7 days')
    ORDER BY latest.views DESC
    LIMIT 1
  `).get() as { script: string } | undefined

  const cmRows = db.prepare(`
    SELECT
      c.cm_id as cmId,
      COALESCE(AVG(latest.views), 0) as avgViews,
      COUNT(DISTINCT p.id) as videos
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND p.posted_at >= datetime('now', '-7 days')
    GROUP BY c.cm_id
    ORDER BY avgViews DESC
  `).all() as Array<{ cmId: string; avgViews: number; videos: number }>

  const prevRow = db.prepare(`
    SELECT COALESCE(AVG(latest.views), 0) as avgViews
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND p.posted_at >= datetime('now', '-14 days')
      AND p.posted_at < datetime('now', '-7 days')
  `).get() as { avgViews: number }

  return {
    totalViews: weekRow.totalViews ?? 0,
    videosPosted: weekRow.videosPosted ?? 0,
    avgViews: weekRow.avgViews ?? 0,
    bestVideoViews: weekRow.bestVideoViews ?? 0,
    bestVideoTitle: bestRow ? bestRow.script.slice(0, 80).replace(/\n/g, ' ') : null,
    cmStats: cmRows,
    prevWeekAvgViews: prevRow.avgViews ?? 0,
  }
}

export function insertCM(db: Database.Database, cm: {
  id: string; generation: number; parent_id?: string; genome: string; status: string; plan?: string
}): void {
  db.prepare(`
    INSERT INTO cms (id, generation, parent_id, genome, status, plan)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cm.id, cm.generation, cm.parent_id ?? null, cm.genome, cm.status, cm.plan ?? null)
}

export function updateCMPlan(db: Database.Database, cmId: string, plan: string): void {
  db.prepare('UPDATE cms SET plan = ? WHERE id = ?').run(plan, cmId)
}
