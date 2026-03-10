import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process spawn
vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => {
    const proc = {
      stderr: { on: vi.fn() },
      on: vi.fn().mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') cb(0)
      }),
      error: { on: vi.fn() },
    }
    return proc
  }),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  dirname: vi.fn().mockReturnValue('/tmp'),
}))

describe('TTS service', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('generates audio and subtitle paths', async () => {
    const { generateTTS } = await import('../../src/services/tts.js')
    const result = await generateTTS('Hola mundo', 'es-MX-JorgeNeural', '+0%', '/tmp/audio', 'test')
    expect(result.audioPath).toBe('/tmp/audio/test.mp3')
    expect(result.subtitlePath).toBe('/tmp/audio/test.vtt')
  })
})
