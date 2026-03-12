// CM planning — generates a content plan from a CM's genome
import { invokeClaudeText } from '../lib/claude.js'
import type { Genome } from '../types/index.js'

export async function generateCMPlan(cmId: string, genome: Genome): Promise<string | null> {
  const prompt = `You are CM ${cmId}, a TikTok/YouTube Shorts content creator.
Your genome defines your style: ${JSON.stringify(genome)}

Define your content plan in JSON:
{
  "targetAudience": "...",
  "desiredEmotion": "...",
  "contentTheme": "...",
  "visualStyle": "...",
  "audioStyle": "...",
  "hookRequirement": "...",
  "acceptanceCriteria": [
    "Subtítulos visibles y legibles",
    "Fondo es video real (no color sólido)",
    "Gancho en los primeros 3 segundos",
    "Tono coincide con: ${genome.toneInstructions}"
  ]
}

Respond ONLY with valid JSON, no markdown or code fences.`

  try {
    const response = await invokeClaudeText(prompt, 'claude-sonnet-4-6')
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    JSON.parse(jsonMatch[0]) // validate
    return jsonMatch[0]
  } catch {
    return null
  }
}
