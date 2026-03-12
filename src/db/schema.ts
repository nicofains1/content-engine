export const CREATE_REDDIT_POSTS = `
CREATE TABLE IF NOT EXISTS reddit_posts (
  id TEXT PRIMARY KEY,
  subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  score INTEGER NOT NULL,
  upvote_ratio REAL NOT NULL,
  url TEXT NOT NULL,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  used INTEGER NOT NULL DEFAULT 0
)`

export const CREATE_CONTENT = `
CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  reddit_post_id TEXT NOT NULL REFERENCES reddit_posts(id),
  cm_id TEXT REFERENCES cms(id),
  script TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  background_clip TEXT NOT NULL DEFAULT '',
  music_track TEXT NOT NULL DEFAULT '',
  duration_seconds REAL,
  script_path TEXT,
  audio_path TEXT,
  subtitle_path TEXT,
  video_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  eval_score INTEGER,
  eval_pass INTEGER,
  eval_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

export const CREATE_POSTS = `
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL REFERENCES content(id),
  platform TEXT NOT NULL,
  platform_post_id TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

export const CREATE_METRICS = `
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  collected_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

export const CREATE_CMS = `
CREATE TABLE IF NOT EXISTS cms (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT REFERENCES cms(id),
  genome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  videos_generated INTEGER NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  total_likes INTEGER NOT NULL DEFAULT 0,
  total_comments INTEGER NOT NULL DEFAULT 0,
  avg_views REAL NOT NULL DEFAULT 0,
  best_video_views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  died_at TEXT,
  death_reason TEXT
)`

export const CREATE_LEARNINGS = `
CREATE TABLE IF NOT EXISTS learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis TEXT NOT NULL,
  prompt_before TEXT NOT NULL,
  prompt_after TEXT NOT NULL,
  config_changes TEXT,
  videos_analyzed INTEGER NOT NULL,
  avg_views_before REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

export const CREATE_EXPERIMENTS = `
CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learning_id INTEGER NOT NULL REFERENCES learnings(id),
  description TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  metric_to_watch TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  result TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  concluded_at TEXT
)`

export const CREATE_PROMPT_HISTORY = `
CREATE TABLE IF NOT EXISTS prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_text TEXT NOT NULL,
  source TEXT NOT NULL,
  performance_score REAL,
  active_from TEXT NOT NULL DEFAULT (datetime('now')),
  active_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

export const ALL_TABLES = [
  CREATE_CMS, // CMS first (content references it)
  CREATE_REDDIT_POSTS,
  CREATE_CONTENT,
  CREATE_POSTS,
  CREATE_METRICS,
  CREATE_LEARNINGS,
  CREATE_EXPERIMENTS,
  CREATE_PROMPT_HISTORY,
]

export const ALL_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_reddit_posts_used ON reddit_posts(used)`,
  `CREATE INDEX IF NOT EXISTS idx_content_status ON content(status)`,
  `CREATE INDEX IF NOT EXISTS idx_content_cm ON content(cm_id)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_content ON posts(content_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_platform ON posts(content_id, platform)`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_post ON metrics(post_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cms_parent ON cms(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cms_status ON cms(status)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_history_active ON prompt_history(active_until)`,
  `CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status)`,
]
