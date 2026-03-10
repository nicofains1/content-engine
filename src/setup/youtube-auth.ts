// YouTube OAuth2 setup - run once to get a refresh token
// Prerequisites: download credentials.json from GCP console (OAuth 2.0 Desktop app)
// Usage: node dist/setup/youtube-auth.js
import { google } from 'googleapis'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload']

async function main(): Promise<void> {
  const credPath = join(process.cwd(), 'credentials.json')

  if (!existsSync(credPath)) {
    console.error('credentials.json not found.')
    console.error('Download it from Google Cloud Console > APIs & Services > Credentials')
    console.error('Create an OAuth 2.0 Client ID (Desktop app) and download the JSON.')
    process.exit(1)
  }

  const credentials = JSON.parse(readFileSync(credPath, 'utf-8'))
  const { client_id, client_secret, redirect_uris } = credentials.installed ?? credentials.web ?? {}

  if (!client_id || !client_secret) {
    console.error('Invalid credentials.json - missing client_id or client_secret')
    process.exit(1)
  }

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] ?? 'urn:ietf:wg:oauth:2.0:oob')

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  console.log('\nOpen this URL in your browser to authorize:')
  console.log('\n' + authUrl + '\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const code = await new Promise<string>(resolve => {
    rl.question('Paste the authorization code here: ', answer => {
      rl.close()
      resolve(answer.trim())
    })
  })

  const { tokens } = await oauth2Client.getToken(code)

  if (!tokens.refresh_token) {
    console.error('No refresh token received. Make sure you used prompt: consent and this is a fresh auth.')
    process.exit(1)
  }

  console.log('\nSuccess! Add these to your config.json:')
  console.log(`  "youtube": {`)
  console.log(`    "clientId": "${client_id}",`)
  console.log(`    "clientSecret": "${client_secret}",`)
  console.log(`    "refreshToken": "${tokens.refresh_token}"`)
  console.log(`  }`)

  // Also save to a token file for reference
  const tokenPath = join(process.cwd(), 'youtube-token.json')
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2))
  console.log(`\nToken also saved to ${tokenPath}`)

  process.exit(0)
}

main().catch(err => {
  console.error('YouTube auth setup failed:', err)
  process.exit(1)
})
