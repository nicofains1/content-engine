// Self-evaluation: visual QA on generated video before posting
import { execFileSync } from 'child_process'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import { invokeClaudeVision } from '../lib/claude.js'
import type { Genome } from '../types/index.js'

const FFMPEG = process.env.FFMPEG_PATH ?? '/Users/nfainstein/bin/ffmpeg'
const FRAME_TIMES = [2, 5, 10] // seconds

export interface EvalResult {
  score: number   // 0-100
  pass: boolean
  reason: string
}

export function extractFrames(videoPath: string, contentId: string): string[] {
  const paths: string[] = []
  for (let i = 0; i < FRAME_TIMES.length; i++) {
    const out = `/tmp/eval-${contentId}-${i}.jpg`
    execFileSync(FFMPEG, [
      '-y', '-ss', String(FRAME_TIMES[i]),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      out,
    ], { timeout: 15_000, stdio: 'pipe' })
    paths.push(out)
  }
  return paths
}

export function cleanupFrames(paths: string[]): void {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p) } catch { /* ignore */ }
  }
}

export async function evaluateVideo(
  videoPath: string,
  subtitlePath: string,
  genome: Genome,
  contentId: string,
): Promise<EvalResult> {
  let framePaths: string[] = []
  try {
    // 1. Extract frames
    framePaths = extractFrames(videoPath, contentId)

    // 2. Read subtitle content
    let subtitleText = ''
    if (subtitlePath && existsSync(subtitlePath)) {
      subtitleText = readFileSync(subtitlePath, 'utf-8')
    }

    // 3. Build evaluation prompt
    const prompt = buildEvalPrompt(subtitleText, genome)

    // 4. Send to Claude Vision
    const response = await invokeClaudeVision(prompt, framePaths)

    // 5. Parse response
    return parseEvalResponse(response)
  } finally {
    cleanupFrames(framePaths)
  }
}

function buildEvalPrompt(subtitleText: string, genome: Genome): string {
  return `You are a video quality evaluator. You are given 3 frames extracted from a short-form video at seconds 2, 5, and 10.

The video should have:
- Visible subtitle/caption text overlaid on the video frames
- A real video background (not a solid color or blank screen)
- Content matching this style: hook="${genome.hookStyle}", tone="${genome.toneInstructions}"

Subtitle file content:
${subtitleText.slice(0, 500)}

Evaluate the frames and respond ONLY with valid JSON (no markdown, no code fences):
{
  "subtitles_visible": true/false,
  "background_is_real_video": true/false,
  "tone_match": true/false,
  "score": 0-100,
  "reason": "brief explanation"
}

Rules:
- subtitles_visible: true if ANY frame shows text overlaid on the video
- background_is_real_video: true if the background shows real footage (not a solid/flat color)
- score: 0-100 overall quality score
- reason: one sentence explaining the score`
}

function parseEvalResponse(response: string): EvalResult {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { score: 50, pass: true, reason: 'Could not parse eval response, defaulting to pass' }
  }

  try {
    const data = JSON.parse(jsonMatch[0]) as {
      subtitles_visible?: boolean
      background_is_real_video?: boolean
      score?: number
      reason?: string
    }

    const subtitlesOk = data.subtitles_visible !== false
    const backgroundOk = data.background_is_real_video !== false
    const pass = subtitlesOk && backgroundOk
    const score = typeof data.score === 'number' ? data.score : (pass ? 80 : 20)

    let reason = data.reason ?? ''
    if (!subtitlesOk) reason = 'no subtitles detected'
    if (!backgroundOk) reason = 'solid color background'
    if (!subtitlesOk && !backgroundOk) reason = 'no subtitles detected, solid color background'

    return { score, pass, reason }
  } catch {
    return { score: 50, pass: true, reason: 'JSON parse error in eval response, defaulting to pass' }
  }
}
