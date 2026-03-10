// WhatsApp notification service using Baileys
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from 'baileys'

import { join } from 'path'
import { mkdirSync } from 'fs'
import { loadConfig } from '../config/index.js'
import { createLogger } from '../lib/logger.js'

const logger = createLogger('whatsapp')

let _socket: ReturnType<typeof makeWASocket> | null = null
let _ready = false

async function getSocket(): Promise<ReturnType<typeof makeWASocket>> {
  if (_socket && _ready) return _socket

  const config = loadConfig()
  const authDir = join(config.paths.dataDir, 'whatsapp-auth')
  mkdirSync(authDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  _socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: 'baileys' }) as any,
    browser: ['content-engine', 'Chrome', '120.0.0'],
  })

  _socket.ev.on('creds.update', saveCreds)

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WhatsApp connection timeout')), 30_000)

    _socket!.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update
      if (connection === 'open') {
        _ready = true
        clearTimeout(timeout)
        resolve()
      } else if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode
        if (code !== DisconnectReason.loggedOut) {
          _ready = false
          _socket = null
        }
        clearTimeout(timeout)
        reject(new Error(`WhatsApp disconnected: ${code}`))
      }
    })
  })

  return _socket!
}

async function sendMessage(text: string): Promise<void> {
  const config = loadConfig()
  if (!config.notifications?.enabled) return
  if (!config.notifications?.whatsappGroupJid) return

  const sock = await getSocket()
  await sock.sendMessage(config.notifications.whatsappGroupJid, { text })
}

export async function notifyVideoPosted(info: {
  title: string
  youtubeUrl?: string
  tiktokPosted?: boolean
  cmId: string
}): Promise<void> {
  try {
    const lines = [
      `Video publicado`,
      `Titulo: ${info.title}`,
      info.youtubeUrl ? `YouTube: ${info.youtubeUrl}` : null,
      info.tiktokPosted ? `TikTok: publicado` : null,
      `CM: ${info.cmId}`,
    ].filter(Boolean)
    await sendMessage(lines.join('\n'))
  } catch (err) {
    logger.error({ err }, 'Failed to send notifyVideoPosted')
  }
}

export async function notifyDailyReport(stats: {
  totalViews: number
  videosPosted: number
  avgViews: number
  bestVideo?: { title: string; views: number; url?: string }
}): Promise<void> {
  try {
    const lines = [
      `Reporte diario`,
      `Videos publicados: ${stats.videosPosted}`,
      `Views totales: ${stats.totalViews.toLocaleString()}`,
      `Promedio views: ${Math.round(stats.avgViews).toLocaleString()}`,
    ]
    if (stats.bestVideo) {
      lines.push(`Mejor video: ${stats.bestVideo.title} (${stats.bestVideo.views.toLocaleString()} views)`)
      if (stats.bestVideo.url) lines.push(stats.bestVideo.url)
    }
    await sendMessage(lines.join('\n'))
  } catch (err) {
    logger.error({ err }, 'Failed to send notifyDailyReport')
  }
}

export async function notifyWeeklyReport(stats: {
  totalViews: number
  videosPosted: number
  avgViews: number
  topPerformers: Array<{ cmId: string; avgViews: number; videos: number }>
  trend: 'up' | 'down' | 'stable'
}): Promise<void> {
  try {
    const trendEmoji = stats.trend === 'up' ? '📈' : stats.trend === 'down' ? '📉' : '➡️'
    const lines = [
      `Reporte semanal ${trendEmoji}`,
      `Videos publicados: ${stats.videosPosted}`,
      `Views totales: ${stats.totalViews.toLocaleString()}`,
      `Promedio views: ${Math.round(stats.avgViews).toLocaleString()}`,
    ]
    if (stats.topPerformers.length > 0) {
      lines.push(`Top CM: ${stats.topPerformers[0].cmId} (${Math.round(stats.topPerformers[0].avgViews)} avg views, ${stats.topPerformers[0].videos} videos)`)
    }
    await sendMessage(lines.join('\n'))
  } catch (err) {
    logger.error({ err }, 'Failed to send notifyWeeklyReport')
  }
}

export async function notifyGodDecision(decision: {
  action: string
  reason: string
  details?: string
}): Promise<void> {
  try {
    const lines = [
      `GOD Decision: ${decision.action}`,
      `Razon: ${decision.reason}`,
    ]
    if (decision.details) lines.push(decision.details)
    await sendMessage(lines.join('\n'))
  } catch (err) {
    logger.error({ err }, 'Failed to send notifyGodDecision')
  }
}

export async function notifyLearnComplete(info: {
  analysis: string
  promptChanged: boolean
  configChanged: boolean
  killed: number
  reproduced: number
}): Promise<void> {
  try {
    const lines = [
      `Learn completado`,
      `Prompt actualizado: ${info.promptChanged ? 'si' : 'no'}`,
      `Config actualizado: ${info.configChanged ? 'si' : 'no'}`,
      `CMs muertos: ${info.killed}`,
      `CMs nuevos: ${info.reproduced}`,
      `Analisis: ${info.analysis.slice(0, 300)}`,
    ]
    await sendMessage(lines.join('\n'))
  } catch (err) {
    logger.error({ err }, 'Failed to send notifyLearnComplete')
  }
}

export async function closeWhatsApp(): Promise<void> {
  if (_socket) {
    await _socket.end(undefined)
    _socket = null
    _ready = false
  }
}
