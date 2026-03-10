// Metrics collection job - fetch YouTube stats and update CM performance
// Runs every 12h at 03:00, 15:00
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import {
  getDb, getStaleYouTubePosts, insertMetric, updateCMStats, getCMVideoStats,
} from '../db/index.js'
import { getVideoStats } from '../services/youtube.js'

const JOB_NAME = 'metrics'

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another metrics job is running, exiting')
    process.exit(0)
  }

  try {
    const config = loadConfig()
    const db = getDb()

    // Get all YouTube posts not updated in 12+ hours
    const stalePosts = getStaleYouTubePosts(db, 12)
    if (stalePosts.length === 0) {
      logger.info('No stale YouTube posts to update')
      return
    }

    logger.info({ count: stalePosts.length }, 'Fetching stats for stale posts')

    // Batch fetch stats from YouTube API
    const videoIds = stalePosts.map(p => p.platform_post_id)
    const statsMap = await getVideoStats(config, videoIds)

    // Insert metrics and track which CMs need updating
    const affectedCMs = new Set<string>()

    for (const post of stalePosts) {
      const stats = statsMap.get(post.platform_post_id)
      if (!stats) {
        logger.warn({ postId: post.id, videoId: post.platform_post_id }, 'No stats returned for video')
        continue
      }

      insertMetric(db, {
        post_id: post.id,
        views: stats.views,
        likes: stats.likes,
        comments: stats.comments,
        shares: 0, // YouTube API doesn't expose shares
      })

      affectedCMs.add(post.cm_id)
      logger.debug({ postId: post.id, views: stats.views }, 'Metric inserted')
    }

    // Recalculate stats for each affected CM
    for (const cmId of affectedCMs) {
      const stats = getCMVideoStats(db, cmId)
      updateCMStats(db, cmId, stats)
      logger.info({ cmId, avgViews: stats.avg_views, totalVideos: stats.videos_generated }, 'CM stats updated')
    }

    logger.info({ updated: stalePosts.length, cmsUpdated: affectedCMs.size }, 'Metrics job complete')
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Metrics job fatal error:', err)
  process.exit(1)
})
