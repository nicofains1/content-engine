// Cleanup job - remove old video files and vacuum SQLite
// Runs Sundays at 04:00
import { readdirSync, statSync, unlinkSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import { getDb } from '../db/index.js'

const JOB_NAME = 'cleanup'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aiff'])
const SUBTITLE_EXTENSIONS = new Set(['.vtt', '.srt', '.ass'])

function getAgeMs(filePath: string): number {
  try {
    return Date.now() - statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function deleteOldFiles(dir: string, maxAgeDays: number, extensions: Set<string>): { deleted: number; freed: number } {
  if (!existsSync(dir)) return { deleted: 0, freed: 0 }

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  let deleted = 0
  let freed = 0

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        // Recurse into subdirectories (content ID folders)
        const sub = deleteOldFiles(fullPath, maxAgeDays, extensions)
        deleted += sub.deleted
        freed += sub.freed

        // Try to remove empty directory
        try {
          const remaining = readdirSync(fullPath)
          if (remaining.length === 0) {
            unlinkSync(fullPath)
          }
        } catch {
          // Ignore - directory might not be empty or might not exist
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (extensions.has(ext) && getAgeMs(fullPath) > maxAgeMs) {
          try {
            const size = statSync(fullPath).size
            unlinkSync(fullPath)
            deleted++
            freed += size
          } catch {
            // Ignore errors on individual files
          }
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return { deleted, freed }
}

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another cleanup job is running, exiting')
    process.exit(0)
  }

  try {
    const config = loadConfig()
    const keepDays = config.cleanup?.maxAgeDays ?? 30

    logger.info({ keepDays, outputDir: config.paths.outputDir }, 'Starting cleanup')

    // 1. Delete old video files
    const videoResult = deleteOldFiles(config.paths.outputDir, keepDays, VIDEO_EXTENSIONS)
    logger.info(videoResult, 'Video files cleaned')

    // 2. Delete old audio files
    const audioResult = deleteOldFiles(config.paths.outputDir, keepDays, AUDIO_EXTENSIONS)
    logger.info(audioResult, 'Audio files cleaned')

    // 3. Delete old subtitle files
    const subtitleResult = deleteOldFiles(config.paths.outputDir, keepDays, SUBTITLE_EXTENSIONS)
    logger.info(subtitleResult, 'Subtitle files cleaned')

    const totalDeleted = videoResult.deleted + audioResult.deleted + subtitleResult.deleted
    const totalFreedMB = (videoResult.freed + audioResult.freed + subtitleResult.freed) / (1024 * 1024)

    // 4. Vacuum SQLite DB to reclaim space
    try {
      const db = getDb()
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.exec('VACUUM')
      logger.info('SQLite VACUUM complete')
    } catch (err) {
      logger.warn({ err }, 'SQLite VACUUM failed, skipping')
    }

    logger.info({
      totalDeleted,
      totalFreedMB: Math.round(totalFreedMB * 100) / 100,
    }, 'Cleanup job complete')
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Cleanup job fatal error:', err)
  process.exit(1)
})
