// Generate job - main content pipeline orchestrator
// Runs every 6h at 00:00, 06:00, 12:00, 18:00
import { join } from 'path'
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import {
  getDb, getAllActiveCMs, insertCM, insertRedditPost,
  isRedditPostProcessed, markRedditPostUsed, insertContent, updateContentStatus,
  updateCMPlan,
} from '../db/index.js'
import { fetchTopPosts } from '../services/reddit.js'
import { generateContent } from '../services/content.js'
import { generateTTS } from '../services/tts.js'
import { generateVideo, pickMusicTrack } from '../services/video.js'
import { getOrFetchBackground, getOrFetchMusic } from '../services/asset-manager.js'
import { selectCM, createInitialPopulation, runPopulationEvaluation } from '../darwin/population.js'
import { evaluateVideo } from '../services/eval.js'
import { generateCMPlan } from '../services/plan.js'
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
        let plan: string | undefined
        try {
          const result = await generateCMPlan(id, genome)
          if (result) plan = result
          logger.info({ cmId: id }, plan ? 'Plan generated for new CM' : 'Plan generation returned null for new CM')
        } catch (err) {
          logger.warn({ err, cmId: id }, 'Plan generation failed for new CM (non-blocking)')
        }
        insertCM(db, { id, generation, genome: JSON.stringify(genome), status: 'active', plan })
      }
      rawCMs = getAllActiveCMs(db)
    }

    const cms: CM[] = rawCMs.map(r => ({
      ...(r as any),
      genome: typeof r['genome'] === 'string' ? JSON.parse(r['genome'] as string) : r['genome'],
    }))

    // Backfill: generate plans for existing CMs that don't have one
    for (const cm of cms) {
      if (!cm.plan) {
        try {
          const plan = await generateCMPlan(cm.id, cm.genome)
          if (plan) {
            updateCMPlan(db, cm.id, plan)
            cm.plan = plan
            logger.info({ cmId: cm.id }, 'Backfilled plan for existing CM')
          } else {
            logger.warn({ cmId: cm.id }, 'Plan backfill returned null (will use generic eval)')
          }
        } catch (err) {
          logger.warn({ err, cmId: cm.id }, 'Plan backfill failed (non-blocking, will use generic eval)')
        }
      }
    }

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

        // 4. Self-evaluation: visual QA before posting
        logger.info({ contentId }, 'Running self-evaluation')
        let evalPassed = true
        try {
          const evalResult = await evaluateVideo(
            outputPath,
            ttsResult.subtitlePath ?? '',
            cm.genome,
            contentId,
            cm.plan ?? undefined,
          )
          // Save eval result to DB
          db.prepare(
            `UPDATE content SET eval_score = ?, eval_pass = ?, eval_reason = ? WHERE id = ?`
          ).run(evalResult.score, evalResult.pass ? 1 : 0, evalResult.reason, contentId)

          if (!evalResult.pass) {
            evalPassed = false
            logger.warn({ contentId, reason: evalResult.reason, score: evalResult.score },
              `[eval] FAIL: ${evalResult.reason}`)
            updateContentStatus(db, contentId, 'failed', {
              error: `eval failed: ${evalResult.reason}`,
            })
          } else {
            logger.info({ contentId, score: evalResult.score, reason: evalResult.reason },
              '[eval] PASS')
          }
        } catch (evalErr) {
          // Eval failure is non-blocking — log and continue
          logger.warn({ err: evalErr, contentId }, '[eval] Eval error (non-blocking, treating as pass)')
        }

        if (!evalPassed) continue

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
        const evalResult = await runPopulationEvaluation(db, logger)
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
