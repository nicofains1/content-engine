import { describe, it, expect, vi } from 'vitest'
import { uploadToTikTok } from '../../src/services/tiktok.js'

vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => ({
    stdout: { on: vi.fn().mockImplementation((e, cb) => e === 'data' && cb(Buffer.from('{"status":"ok"}'))) },
    stderr: { on: vi.fn() },
    on: vi.fn().mockImplementation((e, cb) => e === 'close' && cb(0)),
  }))
}))

describe('TikTok service', () => {
  it('resolves on successful upload', async () => {
    await expect(uploadToTikTok({
      videoPath: '/tmp/video.mp4',
      description: 'test',
      cookiesPath: '/tmp/cookies.txt',
      contentId: 'test-123',
    })).resolves.toBeUndefined()
  })
})
