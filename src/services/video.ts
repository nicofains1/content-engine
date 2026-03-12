import { spawn } from 'child_process'
import { readdirSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Genome, Config } from '../types/index.js'
import { getOrFetchBackground, getOrFetchMusic } from './asset-manager.js'

export interface VideoOptions {
  audioPath: string
  subtitlePath: string | null
  outputPath: string
  backgroundClip: string
  musicTrack: string
  subtitleStyle: string
  subtitleColor: string
  subtitlePosition: string
  musicVolume: number
}

const M1_BIN_PATH = '/Users/nfainstein/bin:/usr/local/bin:/opt/homebrew/bin'

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PATH: `${process.env.PATH}:${M1_BIN_PATH}` }
    })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} failed (code ${code}): ${stderr.slice(0, 500)}`)))
    proc.on('error', reject)
  })
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function pickBackgroundClip(backgroundsDir: string, preference: string): string {
  const files = readdirSync(backgroundsDir).filter(f => /\.(mp4|mov|mkv)$/i.test(f))
  if (files.length === 0) throw new Error(`No background clips found in ${backgroundsDir}`)

  if (preference !== 'random') {
    const prefFiles = files.filter(f => f.toLowerCase().includes(preference.toLowerCase()))
    if (prefFiles.length > 0) return join(backgroundsDir, pickRandom(prefFiles))
  }

  return join(backgroundsDir, pickRandom(files))
}

export async function pickBackgroundClipFromGenome(genome: Genome, config: Config): Promise<string> {
  return getOrFetchBackground(genome.backgroundQuery ?? genome.backgroundPreference ?? 'abstract', config)
}

export function pickMusicTrack(musicDir: string): string {
  const files = readdirSync(musicDir).filter(f => /\.(mp3|m4a|wav|flac)$/i.test(f))
  if (files.length === 0) throw new Error(`No music tracks found in ${musicDir}`)
  return join(musicDir, pickRandom(files))
}

export async function pickMusicTrackFromGenome(genome: Genome, config: Config): Promise<string | null> {
  return getOrFetchMusic(genome.musicGenre ?? null, config)
}

function hexToAssColor(hex: string): string {
  // ASS format is &HAABBGGRR (little-endian RGB, AA=00 = opaque)
  const r = hex.slice(1, 3)
  const g = hex.slice(3, 5)
  const b = hex.slice(5, 7)
  return `&H00${b}${g}${r}`.toUpperCase()
}

function getSubtitleForceStyle(opts: VideoOptions): string {
  // FontSize is in pixels on the rendered video (1080x1920). 20px was invisible; 60-72px is readable.
  const size = opts.subtitleStyle === 'karaoke_grande' ? 72 : opts.subtitleStyle === 'karaoke_chico' ? 56 : 64
  const color = hexToAssColor(opts.subtitleColor)
  const marginV = opts.subtitlePosition === 'abajo' ? 100 : opts.subtitlePosition === 'arriba' ? 800 : 500
  // PlayResX/PlayResY must match video resolution so FontSize/MarginV are in actual pixels.
  // Without this, libass uses PlayResY=288 default and scales all values by 1920/288 ≈ 6.7x,
  // pushing MarginV=500 to 3333px (off-screen) and making FontSize wildly oversized.
  return `PlayResX=1080,PlayResY=1920,FontName=Arial,Bold=1,FontSize=${size},PrimaryColour=${color},OutlineColour=&H00000000,ShadowColour=&H80000000,Outline=3,Shadow=1,BorderStyle=1,Alignment=2,MarginV=${marginV}`
}

export async function generateVideo(opts: VideoOptions): Promise<string> {
  mkdirSync(dirname(opts.outputPath), { recursive: true })

  const args: string[] = [
    '-y',
    '-stream_loop', '-1', '-i', opts.backgroundClip,
    '-i', opts.audioPath,
  ]

  const filterParts: string[] = [
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1:1[bg]',
  ]

  let audioMap: string

  if (existsSync(opts.musicTrack)) {
    args.push('-stream_loop', '-1', '-i', opts.musicTrack)
    filterParts.push(`[2:a]volume=${opts.musicVolume}[music]`)
    filterParts.push('[1:a][music]amix=inputs=2:duration=first[audio]')
    audioMap = '[audio]'
  } else {
    filterParts.push('[1:a]acopy[audio]')
    audioMap = '[audio]'
  }

  let videoMap: string
  if (opts.subtitlePath && existsSync(opts.subtitlePath)) {
    const forceStyle = getSubtitleForceStyle(opts)
    const escapedSub = opts.subtitlePath.replace(/[:\\]/g, '\\$&').replace(/'/g, "'\\''")
    filterParts.push(`[bg]subtitles='${escapedSub}':force_style='${forceStyle}'[final]`)
    videoMap = '[final]'
  } else {
    filterParts.push('[bg]copy[final]')
    videoMap = '[final]'
  }

  args.push(
    '-filter_complex', filterParts.join(';'),
    '-map', videoMap,
    '-map', audioMap,
    '-shortest',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    opts.outputPath
  )

  await spawnAsync('ffmpeg', args)
  return opts.outputPath
}

export async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', audioPath
    ])
    let output = ''
    proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'))
      try {
        const data = JSON.parse(output) as { format: { duration: string } }
        resolve(parseFloat(data.format.duration))
      } catch (e) { reject(e) }
    })
    proc.on('error', reject)
  })
}
