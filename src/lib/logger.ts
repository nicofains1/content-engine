import pino from 'pino'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { loadConfig } from '../config/index.js'

export function createLogger(jobName: string): pino.Logger {
  const level = process.env['LOG_LEVEL'] ?? 'info'

  let config: ReturnType<typeof loadConfig> | null = null
  try {
    config = loadConfig()
  } catch {
    // If config isn't available yet, log only to stdout
    return pino({ level, name: jobName })
  }

  const logsDir = join(config.paths.dataDir, 'logs')
  mkdirSync(logsDir, { recursive: true })

  const logFilePath = join(logsDir, `${jobName}.log`)

  const transport = pino.transport({
    targets: [
      {
        target: 'pino/file',
        options: { destination: logFilePath, append: true },
        level,
      },
      {
        target: 'pino/file',
        options: { destination: 1 }, // stdout fd
        level,
      },
    ],
  })

  return pino({ level, name: jobName }, transport)
}
