// GOD job - strategic orchestrator entry point
// Runs Sundays at 03:00
import { acquireLock, releaseLock } from '../lib/lock.js'
import { createLogger } from '../lib/logger.js'
import { runGod } from '../god/god.js'

const JOB_NAME = 'god'

async function main(): Promise<void> {
  const logger = createLogger(JOB_NAME)

  if (!acquireLock(JOB_NAME)) {
    logger.info('Another god job is running, exiting')
    process.exit(0)
  }

  try {
    await runGod()
  } finally {
    releaseLock(JOB_NAME)
  }
}

main().catch(err => {
  console.error('GOD job fatal error:', err)
  process.exit(1)
})
