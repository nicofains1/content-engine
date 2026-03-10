// Lock file management for preventing concurrent job execution
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs'

const LOCK_DIR = '/tmp'

export function acquireLock(jobName: string): boolean {
  const lockPath = `${LOCK_DIR}/content-engine-${jobName}.lock`
  if (existsSync(lockPath)) {
    const pid = parseInt(readFileSync(lockPath, 'utf-8'))
    try {
      process.kill(pid, 0)
      return false // still running
    } catch {
      unlinkSync(lockPath) // stale lock
    }
  }
  writeFileSync(lockPath, process.pid.toString())
  return true
}

export function releaseLock(jobName: string): void {
  const lockPath = `${LOCK_DIR}/content-engine-${jobName}.lock`
  if (existsSync(lockPath)) unlinkSync(lockPath)
}
