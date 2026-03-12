// Generate job - main content pipeline orchestrator
// Runs every 6h at 00:00, 06:00, 12:00, 18:00
import { join } from 'path'
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import {
  getDb, getAllActiveCMs, insertCM, insertRedditPost,
  isRedditPostProcessed, markRedditPostUsed, insertContent, updateContentStatus,
} from '../db/index.js'
import { fetchTopPosts } from '../services/reddit.js'
import { generateContent } from '../services/content.js'
import { generateTTS } from '../services/tts.js'
import { generateVideo, pickMusicTrack } from '../services/video.js'
import { getOrFetchBackground, getOrFetchMusic } from '../services/asset-manager.js'
import { selectCM, createInitialPopulation, runPopulationEvaluation } from '../darwin/population.js'
import type { CM } from '../types/index.js'
import { nanoid } from 'nanoid'

const JOB_NAME = 'generate'

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another generate job is running, exiting')
    process.exit(0)
  }

  try {
    const config = loadConfig()
    const db = getDb()

    // Bootstrap: if no CMs exist, create initial population
    let rawCMs = getAllActiveCMs(db)
    if (rawCMs.length === 0) {
      logger.info('No CMs found, creating initial population')
      const initial = createInitialPopulation(3, config.voices)
      for (const { id, generation, genome } of initial) {
        insertCM(db, { id, generation, genome: JSON.stringify(genome), status: 'active' })
      }
      rawCMs = getAllActiveCMs(db)
    }

    const cms: CM[] = rawCMs.map(r => ({
      ...(r as any),
      genome: typeof r['genome'] === 'string' ? JSON.parse(r['genome'] as string) : r['genome'],
    }))

    const videosPerRun = config.content.videosPerRun ?? 1
    let generated = 0

    for (let attempt = 0; attempt < videosPerRun * 3 && generated < videosPerRun; attempt++) {
      const cm = selectCM(cms)
      logger.info({ cmId: cm.id }, 'Selected CM')

      const subreddits = cm.genome.preferredSubreddits?.length
        ? cm.genome.preferredSubreddits
        : config.subreddits

      const subreddit = subreddits[Math.floor(Math.random() * subreddits.length)] ?? subreddits[0]!
      const posts = await fetchTopPosts(config, subreddit)
      const post = posts.find(p => !isRedditPostProcessed(db, p.id))
      if (!post) {
        logger.info({ cmId: cm.id }, 'No new posts available for this CM, trying next')
        continue
      }

      insertRedditPost(db, {
        id: post.id,
        subreddit: post.subreddit,
        title: post.title,
        score: post.score,
        upvote_ratio: post.upvote_ratio,
        url: post.url,
      })

      const contentId = `c-${nanoid(12)}`
      const voice = cm.genome.voice ?? config.voices[0]!
      const speechRate = cm.genome.speechRate ?? '+0%'

      // Pick background and music - always returns a valid path (generates fallback if needed)
      const backgroundQuery = cm.genome.backgroundQuery ?? cm.genome.backgroundPreference ?? 'abstract'
      const backgroundClip = await getOrFetchBackground(backgroundQuery, config)
      let musicTrack = 'default'
      try {
        const track = await getOrFetchMusic(cm.genome.musicGenre ?? null, config)
        if (track) musicTrack = track
      } catch {
        try {
          musicTrack = pickMusicTrack(config.paths.musicDir)
        } catch {
          // No music available
        }
      }

      insertContent(db, {
        id: contentId,
        reddit_post_id: post.id,
        cm_id: cm.id,
        script: '',
        caption: '',
        hashtags: '',
        voice,
        background_clip: backgroundClip,
        music_track: musicTrack,
      })

      markRedditPostUsed(db, post.id)

      try {
        // 1. Generate script, caption, hashtags via Claude
        logger.info({ contentId }, 'Generating content via Claude')
        const content = await generateContent(post, cm)
        updateContentStatus(db, contentId, 'generating')

        // 2. TTS
        logger.info({ contentId }, 'Generating TTS audio')
        const outputDir = join(config.paths.outputDir, contentId)
        const ttsResult = await generateTTS(
          content.script,
          voice,
          speechRate,
          outputDir,
          'audio'
        )
        updateContentStatus(db, contentId, 'generating', {
          audio_path: ttsResult.audioPath,
          subtitle_path: ttsResult.subtitlePath ?? undefined,
        })

        // 3. Video
        logger.info({ contentId }, 'Generating video')
        const outputPath = join(outputDir, 'video.mp4')
        await generateVideo({
          audioPath: ttsResult.audioPath,
          subtitlePath: ttsResult.subtitlePath,
          outputPath,
          backgroundClip,
          musicTrack,
          subtitleStyle: cm.genome.subtitleStyle,
          subtitleColor: cm.genome.subtitleColor,
          subtitlePosition: cm.genome.subtitlePosition,
          musicVolume: cm.genome.musicVolume,
        })

        updateContentStatus(db, contentId, 'ready', {
          video_path: outputPath,
        })

        // Save script, caption, hashtags for learn job analysis
        db.prepare(`UPDATE content SET script = ?, caption = ?, hashtags = ? WHERE id = ?`)
          .run(content.script, content.caption, content.hashtags, contentId)

        logger.info({ contentId, outputPath }, 'Video ready')
        generated++
      } catch (err) {
        logger.error({ err, contentId }, 'Content generation failed')
        updateContentStatus(db, contentId, 'failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    logger.info({ generated, videosPerRun }, 'Generate job complete')

    // Run Darwin evaluation after every generate cycle
    if (generated > 0) {
      try {
        const evalResult = runPopulationEvaluation(db, logger)
        logger.info({ killed: evalResult.killed, reproduced: evalResult.reproduced }, 'Darwin evaluation complete')
      } catch (err) {
        logger.error({ err }, 'Darwin evaluation failed (non-fatal)')
      }
    }
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Generate job fatal error:', err)
  process.exit(1)
})
