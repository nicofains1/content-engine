import { describe, it, expect, vi } from 'vitest'

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })) },
    youtube: vi.fn().mockReturnValue({
      videos: {
        insert: vi.fn().mockResolvedValue({ data: { id: 'test_video_id' } }),
        list: vi.fn().mockResolvedValue({
          data: { items: [{ id: 'vid1', statistics: { viewCount: '1000', likeCount: '50', commentCount: '10' } }] }
        }),
      }
    })
  }
}))

vi.mock('fs', () => ({ createReadStream: vi.fn().mockReturnValue({}) }))

describe('YouTube service', () => {
  it('returns video id and url on upload', async () => {
    const { uploadShort } = await import('../../src/services/youtube.js')
    const config = { youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' } } as unknown as import('../../src/types/index.js').Config
    const result = await uploadShort(config, '/tmp/video.mp4', 'Test title', 'Test desc')
    expect(result.id).toBe('test_video_id')
    expect(result.url).toBe('https://youtube.com/shorts/test_video_id')
  })

  it('fetches video stats', async () => {
    const { getVideoStats } = await import('../../src/services/youtube.js')
    const config = { youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' } } as unknown as import('../../src/types/index.js').Config
    const stats = await getVideoStats(config, ['vid1'])
    expect(stats.get('vid1')?.views).toBe(1000)
  })
})
