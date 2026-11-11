#!/usr/bin/env node
/**
 * MCP stdio bridge: speaks the Model Context Protocol on stdin/stdout and forwards every call to
 * the running file manager over its loopback API (docs/MCP.md). No logic of its own beyond the
 * protocol, so the agent always sees what the app itself can do.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const cfgPath = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'max-file-manager',
  'mcp.json'
)

function config() {
  try {
    const c = JSON.parse(readFileSync(cfgPath, 'utf8'))
    return { port: Number(c.port) || 47321, token: String(c.token || '') }
  } catch {
    return null
  }
}

async function call(tool, args) {
  const c = config()
  if (!c || !c.token) {
    throw new Error(`no token in ${cfgPath} — enable the agent API in the app first`)
  }
  const res = await fetch(`http://127.0.0.1:${c.port}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ tool, args: args ?? {} })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body.result
}

async function tools() {
  const c = config()
  if (!c) return []
  try {
    const res = await fetch(`http://127.0.0.1:${c.port}/tools`, {
      headers: { authorization: `Bearer ${c.token}` }
    })
    const body = await res.json()
    return body.tools ?? []
  } catch {
    return []
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

const schemaOf = (input) => ({
  type: 'object',
  properties: Object.fromEntries(
    Object.entries(input).map(([k, v]) => [
      k,
      { type: v.replace('?', '') === 'string[]' ? 'array' : v.replace('?', ''), items: { type: 'string' } }
    ])
  ),
  required: Object.entries(input)
    .filter(([, v]) => !v.endsWith('?'))
    .map(([k]) => k)
})

async function handle(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'max-file-manager', version: '1.0.0' }
        }
      })
    }
    if (method === 'tools/list') {
      const list = await tools()
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: list.map((t) => ({
            name: t.name,
            description: `${t.description}${t.read ? '' : ' (needs read-write mode)'}`,
            inputSchema: schemaOf(t.input ?? {})
          }))
        }
      })
    }
    if (method === 'tools/call') {
      const name = params?.name
      const args = params?.arguments ?? {}
      const result = await call(name, args)
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      })
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method && method.startsWith('notifications/')) return
    if (id !== undefined) {
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } })
    }
  } catch (e) {
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e.message || e) } })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (line) void handle(line)
  }
})
