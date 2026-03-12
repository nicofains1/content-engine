// Wrapper for claude -p CLI invocations
// All functions use the authenticated claude CLI (OAuth), never ANTHROPIC_API_KEY.
import { spawn } from 'child_process'
import { readFileSync } from 'fs'

const CLAUDE_PATH = process.env.CLAUDE_PATH ?? '/Users/nfainstein/.local/bin/claude'
// Strip CLAUDECODE env var to allow spawning claude CLI from within a Claude Code session
const { CLAUDECODE: _, ...cleanEnv } = process.env
const CLAUDE_ENV = { ...cleanEnv, PATH: `${process.env.PATH}:/Users/nfainstein/.local/bin:/usr/local/bin` }

export async function invokeClaude(prompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_PATH, ['-p', '--output-format', 'text'], {
      timeout: timeoutMs,
      env: CLAUDE_ENV,
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
  _model = 'claude-sonnet-4-6',
  timeoutMs = 60_000,
): Promise<string> {
  // Delegate to CLI-based invokeClaude (model selection handled by CLI config)
  return invokeClaude(prompt, timeoutMs)
}

export async function invokeClaudeVision(
  prompt: string,
  imagePaths: string[],
  _model = 'claude-haiku-4-5-20251001',
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      CLAUDE_PATH,
      ['-p', '--verbose', '--output-format', 'stream-json', '--input-format', 'stream-json'],
      { timeout: timeoutMs, env: CLAUDE_ENV },
    )

    // Build multimodal content blocks: images as base64 + text prompt
    const contentBlocks: Array<Record<string, unknown>> = []
    for (const imgPath of imagePaths) {
      const data = readFileSync(imgPath).toString('base64')
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data },
      })
    }
    contentBlocks.push({ type: 'text', text: prompt })

    // stream-json format: newline-delimited JSON messages on stdin
    const msg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks,
      },
    })
    proc.stdin.write(msg + '\n')
    proc.stdin.end()

    let output = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude vision exited with code ${code}: ${stderr.slice(0, 500)}`))
        return
      }
      // Parse stream-json output: newline-delimited JSON, extract assistant result text
      const text = parseStreamJsonOutput(output)
      if (text) {
        resolve(text)
      } else {
        reject(new Error('claude vision returned empty output'))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Parse stream-json output from claude CLI.
 * Output is newline-delimited JSON. We look for the result message.
 */
function parseStreamJsonOutput(raw: string): string {
  const lines = raw.split('\n').filter(l => l.trim())
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as Record<string, unknown>
      // The result message has type "result" and contains the response
      if (msg.type === 'result' && typeof msg.result === 'string') {
        return msg.result.trim()
      }
      // Handle {type: "assistant", message: {content: [{type: "text", text: "..."}]}}
      if (msg.type === 'assistant' && msg.message) {
        const m = msg.message as Record<string, unknown>
        if (typeof m.content === 'string') return m.content.trim()
        if (Array.isArray(m.content)) {
          const text = (m.content as Array<Record<string, unknown>>)
            .filter(b => b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text as string)
            .join('')
          if (text.trim()) return text.trim()
        }
      }
    } catch { /* skip non-JSON lines */ }
  }
  // Fallback: return raw output
  return raw.trim()
}
