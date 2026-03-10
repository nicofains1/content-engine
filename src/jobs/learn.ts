// Learn job - analyze metrics, evolve population, self-rewrite prompt and config
// Runs Mon and Thu at 05:00
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import {
  getDb, getAllActiveCMs, insertCM, updateCMStats,
} from '../db/index.js'
import { invokeClaude } from '../lib/claude.js'
import { evaluatePopulation, parseCM } from '../darwin/population.js'
import { notifyLearnComplete } from '../services/whatsapp.js'

const JOB_NAME = 'learn'
const CONFIG_PATH = join(process.cwd(), 'config.json')
const CONTENT_SVC_PATH = join(process.cwd(), 'src/services/content.ts')

function getLastWeekVideoData(db: ReturnType<typeof getDb>): Array<{
  contentId: string; cmId: string; script: string; caption: string
  views: number; likes: number; voice: string; hookStyle: string
}> {
  return db.prepare(`
    SELECT
      c.id as contentId,
      c.cm_id as cmId,
      c.script,
      c.caption,
      c.voice,
      COALESCE(latest.views, 0) as views,
      COALESCE(latest.likes, 0) as likes
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views, likes FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND p.posted_at >= datetime('now', '-7 days')
    ORDER BY views DESC
  `).all() as any[]
}

function parseSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const sectionRegex = /===([A-Z_]+)===([\s\S]*?)(?====\w+===|===FIN===|$)/g
  let match: RegExpExecArray | null
  while ((match = sectionRegex.exec(raw)) !== null) {
    const name = match[1]!.trim()
    const content = match[2]!.trim()
    sections[name] = content
  }
  return sections
}

function deepMerge(base: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const result = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k], v)
    } else {
      result[k] = v
    }
  }
  return result
}

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another learn job is running, exiting')
    process.exit(0)
  }

  try {
    const config = loadConfig()
    const db = getDb()

    // 1. Darwin population evaluation
    const rawCMs = getAllActiveCMs(db)
    const cms = rawCMs.map(r => parseCM(r as Record<string, unknown>))
    const { toKill, toReproduce } = evaluatePopulation(cms)

    // Kill underperformers
    for (const cm of toKill) {
      db.prepare(`UPDATE cms SET status = 'dead', died_at = datetime('now'), death_reason = 'below_threshold' WHERE id = ?`).run(cm.id)
      logger.info({ cmId: cm.id, avgViews: cm.avg_views }, 'CM killed')
    }

    // Reproduce high performers
    for (const { childId, childGenome, parent } of toReproduce) {
      insertCM(db, {
        id: childId,
        generation: parent.generation + 1,
        parent_id: parent.id,
        genome: JSON.stringify(childGenome),
        status: 'active',
      })
      logger.info({ childId, parentId: parent.id }, 'CM reproduced')
    }

    // 2. Get last 7 days of video data
    const videoData = getLastWeekVideoData(db)
    if (videoData.length === 0) {
      logger.info('Not enough video data for learning, skipping analysis')
      return
    }

    const avgViews = videoData.reduce((s, v) => s + v.views, 0) / videoData.length

    // 3. Build analysis prompt
    const currentContent = existsSync(CONTENT_SVC_PATH)
      ? readFileSync(CONTENT_SVC_PATH, 'utf-8')
      : ''
    const currentConfig = existsSync(CONFIG_PATH)
      ? readFileSync(CONFIG_PATH, 'utf-8')
      : '{}'

    const topVideos = videoData.slice(0, 5).map(v =>
      `Views: ${v.views} | Hook: ${v.hookStyle ?? 'unknown'} | Voice: ${v.voice}\nCaption: ${v.caption.slice(0, 80)}\nScript: ${v.script.slice(0, 200)}`
    ).join('\n---\n')

    const bottomVideos = videoData.slice(-3).map(v =>
      `Views: ${v.views} | Hook: ${v.hookStyle ?? 'unknown'} | Voice: ${v.voice}\nCaption: ${v.caption.slice(0, 80)}`
    ).join('\n---\n')

    const analysisPrompt = `Sos el sistema de aprendizaje de un motor de contenido de TikTok/YouTube Shorts que genera videos de datos curiosos en español.

DATOS DE LA SEMANA:
- Videos analizados: ${videoData.length}
- Promedio de views: ${Math.round(avgViews)}
- Mejor video: ${videoData[0]?.views ?? 0} views
- Peor video: ${videoData[videoData.length - 1]?.views ?? 0} views

TOP 5 VIDEOS (mayor engagement):
${topVideos}

BOTTOM 3 VIDEOS (menor engagement):
${bottomVideos}

ESTADO DE LA POBLACION:
- CMs activos: ${cms.length - toKill.length + toReproduce.length}
- CMs eliminados esta semana: ${toKill.length}
- CMs nuevos esta semana: ${toReproduce.length}

PROMPT ACTUAL (en src/services/content.ts, funcion buildPrompt):
\`\`\`
${currentContent.slice(0, 3000)}
\`\`\`

CONFIG ACTUAL:
\`\`\`json
${currentConfig.slice(0, 1000)}
\`\`\`

Tu tarea: analizar los patrones de exito y fracaso, y proponer mejoras.

Responde EXACTAMENTE en este formato (con los separadores exactos):

===ANALISIS===
[Analisis de que funciono y que no. Patrones de hooks, tonos, duraciones exitosas. Max 300 palabras.]

===PROMPT===
[Nuevo texto completo para reemplazar el cuerpo de la funcion buildPrompt en content.ts. Solo el template string de retorno, sin codigo TypeScript. Usar las mismas variables: post.title, post.subreddit, content, g.toneInstructions, etc.]

===CONFIG===
[JSON parcial con SOLO los campos de config.json que cambiar. Ejemplo: {"content": {"targetDurationSeconds": 50}}. Si no hay cambios, poner {}]

===EXPERIMENTOS===
[Lista de 2-3 experimentos a trackear. Formato: "- Experimento: X | Hipotesis: Y | Metrica: Z"]

===FIN===`

    logger.info('Invoking Claude for analysis')
    let rawResponse: string
    try {
      rawResponse = await invokeClaude(analysisPrompt, 180_000)
    } catch (err) {
      logger.error({ err }, 'Claude analysis failed')
      return
    }

    const sections = parseSections(rawResponse)
    const analysis = sections['ANALISIS'] ?? ''
    const newPromptTemplate = sections['PROMPT'] ?? ''
    const configChanges = sections['CONFIG'] ?? '{}'
    const experiments = sections['EXPERIMENTOS'] ?? ''

    // 4. Save learning to DB
    const learningResult = db.prepare(`
      INSERT INTO learnings (analysis, prompt_before, prompt_after, config_changes, videos_analyzed, avg_views_before)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      analysis,
      currentContent.slice(0, 10000),
      newPromptTemplate,
      configChanges,
      videoData.length,
      avgViews,
    )
    const learningId = learningResult.lastInsertRowid as number

    // 5. Parse and save experiments
    if (experiments) {
      const expLines = experiments.split('\n').filter(l => l.startsWith('-'))
      for (const line of expLines) {
        const expMatch = line.match(/Experimento:\s*(.+?)\s*\|\s*Hipotesis:\s*(.+?)\s*\|\s*Metrica:\s*(.+)/i)
        if (expMatch) {
          db.prepare(`
            INSERT INTO experiments (learning_id, description, hypothesis, metric_to_watch)
            VALUES (?, ?, ?, ?)
          `).run(learningId, expMatch[1]!.trim(), expMatch[2]!.trim(), expMatch[3]!.trim())
        }
      }
    }

    let promptChanged = false
    let configChanged = false

    // 6. Apply prompt update to content.ts
    if (newPromptTemplate && newPromptTemplate.length > 100) {
      // Back up original
      const backupPath = `${CONTENT_SVC_PATH}.bak`
      writeFileSync(backupPath, currentContent)

      // Record in prompt_history
      db.prepare(`
        INSERT INTO prompt_history (prompt_text, source)
        VALUES (?, 'learn')
      `).run(newPromptTemplate)

      promptChanged = true
      logger.info('Prompt template saved to prompt_history')
    }

    // 7. Apply config changes
    let parsedConfigChanges: Record<string, any> = {}
    try {
      parsedConfigChanges = JSON.parse(configChanges)
    } catch {
      logger.warn('Could not parse config changes JSON, skipping')
    }

    if (Object.keys(parsedConfigChanges).length > 0) {
      const currentConfigObj = JSON.parse(currentConfig)
      const newConfig = deepMerge(currentConfigObj, parsedConfigChanges)

      // Back up config
      writeFileSync(`${CONFIG_PATH}.bak`, currentConfig)
      writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2))

      // 8. Rebuild check
      try {
        execSync('pnpm type-check && pnpm build', { stdio: 'pipe', cwd: process.cwd() })
        configChanged = true
        logger.info('Config updated and build passed')
      } catch (buildErr) {
        logger.error({ buildErr }, 'Build failed after config change, reverting')
        // Revert config
        writeFileSync(CONFIG_PATH, currentConfig)
        logger.info('Config reverted')
      }
    }

    // 9. Notify
    await notifyLearnComplete({
      analysis: analysis.slice(0, 200),
      promptChanged,
      configChanged,
      killed: toKill.length,
      reproduced: toReproduce.length,
    })

    logger.info({
      learningId,
      killed: toKill.length,
      reproduced: toReproduce.length,
      promptChanged,
      configChanged,
    }, 'Learn job complete')
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('Learn job fatal error:', err)
  process.exit(1)
})
