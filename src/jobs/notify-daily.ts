// Daily notification job - sends today's performance report
// Runs daily at 21:00
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { getDb, getDailyMetrics } from '../db/index.js'
import { notifyDailyReport } from '../services/whatsapp.js'

const JOB_NAME = 'notify-daily'

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another notify-daily job is running, exiting')
    process.exit(0)
  }

  try {
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10)
    const stats = getDailyMetrics(db, today)

    if (stats.videosPosted === 0) {
      logger.info('No videos posted today, skipping daily report')
      return
    }

    await notifyDailyReport({
      totalViews: stats.totalViews,
      videosPosted: stats.videosPosted,
      avgViews: stats.videosPosted > 0 ? stats.totalViews / stats.videosPosted : 0,
      bestVideo: stats.bestVideoTitle
        ? { title: stats.bestVideoTitle, views: stats.bestVideoViews }
        : undefined,
    })

    logger.info({ videosPosted: stats.videosPosted, totalViews: stats.totalViews }, 'Daily report sent')
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Notify-daily job fatal error:', err)
  process.exit(1)
})
