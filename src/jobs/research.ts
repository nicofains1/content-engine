// Research job — periodic market research for Spanish short-form content
// Runs Wednesday + Saturday at 20:00
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { getDb } from '../db/index.js'

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? '/Users/nfainstein/.local/bin/claude'
const { CLAUDECODE: _cc, ...cleanEnv } = process.env
const CLAUDE_ENV = { ...cleanEnv, PATH: `${process.env.PATH}:/Users/nfainstein/.local/bin:/usr/local/bin` }

/** Like invokeClaude but with web search tools enabled */
function invokeClaudeWithSearch(prompt: string, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_PATH, [
      '-p',
      '--output-format', 'text',
      '--allowedTools', 'WebSearch,WebFetch',
    ], { timeout: timeoutMs, env: CLAUDE_ENV })

    proc.stdin.write(prompt)
    proc.stdin.end()

    let output = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output.trim())
      else if (code === 0) reject(new Error('claude -p returned empty output'))
      else reject(new Error(`claude -p exited with code ${code}: ${stderr.slice(0, 500)}`))
    })
    proc.on('error', reject)
  })
}

const JOB_NAME = 'research'

interface ResearchResult {
  findings: string[]
  topFormats: Array<{ format: string; why: string; evidence: string }>
  genomeRecommendations: Array<{ field: string; value: string; reason: string }>
  newSpeciesIdeas: string[]
}

const RESEARCH_PROMPT = `You are a market research analyst for a Spanish-language short-form content operation (TikTok + YouTube Shorts) focused on "datos curiosos" and faceless AI channels.

Use web search to research what is currently winning in this space. Search for:
1. What formats are going viral in Spanish short-form content right now
2. What hooks get the most engagement on YouTube Shorts and TikTok
3. Which niches have low competition but high views in the Spanish-speaking market
4. Trending topics in "datos curiosos", faceless AI channels, and educational short-form content

Research these sources:
- Reddit: r/NewTubers, r/TikTokCreators — what strategies are people sharing?
- YouTube search: "datos curiosos", "datos curiosos cortos", "curiosidades en español"
- TikTok trends in Spanish educational/curiosity content
- Medium posts on AI content automation and faceless YouTube channels
- Search "best hooks YouTube Shorts 2025" and "mejores hooks shorts español"
- Search "faceless YouTube channel niches 2025"

Return ONLY a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "findings": ["<key finding 1>", "<key finding 2>", ...],
  "topFormats": [
    {"format": "<format name>", "why": "<why it works>", "evidence": "<what you found>"},
    ...
  ],
  "genomeRecommendations": [
    {"field": "<genome field like hook_style, pacing, voice_tone>", "value": "<recommended value>", "reason": "<why>"},
    ...
  ],
  "newSpeciesIdeas": ["<content species idea 1>", "<content species idea 2>", ...]
}

Be specific with data points, channel names, view counts, and concrete examples where possible.`

function extractJson(raw: string): string {
  // Try to extract JSON from markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) return fenceMatch[1].trim()
  // Otherwise find the first { ... } block
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw
}

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another research job is running, exiting')
    process.exit(0)
  }

  try {
    logger.info('Starting market research...')

    // Call Claude with web search (longer timeout for research)
    const raw = await invokeClaudeWithSearch(RESEARCH_PROMPT, 300_000)
    logger.info('Claude returned research results')

    // Parse JSON response
    let result: ResearchResult
    try {
      result = JSON.parse(extractJson(raw))
    } catch (err) {
      logger.error({ raw: raw.slice(0, 500) }, 'Failed to parse research JSON')
      throw new Error(`Failed to parse research response as JSON: ${err}`)
    }

    // Validate structure
    if (!result.findings || !result.topFormats || !result.genomeRecommendations || !result.newSpeciesIdeas) {
      throw new Error('Research response missing required fields')
    }

    const db = getDb()
    const runId = randomUUID()
    const ranAt = new Date().toISOString()

    // Save to DB
    db.prepare(`
      INSERT INTO research_runs (id, ran_at, findings, genome_recommendations)
      VALUES (?, ?, ?, ?)
    `).run(
      runId,
      ranAt,
      JSON.stringify(result.findings),
      JSON.stringify(result.genomeRecommendations),
    )
    logger.info({ runId }, 'Saved research run to DB')

    // Append to GOD.md
    const godPath = join(process.cwd(), 'GOD.md')
    const godContent = readFileSync(godPath, 'utf-8')

    const entry = [
      `\n### Research ${ranAt.split('T')[0]}`,
      `**Top formats:** ${result.topFormats.map(f => f.format).join(', ')}`,
      `**Findings:** ${result.findings.slice(0, 5).join('; ')}`,
      `**Genome recs:** ${result.genomeRecommendations.map(r => `${r.field}=${r.value}`).join(', ')}`,
      `**New species ideas:** ${result.newSpeciesIdeas.join(', ')}`,
    ].join('\n')

    if (godContent.includes('## Research Log')) {
      // Append after the Research Log header
      const updated = godContent.replace('## Research Log', `## Research Log\n${entry}`)
      writeFileSync(godPath, updated)
    } else {
      // Add Research Log section at the end
      writeFileSync(godPath, godContent.trimEnd() + `\n\n## Research Log\n${entry}\n`)
    }

    logger.info('Appended findings to GOD.md')
    logger.info({
      findings: result.findings.length,
      formats: result.topFormats.length,
      recommendations: result.genomeRecommendations.length,
      newIdeas: result.newSpeciesIdeas.length,
    }, 'Research complete')
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Research job fatal error:', err)
  process.exit(1)
})
