import type { Config } from '../types/index.js'

/**
 * Attempts to acquire a Pexels API key.
 *
 * Pexels offers a free API (instant approval). Auto-acquisition via their signup
 * form would require browser automation. For now, this logs the manual step needed
 * and returns null. When config.pexels.apiKey is empty, GOD should surface this
 * to trigger the ACQUIRE_CAPABILITY flow.
 */
export async function acquirePexelsApiKey(config: Config): Promise<string | null> {
  const existing = config.pexels?.apiKey ?? ''
  if (existing) return existing

  console.log('[capability-manager] Pexels API key missing.')
  console.log('[capability-manager] Sign up at https://www.pexels.com/api/ (free, instant approval).')
  console.log('[capability-manager] Then add the key to config.json under pexels.apiKey.')
  return null
}

/**
 * Checks whether the system has all required external API capabilities.
 * Returns a list of missing capability names.
 */
export function getMissingCapabilities(config: Config): string[] {
  const missing: string[] = []

  if (!config.pexels?.apiKey) {
    missing.push('pexels_api_key')
  }

  return missing
}
