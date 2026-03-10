import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAllCandidates } from '../../src/services/reddit.js'

describe('reddit client', () => {
  beforeEach(() => {
    // Reset cached token between tests
    vi.resetModules()
  })

  it('filters posts below minRedditScore', async () => {
    const mockFetch = vi.fn()
    global.fetch = mockFetch

    // Mock token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 })
    })
    // Mock posts - one above threshold, one below
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: { children: [
          { data: { id: 'abc', title: 'Good post', selftext: '', score: 8000, upvote_ratio: 0.95, url: 'u', over_18: false, stickied: false } },
          { data: { id: 'def', title: 'Low score', selftext: '', score: 100, upvote_ratio: 0.95, url: 'u', over_18: false, stickied: false } },
        ]}
      })
    })

    const config = {
      reddit: { clientId: 'c', clientSecret: 's', username: 'u', password: 'p', userAgent: 'test/1.0' },
      subreddits: ['todayilearned'],
      content: { minRedditScore: 5000, minUpvoteRatio: 0.90, videosPerRun: 1, targetDurationSeconds: 45 },
    } as unknown as import('../../src/types/index.js').Config

    const results = await fetchAllCandidates(config, new Set())
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('abc')
  })

  it('excludes already processed posts', async () => {
    const mockFetch = vi.fn()
    global.fetch = mockFetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        data: { children: [
          { data: { id: 'already', title: 'Old', selftext: '', score: 9000, upvote_ratio: 0.95, url: 'u', over_18: false, stickied: false } },
        ]}
      })
    })
    const config = {
      reddit: { clientId: 'c', clientSecret: 's', username: 'u', password: 'p', userAgent: 'test/1.0' },
      subreddits: ['todayilearned'],
      content: { minRedditScore: 5000, minUpvoteRatio: 0.90, videosPerRun: 1, targetDurationSeconds: 45 },
    } as unknown as import('../../src/types/index.js').Config
    const results = await fetchAllCandidates(config, new Set(['already']))
    expect(results).toHaveLength(0)
  })
})
