// Wrapper for claude -p CLI invocations
import { spawn } from 'child_process'

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
