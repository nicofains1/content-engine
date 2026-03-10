// GOD layer - strategic orchestrator for radical population management
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb, getAllActiveCMs, insertCM } from '../db/index.js'
import { invokeClaude } from '../lib/claude.js'
import { createLogger } from '../lib/logger.js'
import { loadConfig } from '../config/index.js'
import { parseCM, randomGenome } from '../darwin/population.js'
import { notifyGodDecision } from '../services/whatsapp.js'
import { nanoid } from 'nanoid'

const logger = createLogger('god')
const GOD_MD_PATH = join(process.cwd(), 'GOD.md')

interface GodDecision {
  action: 'MAINTAIN' | 'INJECT_RADICAL' | 'FORCE_DIVERSITY' | 'UPDATE_RULES' | 'KILL_ALL_AND_RESTART'
  reason: string
  details?: Record<string, any>
}

function parseSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const regex = /===([A-Z_]+)===([\s\S]*?)(?====\w+===|$)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(raw)) !== null) {
    sections[match[1]!.trim()] = match[2]!.trim()
  }
  return sections
}

function parseDecision(decisionsText: string): GodDecision {
  const actionMatch = decisionsText.match(/^ACTION:\s*(.+)$/m)
  const reasonMatch = decisionsText.match(/^REASON:\s*(.+)$/m)
  const detailsMatch = decisionsText.match(/^DETAILS:\s*(.+)$/ms)

  const action = (actionMatch?.[1]?.trim() ?? 'MAINTAIN') as GodDecision['action']
  const reason = reasonMatch?.[1]?.trim() ?? 'No reason provided'
  let details: Record<string, any> | undefined

  if (detailsMatch?.[1]?.trim()) {
    try {
      details = JSON.parse(detailsMatch[1].trim())
    } catch {
      // ignore parse errors
    }
  }

  return { action, reason, details }
}

function get14DayMetrics(db: ReturnType<typeof getDb>): {
  avgViews: number; totalVideos: number; viewVariance: number
  weeklyAvgs: number[]
} {
  const rows = db.prepare(`
    SELECT
      COALESCE(latest.views, 0) as views,
      p.posted_at
    FROM posts p
    JOIN content c ON c.id = p.content_id
    LEFT JOIN (
      SELECT post_id, views FROM metrics
      WHERE id IN (SELECT MAX(id) FROM metrics GROUP BY post_id)
    ) latest ON latest.post_id = p.id
    WHERE p.platform = 'youtube' AND p.status = 'posted'
      AND p.posted_at >= datetime('now', '-14 days')
    ORDER BY p.posted_at ASC
  `).all() as Array<{ views: number; posted_at: string }>

  if (rows.length === 0) return { avgViews: 0, totalVideos: 0, viewVariance: 0, weeklyAvgs: [] }

  const views = rows.map(r => r.views)
  const avgViews = views.reduce((a, b) => a + b, 0) / views.length
  const variance = views.reduce((s, v) => s + Math.pow(v - avgViews, 2), 0) / views.length

  // Split into two weeks
  const midpoint = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const week1 = rows.filter(r => r.posted_at < midpoint).map(r => r.views)
  const week2 = rows.filter(r => r.posted_at >= midpoint).map(r => r.views)
  const w1avg = week1.length ? week1.reduce((a, b) => a + b, 0) / week1.length : 0
  const w2avg = week2.length ? week2.reduce((a, b) => a + b, 0) / week2.length : 0

  return { avgViews, totalVideos: rows.length, viewVariance: variance, weeklyAvgs: [w1avg, w2avg] }
}

async function executeDecision(
  db: ReturnType<typeof getDb>,
  decision: GodDecision,
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const rawCMs = getAllActiveCMs(db)
  const cms = rawCMs.map(r => parseCM(r as Record<string, unknown>))

  switch (decision.action) {
    case 'MAINTAIN':
      logger.info('GOD decision: MAINTAIN - no changes')
      break

    case 'INJECT_RADICAL': {
      const newGenome = randomGenome(config.voices)
      // Optionally override genome fields from details
      if (decision.details?.genome) {
        Object.assign(newGenome, decision.details.genome)
      }
      const newId = `cm-god-${nanoid(6)}`
      insertCM(db, {
        id: newId,
        generation: 1,
        genome: JSON.stringify(newGenome),
        status: 'active',
      })
      logger.info({ newId }, 'GOD: injected radical CM')
      break
    }

    case 'FORCE_DIVERSITY': {
      for (const cm of cms) {
        const genome = { ...cm.genome }
        const fields = Object.keys(genome) as (keyof typeof genome)[]
        const shuffled = fields.sort(() => Math.random() - 0.5).slice(0, 3)
        const freshGenome = randomGenome(config.voices)
        for (const field of shuffled) {
          (genome as any)[field] = (freshGenome as any)[field]
        }
        db.prepare('UPDATE cms SET genome = ? WHERE id = ?').run(JSON.stringify(genome), cm.id)
      }
      logger.info({ cmsModified: cms.length }, 'GOD: forced diversity on all CMs')
      break
    }

    case 'UPDATE_RULES': {
      if (decision.details?.darwin) {
        const configPath = join(process.cwd(), 'config.json')
        if (existsSync(configPath)) {
          const currentConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
          currentConfig.darwin = { ...currentConfig.darwin, ...decision.details.darwin }
          writeFileSync(configPath, JSON.stringify(currentConfig, null, 2))
          logger.info({ changes: decision.details.darwin }, 'GOD: updated darwin rules in config.json')
        }
      }
      break
    }

    case 'KILL_ALL_AND_RESTART': {
      // Kill all active CMs
      db.prepare(`UPDATE cms SET status = 'dead', died_at = datetime('now'), death_reason = 'god_reset' WHERE status != 'dead'`).run()
      // Insert fresh population
      const count = decision.details?.populationSize ?? 3
      for (let i = 0; i < count; i++) {
        insertCM(db, {
          id: `cm-restart-${nanoid(6)}`,
          generation: 1,
          genome: JSON.stringify(randomGenome(config.voices)),
          status: 'active',
        })
      }
      logger.warn({ newPopulation: count }, 'GOD: killed all CMs and restarted with fresh population')
      break
    }
  }
}

export async function runGod(): Promise<void> {
  const config = loadConfig()
  const db = getDb()

  const rawCMs = getAllActiveCMs(db)
  const cms = rawCMs.map(r => parseCM(r as Record<string, unknown>))
  const metrics = get14DayMetrics(db)

  const godMd = existsSync(GOD_MD_PATH) ? readFileSync(GOD_MD_PATH, 'utf-8') : ''

  const cmSummary = cms.map(cm =>
    `- CM ${cm.id} (gen ${cm.generation}): avg_views=${cm.avg_views}, videos=${cm.videos_generated}, hook=${cm.genome.hookStyle}, tone="${cm.genome.toneInstructions.slice(0, 40)}"`
  ).join('\n')

  const prompt = `Sos GOD, el director de optimizacion estrategica de un motor de contenido de TikTok/YouTube Shorts.

ESTADO ACTUAL DEL SISTEMA:
- CMs activos: ${cms.length}
- Videos ultimos 14 dias: ${metrics.totalVideos}
- Promedio views (14d): ${Math.round(metrics.avgViews)}
- Varianza: ${Math.round(metrics.viewVariance)} (baja = todos parecidos, alta = hay diferencias)
- Semana 1 avg: ${Math.round(metrics.weeklyAvgs[0] ?? 0)} | Semana 2 avg: ${Math.round(metrics.weeklyAvgs[1] ?? 0)}

POBLACION ACTUAL:
${cmSummary || 'Sin CMs activos'}

CONTEXTO HISTORICO (GOD.md):
${godMd.slice(-2000)}

ACCIONES DISPONIBLES:
- MAINTAIN: el sistema funciona, no tocar
- INJECT_RADICAL: inyectar un CM nuevo con genome diferente al resto
- FORCE_DIVERSITY: mutar 3 campos en todos los CMs activos
- UPDATE_RULES: cambiar parametros darwin en config.json
- KILL_ALL_AND_RESTART: matar todo y empezar de cero (solo si hay estancamiento severo)

CRITERIOS:
- Si avg_views > 1000 y tendencia estable: MAINTAIN
- Si varianza muy baja (< 50000) y avg_views < 500: FORCE_DIVERSITY o INJECT_RADICAL
- Si llevamos 2 semanas sin mejorar: considera INJECT_RADICAL
- KILL_ALL_AND_RESTART solo si avg_views < 100 Y llevas 3+ semanas sin mejorar

Responde EXACTAMENTE en este formato:

===DECISIONS===
ACTION: [MAINTAIN|INJECT_RADICAL|FORCE_DIVERSITY|UPDATE_RULES|KILL_ALL_AND_RESTART]
REASON: [una linea explicando la decision]
DETAILS: [JSON con parametros extra, o {} si no aplica]

===GOD_LOG===
[Tu analisis completo del estado del sistema. 3-5 oraciones. Esto se appendera al historial.]`

  logger.info('Invoking Claude for GOD analysis')
  const rawResponse = await invokeClaude(prompt, 120_000)
  const sections = parseSections(rawResponse)

  const decisionsText = sections['DECISIONS'] ?? ''
  const godLog = sections['GOD_LOG'] ?? ''
  const decision = parseDecision(decisionsText)

  logger.info({ action: decision.action, reason: decision.reason }, 'GOD decision received')

  // Execute the decision
  await executeDecision(db, decision, config)

  // Update GOD.md with historial entry
  const timestamp = new Date().toISOString()
  const historyEntry = `\n### ${timestamp}\n**Action:** ${decision.action}\n**Reason:** ${decision.reason}\n\n${godLog}\n`
  const updatedGodMd = godMd + historyEntry
  writeFileSync(GOD_MD_PATH, updatedGodMd)

  // Notify via WhatsApp
  await notifyGodDecision({
    action: decision.action,
    reason: decision.reason,
    details: godLog.slice(0, 200),
  })

  logger.info({ action: decision.action }, 'GOD run complete')
}
