import type { CM, Genome } from '../types/index.js'

export type { CM, Genome }

export const INITIAL_CMS: Array<{ id: string; name: string; genome: Genome }> = [
  {
    id: 'cm_alpha', name: 'El Profesor',
    genome: {
      hookStyle: 'pregunta',
      toneInstructions: 'Tono educativo pero accesible. Como un profesor explicando algo en el recreo. Usa preguntas retoricas.',
      scriptStructure: 'hook-desarrollo-cierre',
      wordCountTarget: 150, closingStyle: 'pregunta_comentarios',
      voice: 'es-MX-JorgeNeural', speechRate: '+0%', musicVolume: 0.12,
      subtitleStyle: 'karaoke_grande', subtitleColor: '#FFFFFF', subtitlePosition: 'abajo',
      backgroundPreference: 'espacio', preferredSubreddits: [], minRedditScore: 5000,
      captionStyle: 'minimal', hashtagCount: 10,
    },
  },
  {
    id: 'cm_beta', name: 'El Impactante',
    genome: {
      hookStyle: 'dato_impactante',
      toneInstructions: 'Tono dramatico, cada dato suena como una revelacion. Frases cortas. Pausas dramaticas.',
      scriptStructure: 'hook-desarrollo-cierre',
      wordCountTarget: 120, closingStyle: 'dato_bonus',
      voice: 'es-AR-TomasNeural', speechRate: '+5%', musicVolume: 0.10,
      subtitleStyle: 'karaoke_grande', subtitleColor: '#FFFF00', subtitlePosition: 'abajo',
      backgroundPreference: 'abstract', preferredSubreddits: [], minRedditScore: 5000,
      captionStyle: 'emoji_heavy', hashtagCount: 12,
    },
  },
  {
    id: 'cm_gamma', name: 'El Rapido',
    genome: {
      hookStyle: 'numero',
      toneInstructions: 'Directo al grano. Sin rodeos. Ritmo rapido. Dato, explicacion corta, siguiente.',
      scriptStructure: '3-datos-rapidos',
      wordCountTarget: 90, closingStyle: 'call_to_follow',
      voice: 'es-MX-JorgeNeural', speechRate: '+10%', musicVolume: 0.10,
      subtitleStyle: 'karaoke_chico', subtitleColor: '#00FF00', subtitlePosition: 'abajo',
      backgroundPreference: 'random', preferredSubreddits: [], minRedditScore: 5000,
      captionStyle: 'controversial', hashtagCount: 8,
    },
  },
  {
    id: 'cm_delta', name: 'El Storyteller',
    genome: {
      hookStyle: 'historia',
      toneInstructions: 'Cuenta el dato como una historia. Personajes, contexto, tension, resolucion.',
      scriptStructure: 'historia-corta',
      wordCountTarget: 180, closingStyle: 'cliffhanger',
      voice: 'es-AR-TomasNeural', speechRate: '-5%', musicVolume: 0.12,
      subtitleStyle: 'linea_completa', subtitleColor: '#FFFFFF', subtitlePosition: 'abajo',
      backgroundPreference: 'naturaleza', preferredSubreddits: [], minRedditScore: 5000,
      captionStyle: 'pregunta', hashtagCount: 10,
    },
  },
  {
    id: 'cm_epsilon', name: 'El Negador',
    genome: {
      hookStyle: 'negacion',
      toneInstructions: 'Arranca negando algo que la gente cree. Provocador pero con datos reales. Tono de revelacion.',
      scriptStructure: 'hook-desarrollo-cierre',
      wordCountTarget: 130, closingStyle: 'pregunta_comentarios',
      voice: 'es-MX-JorgeNeural', speechRate: '+0%', musicVolume: 0.12,
      subtitleStyle: 'karaoke_grande', subtitleColor: '#FF4444', subtitlePosition: 'abajo',
      backgroundPreference: 'abstract', preferredSubreddits: [], minRedditScore: 5000,
      captionStyle: 'controversial', hashtagCount: 10,
    },
  },
]
