import { spawn } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createWriteStream, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = join(__dirname, '../../scripts/upload_tiktok.py')
const LOGS_DIR = join(__dirname, '../../logs')

export interface TikTokUploadOptions {
  videoPath: string
  description: string
  cookiesPath: string
  contentId: string
}

async function runPythonScript(args: Record<string, string>, contentId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(LOGS_DIR, { recursive: true })
    const logPath = join(LOGS_DIR, `tiktok-upload-${contentId}.log`)
    const logStream = createWriteStream(logPath, { flags: 'w' })
    logStream.write(`=== TikTok upload log for content ${contentId} ===\n`)
    logStream.write(`Started: ${new Date().toISOString()}\n\n`)

    const python = process.env.PYTHON3_PATH ?? '/opt/homebrew/bin/python3.11'
    const proc = spawn(python, [SCRIPT_PATH, JSON.stringify(args)], {
      timeout: 300_000, // 5 minutes
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
      logStream.write(chunk)
    })

    proc.on('close', (code) => {
      logStream.write(`\nProcess exited with code ${code}\n`)
      logStream.write(`Finished: ${new Date().toISOString()}\n`)
      logStream.end()

      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim()) as { status: string; message?: string }
          if (result.status === 'ok') return resolve()
          return reject(new Error(`TikTok upload failed: ${result.message}`))
        } catch {
          return resolve() // Assume success if can't parse output
        }
      }
      reject(new Error(`TikTok uploader exited with code ${code}: ${stderr.slice(0, 500)}`))
    })

    proc.on('error', (err) => {
      logStream.write(`\nSpawn error: ${err.message}\n`)
      logStream.end()
      reject(new Error(`Failed to spawn TikTok uploader: ${err.message}`))
    })
  })
}

export async function uploadToTikTok(opts: TikTokUploadOptions, retries = 1): Promise<void> {
  try {
    await runPythonScript({
      video: opts.videoPath,
      description: opts.description,
      cookies: opts.cookiesPath,
    }, opts.contentId)
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 10_000))
      return uploadToTikTok(opts, retries - 1)
    }
    throw err
  }
}
