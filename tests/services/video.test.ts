import { describe, it, expect, vi } from 'vitest'
import { pickRandom, pickBackgroundClip, pickMusicTrack } from '../../src/services/video.js'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readdirSync: vi.fn((dir: string) => {
      if (dir.includes('backgrounds')) return ['nature.mp4', 'space.mp4', 'abstract.mp4']
      if (dir.includes('music')) return ['lofi1.mp3', 'lofi2.mp3']
      return []
    }),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
  }
})

describe('pickRandom', () => {
  it('returns an element from the array', () => {
    const arr = [1, 2, 3]
    expect(arr).toContain(pickRandom(arr))
  })
})

describe('pickBackgroundClip', () => {
  it('prefers clips matching the preference', () => {
    const clip = pickBackgroundClip('/data/backgrounds', 'space')
    expect(clip).toContain('space.mp4')
  })

  it('falls back to random when preference not found', () => {
    const clip = pickBackgroundClip('/data/backgrounds', 'nonexistent')
    expect(clip).toMatch(/\.(mp4|mov|mkv)$/i)
  })
})

describe('pickMusicTrack', () => {
  it('returns a music file', () => {
    const track = pickMusicTrack('/data/music')
    expect(track).toMatch(/\.mp3$/)
  })
})
