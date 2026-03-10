import { describe, it, expect } from 'vitest'
import { parseOutput, buildPrompt } from '../../src/services/content.js'
import type { CM, RedditPost } from '../../src/types/index.js'

const mockCM: CM = {
  id: 'cm_test', generation: 1, genome: {
    hookStyle: 'pregunta', toneInstructions: 'educativo y accesible',
    scriptStructure: 'hook-desarrollo-cierre', wordCountTarget: 150,
    closingStyle: 'pregunta_comentarios', voice: 'es-MX-JorgeNeural',
    speechRate: '+0%', musicVolume: 0.12, subtitleStyle: 'karaoke_grande',
    subtitleColor: '#FFFFFF', subtitlePosition: 'abajo',
    backgroundPreference: 'espacio', preferredSubreddits: [],
    minRedditScore: 5000, captionStyle: 'minimal', hashtagCount: 10,
  },
  status: 'active', videos_generated: 0, total_views: 0, total_likes: 0,
  total_comments: 0, avg_views: 0, best_video_views: 0, created_at: new Date().toISOString(),
}

const mockPost: RedditPost = {
  id: 'abc', subreddit: 'todayilearned', title: 'TIL octopuses have 3 hearts',
  selftext: '', score: 8000, upvote_ratio: 0.95, url: 'https://reddit.com',
  over_18: false, stickied: false,
}

describe('parseOutput', () => {
  it('parses correctly formatted output', () => {
    const raw = `Este es el guion del video.\n\n---\ncaption: Los pulpos son increibles 🐙\nhashtags: #datoscuriosos #curiosidades`
    const result = parseOutput(raw)
    expect(result.script).toBe('Este es el guion del video.')
    expect(result.caption).toBe('Los pulpos son increibles 🐙')
    expect(result.hashtags).toBe('#datoscuriosos #curiosidades')
  })

  it('handles missing --- separator', () => {
    const raw = 'Solo el guion sin separador'
    const result = parseOutput(raw)
    expect(result.script).toBe('Solo el guion sin separador')
    expect(result.hashtags).toContain('#datoscuriosos')
  })
})

describe('buildPrompt', () => {
  it('includes CM tone instructions', () => {
    const prompt = buildPrompt(mockPost, mockCM)
    expect(prompt).toContain('educativo y accesible')
  })

  it('includes reddit post title', () => {
    const prompt = buildPrompt(mockPost, mockCM)
    expect(prompt).toContain('TIL octopuses have 3 hearts')
  })

  it('uses top_comment when available', () => {
    const postWithComment = { ...mockPost, top_comment: 'The comment content' }
    const prompt = buildPrompt(postWithComment, mockCM)
    expect(prompt).toContain('The comment content')
  })
})
