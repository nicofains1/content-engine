// WhatsApp setup - initialize Baileys auth and print QR code
// Run once to authenticate: node dist/setup/whatsapp.js
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from 'baileys'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { loadConfig } from '../config/index.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const authDir = join(config.paths.dataDir, 'whatsapp-auth')
  mkdirSync(authDir, { recursive: true })

  console.log('Starting WhatsApp auth setup...')
  console.log('Scan the QR code with your WhatsApp app.')

  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['content-engine', 'Chrome', '120.0.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  await new Promise<void>((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) {
        console.log('\nQR code displayed above. Scan it with WhatsApp.')
      }
      if (connection === 'open') {
        console.log('\nWhatsApp connected successfully! Auth saved to:', authDir)
        console.log('You can now run the content engine jobs.')
        resolve()
      } else if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode
        if (code === DisconnectReason.loggedOut) {
          reject(new Error('WhatsApp logged out - delete auth dir and retry'))
        } else {
          reject(new Error(`Connection closed: ${code}`))
        }
      }
    })
  })

  await sock.end(undefined)
  process.exit(0)
}

main().catch(err => {
  console.error('WhatsApp setup failed:', err)
  process.exit(1)
})
