// Post job - upload ready content to YouTube Shorts and TikTok
// Runs every 6h at 01:00, 07:00, 13:00, 19:00
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import {
  getDb, getReadyContent, insertPost, updatePost, updateContentStatus,
} from '../db/index.js'
import { uploadShort } from '../services/youtube.js'
import { uploadToTikTok } from '../services/tiktok.js'
import { notifyVideoPosted } from '../services/whatsapp.js'

const JOB_NAME = 'post'

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another post job is running, exiting')
    process.exit(0)
  }

  try {
    const config = loadConfig()
    const db = getDb()

    const row = getReadyContent(db)
    if (!row) {
      logger.info('No ready content to post')
      return
    }

    const contentId = row['id'] as string
    const videoPath = row['video_path'] as string
    const caption = row['caption'] as string
    const hashtags = row['hashtags'] as string
    const title = (row['script'] as string).slice(0, 80).replace(/\n/g, ' ')
    const cmId = row['cm_id'] as string
    const description = `${caption}\n\n${hashtags}`

    logger.info({ contentId, videoPath }, 'Posting content')

    let youtubeUrl: string | undefined
    let tiktokPosted = false

    // 1. Upload to YouTube Shorts
    const ytPostId = insertPost(db, { content_id: contentId, platform: 'youtube' })
    try {
      logger.info({ contentId }, 'Uploading to YouTube Shorts')
      const result = await uploadShort(config, videoPath, title, description)
      updatePost(db, ytPostId, 'posted', {
        platform_post_id: result.id,
        url: result.url,
        posted_at: new Date().toISOString(),
      })
      youtubeUrl = result.url
      // Increment videos_generated immediately so Darwin has current data
      db.prepare('UPDATE cms SET videos_generated = videos_generated + 1 WHERE id = ?').run(cmId)
      logger.info({ contentId, url: result.url }, 'YouTube upload complete')
    } catch (err) {
      logger.error({ err, contentId }, 'YouTube upload failed')
      updatePost(db, ytPostId, 'failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 2. Upload to TikTok
    const ttPostId = insertPost(db, { content_id: contentId, platform: 'tiktok' })
    try {
      logger.info({ contentId }, 'Uploading to TikTok')
      await uploadToTikTok({
        videoPath,
        description: `${caption} ${hashtags}`,
        cookiesPath: config.tiktok.cookiesPath,
        contentId,
      })
      updatePost(db, ttPostId, 'posted', {
        posted_at: new Date().toISOString(),
      })
      tiktokPosted = true
      logger.info({ contentId }, 'TikTok upload complete')
    } catch (err) {
      logger.error({ err, contentId }, 'TikTok upload failed')
      updatePost(db, ttPostId, 'failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 3. Update content status to 'posted' if at least one platform succeeded
    if (youtubeUrl || tiktokPosted) {
      updateContentStatus(db, contentId, 'posted')
    }

    // 4. Notify via WhatsApp
    await notifyVideoPosted({
      title,
      youtubeUrl,
      tiktokPosted,
      cmId,
    })

    logger.info({ contentId, youtubeUrl, tiktokPosted }, 'Post job complete')
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Post job fatal error:', err)
  process.exit(1)
})
