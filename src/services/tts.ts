import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface TTSResult {
  audioPath: string
  subtitlePath: string | null
}

let edgeTtsFailCount = 0

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} failed (code ${code}): ${stderr.slice(0, 300)}`))
    })
    proc.on('error', reject)
  })
}

async function runEdgeTts(text: string, voice: string, rate: string, audioOut: string, subOut: string): Promise<void> {
  ensureDir(audioOut)
  await spawnAsync('edge-tts', [
    '--voice', voice,
    '--rate', rate,
    '--text', text,
    '--write-media', audioOut,
    '--write-subtitles', subOut,
  ])
}

async function runMacOsSay(text: string, audioOut: string): Promise<void> {
  ensureDir(audioOut)
  const aiffPath = audioOut.replace(/\.mp3$/, '.aiff')
  await spawnAsync('say', ['-v', 'Paulina', '-o', aiffPath, text])
  await spawnAsync('ffmpeg', ['-y', '-i', aiffPath, '-codec:a', 'libmp3lame', '-qscale:a', '2', audioOut])
}

export async function generateTTS(
  text: string,
  voice: string,
  speechRate: string,
  outputDir: string,
  filename: string
): Promise<TTSResult> {
  const audioPath = `${outputDir}/${filename}.mp3`
  const subtitlePath = `${outputDir}/${filename}.vtt`

  if (edgeTtsFailCount < 3) {
    try {
      await runEdgeTts(text, voice, speechRate, audioPath, subtitlePath)
      edgeTtsFailCount = 0
      return { audioPath, subtitlePath }
    } catch (err) {
      edgeTtsFailCount++
      if (edgeTtsFailCount < 3) throw err
      // Fall through to macOS say
    }
  }

  await runMacOsSay(text, audioPath)
  return { audioPath, subtitlePath: null }
}
