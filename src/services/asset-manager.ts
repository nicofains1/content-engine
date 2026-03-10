import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { Config } from '../types/index.js'

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} failed (code ${code}): ${stderr.slice(0, 500)}`)))
    proc.on('error', reject)
  })
}

async function fetchWithRedirect(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers })
  return res
}

async function downloadFile(url: string, destPath: string, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetchWithRedirect(url, headers)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} for ${url}`)
  const buf = await res.arrayBuffer()
  writeFileSync(destPath, Buffer.from(buf))
}

interface PexelsVideoFile {
  link: string
  quality: string
  file_type: string
  width: number
  height: number
}

interface PexelsVideo {
  id: number
  video_files: PexelsVideoFile[]
}

interface PexelsSearchResponse {
  videos: PexelsVideo[]
  total_results: number
}

export async function fetchPexelsVideo(query: string, apiKey: string, outputDir: string): Promise<string> {
  mkdirSync(outputDir, { recursive: true })

  const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=10&orientation=portrait`
  const res = await fetch(searchUrl, { headers: { Authorization: apiKey } })
  if (!res.ok) throw new Error(`Pexels search failed: ${res.status} ${res.statusText}`)

  const data = await res.json() as PexelsSearchResponse
  if (!data.videos || data.videos.length === 0) throw new Error(`No Pexels results for query: ${query}`)

  const video = data.videos[0]!
  // Prefer HD, fallback to any
  const hdFile = video.video_files.find(f => f.quality === 'hd') ?? video.video_files[0]
  if (!hdFile) throw new Error('No video file found in Pexels result')

  const hash = createHash('md5').update(query).digest('hex').slice(0, 8)
  const destPath = join(outputDir, `${hash}.mp4`)
  await downloadFile(hdFile.link, destPath)
  return destPath
}

export async function generateAbstractBackground(outputPath: string, durationSeconds: number): Promise<void> {
  const dir = outputPath.split('/').slice(0, -1).join('/')
  if (dir) mkdirSync(dir, { recursive: true })

  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x1a0533:s=1080x1920:r=30,geq=r='r(X,Y)*sin(N/30)':g='g(X,Y)*cos(N/25)':b='b(X,Y)',format=yuv420p`,
    '-t', String(durationSeconds),
    outputPath,
  ]

  try {
    await spawnAsync('ffmpeg', args)
  } catch {
    // simpler fallback: solid color gradient
    const fallbackArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0x0d0d2b:s=1080x1920:r=30,format=yuv420p`,
      '-t', String(durationSeconds),
      outputPath,
    ]
    await spawnAsync('ffmpeg', fallbackArgs)
  }
}

export async function getOrFetchBackground(query: string, config: Config): Promise<string> {
  const bgDir = config.paths.backgroundsDir
  mkdirSync(bgDir, { recursive: true })

  const hash = createHash('md5').update(query).digest('hex').slice(0, 8)
  const cachedPath = join(bgDir, `${hash}.mp4`)
  if (existsSync(cachedPath)) return cachedPath

  const apiKey = config.pexels?.apiKey ?? ''
  if (apiKey) {
    try {
      return await fetchPexelsVideo(query, apiKey, bgDir)
    } catch (err) {
      // fall through to generated background
    }
  }

  // Try any local file first
  try {
    const files = readdirSync(bgDir).filter(f => /\.(mp4|mov|mkv)$/i.test(f))
    if (files.length > 0) {
      const idx = Math.floor(Math.random() * files.length)
      return join(bgDir, files[idx]!)
    }
  } catch {
    // ignore
  }

  // Pure FFmpeg fallback
  const genPath = join(bgDir, `generated_${hash}.mp4`)
  await generateAbstractBackground(genPath, 60)
  return genPath
}

export async function fetchFreePdMusic(genre: string, outputDir: string): Promise<string> {
  mkdirSync(outputDir, { recursive: true })

  const pageUrl = 'https://freepd.com/'
  const res = await fetch(pageUrl)
  if (!res.ok) throw new Error(`FreePD fetch failed: ${res.status}`)

  const html = await res.text()

  // Parse .mp3 links from page
  const mp3Regex = /href="([^"]+\.mp3)"/gi
  const matches: string[] = []
  let match: RegExpExecArray | null
  while ((match = mp3Regex.exec(html)) !== null) {
    matches.push(match[1]!)
  }

  if (matches.length === 0) throw new Error('No MP3 links found on FreePD')

  // Filter by genre keyword if possible
  const genreLower = genre.toLowerCase()
  const genreMatches = matches.filter(m => m.toLowerCase().includes(genreLower))
  const candidates = genreMatches.length > 0 ? genreMatches : matches

  const chosen = candidates[Math.floor(Math.random() * candidates.length)]!
  const fullUrl = chosen.startsWith('http') ? chosen : `https://freepd.com/${chosen.replace(/^\//, '')}`

  const filename = fullUrl.split('/').pop()!
  const destPath = join(outputDir, filename)

  if (existsSync(destPath)) return destPath

  await downloadFile(fullUrl, destPath)
  return destPath
}

export async function getOrFetchMusic(genre: string | null, config: Config): Promise<string | null> {
  if (genre === null) return null

  const musicDir = config.paths.musicDir
  mkdirSync(musicDir, { recursive: true })

  // Check cache: any file that matches genre in name
  try {
    const files = readdirSync(musicDir).filter(f => /\.(mp3|m4a|wav|flac)$/i.test(f))
    const genreFiles = files.filter(f => f.toLowerCase().includes(genre.toLowerCase()))
    if (genreFiles.length > 0) {
      const idx = Math.floor(Math.random() * genreFiles.length)
      return join(musicDir, genreFiles[idx]!)
    }
    // Any cached file as fallback
    if (files.length > 0) {
      return join(musicDir, files[Math.floor(Math.random() * files.length)]!)
    }
  } catch {
    // ignore
  }

  try {
    return await fetchFreePdMusic(genre, musicDir)
  } catch {
    return null
  }
}
