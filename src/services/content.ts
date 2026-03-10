import { invokeClaude } from '../lib/claude.js'
import type { RedditPost, CM } from '../types/index.js'

export interface GeneratedContent {
  script: string
  caption: string
  hashtags: string
}

function getHookInstructions(style: string): string {
  const map: Record<string, string> = {
    pregunta: 'Arrancar con una pregunta que genere curiosidad. Ejemplos: "¿Sabias que...?", "¿Por que...?", "¿Que pasaria si...?"',
    dato_impactante: 'Arrancar con el dato mas impactante directo, sin introduccion. Que sea tipo wow.',
    negacion: 'Arrancar negando algo que la gente cree. Ejemplo: "Todo lo que te ensenaron sobre X esta mal."',
    numero: 'Arrancar con un numero o estadistica. Ejemplo: "El 97% de la gente no sabe que..."',
    historia: 'Arrancar como narrativa. Ejemplo: "En 1987, un cientifico descubrio algo inesperado..."',
  }
  return map[style] ?? map.pregunta
}

function getStructureInstructions(structure: string): string {
  const map: Record<string, string> = {
    'hook-desarrollo-cierre': 'Hook impactante → 3-4 oraciones de desarrollo → cierre',
    '3-datos-rapidos': 'Tres datos cortos y rapidos sobre el mismo tema, sin desarrollo largo',
    'historia-corta': 'Narrativa con personaje, contexto, tension y resolucion',
    'pregunta-respuesta': 'Plantear la pregunta → construir la respuesta gradualmente',
  }
  return map[structure] ?? map['hook-desarrollo-cierre']
}

function getClosingInstructions(style: string): string {
  const map: Record<string, string> = {
    pregunta_comentarios: 'Terminar con una pregunta para generar comentarios. Ejemplo: "¿Vos lo sabias?"',
    call_to_follow: 'Terminar invitando a seguir para mas datos. Ejemplo: "Seguime para mas curiosidades asi."',
    dato_bonus: 'Terminar con un dato extra sorprendente relacionado.',
    cliffhanger: 'Terminar en suspenso, insinuando que hay mas. "Y eso no es todo..."',
  }
  return map[style] ?? map.pregunta_comentarios
}

export function buildPrompt(post: RedditPost, cm: CM): string {
  const g = cm.genome
  const content = post.top_comment || post.selftext || post.title
  return `Sos un guionista de datos curiosos para TikTok. Tu estilo es: ${g.toneInstructions}

POST DE REDDIT:
Titulo: ${post.title}
Contenido: ${content}
Subreddit: r/${post.subreddit}

REGLAS:
1. El output es SOLO el guion narrado. Sin titulos ni markdown.
2. Idioma: espanol latinoamericano neutro. Usar "tu", no "vos". Vocabulario neutro.
3. Duracion target: ${g.wordCountTarget} palabras.
4. Hook: ${getHookInstructions(g.hookStyle)}
5. Estructura: ${getStructureInstructions(g.scriptStructure)}
6. Cierre: ${getClosingInstructions(g.closingStyle)}
7. NO copiar el texto original. Reescribir completamente.
8. Usar "..." para pausas naturales.
9. Sin emojis en el guion.
10. Si el dato es dudoso, agregar "segun estudios" o "se estima que".

TAMBIEN genera (separado del guion con ---):
- caption: 1-2 oraciones para la descripcion del video (con emojis)
- hashtags: ${g.hashtagCount} hashtags relevantes empezando con #datoscuriosos #curiosidades #sabíasque`
}

export function parseOutput(raw: string): GeneratedContent {
  const parts = raw.split(/^---$/m)
  const script = parts[0].trim()
  let caption = ''
  let hashtags = ''

  if (parts.length > 1) {
    const meta = parts[1]
    const captionMatch = meta.match(/^caption:\s*(.+)$/m)
    const hashtagsMatch = meta.match(/^hashtags:\s*(.+)$/m)
    caption = captionMatch?.[1]?.trim() ?? ''
    hashtags = hashtagsMatch?.[1]?.trim() ?? ''
  }

  if (!caption) caption = script.slice(0, 100) + '...'
  if (!hashtags) hashtags = '#datoscuriosos #curiosidades #sabíasque #fyp #parati'

  return { script, caption, hashtags }
}

export async function generateContent(post: RedditPost, cm: CM): Promise<GeneratedContent> {
  const prompt = buildPrompt(post, cm)
  const raw = await invokeClaude(prompt)
  return parseOutput(raw)
}
