// Wrapper for claude -p CLI invocations
import { spawn } from 'child_process'
import { readFileSync } from 'fs'

export async function invokeClaude(prompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudePath = process.env.CLAUDE_PATH ?? '/Users/nfainstein/.local/bin/claude'
    const proc = spawn(claudePath, ['-p', '--output-format', 'text'], {
      timeout: timeoutMs,
      env: { ...process.env, PATH: `${process.env.PATH}:/Users/nfainstein/.local/bin:/usr/local/bin` },
    })

    proc.stdin.write(prompt)
    proc.stdin.end()

    let output = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim())
      } else if (code === 0 && !output.trim()) {
        reject(new Error('claude -p returned empty output (tool-only response)'))
      } else {
        reject(new Error(`claude -p exited with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })

    proc.on('error', reject)
  })
}

export async function invokeClaudeText(
  prompt: string,
  model = 'claude-sonnet-4-6',
  timeoutMs = 60_000,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Claude API calls')
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Anthropic API error ${resp.status}: ${body.slice(0, 300)}`)
  }

  const json = (await resp.json()) as { content: Array<{ type: string; text?: string }> }
  const text = json.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  if (!text.trim()) throw new Error('Claude returned empty response')
  return text.trim()
}

export async function invokeClaudeVision(
  prompt: string,
  imagePaths: string[],
  model = 'claude-haiku-4-5-20251001',
  timeoutMs = 30_000,
): Promise<string> {
  // Build multimodal content: images as base64 + text prompt
  const content: Array<Record<string, unknown>> = []
  for (const imgPath of imagePaths) {
    const data = readFileSync(imgPath).toString('base64')
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    })
  }
  content.push({ type: 'text', text: prompt })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for vision eval')
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Anthropic API error ${resp.status}: ${body.slice(0, 300)}`)
  }

  const json = (await resp.json()) as { content: Array<{ type: string; text?: string }> }
  const text = json.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  if (!text.trim()) throw new Error('Vision eval returned empty response')
  return text.trim()
}
