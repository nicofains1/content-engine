import { google } from 'googleapis'
import { createReadStream } from 'fs'
import type { Config } from '../types/index.js'

export interface YouTubeUploadResult {
  id: string
  url: string
}

function createOAuth2Client(config: Config['youtube']) {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret)
  auth.setCredentials({ refresh_token: config.refreshToken })
  return auth
}

export async function uploadShort(
  config: Config,
  videoPath: string,
  title: string,
  description: string
): Promise<YouTubeUploadResult> {
  const auth = createOAuth2Client(config.youtube)
  const youtube = google.youtube({ version: 'v3', auth })

  const shortTitle = title.length > 90 ? title.slice(0, 87) + '...' : title
  const fullTitle = `${shortTitle} #Shorts`

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: fullTitle,
        description,
        categoryId: '22',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: createReadStream(videoPath),
    },
  })

  const id = res.data.id!
  return { id, url: `https://youtube.com/shorts/${id}` }
}

export async function getVideoStats(
  config: Config,
  videoIds: string[]
): Promise<Map<string, { views: number; likes: number; comments: number }>> {
  const auth = createOAuth2Client(config.youtube)
  const youtube = google.youtube({ version: 'v3', auth })
  const stats = new Map<string, { views: number; likes: number; comments: number }>()

  // Batch in chunks of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50)
    const res = await youtube.videos.list({
      part: ['statistics'],
      id: chunk,
    })

    for (const item of res.data.items ?? []) {
      if (!item.id) continue
      stats.set(item.id, {
        views: parseInt(item.statistics?.viewCount ?? '0'),
        likes: parseInt(item.statistics?.likeCount ?? '0'),
        comments: parseInt(item.statistics?.commentCount ?? '0'),
      })
    }
  }

  return stats
}
