// Weekly notification job - send weekly performance report via WhatsApp
// Runs every Sunday at 21:00
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { getDb, getWeeklyMetrics } from '../db/index.js'
import { notifyWeeklyReport, closeWhatsApp } from '../services/whatsapp.js'

const JOB_NAME = 'notify-weekly'

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another notify-weekly job is running, exiting')
    process.exit(0)
  }

  try {
    const db = getDb()

    logger.info('Fetching weekly metrics')
    const metrics = getWeeklyMetrics(db)

    const trend: 'up' | 'down' | 'stable' =
      metrics.prevWeekAvgViews === 0 ? 'stable'
        : metrics.avgViews > metrics.prevWeekAvgViews * 1.05 ? 'up'
        : metrics.avgViews < metrics.prevWeekAvgViews * 0.95 ? 'down'
        : 'stable'

    await notifyWeeklyReport({
      totalViews: metrics.totalViews,
      videosPosted: metrics.videosPosted,
      avgViews: metrics.avgViews,
      topPerformers: metrics.cmStats,
      trend,
    })

    logger.info({ metrics, trend }, 'Weekly notification sent')
  } finally {
    releaseLock(JOB_NAME)
    await closeWhatsApp()
  }
}

main().catch(err => {
  console.error('Notify-weekly job fatal error:', err)
  process.exit(1)
})
