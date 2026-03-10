import { createLogger } from '../lib/logger.js'
import type { Config } from '../types/index.js'

const logger = createLogger('notifier')

export interface PostResult {
  platform: string
  success: boolean
  url?: string
  error?: string
}

export interface DailyStats {
  date: string
  videosGenerated: number
  videosPosted: number
  failures: number
  totalViews: number
  totalLikes: number
  totalComments: number
  bestVideoTitle?: string
  bestVideoViews?: number
  niche: string
  dayNumber: number
}

export interface WeeklyStats {
  weekNumber: number
  videosGenerated: number
  videosPosted: number
  successRate: number
  totalViews: number
  avgViews: number
  bestVideoTitle?: string
  bestVideoViews?: number
  worstVideoViews?: number
  cmRanking: Array<{ id: string; name: string; avgViews: number; status: string }>
  killCriteria: { anyVideoOver1k: boolean; postingSuccess: boolean; avgViewsOk: boolean }
}

type WASock = {
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>
  ev: { on: (event: string, handler: (...args: unknown[]) => void) => void }
}

let sock: WASock | null = null

async function getSock(config: Config): Promise<WASock> {
  if (sock) return sock

  try {
    const baileys = await import('baileys') as unknown as {
      default: (opts: Record<string, unknown>) => WASock;
      useMultiFileAuthState: (path: string) => Promise<{ state: unknown; saveCreds: () => void }>;
      DisconnectReason: Record<string, unknown>;
    }
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys

    const authDir = `${config.paths.dataDir}/whatsapp-auth`
    const { state, saveCreds } = await useMultiFileAuthState(authDir)

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: { level: 'silent', child: () => ({}) },
    })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update: unknown) => {
      const u = update as { connection?: string; lastDisconnect?: { error?: { output?: { statusCode: number } } } }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode
        if (code !== (DisconnectReason.loggedOut as number)) {
          sock = null // allow reconnect
        }
      }
    })

    return sock
  } catch (err) {
    throw new Error(`Baileys not available: ${err}`)
  }
}

async function send(config: Config, message: string): Promise<void> {
  if (!config.notifications.enabled) return
  try {
    const s = await getSock(config)
    await s.sendMessage(config.notifications.whatsappGroupJid, { text: message })
  } catch (err) {
    logger.error({ err }, 'WhatsApp notification failed')
    // Non-fatal: notifications failing should not stop the pipeline
  }
}

export async function notifyVideoPosted(config: Config, title: string, results: PostResult[]): Promise<void> {
  const lines = [`📹 Video posteado\n\n"${title.slice(0, 80)}..."\n`]
  for (const r of results) {
    const icon = r.success ? '✅' : '❌'
    const detail = r.success ? (r.url ?? 'subido') : r.error ?? 'error desconocido'
    lines.push(`${icon} ${r.platform}: ${detail}`)
  }
  await send(config, lines.join('\n'))
}

export async function notifyDailyReport(config: Config, stats: DailyStats): Promise<void> {
  const msg = `📊 Resumen del dia — ${stats.date}

Videos generados: ${stats.videosGenerated}/${stats.videosGenerated + stats.failures}
Videos posteados: ${stats.videosPosted}
Fallos: ${stats.failures}

YouTube (ultimas 24hs):
  Views: ${stats.totalViews.toLocaleString()}
  Likes: ${stats.totalLikes}
  Comentarios: ${stats.totalComments}
  ${stats.bestVideoTitle ? `Mejor video: "${stats.bestVideoTitle}" (${stats.bestVideoViews} views)` : ''}

Nicho: ${stats.niche}
Dia ${stats.dayNumber} de 30 del periodo de validacion`

  await send(config, msg)
}

export async function notifyWeeklyReport(config: Config, stats: WeeklyStats): Promise<void> {
  const ranking = stats.cmRanking
    .map((cm, i) => `${i + 1}. ${cm.id} — avg ${Math.round(cm.avgViews)} views (${cm.status})`)
    .join('\n')

  const kc = stats.killCriteria
  const msg = `📈 Reporte semanal — Semana ${stats.weekNumber}

Videos generados: ${stats.videosGenerated}
Videos posteados: ${stats.videosPosted}
Tasa de exito: ${Math.round(stats.successRate * 100)}%

YouTube (7 dias):
  Views totales: ${stats.totalViews.toLocaleString()}
  Promedio views/video: ${Math.round(stats.avgViews)}
  ${stats.bestVideoTitle ? `Mejor: "${stats.bestVideoTitle}" (${stats.bestVideoViews} views)` : ''}

Ranking CMs:
${ranking}

Kill criteria:
  ${kc.anyVideoOver1k ? '✅' : '❌'} Algun video >1K views
  ${kc.postingSuccess ? '✅' : '❌'} Posting success >70%
  ${kc.avgViewsOk ? '✅' : '❌'} Avg views >500

Semana ${stats.weekNumber} de 4 del periodo de validacion`

  await send(config, msg)
}

export async function notifyAlert(config: Config, type: string, details: string): Promise<void> {
  await send(config, `🚨 ALERTA: ${type}\n\n${details}`)
}

export async function notifyGodDecision(config: Config, decision: string, reason: string): Promise<void> {
  await send(config, `🌐 GOD Decision\n\n${decision}\n\nRazon: ${reason}`)
}
