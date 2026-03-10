import { describe, it, expect, vi } from 'vitest'

vi.mock('@whiskeysockets/baileys', () => ({
  default: vi.fn().mockReturnValue({
    sendMessage: vi.fn().mockResolvedValue({}),
    ev: { on: vi.fn() },
  }),
  useMultiFileAuthState: vi.fn().mockResolvedValue({ state: {}, saveCreds: vi.fn() }),
  DisconnectReason: { loggedOut: 401 },
}))

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({ error: vi.fn(), info: vi.fn() })
}))

describe('notifier', () => {
  it('does not throw when notifications disabled', async () => {
    const { notifyAlert } = await import('../../src/services/notifier.js')
    const config = {
      notifications: { enabled: false, whatsappGroupJid: 'test@g.us' },
      paths: { dataDir: '/tmp' }
    } as unknown as import('../../src/types/index.js').Config

    await expect(notifyAlert(config, 'test', 'details')).resolves.toBeUndefined()
  })
})
