import type { Config, RedditPost } from '../types/index.js'

interface RedditToken {
  access_token: string
  expires_at: number
}

let cachedToken: RedditToken | null = null

const ASK_SUBREDDITS = new Set(['explainlikeimfive', 'AskScience', 'AskHistorians'])

async function getToken(config: Config['reddit']): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) return cachedToken.access_token
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': config.userAgent },
    body: `grant_type=password&username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`,
  })
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + (data.expires_in - 60) * 1000 }
  return cachedToken.access_token
}

async function fetchWithRetry(url: string, headers: Record<string, string>, retries = 1): Promise<Response> {
  const res = await fetch(url, { headers })
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 60_000))
    return fetchWithRetry(url, headers, retries - 1)
  }
  return res
}

async function getTopComment(token: string, subreddit: string, postId: string, userAgent: string): Promise<string | undefined> {
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': userAgent }
  const res = await fetchWithRetry(`https://oauth.reddit.com/r/${subreddit}/comments/${postId}?sort=top&limit=1`, headers)
  if (!res.ok) return undefined
  const data = await res.json() as unknown[]
  try {
    const comments = (data[1] as { data: { children: Array<{ data: { body: string; score: number } }> } }).data.children
    return comments[0]?.data?.body
  } catch { return undefined }
}

export async function fetchTopPosts(config: Config, subreddit: string, limit = 25): Promise<RedditPost[]> {
  const token = await getToken(config.reddit)
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': config.reddit.userAgent }
  const res = await fetchWithRetry(`https://oauth.reddit.com/r/${subreddit}/top?t=week&limit=${limit}`, headers)
  if (!res.ok) throw new Error(`Reddit fetch failed for r/${subreddit}: ${res.status}`)
  const data = await res.json() as { data: { children: Array<{ data: Record<string, unknown> }> } }
  const posts: RedditPost[] = []
  for (const child of data.data.children) {
    const p = child.data
    if ((p.score as number) < config.content.minRedditScore) continue
    if ((p.upvote_ratio as number) < config.content.minUpvoteRatio) continue
    if (p.over_18 || p.stickied) continue
    const post: RedditPost = {
      id: p.id as string, subreddit, title: p.title as string,
      selftext: p.selftext as string, score: p.score as number,
      upvote_ratio: p.upvote_ratio as number, url: p.url as string,
      over_18: p.over_18 as boolean, stickied: p.stickied as boolean,
    }
    if (ASK_SUBREDDITS.has(subreddit)) {
      post.top_comment = await getTopComment(token, subreddit, post.id, config.reddit.userAgent)
    }
    posts.push(post)
  }
  return posts
}

export async function fetchAllCandidates(config: Config, processedIds: Set<string>): Promise<RedditPost[]> {
  const all: RedditPost[] = []
  for (const subreddit of config.subreddits) {
    try {
      const posts = await fetchTopPosts(config, subreddit)
      for (const p of posts) {
        if (!processedIds.has(p.id)) all.push(p)
      }
    } catch (err) {
      console.error(`Failed to fetch r/${subreddit}:`, err)
    }
  }
  return all.sort((a, b) => b.score - a.score)
}
