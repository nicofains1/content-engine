import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Config } from '../types/index.js'

let _config: Config | null = null

export function loadConfig(): Config {
  if (_config) return _config

  const configPath = join(process.cwd(), 'config.json')

  if (!existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}. Copy config.example.json to config.json and fill in your credentials.`
    )
  }

  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<Config>

  // Validate required fields
  if (!raw.reddit?.clientId) throw new Error('config.json: missing reddit.clientId')
  if (!raw.reddit?.clientSecret) throw new Error('config.json: missing reddit.clientSecret')
  if (!raw.reddit?.username) throw new Error('config.json: missing reddit.username')
  if (!raw.reddit?.password) throw new Error('config.json: missing reddit.password')
  if (!raw.reddit?.userAgent) throw new Error('config.json: missing reddit.userAgent')
  if (!raw.youtube?.clientId) throw new Error('config.json: missing youtube.clientId')
  if (!raw.youtube?.clientSecret) throw new Error('config.json: missing youtube.clientSecret')
  if (!raw.youtube?.refreshToken) throw new Error('config.json: missing youtube.refreshToken')
  if (!raw.tiktok?.cookiesPath) throw new Error('config.json: missing tiktok.cookiesPath')
  if (!raw.paths?.dataDir) throw new Error('config.json: missing paths.dataDir')
  if (!raw.paths?.backgroundsDir) throw new Error('config.json: missing paths.backgroundsDir')
  if (!raw.paths?.musicDir) throw new Error('config.json: missing paths.musicDir')
  if (!raw.paths?.fontsDir) throw new Error('config.json: missing paths.fontsDir')
  if (!raw.paths?.outputDir) throw new Error('config.json: missing paths.outputDir')
  if (!raw.subreddits?.length) throw new Error('config.json: missing subreddits array')
  if (!raw.voices?.length) throw new Error('config.json: missing voices array')

  _config = raw as Config
  return _config
}
