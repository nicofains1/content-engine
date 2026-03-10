// Darwin population manager - CM selection, evaluation, mutation, crossover
import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { CM, Genome } from '../types/index.js'
import { insertCM, getAllActiveCMs } from '../db/index.js'

const GENOME_FIELDS: (keyof Genome)[] = [
  'hookStyle',
  'toneInstructions',
  'scriptStructure',
  'wordCountTarget',
  'closingStyle',
  'voice',
  'speechRate',
  'musicVolume',
  'subtitleStyle',
  'subtitleColor',
  'subtitlePosition',
  'backgroundPreference',
  'preferredSubreddits',
  'minRedditScore',
  'captionStyle',
  'hashtagCount',
]

const HOOK_STYLES = ['pregunta', 'dato_impactante', 'negacion', 'numero', 'historia']
const TONE_INSTRUCTIONS = [
  'casual y conversacional, como contandole a un amigo',
  'formal pero accesible, como un documental corto',
  'dramatico y con suspenso, construyendo tension',
  'energico y rapido, datos al grano sin pausa',
  'reflexivo, invitando a pensar al espectador',
]
const STRUCTURES = ['hook-desarrollo-cierre', '3-datos-rapidos', 'historia-corta', 'pregunta-respuesta']
const CLOSING_STYLES = ['pregunta_comentarios', 'call_to_follow', 'dato_bonus', 'cliffhanger']
const VOICES = ['es-MX-JorgeNeural', 'es-AR-TomasNeural', 'es-ES-AlvaroNeural', 'es-MX-DaliaNeural']
const SPEECH_RATES = ['-10%', '0%', '+5%', '+10%', '+15%']
const SUBTITLE_STYLES = ['bold_white', 'yellow_highlight', 'outline_black', 'gradient']
const SUBTITLE_COLORS = ['#FFFFFF', '#FFFF00', '#00FF00', '#FF6B6B']
const SUBTITLE_POSITIONS = ['bottom', 'center', 'top']
const BACKGROUND_PREFS = ['gameplay', 'nature', 'abstract', 'cityscape', 'any']
const SUBREDDITS = ['todayilearned', 'Showerthoughts', 'explainlikeimfive', 'interestingasfuck', 'mildlyinteresting', 'science', 'history']
const CAPTION_STYLES = ['corto_impactante', 'con_emoji', 'pregunta', 'afirmacion']

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randomGenome(voices: string[] = VOICES): Genome {
  return {
    hookStyle: randomFrom(HOOK_STYLES),
    toneInstructions: randomFrom(TONE_INSTRUCTIONS),
    scriptStructure: randomFrom(STRUCTURES),
    wordCountTarget: randomInt(80, 150),
    closingStyle: randomFrom(CLOSING_STYLES),
    voice: randomFrom(voices),
    speechRate: randomFrom(SPEECH_RATES),
    musicVolume: parseFloat((Math.random() * 0.2 + 0.05).toFixed(2)),
    subtitleStyle: randomFrom(SUBTITLE_STYLES),
    subtitleColor: randomFrom(SUBTITLE_COLORS),
    subtitlePosition: randomFrom(SUBTITLE_POSITIONS),
    backgroundPreference: randomFrom(BACKGROUND_PREFS),
    preferredSubreddits: [randomFrom(SUBREDDITS), randomFrom(SUBREDDITS)].filter((v, i, a) => a.indexOf(v) === i),
    minRedditScore: randomFrom([1000, 3000, 5000, 10000]),
    captionStyle: randomFrom(CAPTION_STYLES),
    hashtagCount: randomInt(5, 12),
  }
}

function mutateGenome(genome: Genome, fieldsToMutate = randomInt(1, 3)): Genome {
  const result = { ...genome, preferredSubreddits: [...genome.preferredSubreddits] }
  const shuffled = [...GENOME_FIELDS].sort(() => Math.random() - 0.5)
  const fields = shuffled.slice(0, fieldsToMutate)

  for (const field of fields) {
    switch (field) {
      case 'hookStyle': result.hookStyle = randomFrom(HOOK_STYLES); break
      case 'toneInstructions': result.toneInstructions = randomFrom(TONE_INSTRUCTIONS); break
      case 'scriptStructure': result.scriptStructure = randomFrom(STRUCTURES); break
      case 'wordCountTarget': result.wordCountTarget = randomInt(80, 150); break
      case 'closingStyle': result.closingStyle = randomFrom(CLOSING_STYLES); break
      case 'voice': result.voice = randomFrom(VOICES); break
      case 'speechRate': result.speechRate = randomFrom(SPEECH_RATES); break
      case 'musicVolume': result.musicVolume = parseFloat((Math.random() * 0.2 + 0.05).toFixed(2)); break
      case 'subtitleStyle': result.subtitleStyle = randomFrom(SUBTITLE_STYLES); break
      case 'subtitleColor': result.subtitleColor = randomFrom(SUBTITLE_COLORS); break
      case 'subtitlePosition': result.subtitlePosition = randomFrom(SUBTITLE_POSITIONS); break
      case 'backgroundPreference': result.backgroundPreference = randomFrom(BACKGROUND_PREFS); break
      case 'preferredSubreddits': result.preferredSubreddits = [randomFrom(SUBREDDITS), randomFrom(SUBREDDITS)]; break
      case 'minRedditScore': result.minRedditScore = randomFrom([1000, 3000, 5000, 10000]); break
      case 'captionStyle': result.captionStyle = randomFrom(CAPTION_STYLES); break
      case 'hashtagCount': result.hashtagCount = randomInt(5, 12); break
    }
  }
  return result
}

function crossoverGenomes(a: Genome, b: Genome): Genome {
  const result = { ...a, preferredSubreddits: [...a.preferredSubreddits] }
  for (const field of GENOME_FIELDS) {
    if (Math.random() > 0.5) {
      (result as any)[field] = (b as any)[field]
    }
  }
  return result
}

export function parseCM(row: Record<string, unknown>): CM {
  return {
    id: row['id'] as string,
    generation: row['generation'] as number,
    parent_id: row['parent_id'] as string | undefined,
    genome: typeof row['genome'] === 'string' ? JSON.parse(row['genome']) : row['genome'] as Genome,
    status: row['status'] as CM['status'],
    videos_generated: row['videos_generated'] as number,
    total_views: row['total_views'] as number,
    total_likes: row['total_likes'] as number,
    total_comments: row['total_comments'] as number,
    avg_views: row['avg_views'] as number,
    best_video_views: row['best_video_views'] as number,
    created_at: row['created_at'] as string,
    died_at: row['died_at'] as string | undefined,
    death_reason: row['death_reason'] as string | undefined,
  }
}

export function selectCM(cms: CM[]): CM {
  if (cms.length === 0) throw new Error('No active CMs available')
  const weights = cms.map(cm => Math.max(cm.avg_views, 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let rand = Math.random() * total
  for (let i = 0; i < cms.length; i++) {
    rand -= weights[i]!
    if (rand <= 0) return cms[i]!
  }
  return cms[cms.length - 1]!
}

export function evaluatePopulation(
  cms: CM[],
  opts: {
    gracePeriodVideos?: number
    minPopulation?: number
    maxPopulation?: number
    killThreshold?: number
    reproduceThreshold?: number
  } = {}
): {
  toKill: CM[]
  toReproduce: { parent: CM; childGenome: Genome; childId: string }[]
} {
  const {
    gracePeriodVideos = 5,
    minPopulation = 2,
    maxPopulation = 8,
    killThreshold = 0.30,
    reproduceThreshold = 1.50,
  } = opts

  const active = cms.filter(cm => cm.status !== 'dead')
  if (active.length === 0) return { toKill: [], toReproduce: [] }

  const totalViews = active.reduce((s, cm) => s + cm.avg_views, 0)
  const populationAvg = totalViews / active.length

  const toKill: CM[] = []
  const toReproduce: { parent: CM; childGenome: Genome; childId: string }[] = []

  for (const cm of active) {
    if (cm.videos_generated < gracePeriodVideos) continue

    if (cm.avg_views < populationAvg * killThreshold) {
      if (active.length - toKill.length > minPopulation) {
        toKill.push(cm)
      }
    } else if (cm.avg_views > populationAvg * reproduceThreshold) {
      if (active.length + toReproduce.length < maxPopulation) {
        const highPerformers = active.filter(c => c.avg_views > populationAvg)
        let childGenome: Genome
        if (highPerformers.length > 1 && Math.random() > 0.5) {
          const partner = highPerformers.find(c => c.id !== cm.id) ?? cm
          childGenome = crossoverGenomes(cm.genome, partner.genome)
        } else {
          childGenome = mutateGenome(cm.genome)
        }
        toReproduce.push({
          parent: cm,
          childGenome,
          childId: `cm-${nanoid(8)}`,
        })
      }
    }
  }

  return { toKill, toReproduce }
}

export function createInitialPopulation(size = 3, voices: string[] = VOICES): Array<{
  id: string; generation: number; genome: Genome
}> {
  return Array.from({ length: size }, () => ({
    id: `cm-${nanoid(8)}`,
    generation: 1,
    genome: randomGenome(voices),
  }))
}

export function seedInitialPopulation(db: Database.Database): void {
  const existing = getAllActiveCMs(db)
  if (existing.length > 0) return

  const initial = createInitialPopulation(3)
  for (const cm of initial) {
    insertCM(db, {
      id: cm.id,
      generation: 1,
      genome: JSON.stringify(cm.genome),
      status: 'active',
    })
  }
}
