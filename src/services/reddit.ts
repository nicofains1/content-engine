import type { Config, RedditPost } from '../types/index.js'

const ASK_SUBREDDITS = new Set(['explainlikeimfive', 'AskScience', 'AskHistorians'])
const USER_AGENT = 'content-engine/1.0 (by /u/content_engine_bot)'

async function fetchWithRetry(url: string, retries = 1): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 60_000))
    return fetchWithRetry(url, retries - 1)
  }
  return res
}

async function getTopComment(subreddit: string, postId: string): Promise<string | undefined> {
  const res = await fetchWithRetry(`https://www.reddit.com/r/${subreddit}/comments/${postId}.json?sort=top&limit=1`)
  if (!res.ok) return undefined
  try {
    const data = await res.json() as unknown[]
    const comments = (data[1] as { data: { children: Array<{ data: { body: string; score: number } }> } }).data.children
    return comments[0]?.data?.body
  } catch { return undefined }
}

export async function fetchTopPosts(config: Config, subreddit: string, limit = 25): Promise<RedditPost[]> {
  const res = await fetchWithRetry(`https://www.reddit.com/r/${subreddit}/top.json?t=week&limit=${limit}`)
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
      post.top_comment = await getTopComment(subreddit, post.id)
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
