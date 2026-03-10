export interface RedditPost {
  id: string
  subreddit: string
  title: string
  selftext: string
  score: number
  upvote_ratio: number
  url: string
  over_18: boolean
  stickied: boolean
  top_comment?: string
}

export type ContentStatus = 'pending' | 'generating' | 'ready' | 'posted' | 'failed'

export interface Content {
  id: string
  reddit_post_id: string
  cm_id: string
  script: string
  caption: string
  hashtags: string
  voice: string
  background_clip: string
  music_track: string
  duration_seconds?: number
  script_path?: string
  audio_path?: string
  subtitle_path?: string
  video_path?: string
  status: ContentStatus
  error?: string
  created_at: string
  updated_at: string
}

export type PostPlatform = 'youtube' | 'tiktok'

export type PostStatus = 'pending' | 'posted' | 'failed'

export interface Post {
  id: string
  content_id: string
  platform: PostPlatform
  platform_post_id?: string
  url?: string
  status: PostStatus
  error?: string
  posted_at?: string
  created_at: string
}

export interface Metric {
  id: string
  post_id: string
  views: number
  likes: number
  comments: number
  shares: number
  collected_at: string
}

export type CMStatus = 'active' | 'probation' | 'dead'

export interface Genome {
  hookStyle: string
  toneInstructions: string
  scriptStructure: string
  wordCountTarget: number
  closingStyle: string
  voice: string
  speechRate: string
  musicVolume: number
  subtitleStyle: string
  subtitleColor: string
  subtitlePosition: string
  backgroundPreference: string
  preferredSubreddits: string[]
  minRedditScore: number
  captionStyle: string
  hashtagCount: number
}

export interface CM {
  id: string
  generation: number
  parent_id?: string
  genome: Genome
  status: CMStatus
  videos_generated: number
  total_views: number
  total_likes: number
  total_comments: number
  avg_views: number
  best_video_views: number
  created_at: string
  died_at?: string
  death_reason?: string
}

export interface Config {
  reddit: {
    clientId: string
    clientSecret: string
    username: string
    password: string
    userAgent: string
  }
  youtube: {
    clientId: string
    clientSecret: string
    refreshToken: string
  }
  tiktok: {
    cookiesPath: string
  }
  notifications: {
    enabled: boolean
    whatsappGroupJid: string
  }
  subreddits: string[]
  content: {
    minRedditScore: number
    minUpvoteRatio: number
    videosPerRun: number
    targetDurationSeconds: number
  }
  voices: string[]
  paths: {
    dataDir: string
    backgroundsDir: string
    musicDir: string
    fontsDir: string
    outputDir: string
  }
  cleanup: {
    maxAgeDays: number
    minFreeDiskGB: number
  }
}
