/**
 * dsh-acp-hub v0.6.0
 *
 * Observable ACP delegation hub for DeepSeek Harness:
 * - Configurable same-session continuation (`allowResume`: strict clean-slate isolation when off;
 *   autonomous per-task continuation vs fresh-session judgment when on, plus direct follow-up inside
 *   `session-acp-*` child panes).
 * - Exact per-step & per-turn DSH `TurnUsagePanel` + `SessionProjectionCache` accounting
 *   (`uncachedInputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`, `reasoningTokens`,
 *   `request/context` `contextWindow`) with ZCode & MiniMax SQLite per-step attribution and parallel tool-call safety.
 * - Dynamic multi-source session MCP discovery (live DSH Host Loader + `cordis.patch.yml` + 7-family
 *   per-agent native MCP configs) with strict secret redaction and native-enabled lock & skip linkage.
 * - Collapsible low-frequency launch drawer + unified POSIX `commandLine` parser, `Magpie.app` native
 *   desktop launcher, and 4-layer DSH upgrade hardening (`safeAppendEvent`, `DockErrorBoundary`,
 *   relaxed `engines.dsh`, and `runHostContractSmokeTest`).
 */
import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { createConnection } from 'node:net'
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { client as createAcpClientApp, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

export const name = 'acp-hub'
export const inject = ['tools', 'sessions', 'subprocess', 'connection', 'commands']

const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/
const ZCODE_SESSION_ID_RE = /^sess_[A-Za-z0-9_-]+$/
const MINIMAX_SESSION_ID_RE = /^mvs_[A-Za-z0-9_-]+$/
const RESERVED_TOOL_NAMES = new Set([
  'read', 'write', 'edit', 'bash', 'glob', 'grep', 'subagent', 'subagent_fork',
  'delegate_acp', 'list_acp_agents', 'acp-stop', 'list_roster_agents', 'delegate_to_roster_agent',
])
const MAX_STORED_SESSIONS = 300

const REASONING_CONFIG_IDS = new Set([
  'reasoning_effort',
  'thinkingEffort',
  'reasoningEffort',
  'thought_level',
  'effort',
])

const MODE_CONFIG_IDS = new Set([
  'mode',
  'permissionMode',
  'approval_policy',
  'approvalMode',
])

const text = value => [{ type: 'text', text: String(value ?? '') }]
const makeId = prefix => `${prefix}-${randomUUID()}`

function dshHomeRoot() {
  const home = process.env.DSH_HOME?.trim()
  return home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh')
}

function hubSettingsPath() {
  return join(dshHomeRoot(), 'acp-hub.json')
}

function legacyMirrorSettingsPath() {
  return join(dshHomeRoot(), 'acp-mirror.json')
}

function hubSessionsPath() {
  return join(dshHomeRoot(), 'acp-hub-sessions.json')
}

function legacyMirrorSessionsPath() {
  return join(dshHomeRoot(), 'acp-mirror-sessions.json')
}

function atomicWriteJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, filePath)
}

function readJsonSafe(filePath, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readJsonBody(request) {
  try {
    return JSON.parse(await request.text())
  } catch {
    return {}
  }
}

/* -------------------------------------------------------------------------- */
/* Rich PATH & Executable Discovery                                           */
/* -------------------------------------------------------------------------- */

function candidateBinDirs() {
  const home = homedir()
  const dirs = [
    join(home, 'agentrelay'),
    join(home, '.minimax-code', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  const nvmDir = join(home, '.nvm', 'versions', 'node')
  try {
    if (existsSync(nvmDir)) {
      const versions = readdirSync(nvmDir).sort().reverse()
      for (const ver of versions) {
        dirs.push(join(nvmDir, ver, 'bin'))
      }
    }
  } catch {}
  const envPath = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const entry of envPath) {
    if (!dirs.includes(entry)) dirs.push(entry)
  }
  return dirs
}

function buildRichEnv(extraEnv = {}) {
  const richPath = candidateBinDirs().join(':')
  return {
    ...process.env,
    PATH: richPath,
    ...extraEnv,
  }
}

function isExecutableFile(filePath) {
  try {
    const st = statSync(filePath)
    if (!st.isFile()) return false
    accessSync(filePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function expandHome(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return ''
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

function resolveExecutable(command) {
  const expanded = expandHome(command)
  if (!expanded) return null
  if (expanded.includes('/')) {
    return isExecutableFile(expanded) ? expanded : null
  }
  for (const dir of candidateBinDirs()) {
    const full = join(dir, expanded)
    if (isExecutableFile(full)) return full
  }
  return null
}

export function parseCommandLine(raw) {
  const str = String(raw ?? '')
  const tokens = []
  let cur = ''
  let inToken = false
  let quote = null

  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i]
    if (quote === "'") {
      if (ch === "'") {
        quote = null
      } else {
        cur += ch
      }
    } else if (quote === '"') {
      if (ch === '"') {
        quote = null
      } else if (ch === '\\') {
        if (i + 1 < str.length) {
          const next = str[i + 1]
          if (next === '"' || next === '\\') {
            cur += next
            i += 1
          } else {
            cur += '\\' + next
            i += 1
          }
        } else {
          cur += '\\'
        }
      } else {
        cur += ch
      }
    } else if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(cur)
        cur = ''
        inToken = false
      }
    } else if (ch === "'" || ch === '"') {
      inToken = true
      quote = ch
    } else if (ch === '\\') {
      inToken = true
      if (i + 1 < str.length) {
        cur += str[i + 1]
        i += 1
      } else {
        cur += '\\'
      }
    } else {
      inToken = true
      cur += ch
    }
  }

  if (inToken) {
    tokens.push(cur)
  }

  return {
    command: tokens[0] ?? '',
    args: tokens.slice(1),
  }
}

export function formatCommandLine(command, args = []) {
  const cmd = String(command ?? '').trim()
  if (!cmd) return ''
  const quoteToken = (tok) => {
    const s = String(tok ?? '')
    if (s.length === 0 || /[\s"'\\]/.test(s)) {
      return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    }
    return s
  }
  const list = Array.isArray(args) ? args : []
  return [quoteToken(cmd), ...list.map(quoteToken)].join(' ')
}

/* -------------------------------------------------------------------------- */
/* Built-in ACP Presets & Brand Icon Resolution                               */
/* -------------------------------------------------------------------------- */

const PRESET_TEMPLATES = [
  {
    id: 'zcode',
    name: 'ZCode',
    iconKey: 'zcode',
    candidates: [join(homedir(), 'agentrelay', 'zcode-acp'), 'zcode-acp'],
    args: [],
    permission: 'allow',
    whenToUse: '跨仓库深度检索、复杂实现对照或调用 ZCode 独立工具链执行子任务。',
    loginHint: '请先在 ZCode 客户端登录，本地桥会自动复用现有登录态。',
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    iconKey: 'minimax',
    candidates: [join(homedir(), '.minimax-code', 'bin', 'mcode'), 'mcode'],
    args: ['acp'],
    permission: 'allow',
    whenToUse: '异构模型交叉评审（方案/代码多轮 Review）、独立视角排查或委派 MiniMax Code。',
    loginHint: '若提示未登录，请在终端执行 mcode login。',
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    iconKey: 'codebuddy',
    candidates: ['codebuddy'],
    args: ['--acp'],
    permission: 'allow',
    whenToUse: '委派给腾讯 CodeBuddy / WorkBuddy CLI 独立执行或审查任务。',
    loginHint: '首次使用请在终端运行 codebuddy 完成登录。',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    iconKey: 'opencode',
    candidates: [join(homedir(), '.opencode', 'bin', 'opencode'), 'opencode'],
    args: ['acp'],
    permission: 'allow',
    whenToUse: '调用 OpenCode CLI 及其本地配置的工具链独立完成任务。',
    loginHint: '使用 ~/.config/opencode/opencode.json 中的模型与供应商配置。',
  },
  {
    id: 'codex',
    name: 'Codex',
    iconKey: 'codex',
    candidates: ['codex-acp'],
    args: [],
    permission: 'allow',
    whenToUse: '委派给 OpenAI Codex ACP 执行高难度代码分析、重构或严格推理审查。',
    loginHint: '请在终端运行 codex login 确保认证有效。',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    iconKey: 'claude-code',
    candidates: ['claude-agent-acp'],
    args: [],
    permission: 'allow',
    whenToUse: '委派给 Claude Code ACP 执行独立编码或评审任务。',
    loginHint: '请在终端运行 claude 确保认证有效。',
  },
  {
    id: 'qoder',
    name: 'Qoder',
    iconKey: 'qoder',
    candidates: ['qodercli'],
    args: ['--acp'],
    permission: 'allow',
    whenToUse: '委派给 Qoder CLI 执行独立任务。',
    loginHint: '请确认 qodercli 已安装并登录。',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    iconKey: 'gemini-cli',
    candidates: ['gemini'],
    args: ['--acp'],
    permission: 'allow',
    whenToUse: '委派给 Gemini CLI 执行长上下文检索或分析任务。',
    loginHint: '请在终端运行 gemini 完成认证。',
  },
]

const ICON_FILES = {
  zcode: { file: 'zcode.svg', mime: 'image/svg+xml' },
  minimax: { file: 'minimax.png', mime: 'image/png' },
  mcode: { file: 'minimax.png', mime: 'image/png' },
  codebuddy: { file: 'codebuddy.svg', mime: 'image/svg+xml' },
  workbuddy: { file: 'codebuddy.svg', mime: 'image/svg+xml' },
  codex: { file: 'codex.svg', mime: 'image/svg+xml' },
  claude: { file: 'claude-code.svg', mime: 'image/svg+xml' },
  'claude-code': { file: 'claude-code.svg', mime: 'image/svg+xml' },
  opencode: { file: 'opencode.svg', mime: 'image/svg+xml' },
  gemini: { file: 'gemini-cli.svg', mime: 'image/svg+xml' },
  'gemini-cli': { file: 'gemini-cli.svg', mime: 'image/svg+xml' },
  antigravity: { file: 'google-antigravity.svg', mime: 'image/svg+xml' },
  qoder: { file: 'qoder.svg', mime: 'image/svg+xml' },
  kimi: { file: 'kimi-code.svg', mime: 'image/svg+xml' },
}

function inferClientFamily(agentId, spec) {
  const hay = `${agentId ?? ''} ${basename(spec?.command ?? '')} ${spec?.name ?? ''}`.toLowerCase()
  if (hay.includes('zcode')) return 'zcode'
  if (hay.includes('minimax') || hay.includes('mcode')) return 'minimax'
  if (hay.includes('codebuddy') || hay.includes('workbuddy')) return 'codebuddy'
  if (hay.includes('opencode')) return 'opencode'
  if (hay.includes('codex')) return 'codex'
  if (hay.includes('claude')) return 'claude'
  if (hay.includes('qoder')) return 'qoder'
  if (hay.includes('gemini')) return 'gemini'
  if (hay.includes('antigravity') || hay.includes('agy')) return 'antigravity'
  if (hay.includes('kimi')) return 'kimi'
  return 'generic'
}

function monogramSvg(label) {
  const clean = String(label || 'A').trim()
  const glyph = (clean[0] || 'A').toUpperCase()
  const palette = ['#2563EB', '#0891B2', '#7C3AED', '#059669', '#D97706', '#DB2777']
  let hash = 0
  for (let i = 0; i < clean.length; i += 1) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0
  const color = palette[hash % palette.length]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7.2" fill="${color}"/>
    <text x="16" y="21.5" text-anchor="middle" font-family="ui-sans-serif,-apple-system,BlinkMacSystemFont,sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">${glyph}</text>
  </svg>`
}

function serveAgentIcon(agentId, agentsMap) {
  const spec = agentsMap.get(agentId)
  const family = inferClientFamily(agentId, spec)
  const entry = ICON_FILES[agentId] ?? ICON_FILES[family]
  if (entry) {
    try {
      const bytes = readFileSync(new URL(`./icons/${entry.file}`, import.meta.url))
      return new Response(bytes, {
        headers: { 'content-type': entry.mime, 'cache-control': 'public, max-age=300' },
      })
    } catch {}
  }
  return new Response(monogramSvg(spec?.name || agentId || 'A'), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
  })
}

/* -------------------------------------------------------------------------- */
/* Read-Only Live Introspection + True Source Resolution & Jump               */
/* -------------------------------------------------------------------------- */

const CLIENT_APP_CANDIDATES = {
  zcode: [
    { name: 'ZCode', path: '/Applications/ZCode.app' },
  ],
  minimax: [
    { name: 'MiniMax Code', path: '/Applications/MiniMax Code.app' },
  ],
  codebuddy: [
    { name: 'WorkBuddy', path: '/Applications/WorkBuddy.app' },
    { name: 'WorkBuddy AI', path: '/Applications/WorkBuddy AI.app' },
    { name: 'CodeBuddy', path: '/Applications/CodeBuddy.app' },
  ],
  opencode: [
    { name: 'OpenCode', path: '/Applications/OpenCode.app' },
  ],
  qoder: [
    { name: 'Qoder', path: '/Applications/Qoder.app' },
    { name: 'Qoder CN', path: '/Applications/Qoder CN.app' },
    { name: 'Qoder IDE', path: '/Applications/Qoder IDE.app' },
  ],
  antigravity: [
    { name: 'Antigravity', path: '/Applications/Antigravity.app' },
  ],
}

function detectClientApp(family) {
  for (const cand of CLIENT_APP_CANDIDATES[family] ?? []) {
    if (existsSync(cand.path)) return cand
  }
  return null
}

export function detectMagpieApp(candidatesOverride = null) {
  const home = homedir()
  const candidates = Array.isArray(candidatesOverride)
    ? candidatesOverride
    : [
        '/Applications/magpie.app',
        '/Applications/Magpie.app',
        join(home, 'Applications', 'magpie.app'),
        join(home, 'Applications', 'Magpie.app'),
      ]
  for (const appPath of candidates) {
    if (typeof appPath === 'string' && appPath && existsSync(appPath)) {
      return { name: 'Magpie', path: appPath }
    }
  }
  return null
}

function detectPreferredEditorApp() {
  const editors = [
    '/Applications/Visual Studio Code.app',
    '/Applications/Cursor.app',
    '/Applications/Zed.app',
    '/Applications/Sublime Text.app',
  ]
  for (const app of editors) {
    if (existsSync(app)) return app
  }
  return null
}

const SECRET_ARG_FLAG_RE = /^(?:--?(?:api[-_]?key|token|access[-_]?token|refresh[-_]?token|auth(?:[-_]?token)?|secret|client[-_]?secret|password|passwd|credential|bearer|header|cookie)|-H)$/i
const SECRET_ARG_INLINE_RE = /(?:api[-_]?key|token|secret|password|passwd|auth|bearer|cookie|credential)[^=\s]*\s*=/i
const SECRET_VALUE_TOKEN_RE = /^(?:sk-[A-Za-z0-9_-]{6,}|Bearer\s+\S+|Basic\s+\S+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+|AIza[0-9A-Za-z_-]{20,})/i

export function redactUrlForSummary(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return trimmed.split(/[?#]/)[0].replace(/\/\/[^/@]+@/, '//')
  }
}

export function safeTargetSummary(server) {
  if (!server || typeof server !== 'object') return ''
  if (typeof server.url === 'string' && server.url.trim()) {
    return redactUrlForSummary(server.url)
  }
  let rawCmd = ''
  let rawArgs = []
  if (typeof server.command === 'string' && server.command.trim()) {
    rawCmd = server.command.trim()
    rawArgs = Array.isArray(server.args) ? server.args.map(a => String(a ?? '')) : []
  } else if (Array.isArray(server.command) && server.command.length > 0) {
    rawCmd = String(server.command[0] ?? '').trim()
    rawArgs = [
      ...server.command.slice(1).map(a => String(a ?? '')),
      ...(Array.isArray(server.args) ? server.args.map(a => String(a ?? '')) : []),
    ]
  }
  if (!rawCmd) return ''
  const head = basename(rawCmd)
  const safeArgs = []
  for (let i = 0; i < rawArgs.length && safeArgs.length < 2; i += 1) {
    const arg = rawArgs[i].trim()
    if (!arg) continue
    if (SECRET_ARG_FLAG_RE.test(arg)) {
      i += 1
      continue
    }
    if (SECRET_ARG_INLINE_RE.test(arg) || SECRET_VALUE_TOKEN_RE.test(arg)) {
      continue
    }
    if (/^https?:\/\//i.test(arg)) {
      safeArgs.push(redactUrlForSummary(arg))
      continue
    }
    safeArgs.push(arg)
  }
  return `${head}${safeArgs.length ? ` ${safeArgs.join(' ')}` : ''}`
}

function classifyMcpTransport(server) {
  const url = typeof server?.url === 'string' ? server.url : ''
  if (url.includes('127.0.0.1:3425/mcp/magpie')) return 'magpie-hub'
  const rawType = (typeof server?.type === 'string' && server.type.trim())
    ? server.type.trim()
    : ((typeof server?.transport === 'string' && server.transport.trim())
      ? server.transport.trim()
      : ((typeof server?.rawType === 'string' && server.rawType.trim()) ? server.rawType.trim() : ''))
  if (rawType === 'local') return 'stdio'
  if (rawType === 'remote') return 'http'
  if (rawType) return rawType
  if (url) return 'http'
  return 'stdio'
}

function stripUnquotedComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote === "'") {
      if (ch === "'") {
        if (line[i + 1] === "'") i += 1
        else quote = null
      }
    } else if (quote === '"') {
      if (ch === '\\') i += 1
      else if (ch === '"') quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]) || /[,[\]{}]/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd()
    }
  }
  return line
}

function unquoteScalar(raw) {
  const s = stripUnquotedComment(String(raw ?? '')).trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    let out = ''
    const inner = s.slice(1, -1)
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === '\\' && i + 1 < inner.length) {
        const nx = inner[i + 1]
        if (nx === 'n') out += '\n'
        else if (nx === 'r') out += '\r'
        else if (nx === 't') out += '\t'
        else out += nx
        i += 1
      } else {
        out += inner[i]
      }
    }
    return out
  }
  return s
}

function splitTopLevelCommas(inner) {
  const parts = []
  let cur = ''
  let quote = null
  let depth = 0
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (quote === "'") {
      cur += ch
      if (ch === "'") {
        if (inner[i + 1] === "'") { cur += inner[++i] }
        else quote = null
      }
    } else if (quote === '"') {
      cur += ch
      if (ch === '\\' && i + 1 < inner.length) {
        cur += inner[++i]
      } else if (ch === '"') {
        quote = null
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
    } else if (ch === '[' || ch === '{') {
      depth += 1
      cur += ch
    } else if (ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
      cur += ch
    } else if (ch === ',' && depth === 0) {
      if (cur.trim().length > 0) parts.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim().length > 0) parts.push(cur.trim())
  return parts
}

function collectBalancedBlock(lines, startIdx, firstLineText, openChar, closeChar) {
  let idx = startIdx
  let textChunk = stripUnquotedComment(firstLineText).trim()
  if (!textChunk) {
    while (idx + 1 < lines.length) {
      const peek = stripUnquotedComment(lines[idx + 1]).trim()
      if (!peek) { idx += 1; continue }
      if (peek.startsWith(openChar)) {
        idx += 1
        textChunk = peek
      }
      break
    }
  }
  if (!textChunk.startsWith(openChar)) return null

  let buf = ''
  let depth = 0
  let quote = null
  let started = false

  while (idx < lines.length) {
    const seg = idx === startIdx && firstLineText.trim() ? textChunk : stripUnquotedComment(lines[idx])
    for (let k = 0; k < seg.length; k += 1) {
      const ch = seg[k]
      if (quote === "'") {
        if (started) buf += ch
        if (ch === "'") {
          if (seg[k + 1] === "'") {
            if (started) buf += seg[k + 1]
            k += 1
          } else {
            quote = null
          }
        }
      } else if (quote === '"') {
        if (started) buf += ch
        if (ch === '\\' && k + 1 < seg.length) {
          if (started) buf += seg[k + 1]
          k += 1
        } else if (ch === '"') {
          quote = null
        }
      } else if (ch === "'" || ch === '"') {
        quote = ch
        if (started) buf += ch
      } else if (ch === openChar) {
        if (depth === 0) {
          started = true
        } else {
          buf += ch
        }
        depth += 1
      } else if (ch === closeChar) {
        depth -= 1
        if (depth === 0) {
          return { inner: buf, endIdx: idx }
        }
        if (started) buf += ch
      } else if (started) {
        buf += ch
      }
    }
    if (started) buf += '\n'
    idx += 1
  }
  return started ? { inner: buf, endIdx: lines.length - 1 } : null
}

function findUnquotedSeparator(str, sepChar) {
  let quote = null
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i]
    if (quote === "'") {
      if (ch === "'") {
        if (str[i + 1] === "'") i += 1
        else quote = null
      }
    } else if (quote === '"') {
      if (ch === '\\') i += 1
      else if (ch === '"') quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === sepChar) {
      return i
    }
  }
  return -1
}

export function parseCodexTomlMcpRaw(filePath, contentOverride = null) {
  const byName = new Map()
  try {
    const content = typeof contentOverride === 'string' ? contentOverride : readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)
    let current = null
    let subTable = null

    const getOrCreate = (rawName) => {
      const cleanName = unquoteScalar(rawName)
      if (!byName.has(cleanName)) {
        byName.set(cleanName, {
          name: cleanName,
          enabled: true,
          rawType: '',
          command: '',
          args: [],
          env: {},
          url: '',
          headers: {},
          bearerEnvVar: '',
          source: '~/.codex/config.toml',
          sourcePath: filePath,
        })
      }
      return byName.get(cleanName)
    }

    for (let i = 0; i < lines.length; i += 1) {
      const stripped = stripUnquotedComment(lines[i]).trim()
      if (!stripped) continue

      if (stripped.startsWith('[') && stripped.endsWith(']')) {
        const secBody = stripped.slice(1, -1).trim()
        const subMatch = /^mcp_servers\.((?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+))\.(env|headers|http_headers|env_http_headers)$/.exec(secBody)
        if (subMatch) {
          current = getOrCreate(subMatch[1])
          subTable = subMatch[2]
          continue
        }
        const mainMatch = /^mcp_servers\.((?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+))$/.exec(secBody)
        if (mainMatch) {
          current = getOrCreate(mainMatch[1])
          subTable = null
          continue
        }
        current = null
        subTable = null
        continue
      }

      if (!current) continue
      const eqIdx = findUnquotedSeparator(stripped, '=')
      if (eqIdx <= 0) continue
      const key = unquoteScalar(stripped.slice(0, eqIdx))
      const rawVal = stripped.slice(eqIdx + 1).trim()

      if (subTable === 'env') {
        if (key) current.env[key] = unquoteScalar(rawVal)
        continue
      }
      if (subTable === 'headers' || subTable === 'http_headers') {
        if (key) current.headers[key] = unquoteScalar(rawVal)
        continue
      }
      if (subTable === 'env_http_headers') {
        const envName = unquoteScalar(rawVal)
        if (key && envName && typeof process.env[envName] === 'string' && process.env[envName]) {
          current.headers[key] = process.env[envName]
        }
        continue
      }

      if (key === 'args' && rawVal.startsWith('[')) {
        const collected = collectBalancedBlock(lines, i, rawVal, '[', ']')
        if (collected) {
          current.args = splitTopLevelCommas(collected.inner).map(unquoteScalar)
          i = collected.endIdx
        }
      } else if ((key === 'env' || key === 'headers' || key === 'http_headers' || key === 'env_http_headers') && rawVal.startsWith('{')) {
        const collected = collectBalancedBlock(lines, i, rawVal, '{', '}')
        if (collected) {
          for (const pair of splitTopLevelCommas(collected.inner)) {
            const pEq = findUnquotedSeparator(pair, '=')
            if (pEq <= 0) continue
            const pKey = unquoteScalar(pair.slice(0, pEq))
            const pVal = unquoteScalar(pair.slice(pEq + 1))
            if (!pKey) continue
            if (key === 'env') {
              current.env[pKey] = pVal
            } else if (key === 'env_http_headers') {
              if (pVal && typeof process.env[pVal] === 'string' && process.env[pVal]) {
                current.headers[pKey] = process.env[pVal]
              }
            } else {
              current.headers[pKey] = pVal
            }
          }
          i = collected.endIdx
        }
      } else if (key === 'command') {
        current.command = unquoteScalar(rawVal)
      } else if (key === 'url') {
        current.url = unquoteScalar(rawVal)
      } else if (key === 'type' || key === 'transport') {
        current.rawType = unquoteScalar(rawVal)
      } else if (key === 'enabled') {
        current.enabled = unquoteScalar(rawVal).toLowerCase() !== 'false'
      } else if (key === 'disabled') {
        if (unquoteScalar(rawVal).toLowerCase() === 'true') current.enabled = false
      } else if (key === 'bearer_token_env_var') {
        current.bearerEnvVar = unquoteScalar(rawVal)
      }
    }

    for (const item of byName.values()) {
      if (item.bearerEnvVar && !item.headers.Authorization && !item.headers.authorization) {
        const tok = process.env[item.bearerEnvVar]
        if (typeof tok === 'string' && tok.trim()) {
          item.headers.Authorization = `Bearer ${tok.trim()}`
        }
      }
      delete item.bearerEnvVar
    }
  } catch {}
  return Array.from(byName.values())
}

function canonicalMcpConfigSpecs(family, spec = {}, options = {}) {
  const home = options.homeDir || homedir()
  const hay = `${spec?.command ?? ''} ${spec?.name ?? ''}`.toLowerCase()
  const qoderStd = join(home, '.qoder', 'mcp.json')
  const qoderCn = join(home, '.qoder-cn', 'mcp.json')
  const useQoderCn = hay.includes('qoder-cn') || (!existsSync(qoderStd) && existsSync(qoderCn))

  const table = {
    zcode: [{ label: '~/.zcode/cli/config.json', path: join(home, '.zcode', 'cli', 'config.json') }],
    minimax: [{ label: '~/.minimax/mcp.json', path: join(home, '.minimax', 'mcp.json') }],
    codebuddy: [{ label: '~/.codebuddy/.mcp.json', path: join(home, '.codebuddy', '.mcp.json') }],
    opencode: [{ label: '~/.config/opencode/opencode.json', path: join(home, '.config', 'opencode', 'opencode.json') }],
    codex: [{ label: '~/.codex/config.toml', path: join(home, '.codex', 'config.toml') }],
    claude: [{ label: '~/.claude.json', path: join(home, '.claude.json') }],
    qoder: [useQoderCn
      ? { label: '~/.qoder-cn/mcp.json', path: qoderCn }
      : { label: '~/.qoder/mcp.json', path: qoderStd }],
  }
  return (table[family] ?? []).map(item => ({
    ...item,
    exists: existsSync(item.path),
  }))
}

function extractRawJsonServerEntry(id, srv, enabled, sourceLabel, sourcePath) {
  let command = ''
  let args = []
  if (Array.isArray(srv.command) && srv.command.length > 0) {
    command = String(srv.command[0] ?? '').trim()
    args = [
      ...srv.command.slice(1).map(a => String(a ?? '')),
      ...(Array.isArray(srv.args) ? srv.args.map(a => String(a ?? '')) : []),
    ]
  } else if (typeof srv.command === 'string') {
    command = srv.command.trim()
    args = Array.isArray(srv.args) ? srv.args.map(a => String(a ?? '')) : []
  }
  const envRaw = srv.environment && typeof srv.environment === 'object'
    ? srv.environment
    : (srv.env && typeof srv.env === 'object' ? srv.env : {})
  const headersRaw = srv.headers && typeof srv.headers === 'object'
    ? srv.headers
    : (srv.http_headers && typeof srv.http_headers === 'object' ? srv.http_headers : {})
  const rawType = typeof srv.type === 'string' && srv.type.trim()
    ? srv.type.trim()
    : (typeof srv.transport === 'string' && srv.transport.trim() ? srv.transport.trim() : '')
  return {
    name: id,
    enabled: Boolean(enabled),
    rawType,
    command,
    args,
    env: envRaw,
    url: typeof srv.url === 'string' ? srv.url.trim() : '',
    headers: headersRaw,
    description: typeof srv.description === 'string' ? srv.description.slice(0, 120) : '',
    source: sourceLabel,
    sourcePath,
  }
}

export function readRawClientMcpServers(family, spec = {}, options = {}) {
  const rawServers = []
  const configFiles = canonicalMcpConfigSpecs(family, spec, options)
  const primary = configFiles[0]

  if (family === 'zcode' && primary?.exists) {
    const doc = readJsonSafe(primary.path, {})
    const map = doc?.mcp?.servers ?? doc?.mcpServers ?? {}
    for (const [id, srv] of Object.entries(map)) {
      if (!srv || typeof srv !== 'object') continue
      rawServers.push(extractRawJsonServerEntry(
        id,
        srv,
        srv.enabled !== false && srv.disabled !== true,
        primary.label,
        primary.path,
      ))
    }
  } else if (family === 'minimax' && primary?.exists) {
    const doc = readJsonSafe(primary.path, {})
    for (const [id, srv] of Object.entries(doc?.mcpServers ?? {})) {
      if (!srv || typeof srv !== 'object') continue
      rawServers.push(extractRawJsonServerEntry(
        id,
        srv,
        srv.enabled !== false && srv.disabled !== true,
        primary.label,
        primary.path,
      ))
    }
  } else if (family === 'codebuddy' && primary?.exists) {
    const doc = readJsonSafe(primary.path, {})
    const disabled = new Set(Array.isArray(doc?.disabledMcpServers) ? doc.disabledMcpServers : [])
    for (const [id, srv] of Object.entries(doc?.mcpServers ?? {})) {
      if (!srv || typeof srv !== 'object') continue
      rawServers.push(extractRawJsonServerEntry(
        id,
        srv,
        !disabled.has(id) && srv.enabled !== false && srv.disabled !== true,
        primary.label,
        primary.path,
      ))
    }
  } else if (family === 'opencode' && primary?.exists) {
    const doc = readJsonSafe(primary.path, {})
    const mcp = doc?.mcp ?? {}
    for (const [id, srv] of Object.entries(mcp)) {
      if (id === 'servers' && srv && typeof srv === 'object') {
        for (const [subId, subSrv] of Object.entries(srv)) {
          if (!subSrv || typeof subSrv !== 'object') continue
          rawServers.push(extractRawJsonServerEntry(
            subId,
            subSrv,
            subSrv.enabled !== false && subSrv.disabled !== true,
            primary.label,
            primary.path,
          ))
        }
        continue
      }
      if (!srv || typeof srv !== 'object') continue
      rawServers.push(extractRawJsonServerEntry(
        id,
        srv,
        srv.enabled !== false && srv.disabled !== true,
        primary.label,
        primary.path,
      ))
    }
  } else if (family === 'codex' && primary?.exists) {
    rawServers.push(...parseCodexTomlMcpRaw(primary.path).map(item => ({
      ...item,
      source: primary.label,
      sourcePath: primary.path,
    })))
  } else if ((family === 'claude' || family === 'qoder') && primary?.exists) {
    const doc = readJsonSafe(primary.path, {})
    for (const [id, srv] of Object.entries(doc?.mcpServers ?? {})) {
      if (!srv || typeof srv !== 'object') continue
      rawServers.push(extractRawJsonServerEntry(
        id,
        srv,
        srv.disabled !== true && srv.enabled !== false,
        primary.label,
        primary.path,
      ))
    }
  }

  return {
    rawServers,
    configFiles,
  }
}

function inspectNativeMcpServers(family, spec = {}, options = {}) {
  const { rawServers, configFiles } = readRawClientMcpServers(family, spec, options)
  const servers = rawServers.map(raw => ({
    name: raw.name,
    enabled: raw.enabled,
    transport: classifyMcpTransport(raw),
    summary: safeTargetSummary(raw),
    ...(raw.description ? { description: raw.description } : {}),
    source: raw.source,
    sourcePath: raw.sourcePath,
  }))

  return {
    servers,
    configPaths: configFiles.filter(c => c.exists).map(c => c.label),
    configFiles,
  }
}

function readSkillMetaAndSummary(skillDir) {
  const mdPath = join(skillDir, 'SKILL.md')
  try {
    if (!existsSync(mdPath)) return { name: basename(skillDir), description: '' }
    const head = readFileSync(mdPath, 'utf8').slice(0, 2400)
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)
    let parsedName = ''
    let parsedDesc = ''
    if (fm) {
      const lines = fm[1].split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        const trimmed = lines[i].trim()
        if (/^name\s*:/.test(trimmed)) {
          parsedName = trimmed.replace(/^name\s*:\s*/, '').replace(/^["']+|["']+$/g, '').trim()
        } else if (/^description\s*:/.test(trimmed)) {
          const rest = trimmed.replace(/^description\s*:\s*/, '').trim()
          if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
            const chunks = []
            for (let j = i + 1; j < lines.length; j += 1) {
              if (!/^\s+/.test(lines[j])) break
              chunks.push(lines[j].trim())
              i = j
            }
            parsedDesc = chunks.join(' ').trim()
          } else {
            parsedDesc = rest.replace(/^["']+|["']+$/g, '').trim()
          }
        }
      }
    }
    if (!parsedDesc) {
      parsedDesc = head
        .replace(/^---[\s\S]*?---/, '')
        .split('\n')
        .map(line => line.replace(/^#+\s*/, '').trim())
        .find(Boolean) ?? ''
    }
    return {
      name: parsedName || basename(skillDir),
      description: parsedDesc.slice(0, 150),
    }
  } catch {
    return { name: basename(skillDir), description: '' }
  }
}

function isReadableFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function scanValidSkillDir(dirPath, scopeLabel, originType, disabledPaths = new Set(), forceEnabled = null) {
  const items = []
  try {
    if (!existsSync(dirPath)) return items
    for (const entry of readdirSync(dirPath)) {
      if (entry.startsWith('.')) {
        if (entry === '.system') {
          items.push(...scanValidSkillDir(join(dirPath, '.system'), `${scopeLabel}/.system`, 'builtin', disabledPaths, forceEnabled))
        }
        continue
      }
      const fullPath = join(dirPath, entry)
      let st
      try {
        st = lstatSync(fullPath)
      } catch {
        continue
      }
      let targetDir = fullPath
      if (st.isSymbolicLink()) {
        try {
          targetDir = realpathSync(fullPath)
        } catch {
          // Broken/dangling symlink: does NOT exist in the native client UI — skip completely
          continue
        }
      }
      try {
        if (!statSync(targetDir).isDirectory()) continue
      } catch {
        continue
      }
      const skillMdReal = join(targetDir, 'SKILL.md')
      const skillMdRaw = join(fullPath, 'SKILL.md')
      if (!isReadableFile(skillMdReal)) continue

      const meta = readSkillMetaAndSummary(targetDir)
      const isDisabled = forceEnabled === false
        || disabledPaths.has(skillMdReal)
        || disabledPaths.has(skillMdRaw)
      items.push({
        name: meta.name || entry,
        enabled: !isDisabled,
        origin: originType,
        scope: scopeLabel,
        dirPath: targetDir,
        skillMdPath: skillMdReal,
        description: meta.description,
      })
    }
  } catch {}
  return items
}

const ZCODE_DEFAULT_ENABLED_PLUGINS = new Set([
  'node-repl-host',
  'browser-use',
  'documents',
  'pdf',
  'presentations',
  'spreadsheets',
  'image-search',
  'plugin-creator',
  'skill-creator',
  'zcode-guide',
  'zcode-site',
])

function scanZcodePluginSkills(home, disabledPaths, enabledPluginsMap) {
  const items = []
  const bundledPath = join(home, '.zcode', 'cli', 'plugins', 'marketplaces', 'zcode-plugins-official', 'bundled-marketplace.json')
  const bundledDoc = readJsonSafe(bundledPath, {})
  const bundledPlugins = Array.isArray(bundledDoc?.manifest?.plugins) ? bundledDoc.manifest.plugins : []
  const seenPlugins = new Set()

  const collectFromPluginRoot = (pluginName, displayLabel, rootPath, pluginEnabled) => {
    if (!rootPath || !existsSync(rootPath)) return
    const skillsDir = join(rootPath, 'skills')
    if (!existsSync(skillsDir)) return
    for (const skillItem of scanValidSkillDir(skillsDir, `Plugin · ${displayLabel}`, 'plugin', disabledPaths, pluginEnabled ? null : false)) {
      items.push({
        ...skillItem,
        pluginName: displayLabel,
      })
    }
  }

  for (const p of bundledPlugins) {
    const pName = typeof p?.name === 'string' ? p.name.trim() : ''
    const cachePath = typeof p?.cachePath === 'string' ? p.cachePath.trim() : ''
    if (!pName || !cachePath) continue
    seenPlugins.add(pName)
    const pluginId = `${pName}@zcode-plugins-official`
    const pluginEnabled = typeof enabledPluginsMap[pluginId] === 'boolean'
      ? enabledPluginsMap[pluginId]
      : ZCODE_DEFAULT_ENABLED_PLUGINS.has(pName)
    const zhName = p?.displayName_i18n?.['zh-CN'] || p?.displayName || pName
    collectFromPluginRoot(pName, zhName, cachePath, pluginEnabled)
  }

  // Also check any non-bundled official cached plugin (e.g. superpowers)
  const officialCacheDir = join(home, '.zcode', 'cli', 'plugins', 'cache', 'zcode-plugins-official')
  try {
    if (existsSync(officialCacheDir)) {
      for (const pName of readdirSync(officialCacheDir)) {
        if (pName.startsWith('.') || seenPlugins.has(pName)) continue
        const pDir = join(officialCacheDir, pName)
        const versions = readdirSync(pDir).filter(v => !v.startsWith('.')).sort()
        if (versions.length === 0) continue
        const latestRoot = join(pDir, versions[versions.length - 1])
        const pluginId = `${pName}@zcode-plugins-official`
        // Non-bundled plugins default to disabled unless explicitly enabled
        const pluginEnabled = enabledPluginsMap[pluginId] === true
        collectFromPluginRoot(pName, pName, latestRoot, pluginEnabled)
      }
    }
  } catch {}
  return items
}

function inspectNativeSkills(family, spec = {}) {
  const home = homedir()
  const disabledPaths = new Set()
  let zcodeEnabledPlugins = {}

  if (family === 'zcode') {
    const doc = readJsonSafe(join(home, '.zcode', 'cli', 'config.json'), {})
    for (const [k, v] of Object.entries(doc?.skills ?? {})) {
      if (v && typeof v === 'object' && v.enable === false) {
        disabledPaths.add(k)
        try { disabledPaths.add(realpathSync(k)) } catch {}
      }
    }
    if (doc?.plugins?.enabledPlugins && typeof doc.plugins.enabledPlugins === 'object') {
      zcodeEnabledPlugins = doc.plugins.enabledPlugins
    }
  }

  const hay = `${spec?.command ?? ''} ${spec?.name ?? ''}`.toLowerCase()
  let dirs = []
  if (family === 'zcode') {
    // Matches ZCode Desktop `createSkillsService`: ~/.zcode/skills + ~/.agents/skills + official plugins
    dirs = [
      { path: join(home, '.zcode', 'skills'), label: '~/.zcode/skills', origin: 'personal' },
      { path: join(home, '.agents', 'skills'), label: '~/.agents/skills', origin: 'agents-shared' },
    ]
  } else if (family === 'minimax') {
    // Matches MiniMax Code (`pi` runtime): ~/.minimax/skills + ~/.minimax/.builtin-skills + ~/.agents/skills
    dirs = [
      { path: join(home, '.minimax', 'skills'), label: '~/.minimax/skills', origin: 'personal' },
      { path: join(home, '.minimax', '.builtin-skills'), label: '~/.minimax/.builtin-skills', origin: 'builtin' },
      { path: join(home, '.agents', 'skills'), label: '~/.agents/skills', origin: 'agents-shared' },
    ]
  } else if (family === 'codebuddy') {
    if (hay.includes('workbuddy-ai') || existsSync(join(home, '.workbuddy-ai', 'skills'))) {
      dirs.push({ path: join(home, '.workbuddy-ai', 'skills'), label: '~/.workbuddy-ai/skills', origin: 'personal' })
    }
    if (hay.includes('workbuddy') || existsSync(join(home, '.workbuddy', 'skills'))) {
      dirs.push({ path: join(home, '.workbuddy', 'skills'), label: '~/.workbuddy/skills', origin: 'personal' })
    }
    if (dirs.length === 0 || existsSync(join(home, '.codebuddy', 'skills'))) {
      dirs.push({ path: join(home, '.codebuddy', 'skills'), label: '~/.codebuddy/skills', origin: 'personal' })
    }
  } else if (family === 'opencode') {
    dirs = [
      { path: join(home, '.config', 'opencode', 'skills'), label: '~/.config/opencode/skills', origin: 'personal' },
    ]
  } else if (family === 'codex') {
    dirs = [
      { path: join(home, '.codex', 'skills'), label: '~/.codex/skills', origin: 'personal' },
      { path: join(home, '.agents', 'skills'), label: '~/.agents/skills', origin: 'agents-shared' },
    ]
  } else if (family === 'claude') {
    dirs = [
      { path: join(home, '.claude', 'skills'), label: '~/.claude/skills', origin: 'personal' },
    ]
  } else if (family === 'qoder') {
    if (hay.includes('qoder-cn') || (!existsSync(join(home, '.qoder', 'skills')) && existsSync(join(home, '.qoder-cn', 'skills')))) {
      dirs = [{ path: join(home, '.qoder-cn', 'skills'), label: '~/.qoder-cn/skills', origin: 'personal' }]
    } else {
      dirs = [{ path: join(home, '.qoder', 'skills'), label: '~/.qoder/skills', origin: 'personal' }]
    }
  }

  const seenByName = new Map()
  const seenByRealMd = new Set()
  const skillDirectories = []

  for (const d of dirs) {
    const exists = existsSync(d.path)
    skillDirectories.push({ label: d.label, path: d.path, exists })
    for (const skill of scanValidSkillDir(d.path, d.label, d.origin, disabledPaths)) {
      const nameKey = skill.name.toLowerCase()
      if (seenByRealMd.has(skill.skillMdPath) || seenByName.has(nameKey)) continue
      seenByRealMd.add(skill.skillMdPath)
      seenByName.set(nameKey, skill)
    }
  }

  if (family === 'zcode') {
    for (const pSkill of scanZcodePluginSkills(home, disabledPaths, zcodeEnabledPlugins)) {
      const nameKey = pSkill.name.toLowerCase()
      if (seenByRealMd.has(pSkill.skillMdPath) || seenByName.has(nameKey)) continue
      seenByRealMd.add(pSkill.skillMdPath)
      seenByName.set(nameKey, pSkill)
    }
  }

  return {
    skills: Array.from(seenByName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    skillDirs: skillDirectories.filter(d => d.exists).map(d => d.label),
    skillDirectories,
  }
}

function probeLocalPortOpen(port, timeoutMs = 350) {
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch {}
      resolvePromise(ok)
    }
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function inspectExternalAgent(agentId, spec, ctx = null) {
  const family = inferClientFamily(agentId, spec)
  const { servers, configPaths, configFiles } = inspectNativeMcpServers(family, spec)
  const { skills, skillDirs, skillDirectories } = inspectNativeSkills(family, spec)
  const clientApp = detectClientApp(family)
  const [skillsHubUp, magpieUp] = await Promise.all([
    probeLocalPortOpen(7799),
    probeLocalPortOpen(3425),
  ])
  const sessionMcpCandidates = buildSessionMcpCandidatesForAgent(agentId, spec, ctx)
  return {
    family,
    clientApp,
    mcpServers: servers,
    mcpConfigPaths: configPaths,
    mcpConfigFiles: configFiles,
    sessionMcpCandidates,
    skills,
    skillDirs,
    skillDirectories,
    hubs: {
      skillsHubUrl: 'http://127.0.0.1:7799',
      skillsHubOnline: skillsHubUp,
      magpieApp: detectMagpieApp(),
      magpieOnline: magpieUp,
    },
  }
}

function runMacOpen(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('/usr/bin/open', args, { timeout: 5000 }, (err) => {
      if (err) rejectPromise(err)
      else resolvePromise()
    })
  })
}

export async function openAllowedTrueSource(agentId, spec, action, targetPath, ctx = null) {
  const inspection = await inspectExternalAgent(agentId, spec, ctx)
  const allowedApps = new Set(inspection.clientApp ? [inspection.clientApp.path] : [])
  const allowedFiles = new Set()
  const allowedDirs = new Set()

  for (const cfg of inspection.mcpConfigFiles ?? []) {
    allowedFiles.add(cfg.path)
    allowedDirs.add(dirname(cfg.path))
  }
  for (const dir of inspection.skillDirectories ?? []) {
    allowedDirs.add(dir.path)
    allowedDirs.add(dirname(dir.path))
  }
  for (const skill of inspection.skills ?? []) {
    if (skill.dirPath) allowedDirs.add(skill.dirPath)
    if (skill.skillMdPath) allowedFiles.add(skill.skillMdPath)
  }

  const cleanTarget = String(targetPath ?? '').trim()

  if (action === 'magpie-app') {
    const magpieApp = inspection.hubs?.magpieApp
    if (!magpieApp?.path || !existsSync(magpieApp.path)) {
      throw new Error('未检测到本机 Magpie.app 应用')
    }
    if (cleanTarget && cleanTarget !== magpieApp.path) {
      throw new Error('目标路径与受检 Magpie 应用不匹配')
    }
    await runMacOpen(['-a', magpieApp.path])
    return { opened: magpieApp.path, via: 'Magpie.app' }
  }

  if (!cleanTarget) throw new Error('目标路径为空')

  if (action === 'app') {
    if (!allowedApps.has(cleanTarget) || !existsSync(cleanTarget)) {
      throw new Error('未找到对应的客户端应用')
    }
    await runMacOpen(['-a', cleanTarget])
    return { opened: cleanTarget, via: 'app' }
  }

  if (action === 'edit') {
    if (!allowedFiles.has(cleanTarget)) {
      throw new Error('仅允许打开受检客户端的真源配置文件或 SKILL.md')
    }
    if (!existsSync(cleanTarget)) {
      // Ensure parent directory exists and reveal parent if file hasn't been created yet
      const parentDir = dirname(cleanTarget)
      mkdirSync(parentDir, { recursive: true })
      await runMacOpen([parentDir])
      return { opened: parentDir, via: 'parent-folder' }
    }
    const editor = detectPreferredEditorApp()
    if (editor) {
      await runMacOpen(['-a', editor, cleanTarget])
      return { opened: cleanTarget, via: basename(editor, '.app') }
    }
    await runMacOpen(['-t', cleanTarget])
    return { opened: cleanTarget, via: 'TextEdit' }
  }

  if (action === 'reveal') {
    if (!allowedFiles.has(cleanTarget) && !allowedDirs.has(cleanTarget)) {
      throw new Error('目标路径不在受检客户端真源范围内')
    }
    if (!existsSync(cleanTarget)) {
      const parentDir = dirname(cleanTarget)
      mkdirSync(parentDir, { recursive: true })
      await runMacOpen([parentDir])
      return { opened: parentDir, via: 'Finder' }
    }
    await runMacOpen(['-R', cleanTarget])
    return { opened: cleanTarget, via: 'Finder' }
  }

  if (action === 'folder') {
    if (!allowedDirs.has(cleanTarget)) {
      throw new Error('目标目录不在受检客户端真源范围内')
    }
    mkdirSync(cleanTarget, { recursive: true })
    await runMacOpen([cleanTarget])
    return { opened: cleanTarget, via: 'Finder' }
  }

  throw new Error(`未知操作类型: ${action}`)
}

/* -------------------------------------------------------------------------- */
/* Host DSH MCP Discovery & Dynamic Per-Agent Session MCP Linkage             */
/* -------------------------------------------------------------------------- */

const ACP_VALID_SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

export function normalizeAcpServerName(rawName) {
  const trimmed = String(rawName ?? '').trim() || 'mcp'
  if (ACP_VALID_SERVER_NAME_RE.test(trimmed)) return trimmed
  const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 8)
  const slug = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'mcp'
  const prefix = slug.slice(0, Math.max(1, 32 - hash.length - 1)).replace(/-+$/g, '') || 'mcp'
  return `${prefix}_${hash}`
}

export function parseCordisPatchMcpEntries(yamlText) {
  if (typeof yamlText !== 'string' || !yamlText.trim()) return []
  const lines = yamlText.split(/\r?\n/)
  const orderedIds = []
  const byId = new Map()
  const anonymousEntries = []

  const mergeEntry = (entry) => {
    if (!entry) return
    const id = entry.id ? String(entry.id).trim() : ''
    if (id) {
      const prev = byId.get(id)
      if (!prev) {
        orderedIds.push(id)
        byId.set(id, entry)
      } else {
        byId.set(id, {
          ...prev,
          ...(entry.name ? { name: entry.name } : {}),
          ...(entry.disabled !== undefined ? { disabled: entry.disabled } : {}),
          config: { ...prev.config, ...entry.config },
        })
      }
    } else {
      anonymousEntries.push(entry)
    }
  }

  let cur = null
  let inConfig = false
  let configIndent = -1
  let configFieldIndent = null

  const flushCur = () => {
    if (cur) {
      mergeEntry(cur)
      cur = null
    }
    inConfig = false
    configIndent = -1
    configFieldIndent = null
  }

  const readIndentedBlockMap = (startIdx, parentIndent) => {
    const out = {}
    let idx = startIdx
    while (idx + 1 < lines.length) {
      const rawLine = lines[idx + 1]
      const cleanLine = stripUnquotedComment(rawLine)
      if (!cleanLine.trim()) { idx += 1; continue }
      const ind = rawLine.length - rawLine.trimStart().length
      if (ind <= parentIndent) break
      const trimmed = cleanLine.trim()
      if (trimmed.startsWith('-')) break
      const colonIdx = findUnquotedSeparator(trimmed, ':')
      if (colonIdx > 0) {
        const k = unquoteScalar(trimmed.slice(0, colonIdx))
        const v = unquoteScalar(trimmed.slice(colonIdx + 1))
        if (k) out[k] = v
      }
      idx += 1
    }
    return { map: out, endIdx: idx }
  }

  const readIndentedBlockSeq = (startIdx, parentIndent) => {
    const out = []
    let idx = startIdx
    while (idx + 1 < lines.length) {
      const rawLine = lines[idx + 1]
      const cleanLine = stripUnquotedComment(rawLine)
      if (!cleanLine.trim()) { idx += 1; continue }
      const ind = rawLine.length - rawLine.trimStart().length
      if (ind < parentIndent) break
      const trimmed = cleanLine.trim()
      if (!trimmed.startsWith('-')) break
      out.push(unquoteScalar(trimmed.slice(1).trim()))
      idx += 1
    }
    return { list: out, endIdx: idx }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    const clean = stripUnquotedComment(rawLine)
    if (!clean.trim()) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const trimmed = clean.trim()

    if (trimmed.startsWith('---') || trimmed === '...') continue

    const listMatch = /^-\s*(.*)$/.exec(trimmed)
    if (listMatch && (!inConfig || indent <= configIndent)) {
      const afterDash = listMatch[1].trim()
      if (afterDash === 'insert:' || afterDash.startsWith('insert:')) {
        flushCur()
        continue
      }
      flushCur()
      cur = { id: '', name: '', disabled: undefined, config: {}, itemIndent: indent }
      if (afterDash) {
        const colonIdx = findUnquotedSeparator(afterDash, ':')
        if (colonIdx > 0) {
          const k = unquoteScalar(afterDash.slice(0, colonIdx))
          const v = unquoteScalar(afterDash.slice(colonIdx + 1))
          if (k === 'id') cur.id = v
          else if (k === 'name') cur.name = v
          else if (k === 'disabled') cur.disabled = v.toLowerCase() === 'true'
          else if (k === 'config') {
            inConfig = true
            configIndent = indent + 2
          }
        }
      }
      continue
    }

    if (!cur) continue
    if (indent <= cur.itemIndent && !listMatch) {
      flushCur()
      continue
    }

    if (inConfig) {
      if (indent <= configIndent) {
        inConfig = false
        configIndent = -1
        configFieldIndent = null
      } else {
        if (configFieldIndent === null) configFieldIndent = indent
        if (indent !== configFieldIndent) continue
        const colonIdx = findUnquotedSeparator(trimmed, ':')
        if (colonIdx <= 0) continue
        const k = unquoteScalar(trimmed.slice(0, colonIdx))
        const rest = trimmed.slice(colonIdx + 1).trim()
        if (k === 'args') {
          const collected = rest.startsWith('[') || rest === ''
            ? collectBalancedBlock(lines, i, rest, '[', ']')
            : null
          if (collected) {
            cur.config.args = splitTopLevelCommas(collected.inner).map(unquoteScalar)
            i = collected.endIdx
          } else if (rest === '') {
            const seq = readIndentedBlockSeq(i, indent)
            cur.config.args = seq.list
            i = seq.endIdx
          }
        } else if (k === 'env' || k === 'headers') {
          const collected = rest.startsWith('{') || rest === ''
            ? collectBalancedBlock(lines, i, rest, '{', '}')
            : null
          if (collected) {
            const map = {}
            for (const pair of splitTopLevelCommas(collected.inner)) {
              const pCol = findUnquotedSeparator(pair, ':')
              if (pCol <= 0) continue
              const pk = unquoteScalar(pair.slice(0, pCol))
              const pv = unquoteScalar(pair.slice(pCol + 1))
              if (pk) map[pk] = pv
            }
            cur.config[k] = map
            i = collected.endIdx
          } else if (rest === '') {
            const blk = readIndentedBlockMap(i, indent)
            cur.config[k] = blk.map
            i = blk.endIdx
          }
        } else {
          cur.config[k] = unquoteScalar(rest)
        }
        continue
      }
    }

    const colonIdx = findUnquotedSeparator(trimmed, ':')
    if (colonIdx <= 0) continue
    const k = unquoteScalar(trimmed.slice(0, colonIdx))
    const vStr = trimmed.slice(colonIdx + 1).trim()
    if (k === 'id') cur.id = unquoteScalar(vStr)
    else if (k === 'name') cur.name = unquoteScalar(vStr)
    else if (k === 'disabled') cur.disabled = unquoteScalar(vStr).toLowerCase() === 'true'
    else if (k === 'config') {
      inConfig = true
      configIndent = indent
      configFieldIndent = null
    }
  }
  flushCur()

  const allEntries = [...orderedIds.map(id => byId.get(id)), ...anonymousEntries]
  return allEntries
    .filter(e => e && e.name === '@deepseek-ai/dsh-mcp-client' && e.disabled !== true)
    .map(e => e.config)
    .filter(cfg => cfg && typeof cfg === 'object' && typeof cfg.serverName === 'string' && cfg.serverName.trim())
}

function normalizeHostConfigToRawServer(cfg, sourceLabel, sourcePath = '') {
  if (!cfg || typeof cfg !== 'object') return null
  const serverName = typeof cfg.serverName === 'string' && cfg.serverName.trim()
    ? cfg.serverName.trim()
    : (typeof cfg.name === 'string' ? cfg.name.trim() : '')
  if (!serverName) return null
  const rawType = typeof cfg.transport === 'string' && cfg.transport.trim()
    ? cfg.transport.trim()
    : (typeof cfg.type === 'string' && cfg.type.trim() ? cfg.type.trim() : '')
  const url = typeof cfg.url === 'string' ? cfg.url.trim() : ''
  const command = typeof cfg.command === 'string' ? cfg.command.trim() : ''
  const args = Array.isArray(cfg.args) ? cfg.args.map(a => String(a ?? '')) : []
  const env = cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env) ? cfg.env : {}
  const headers = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers) ? cfg.headers : {}
  const cwd = typeof cfg.cwd === 'string' && cfg.cwd.trim() ? cfg.cwd.trim() : ''
  return {
    name: serverName,
    enabled: true,
    rawType,
    command,
    args,
    env,
    url,
    headers,
    ...(cwd ? { cwd } : {}),
    source: sourceLabel,
    sourcePath,
  }
}

export function discoverRawHostDshMcpServers(ctx = null, options = {}) {
  const byId = new Map()

  // 1. Live Cordis Loader tree entries (highest priority)
  try {
    const loader = ctx?.get?.('loader') ?? ctx?.loader
    const entries = typeof loader?.entries === 'function' ? loader.entries() : []
    for (const entry of entries) {
      if (!entry || entry.options?.name !== '@deepseek-ai/dsh-mcp-client') continue
      if (entry.disabled === true) continue
      if (entry.fiber && entry.fiber.uid === null) continue
      const cfg = entry.options?.config ?? entry.fiber?._config
      const raw = normalizeHostConfigToRawServer(cfg, 'DSH 运行时 Loader')
      if (!raw) continue
      const normId = normalizeAcpServerName(raw.name)
      if (!byId.has(normId)) byId.set(normId, raw)
    }
  } catch {}

  // 2. Active profile cordis.patch.yml fallback (zero external dependencies)
  const patchPath = (
    (typeof options.patchPath === 'string' && options.patchPath.trim())
    || ctx?.get?.('profileContext')?.patchPath
    || ctx?.profileContext?.patchPath
    || (process.env.DSH_PROFILE_DIR ? join(process.env.DSH_PROFILE_DIR, 'cordis.patch.yml') : '')
    || join(dshHomeRoot(), 'profiles', 'desktop', 'cordis.patch.yml')
  )
  try {
    if (patchPath && existsSync(patchPath)) {
      const yamlText = readFileSync(patchPath, 'utf8')
      const configs = parseCordisPatchMcpEntries(yamlText)
      for (const cfg of configs) {
        const raw = normalizeHostConfigToRawServer(cfg, 'DSH 宿主', patchPath)
        if (!raw) continue
        const normId = normalizeAcpServerName(raw.name)
        if (!byId.has(normId)) byId.set(normId, raw)
      }
    }
  } catch {}

  return Array.from(byId.values())
}

function classifyWireType(raw) {
  const tr = classifyMcpTransport(raw)
  if (tr === 'stdio') return 'stdio'
  if (tr === 'http' || tr === 'streamable-http' || tr === 'remote' || tr === 'magpie-hub') return 'http'
  if (tr === 'sse') return 'sse'
  return 'unsupported'
}

function isRawServerReady(raw) {
  if (!raw) return false
  const wireType = classifyWireType(raw)
  if (wireType === 'stdio') {
    return Boolean(resolveExecutable(raw.command))
  }
  if (wireType === 'http' || wireType === 'sse') {
    try {
      const parsed = new URL(String(raw.url || '').trim())
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }
  return false
}

export function buildSessionMcpCandidatesForAgent(agentId, spec = {}, ctx = null, options = {}) {
  const family = inferClientFamily(agentId, spec)
  const { rawServers } = readRawClientMcpServers(family, spec, options)
  const hostServers = discoverRawHostDshMcpServers(ctx, options)

  const byId = new Map()
  for (const srv of rawServers) {
    const id = normalizeAcpServerName(srv.name)
    const cur = byId.get(id) ?? { id, clientRaw: null, hostRaw: null }
    if (!cur.clientRaw || (!cur.clientRaw.enabled && srv.enabled)) {
      cur.clientRaw = srv
    }
    byId.set(id, cur)
  }
  for (const hSrv of hostServers) {
    const id = normalizeAcpServerName(hSrv.name)
    const cur = byId.get(id) ?? { id, clientRaw: null, hostRaw: null }
    cur.hostRaw = hSrv
    byId.set(id, cur)
  }

  const out = []
  for (const { id, clientRaw, hostRaw } of byId.values()) {
    const nativeState = clientRaw ? (clientRaw.enabled ? 'enabled' : 'disabled') : 'absent'
    const inDshHost = Boolean(hostRaw)
    const preferredRaw = (clientRaw && (isRawServerReady(clientRaw) || !hostRaw)) ? clientRaw : (hostRaw ?? clientRaw)
    const transport = classifyMcpTransport(preferredRaw)
    const wireType = classifyWireType(preferredRaw)
    const ready = isRawServerReady(preferredRaw) || Boolean(hostRaw && isRawServerReady(hostRaw))
    const sourceLabel = clientRaw
      ? (inDshHost ? `${clientRaw.source} · DSH 宿主` : clientRaw.source)
      : 'DSH 宿主'
    out.push({
      id,
      name: (clientRaw?.name || hostRaw?.name || id),
      transport,
      wireType,
      summary: safeTargetSummary(preferredRaw),
      inDshHost,
      nativeState,
      sourceLabel,
      ready,
    })
  }

  // Sort: enabled first -> disabled -> absent, preserving name stability
  const rank = { enabled: 0, disabled: 1, absent: 2 }
  out.sort((a, b) => (rank[a.nativeState] - rank[b.nativeState]) || a.name.localeCompare(b.name))
  return out
}

function kvObjectToAcpPairs(obj, { validateHttpHeader = false } = {}) {
  const src = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  const pairs = []
  const seen = new Set()
  for (const [rawKey, rawVal] of Object.entries(src)) {
    const k = String(rawKey ?? '').trim()
    if (!k) continue
    const v = String(rawVal ?? '')
    if (validateHttpHeader) {
      try {
        validateHeaderName(k)
        validateHeaderValue(k, v)
      } catch {
        continue
      }
      const lower = k.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      pairs.push({ name: k, value: v })
    } else {
      if (k.includes('=') || k.includes('\0') || seen.has(k)) continue
      seen.add(k)
      pairs.push({ name: k, value: v })
    }
  }
  return pairs
}

function toAcpWireMcpServer(name, raw, { supportsHttp, supportsSse }) {
  if (!raw || typeof raw !== 'object') return null
  const wireType = classifyWireType(raw)
  if (wireType === 'stdio') {
    const rawCmd = String(raw.command || '').trim()
    const resolvedCmd = resolveExecutable(rawCmd) || expandHome(rawCmd)
    if (!resolvedCmd || !isAbsolute(resolvedCmd)) return null
    const args = Array.isArray(raw.args) ? raw.args.filter(a => typeof a === 'string') : []
    const env = kvObjectToAcpPairs(raw.env, { validateHttpHeader: false })
    // ACP stdio McpServer must NOT carry a `type` property (packages/acp/acp/src/mcp.ts & zcode-acp)
    return {
      name,
      command: resolvedCmd,
      args,
      env,
    }
  }
  if (wireType === 'http' || wireType === 'sse') {
    if (wireType === 'http' && !supportsHttp) return null
    if (wireType === 'sse' && !supportsSse) return null
    const rawUrl = String(raw.url || '').trim()
    try {
      const parsed = new URL(rawUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    } catch {
      return null
    }
    const headers = kvObjectToAcpPairs(raw.headers, { validateHttpHeader: true })
    return {
      name,
      type: wireType,
      url: rawUrl,
      headers,
    }
  }
  return null
}

export function buildSessionMcpServers(spec, agentCapabilities = {}, ctx = null, options = {}) {
  const forwarded = Array.isArray(spec.forwardMcpIds) ? spec.forwardMcpIds : []
  const custom = Array.isArray(spec.extraMcpServers) ? spec.extraMcpServers : []
  if (forwarded.length === 0 && custom.length === 0) return []

  const family = inferClientFamily(spec.id ?? '', spec)
  const supportsHttp = Boolean(agentCapabilities?.mcpCapabilities?.http || family === 'zcode')
  const supportsSse = Boolean(agentCapabilities?.mcpCapabilities?.sse || family === 'zcode')

  const { rawServers } = readRawClientMcpServers(family, spec, options)
  const hostServers = discoverRawHostDshMcpServers(ctx, options)

  const clientById = new Map()
  const nativeEnabledIds = new Set()
  for (const srv of rawServers) {
    const id = normalizeAcpServerName(srv.name)
    if (!clientById.has(id) || (!clientById.get(id).enabled && srv.enabled)) {
      clientById.set(id, srv)
    }
    if (srv.enabled) nativeEnabledIds.add(id)
  }

  const hostById = new Map()
  for (const hSrv of hostServers) {
    const id = normalizeAcpServerName(hSrv.name)
    if (!hostById.has(id)) hostById.set(id, hSrv)
  }

  const seenNames = new Set(nativeEnabledIds)
  const out = []

  for (const rawId of forwarded) {
    const id = normalizeAcpServerName(rawId)
    if (seenNames.has(id)) continue
    const cSrv = clientById.get(id)
    const hSrv = hostById.get(id)
    const chosen = (cSrv && isRawServerReady(cSrv))
      ? cSrv
      : (hSrv && isRawServerReady(hSrv) ? hSrv : (cSrv ?? hSrv))
    if (!chosen) continue
    const wire = toAcpWireMcpServer(id, chosen, { supportsHttp, supportsSse })
    if (wire) {
      out.push(wire)
      seenNames.add(id)
    }
  }

  for (const item of custom) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) continue
    const id = normalizeAcpServerName(item.name)
    if (seenNames.has(id)) continue
    const wire = toAcpWireMcpServer(id, item, { supportsHttp, supportsSse })
    if (wire) {
      out.push(wire)
      seenNames.add(id)
    }
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* Agent Normalization, Progressive Disclosure & Persistent Store             */
/* -------------------------------------------------------------------------- */

function normalizePromptDisclosure(value) {
  if (value === 'full' || value === 'none' || value === 'compact') return value
  return 'compact'
}

export function normalizeAgentEntry(id, value, fallback = {}) {
  const raw = value && typeof value === 'object' ? value : {}
  const base = fallback && typeof fallback === 'object' ? fallback : {}
  const parsedCmdLine = (!raw.command && typeof raw.commandLine === 'string' && raw.commandLine.trim())
    ? parseCommandLine(raw.commandLine)
    : null
  const command = typeof raw.command === 'string' && raw.command.trim()
    ? raw.command.trim()
    : (parsedCmdLine?.command || (typeof base.command === 'string' ? base.command.trim() : ''))
  if (!command) return null
  const args = Array.isArray(raw.args)
    ? raw.args.filter(a => typeof a === 'string')
    : (parsedCmdLine
      ? parsedCmdLine.args
      : (Array.isArray(base.args) ? base.args.filter(a => typeof a === 'string') : []))
  const envSrc = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
    ? raw.env
    : (base.env && typeof base.env === 'object' && !Array.isArray(base.env) ? base.env : {})
  const cfgSrc = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
    ? raw.config
    : (base.config && typeof base.config === 'object' && !Array.isArray(base.config) ? base.config : {})

  const pickOptionalStr = (key) => {
    if (raw[key] !== undefined) {
      const trimmed = String(raw[key] ?? '').trim()
      return trimmed.length > 0 ? trimmed : undefined
    }
    const baseTrimmed = String(base[key] ?? '').trim()
    return baseTrimmed.length > 0 ? baseTrimmed : undefined
  }

  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : (typeof base.name === 'string' && base.name.trim() ? base.name.trim() : id),
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : (base.enabled !== undefined ? Boolean(base.enabled) : true),
    autoLaunch: raw.autoLaunch !== undefined ? Boolean(raw.autoLaunch) : (base.autoLaunch !== undefined ? Boolean(base.autoLaunch) : true),
    allowResume: raw.allowResume !== undefined ? Boolean(raw.allowResume) : (base.allowResume !== undefined ? Boolean(base.allowResume) : true),
    command,
    args,
    mode: pickOptionalStr('mode'),
    modeSource: pickOptionalStr('modeSource'),
    modeConfigId: pickOptionalStr('modeConfigId'),
    permission: (raw.permission ?? base.permission) === 'reject' ? 'reject' : 'allow',
    cwd: pickOptionalStr('cwd'),
    model: pickOptionalStr('model'),
    reasoning: pickOptionalStr('reasoning'),
    reasoningConfigId: pickOptionalStr('reasoningConfigId'),
    whenToUse: typeof raw.whenToUse === 'string'
      ? raw.whenToUse.trim().slice(0, 600)
      : (typeof base.whenToUse === 'string' ? base.whenToUse.trim().slice(0, 600) : ''),
    instructions: typeof raw.instructions === 'string'
      ? raw.instructions.trim().slice(0, 4000)
      : (typeof base.instructions === 'string' ? base.instructions.trim().slice(0, 4000) : ''),
    forwardMcpIds: Array.isArray(raw.forwardMcpIds)
      ? raw.forwardMcpIds.filter(x => typeof x === 'string')
      : (Array.isArray(base.forwardMcpIds) ? base.forwardMcpIds.filter(x => typeof x === 'string') : []),
    extraMcpServers: Array.isArray(raw.extraMcpServers)
      ? raw.extraMcpServers.filter(x => x && typeof x === 'object')
      : (Array.isArray(base.extraMcpServers) ? base.extraMcpServers.filter(x => x && typeof x === 'object') : []),
    env: Object.fromEntries(Object.entries(envSrc).filter(([, v]) => typeof v === 'string')),
    config: Object.fromEntries(Object.entries(cfgSrc).filter(([, v]) => typeof v === 'string')),
  }
}

export function loadMergedSettings(seedConfig, settingsPath, legacyPath = legacyMirrorSettingsPath()) {
  const sourcePath = existsSync(settingsPath)
    ? settingsPath
    : (legacyPath && existsSync(legacyPath) ? legacyPath : settingsPath)
  const savedDoc = readJsonSafe(sourcePath, { version: 3, promptDisclosure: 'compact', agents: {}, deleted: [] })
  const deleted = new Set(Array.isArray(savedDoc.deleted) ? savedDoc.deleted : [])
  const promptDisclosure = normalizePromptDisclosure(savedDoc.promptDisclosure)
  const map = new Map()
  const seedAgents = seedConfig && typeof seedConfig === 'object' ? seedConfig : {}
  const savedAgents = savedDoc.agents && typeof savedDoc.agents === 'object' ? savedDoc.agents : {}

  for (const [id, seed] of Object.entries(seedAgents)) {
    if (!AGENT_ID_PATTERN.test(id) || deleted.has(id)) continue
    const merged = normalizeAgentEntry(id, savedAgents[id], seed)
    if (merged) map.set(id, merged)
  }
  for (const [id, saved] of Object.entries(savedAgents)) {
    if (!AGENT_ID_PATTERN.test(id) || deleted.has(id) || map.has(id)) continue
    const entry = normalizeAgentEntry(id, saved)
    if (entry) map.set(id, entry)
  }
  return { map, deleted, promptDisclosure }
}

function persistSettings(settingsPath, agentsMap, deletedSet, promptDisclosure) {
  const agents = {}
  for (const [id, spec] of agentsMap.entries()) {
    agents[id] = {
      name: spec.name,
      enabled: spec.enabled,
      autoLaunch: spec.autoLaunch,
      allowResume: spec.allowResume !== false,
      command: spec.command,
      args: spec.args,
      permission: spec.permission,
      ...(spec.mode ? { mode: spec.mode } : {}),
      ...(spec.modeSource ? { modeSource: spec.modeSource } : {}),
      ...(spec.modeConfigId ? { modeConfigId: spec.modeConfigId } : {}),
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.reasoning ? { reasoning: spec.reasoning } : {}),
      ...(spec.reasoningConfigId ? { reasoningConfigId: spec.reasoningConfigId } : {}),
      ...(spec.whenToUse ? { whenToUse: spec.whenToUse } : {}),
      ...(spec.instructions ? { instructions: spec.instructions } : {}),
      ...(spec.forwardMcpIds?.length ? { forwardMcpIds: spec.forwardMcpIds } : {}),
      ...(spec.extraMcpServers?.length ? { extraMcpServers: spec.extraMcpServers } : {}),
      env: spec.env ?? {},
      ...(Object.keys(spec.config ?? {}).length ? { config: spec.config } : {}),
    }
  }
  atomicWriteJson(settingsPath, {
    version: 3,
    promptDisclosure: normalizePromptDisclosure(promptDisclosure),
    agents,
    deleted: Array.from(deletedSet),
  })
}

function estimateTokensApprox(str) {
  if (!str) return 0
  let cjk = 0
  let rest = 0
  for (const ch of str) {
    if (ch.charCodeAt(0) > 0x2E80) cjk += 1
    else rest += 1
  }
  return Math.ceil(cjk * 0.65 + rest * 0.28)
}

function buildRoutingPromptText(agentsMap, promptDisclosure) {
  const mode = normalizePromptDisclosure(promptDisclosure)
  if (mode === 'none') return ''
  const enabled = Array.from(agentsMap.values()).filter(a => a.enabled !== false && a.autoLaunch !== false)
  if (enabled.length === 0) return ''

  if (mode === 'compact') {
    const items = enabled.map((spec) => {
      const brief = spec.whenToUse
        ? spec.whenToUse.replace(/\s+/g, ' ').slice(0, 42) + (spec.whenToUse.length > 42 ? '…' : '')
        : spec.name
      const contTag = spec.allowResume === false ? ' [clean-slate only]' : ''
      return `- \`${spec.id}\` (${spec.name})${contTag}: ${brief}`
    })
    return [
      'External ACP subagents (`delegate_acp`; load `list_acp_agents` for full profiles):',
      ...items,
      'Do NOT reuse prior sessions blindly: for resumable agents, pass `resumeChildId` ONLY when directly iterating on that subagent\'s prior context; omit `resumeChildId` for independent tasks or unbiased fresh review (never pass `resumeChildId` for `[clean-slate only]` agents). End your turn after delegating.',
    ].join('\n')
  }

  const lines = enabled.map((spec) => {
    const modelNote = spec.model ? ` [model: ${spec.model}]` : ''
    const contNote = spec.allowResume === false ? ' [clean-slate only: resumeChildId forbidden]' : ' [resumable on demand]'
    const useNote = spec.whenToUse ? ` — ${spec.whenToUse}` : ''
    return `- \`${spec.id}\` (${spec.name})${modelNote}${contNote}${useNote}`
  })
  return [
    'External ACP agents available for asynchronous delegation (`delegate_acp`):',
    ...lines,
    'Session continuation policy: do NOT pass `resumeChildId` by default. Decide per task — pass `resumeChildId` ONLY when continuing the exact same thread of investigation/edits; omit `resumeChildId` for new topics or clean-slate independent review. Never pass `resumeChildId` to `[clean-slate only]` agents. End your turn after delegating without polling.',
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* Continuation Ledger (childId <-> remoteSessionId & parentSessionId)        */
/* -------------------------------------------------------------------------- */

function readContinuationLedger() {
  const primary = hubSessionsPath()
  const legacy = legacyMirrorSessionsPath()
  const sourcePath = existsSync(primary) ? primary : (existsSync(legacy) ? legacy : primary)
  const doc = readJsonSafe(sourcePath, { sessions: {} })
  return doc.sessions && typeof doc.sessions === 'object' ? doc.sessions : {}
}

function recordContinuationEntry(childId, record) {
  const sessions = readContinuationLedger()
  sessions[childId] = { ...(sessions[childId] ?? {}), ...record, updatedAt: Date.now() }
  const entries = Object.entries(sessions)
    .sort(([, a], [, b]) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0))
    .slice(0, MAX_STORED_SESSIONS)
  try {
    atomicWriteJson(hubSessionsPath(), { sessions: Object.fromEntries(entries) })
  } catch {}
}

function lookupContinuationEntry(resumeChildId) {
  const needle = String(resumeChildId ?? '').trim()
  if (!needle) return null
  const sessions = readContinuationLedger()
  if (sessions[needle]) return { childId: needle, ...sessions[needle] }
  const matches = Object.entries(sessions).filter(([id]) => id.startsWith(needle))
  if (matches.length === 1) return { childId: matches[0][0], ...matches[0][1] }
  return null
}

/* -------------------------------------------------------------------------- */
/* Disjoint Token Accounting + ZCode SQLite Per-Step Usage & Context Window   */
/* -------------------------------------------------------------------------- */

function toNonNegInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0
}

export function splitDisjointInputTokens(rawInput, cacheRead, cacheWrite, output, reportedTotal, reasoning = 0) {
  const cacheSum = cacheRead + cacheWrite
  if (rawInput <= 0) return 0
  if (cacheSum <= 0) return rawInput
  if (reportedTotal > 0) {
    const diffInclusive = Math.min(
      Math.abs(reportedTotal - (rawInput + output)),
      Math.abs(reportedTotal - (rawInput + output + reasoning)),
    )
    const diffDisjoint = Math.min(
      Math.abs(reportedTotal - (rawInput + cacheSum + output)),
      Math.abs(reportedTotal - (rawInput + cacheSum + output + reasoning)),
    )
    if (diffDisjoint < diffInclusive) {
      return rawInput
    }
  }
  return Math.max(0, rawInput - cacheSum)
}

export function reconcileOutputAndReasoning(promptTokens, rawOut, rawReasoning, reportedTotal = 0) {
  const out = toNonNegInt(rawOut)
  const reasoning = toNonNegInt(rawReasoning)
  if (reasoning <= 0) return { outputTokens: out, reasoningTokens: 0 }
  const tot = toNonNegInt(reportedTotal)
  if (tot > 0) {
    const diffDisjoint = Math.abs(tot - (promptTokens + out + reasoning))
    const diffInclusive = Math.abs(tot - (promptTokens + out))
    if (diffDisjoint < diffInclusive) {
      return { outputTokens: out + reasoning, reasoningTokens: reasoning }
    }
  }
  if (reasoning > out) {
    return { outputTokens: out + reasoning, reasoningTokens: reasoning }
  }
  return { outputTokens: out, reasoningTokens: reasoning }
}

export function normalizeDisjointUsage(reported, context) {
  if (reported && typeof reported === 'object') {
    const rawIn = toNonNegInt(reported.inputTokens)
    const rawOut = toNonNegInt(reported.outputTokens)
    const cacheRead = toNonNegInt(reported.cachedReadTokens ?? reported.cacheReadTokens)
    const cacheWrite = toNonNegInt(reported.cachedWriteTokens ?? reported.cacheWriteTokens)
    const rawReasoning = toNonNegInt(reported.thoughtTokens ?? reported.reasoningTokens)
    const tot = toNonNegInt(reported.totalTokens)
    if (rawIn > 0 || rawOut > 0 || rawReasoning > 0 || cacheRead > 0 || cacheWrite > 0 || tot > 0) {
      const uncachedIn = tot > 0 && rawIn === 0 && cacheRead === 0 && cacheWrite === 0
        ? Math.max(0, tot - Math.max(rawOut, rawReasoning))
        : splitDisjointInputTokens(rawIn, cacheRead, cacheWrite, rawOut, tot, rawReasoning)
      const promptTokens = uncachedIn + cacheRead + cacheWrite
      const { outputTokens, reasoningTokens } = reconcileOutputAndReasoning(promptTokens, rawOut, rawReasoning, tot)
      const totalTokens = promptTokens + outputTokens
      return {
        inputTokens: uncachedIn,
        outputTokens,
        cacheReadTokens: cacheRead,
        totalTokens,
        ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
        ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      }
    }
  }
  if (context && typeof context.used === 'number' && context.used > 0) {
    const used = toNonNegInt(context.used)
    return {
      inputTokens: used,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: used,
    }
  }
  return undefined
}

function querySqliteRows(dbPath, sql) {
  if (!dbPath || !existsSync(dbPath)) return null
  try {
    const out = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', dbPath, sql], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return []
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return null
  }
}

function zcodeDbPath() {
  return join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
}

function minimaxDbPath() {
  return join(homedir(), '.minimax', 'v2', 'sqlite', 'runtime-state.sqlite')
}

export function queryZcodeModelUsageRows(remoteSessionId) {
  if (typeof remoteSessionId !== 'string' || !remoteSessionId.startsWith('zc-')) return null
  const zsid = remoteSessionId.slice(3)
  if (!ZCODE_SESSION_ID_RE.test(zsid)) return null
  const sql = `SELECT id, query_source, status, provider_id, model_id, started_at, first_token_at, completed_at, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, provider_total_tokens, computed_total_tokens FROM model_usage WHERE session_id = '${zsid}' AND COALESCE(query_source, '') NOT IN ('session_title', 'goal_summary_title') ORDER BY started_at ASC, id ASC`
  return querySqliteRows(zcodeDbPath(), sql)
}

export function queryMinimaxTokenUsageRows(remoteSessionId) {
  if (typeof remoteSessionId !== 'string' || !MINIMAX_SESSION_ID_RE.test(remoteSessionId)) return null
  const sql = `SELECT id, model, ts, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, raw FROM local_runtime_token_usage WHERE session_id = '${remoteSessionId}' ORDER BY ts ASC, id ASC`
  return querySqliteRows(minimaxDbPath(), sql)
}

function normalizeUsageRowCollection(rows, extractFields) {
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  let uncachedIn = 0
  let out = 0
  let cacheRead = 0
  let cacheWrite = 0
  let reasoning = 0
  let route
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const f = extractFields(row)
    const stepUncachedIn = f.alreadyDisjoint && f.rTot <= 0
      ? f.rIn
      : splitDisjointInputTokens(f.rIn, f.rCacheRead, f.rCacheWrite, f.rOut, f.rTot, f.rReason)
    const stepPrompt = stepUncachedIn + f.rCacheRead + f.rCacheWrite
    const reconciled = reconcileOutputAndReasoning(stepPrompt, f.rOut, f.rReason, f.rTot)
    uncachedIn += stepUncachedIn
    out += reconciled.outputTokens
    cacheRead += f.rCacheRead
    cacheWrite += f.rCacheWrite
    reasoning += reconciled.reasoningTokens
    if (f.route) route = f.route
  }
  const totalTokens = uncachedIn + cacheRead + cacheWrite + out
  if (totalTokens <= 0) return undefined
  return {
    usage: {
      inputTokens: uncachedIn,
      outputTokens: out,
      cacheReadTokens: cacheRead,
      totalTokens,
      ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
      ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
    },
    route,
  }
}

export function normalizeZcodeUsageRows(rows) {
  return normalizeUsageRowCollection(rows, (row) => {
    const prov = typeof row.provider_id === 'string' ? row.provider_id.trim() : ''
    const mod = typeof row.model_id === 'string' ? row.model_id.trim() : ''
    const route = mod ? { provider: prov || 'zcode', model: mod } : undefined
    return {
      rIn: toNonNegInt(row.input_tokens),
      rOut: toNonNegInt(row.output_tokens),
      rCacheRead: toNonNegInt(row.cache_read_input_tokens),
      rCacheWrite: toNonNegInt(row.cache_creation_input_tokens),
      rReason: toNonNegInt(row.reasoning_tokens),
      rTot: toNonNegInt(row.provider_total_tokens ?? row.computed_total_tokens),
      alreadyDisjoint: false,
      route,
    }
  })
}

export function normalizeMinimaxUsageRows(rows) {
  return normalizeUsageRowCollection(rows, (row) => {
    const mod = typeof row.model === 'string' ? row.model.trim() : ''
    let rawTotal = 0
    if (typeof row.raw === 'string' && row.raw.trim().startsWith('{')) {
      try {
        rawTotal = toNonNegInt(JSON.parse(row.raw)?.totalTokens)
      } catch {}
    }
    return {
      rIn: toNonNegInt(row.input_tokens),
      rOut: toNonNegInt(row.output_tokens),
      rCacheRead: toNonNegInt(row.cache_read_tokens),
      rCacheWrite: toNonNegInt(row.cache_write_tokens),
      rReason: toNonNegInt(row.reasoning_tokens),
      rTot: rawTotal,
      alreadyDisjoint: true,
      route: mod ? { provider: 'minimax', model: mod } : undefined,
    }
  })
}

export function consumeNewSqliteStepUsage(family, remoteSessionId, consumedRowIds, queryFn = undefined) {
  if (!(consumedRowIds instanceof Set)) return null
  if (family !== 'zcode' && family !== 'minimax') return null
  const reader = queryFn ?? (family === 'minimax' ? queryMinimaxTokenUsageRows : queryZcodeModelUsageRows)
  const rows = reader(remoteSessionId)
  const fresh = (rows ?? []).filter((r) => {
    if (!r || consumedRowIds.has(r.id)) return false
    return family === 'zcode' ? r.status === 'completed' : true
  })
  if (fresh.length === 0) return null
  for (const r of fresh) consumedRowIds.add(r.id)
  const normalized = family === 'minimax' ? normalizeMinimaxUsageRows(fresh) : normalizeZcodeUsageRows(fresh)
  if (!normalized) return null
  return { ...normalized, rowCount: fresh.length }
}

export function consumeNewZcodeStepUsage(family, remoteSessionId, consumedRowIds, queryFn = queryZcodeModelUsageRows) {
  if (family !== 'zcode') return null
  return consumeNewSqliteStepUsage(family, remoteSessionId, consumedRowIds, queryFn)
}

export async function resolveTurnTokenUsage(
  family,
  remoteSessionId,
  consumedRowIds,
  reportedUsage,
  contextUsage,
  { priorZcodeRowsConsumed = 0, priorSqliteRowsConsumed, queryFn = undefined } = {},
) {
  const priorConsumed = priorSqliteRowsConsumed ?? priorZcodeRowsConsumed
  if ((family === 'zcode' || family === 'minimax') && consumedRowIds instanceof Set) {
    let stepResult = consumeNewSqliteStepUsage(family, remoteSessionId, consumedRowIds, queryFn)
    if (!stepResult) {
      await new Promise(r => setTimeout(r, family === 'minimax' ? 150 : 260))
      stepResult = consumeNewSqliteStepUsage(family, remoteSessionId, consumedRowIds, queryFn)
    }
    if (stepResult) return stepResult
    if (priorConsumed > 0) {
      // Earlier steps in this turn already consumed SQLite rows;
      // never fall back to turn-aggregate reportedUsage to avoid double-counting.
      return { usage: undefined, route: undefined }
    }
  }
  const usage = normalizeDisjointUsage(reportedUsage, contextUsage)
  return { usage, route: undefined }
}

export function extractEffectiveModelHint(family, specModel = '', catalogCurrent = '') {
  const direct = String(specModel || '').trim()
  if (direct) return direct
  const probed = String(catalogCurrent || '').trim()
  if (probed) return probed
  const home = homedir()
  try {
    if (family === 'zcode') {
      const doc = readJsonSafe(join(home, '.zcode', 'cli', 'config.json'), {})
      if (typeof doc?.model === 'string' && doc.model.trim()) return doc.model.trim()
    } else if (family === 'minimax') {
      const cfgPath = join(home, '.minimax', 'config.yaml')
      if (existsSync(cfgPath)) {
        const raw = readFileSync(cfgPath, 'utf8')
        const m = /^defaultModel:\s*(.+)$/m.exec(raw)
        if (m && m[1]) {
          const clean = m[1].replace(/#.*$/, '').replace(/^["']+|["']+$/g, '').trim()
          if (clean) return clean
        }
      }
    } else if (family === 'opencode') {
      const doc = readJsonSafe(join(home, '.config', 'opencode', 'opencode.json'), {})
      if (typeof doc?.model === 'string' && doc.model.trim()) return doc.model.trim()
    } else if (family === 'codex') {
      const cfgPath = join(home, '.codex', 'config.toml')
      if (existsSync(cfgPath)) {
        const raw = readFileSync(cfgPath, 'utf8')
        const m = /^model\s*=\s*["']?([^"'\s#]+)["']?/m.exec(raw)
        if (m && m[1]) return m[1].trim()
      }
    }
  } catch {}
  return ''
}

function normalizeModelLeafForWindow(rawModel) {
  let s = String(rawModel || '').trim()
  if (!s) return ''
  try { s = decodeURIComponent(s) } catch {}
  const mm = /^m:([^:]+):(.+?)(?::v:([^:]*))?$/.exec(s)
  if (mm) s = mm[2]
  s = s.replace(/:v:[^:]*$/, '')
  const parts = s.split(/[/:~]/).filter(Boolean)
  return parts[parts.length - 1] || s
}

function readConfiguredModelContextLimit(family, modelStr) {
  if (!modelStr) return 0
  const home = homedir()
  const leaf = normalizeModelLeafForWindow(modelStr).toLowerCase()
  try {
    if (family === 'zcode') {
      const doc = readJsonSafe(join(home, '.zcode', 'cli', 'config.json'), {})
      for (const prov of Object.values(doc?.provider ?? {})) {
        for (const [mKey, mVal] of Object.entries(prov?.models ?? {})) {
          const ctxLim = toNonNegInt(mVal?.limit?.context ?? mVal?.contextWindow)
          if (ctxLim > 0 && (mKey.toLowerCase() === leaf || modelStr.toLowerCase().endsWith(`/${mKey.toLowerCase()}`))) {
            return ctxLim
          }
        }
      }
    } else if (family === 'opencode') {
      const doc = readJsonSafe(join(home, '.config', 'opencode', 'opencode.json'), {})
      for (const prov of Object.values(doc?.provider ?? {})) {
        for (const [mKey, mVal] of Object.entries(prov?.models ?? {})) {
          const ctxLim = toNonNegInt(mVal?.limit?.context ?? mVal?.contextWindow)
          if (ctxLim > 0 && (mKey.toLowerCase() === leaf || modelStr.toLowerCase().endsWith(`/${mKey.toLowerCase()}`))) {
            return ctxLim
          }
        }
      }
    } else if (family === 'minimax') {
      const catPath = join(home, '.minimax', 'cache', 'models-dev-catalog.json')
      if (existsSync(catPath)) {
        const cat = readJsonSafe(catPath, {})
        for (const prov of Object.values(cat ?? {})) {
          for (const [mKey, mVal] of Object.entries(prov?.models ?? {})) {
            const ctxLim = toNonNegInt(mVal?.limit?.context)
            if (ctxLim > 0 && mKey.toLowerCase() === leaf) return ctxLim
          }
        }
      }
    }
  } catch {}
  return 0
}

export function resolveAgentContextWindow(family, specModel = '', catalogCurrent = '') {
  const effectiveModel = extractEffectiveModelHint(family, specModel, catalogCurrent)
  const configured = readConfiguredModelContextLimit(family, effectiveModel)
  if (configured > 0) return configured

  const leaf = normalizeModelLeafForWindow(effectiveModel)
  if (leaf) {
    if (/claude/i.test(leaf)) return 200_000
    if (/magpie/i.test(effectiveModel)) return 1_000_000
    if (/minimax-m3|m3\.1|\bm3\b/i.test(leaf)) return 512_000
    if (/dfmodel|deepseek-flash|deepseek-v4|glm-5\.3|qfmodel|qwen3\.8|gemini/i.test(leaf)) return 1_000_000
    if (/gpt-5|codex/i.test(leaf)) return 400_000
    if (/kimi|moonshot|step-5|stepfun/i.test(leaf)) return 256_000
    if (/deepseek/i.test(leaf)) return 128_000
  }
  if (/magpie/i.test(effectiveModel)) return 1_000_000

  if (family === 'zcode' || family === 'gemini') return 1_000_000
  if (family === 'minimax') return 512_000
  if (family === 'codex') return 400_000
  return 200_000
}

/* -------------------------------------------------------------------------- */
/* ACP Tool Call Reducer & Native DSH Live Stream Projector                   */
/* -------------------------------------------------------------------------- */

export class AcpToolCallReducer {
  constructor() {
    this.calls = new Map()
  }

  apply(update) {
    const callId = String(update.toolCallId || makeId('acp-tool'))
    const prev = this.calls.get(callId) ?? {
      toolCallId: callId,
      status: 'pending',
      title: undefined,
      kind: undefined,
      name: undefined,
      rawInput: undefined,
      input: undefined,
      rawOutput: undefined,
      content: undefined,
    }
    const next = {
      ...prev,
      ...(typeof update.title === 'string' && update.title ? { title: update.title } : {}),
      ...(typeof update.kind === 'string' && update.kind ? { kind: update.kind } : {}),
      ...(typeof update.name === 'string' && update.name ? { name: update.name } : {}),
      ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
      ...(update.input !== undefined ? { input: update.input } : {}),
      ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
      ...(Array.isArray(update.content) && update.content.length > 0 ? { content: update.content } : {}),
      ...(typeof update.status === 'string' && update.status ? { status: update.status } : {}),
    }
    this.calls.set(callId, next)
    return next
  }
}

export function safeAppendEvent(session, type, data, opts = undefined, ctx = undefined) {
  try {
    return opts !== undefined ? session.append(type, data, opts) : session.append(type, data)
  } catch (err) {
    ctx?.logger?.warn?.(`acp-hub: decorative event "${type}" skipped: ${String(err?.message ?? err)}`)
    return null
  }
}

const sessionStreamCounters = new Map()

function getSessionStreamCounter(sessionId) {
  const key = String(sessionId || '')
  let counter = sessionStreamCounters.get(key)
  if (!counter) {
    counter = { attemptNo: 0, revision: 0 }
  } else {
    sessionStreamCounters.delete(key)
  }
  sessionStreamCounters.set(key, counter)
  if (sessionStreamCounters.size > MAX_STORED_SESSIONS) {
    const oldest = sessionStreamCounters.keys().next().value
    if (oldest !== undefined) sessionStreamCounters.delete(oldest)
  }
  return counter
}

export function extractAcpChunkText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(extractAcpChunkText).join('')
  if (typeof content === 'object') {
    if ((!content.type || content.type === 'text' || content.type === 'thinking' || content.type === 'reasoning') && typeof content.text === 'string') {
      return content.text
    }
    if (typeof content.thinking === 'string') return content.thinking
  }
  return ''
}

export class AcpMirrorStream {
  constructor(ctx, session, modelLabel, turnNo = 1, options = {}) {
    this.ctx = ctx
    this.session = session
    this.provider = String(options.provider || 'acp-hub')
    this.model = String(modelLabel || 'acp-model')
    this.turn = turnNo
    this.agent = { id: session.id, session }
    this._streamCounter = getSessionStreamCounter(session?.id)
    this.attempt = undefined
    this.activeBlock = undefined
    this.blocks = []
    this.step = 1
    this.stepSettled = false
    this.settled = false
    this.sawReasoning = Boolean(options.sawReasoning)
    this.sawReasoningPositive = false
    this.sawCacheWritePositive = false
    this.zcodeRowsConsumed = 0
    this.resolveStepUsage = typeof options.resolveStepUsage === 'function' ? options.resolveStepUsage : null
  }

  get attemptNo() {
    return this._streamCounter.attemptNo
  }

  set attemptNo(val) {
    this._streamCounter.attemptNo = val
  }

  get revision() {
    return this._streamCounter.revision
  }

  set revision(val) {
    this._streamCounter.revision = val
  }

  zeroStepUsage() {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    }
  }

  formatStepUsage(raw, { isFinal = false } = {}) {
    if (!raw || typeof raw !== 'object') return undefined
    const inputTokens = toNonNegInt(raw.inputTokens)
    const cacheReadTokens = toNonNegInt(raw.cacheReadTokens)
    const rawCacheWrite = toNonNegInt(raw.cacheWriteTokens)
    const rawReasoning = toNonNegInt(raw.reasoningTokens)
    const promptTokens = inputTokens + cacheReadTokens + rawCacheWrite
    const { outputTokens, reasoningTokens } = reconcileOutputAndReasoning(
      promptTokens,
      raw.outputTokens,
      rawReasoning,
      raw.totalTokens,
    )
    const totalTokens = promptTokens + outputTokens

    if (rawCacheWrite > 0) this.sawCacheWritePositive = true
    if (reasoningTokens > 0) {
      this.sawReasoningPositive = true
      this.sawReasoning = true
    }

    const includeCacheWrite = rawCacheWrite > 0 || this.sawCacheWritePositive || !isFinal
    const includeReasoning = reasoningTokens > 0 || this.sawReasoningPositive || (!isFinal && this.sawReasoning)

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalTokens,
      ...(includeCacheWrite ? { cacheWriteTokens: rawCacheWrite } : {}),
      ...(includeReasoning ? { reasoningTokens } : {}),
    }
  }

  buildRoute(routeOverride) {
    const provider = String(routeOverride?.provider || this.provider || 'acp-hub').trim() || 'acp-hub'
    const model = String(routeOverride?.model || this.model || 'acp-model').trim() || 'acp-model'
    return { kind: 'model', provider, model }
  }

  emit(frame) {
    try {
      this.ctx.emit('agent/assistant-stream', { agent: this.agent, frame })
    } catch {}
  }

  chunk(chunk) {
    if (!this.attempt) return
    const time = Date.now()
    this.attempt.records.push({ type: 'chunk', time, chunk })
    this.emit({
      type: 'chunk',
      attemptId: this.attempt.attemptId,
      revision: ++this.revision,
      index: this.attempt.nextIndex++,
      time,
      chunk,
    })
  }

  beginAttempt() {
    if (this.attempt) return
    if (this.stepSettled) {
      this.nextStep()
    }
    const attemptId = `${this.session.id}:t${this.turn}:${++this.attemptNo}`
    this.attempt = { attemptId, records: [], nextIndex: 0 }
    this.emit({
      type: 'start',
      attemptId,
      revision: ++this.revision,
      turn: this.turn,
      step: this.step,
    })
  }

  closeBlock() {
    const active = this.activeBlock
    if (!active) return
    this.activeBlock = undefined
    if (active.text === '' && active.type !== 'tool-call') return
    this.chunk({ type: 'block-end', index: active.index, block: active.block })
  }

  beginBlock(type) {
    this.beginAttempt()
    this.closeBlock()
    const index = this.blocks.length
    const block = type === 'tool-call' ? undefined : { type, text: '' }
    this.blocks.push(block ?? { type: 'tool-call', id: '', name: '', arguments: '' })
    this.activeBlock = { index, type, text: '', block }
    this.chunk({ type: 'block-start', index, blockType: type })
  }

  append(type, value) {
    const body = String(value ?? '')
    if (!body) return
    if (type === 'reasoning') this.sawReasoning = true
    if (!this.activeBlock || this.activeBlock.type !== type) this.beginBlock(type)
    this.activeBlock.text += body
    if (type !== 'tool-call') this.activeBlock.block.text = this.activeBlock.text
    this.chunk({
      type: type === 'reasoning' ? 'reasoning-delta' : 'text-delta',
      index: this.activeBlock.index,
      text: body,
    })
  }

  tool(mergedCall, precomputed = null) {
    this.beginAttempt()
    this.closeBlock()
    const index = this.blocks.length
    const callId = String(precomputed?.callId ?? mergedCall.toolCallId ?? makeId('acp-tool'))
    const toolTitle = String(precomputed?.name ?? acpToolName(mergedCall))
    const args = String(precomputed?.arguments ?? acpToolArguments(mergedCall))
    const block = { type: 'tool-call', id: callId, name: toolTitle, arguments: args }
    this.blocks.push(block)
    this.activeBlock = { index, type: 'tool-call', text: args, block }
    this.chunk({ type: 'block-start', index, blockType: 'tool-call' })
    this.chunk({ type: 'tool-call-delta', index, id: callId, name: toolTitle, argumentsDelta: args })
    this.closeBlock()
  }

  settle(explicitUsage = undefined, explicitRoute = undefined, { isFinal = false } = {}) {
    this.closeBlock()
    if (!this.attempt) return
    if (this.blocks.length > 0) {
      let stepUsage = explicitUsage !== undefined
        ? this.formatStepUsage(explicitUsage, { isFinal })
        : undefined
      let stepRoute = explicitRoute
      if (stepUsage === undefined && !isFinal && this.resolveStepUsage) {
        const resolved = this.resolveStepUsage()
        if (resolved?.usage) {
          stepUsage = this.formatStepUsage(resolved.usage, { isFinal: false })
          stepRoute = resolved.route ?? stepRoute
          this.zcodeRowsConsumed += Number(resolved.rowCount || 1)
        }
      }
      if (stepUsage === undefined && !isFinal) {
        stepUsage = this.zeroStepUsage()
      } else if (stepUsage === undefined && isFinal && (this.step > 1 || this.zcodeRowsConsumed > 0)) {
        stepUsage = this.formatStepUsage(
          { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 },
          { isFinal: true },
        )
      }
      if (stepUsage !== undefined) {
        this.chunk({ type: 'usage', usage: stepUsage })
      }
      const hasToolCalls = this.blocks.some(b => b?.type === 'tool-call')
      this.chunk({ type: 'finish', reason: { kind: hasToolCalls ? 'tool-calls' : 'stop' } })
      const seq = this.session.append('assistant/message', {
        turn: this.turn,
        step: this.step,
        message: {
          id: makeId('acp-message'),
          role: 'assistant',
          content: this.blocks.map(block => block.type === 'tool-call'
            ? { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }
            : { type: block.type, text: block.text }),
          source: this.buildRoute(stepRoute),
        },
        ...(stepUsage !== undefined ? { usage: stepUsage } : {}),
        stream: this.attempt.records,
      }, { surfaceOp: 'append' }).seq
      this.stepSettled = true
      this.emit({
        type: 'end',
        attemptId: this.attempt.attemptId,
        revision: ++this.revision,
        index: this.attempt.nextIndex,
        outcome: { kind: 'committed', eventType: 'assistant/message', seq },
      })
    } else {
      this.emit({
        type: 'end',
        attemptId: this.attempt.attemptId,
        revision: ++this.revision,
        index: this.attempt.nextIndex,
        outcome: { kind: 'abandoned' },
      })
    }
    this.attempt = undefined
    this.activeBlock = undefined
    this.blocks = []
  }

  nextStep() {
    if (this.attempt) this.settle(undefined, undefined, { isFinal: false })
    if (!this.stepSettled) {
      this.session.append('assistant/message', {
        turn: this.turn,
        step: this.step,
        message: {
          id: makeId('acp-message'),
          role: 'assistant',
          content: [],
          source: this.buildRoute(),
        },
        usage: this.zeroStepUsage(),
        stream: [],
      }, { surfaceOp: 'append' })
      this.stepSettled = true
    }
    this.session.append('step/end', { turn: this.turn, step: this.step })
    this.step += 1
    this.stepSettled = false
    this.session.append('step/start', { turn: this.turn, step: this.step })
  }

  finishAll(finalUsage = undefined, finalRoute = undefined) {
    if (this.attempt && this.blocks.length > 0) {
      this.settle(finalUsage, finalRoute, { isFinal: true })
      this.settled = true
      return
    }
    if (this.attempt) {
      // Empty attempt with 0 blocks -> abandon stream frame first
      this.settle(undefined, undefined, { isFinal: true })
    }
    if (this.stepSettled) {
      // Never emit a trailing empty-content assistant/message step: DSH latestAnswer()
      // inspects turn.steps.at(-1), so a trailing content:[] step breaks foldedReplies:final.
      this.settled = true
      return
    }
    // Current step is open (`stepSettled === false`) with 0 blocks:
    if (finalUsage !== undefined || this.step > 1 || this.zcodeRowsConsumed > 0) {
      const formatted = finalUsage !== undefined
        ? this.formatStepUsage(finalUsage, { isFinal: true })
        : this.formatStepUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }, { isFinal: true })
      this.session.append('assistant/message', {
        turn: this.turn,
        step: this.step,
        message: {
          id: makeId('acp-message'),
          role: 'assistant',
          content: [],
          source: this.buildRoute(finalRoute),
        },
        ...(formatted !== undefined ? { usage: formatted } : {}),
        stream: [],
      }, { surfaceOp: 'append' })
      this.stepSettled = true
    } else {
      // Unbilled 1-step empty failure (e.g. CLI startup error before any output or usage):
      // still append an unattributed empty message ONLY if nothing settled, or leave unbilled.
      this.session.append('assistant/message', {
        turn: this.turn,
        step: this.step,
        message: {
          id: makeId('acp-message'),
          role: 'assistant',
          content: [],
          source: this.buildRoute(finalRoute),
        },
        stream: [],
      }, { surfaceOp: 'append' })
      this.stepSettled = true
    }
    this.settled = true
  }
}

function publishMirrorStatus(ctx, agent, status) {
  try { ctx.emit('agent/status', { agent, status }) } catch {}
  try { ctx.emit('api-session/status', agent.id, status === 'running') } catch {}
}

function acpToolName(update) {
  return String(update.title || update.name || update.kind || update.toolCallId || 'acp-tool')
}

function acpToolArguments(update) {
  const input = update.rawInput ?? update.input
  if (input === undefined) return '{}'
  if (typeof input === 'string') return input
  try { return JSON.stringify(input) } catch { return '{}' }
}

function acpToolContent(update) {
  const content = []
  for (const item of Array.isArray(update.content) ? update.content : []) {
    if (item && item.type === 'content' && item.content && item.content.type === 'text') {
      content.push({ type: 'text', text: String(item.content.text ?? '') })
    } else if (item && item.type === 'text') {
      content.push({ type: 'text', text: String(item.text ?? '') })
    } else if (item && item.type === 'diff') {
      const fileHeader = typeof item.path === 'string' ? `--- ${item.path}\n` : ''
      const diffBody = item.diff ?? (item.newText !== undefined ? item.newText : '')
      content.push({ type: 'text', text: `${fileHeader}${String(diffBody ?? '')}` })
    }
  }
  if (content.length === 0 && update.rawOutput !== undefined) {
    const output = update.rawOutput
    if (output && Array.isArray(output.content)) {
      for (const item of output.content) {
        if (item && item.type === 'text') content.push({ type: 'text', text: String(item.text ?? '') })
      }
    }
    if (content.length === 0) {
      content.push({ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output, null, 2) })
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: String(update.status || 'completed') })
  return content
}

function hasAcpToolInput(update) {
  return update.rawInput !== undefined || update.input !== undefined
}

export function createAcpToolCoordinator({
  stream,
  session,
  coalesceMs = 60,
  enqueue = fn => fn(),
  onStepSettled = () => {},
  onAllStepToolsFinished = () => {},
}) {
  const unready = new Map()
  const readyBuffer = new Map()
  const readyTerminal = new Map()
  const advertised = new Map()
  const deferred = new Map()
  const deferredTerminal = new Map()
  const completedIds = new Set()
  let flushTimer = null
  let disposed = false

  const clearTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  const emitResult = (entry, call) => {
    const failed = call.status === 'failed' || call.status === 'cancelled'
    session.append('tool/result', {
      turn: stream.turn,
      step: stream.step,
      message: {
        id: makeId('acp-tool-result'),
        role: 'tool',
        toolCallId: entry.callId,
        source: { kind: 'tool', callId: entry.callId },
        content: acpToolContent(call),
        isError: failed,
      },
      ...(failed ? { error: { name: 'AcpToolError', code: 'ACP_TOOL_FAILED' } } : {}),
    }, { surfaceOp: 'append', sourceEventSeqs: entry.seq === null ? [] : [entry.seq] })
  }

  const flushReadyBuffer = ({ forceUnready = false } = {}) => {
    clearTimer()
    if (forceUnready && unready.size > 0) {
      for (const [cid, c] of unready) {
        if (!readyBuffer.has(cid)) readyBuffer.set(cid, c)
      }
      unready.clear()
    }
    if (readyBuffer.size === 0) return false
    if (stream.stepSettled) {
      for (const [cid, c] of readyBuffer) {
        deferred.set(cid, c)
      }
      for (const [cid, tc] of readyTerminal) {
        deferredTerminal.set(cid, tc)
      }
      readyBuffer.clear()
      readyTerminal.clear()
      return false
    }
    if (unready.size > 0) {
      for (const [cid, c] of unready) {
        deferred.set(cid, c)
      }
      unready.clear()
    }
    const batch = []
    for (const [callId, call] of readyBuffer) {
      batch.push({
        callId,
        name: acpToolName(call),
        arguments: acpToolArguments(call),
        call,
      })
    }
    readyBuffer.clear()
    // Emit all tool-call blocks into the single assistant/message of this step BEFORE settle()
    // so DSH v4 worker validator accepts parallel tool/call events in the same step.
    for (const item of batch) {
      stream.tool(item.call, item)
    }
    stream.settle()
    onStepSettled()
    for (const item of batch) {
      const seq = session.append('tool/call', {
        turn: stream.turn,
        step: stream.step,
        callId: item.callId,
        name: item.name,
        arguments: item.arguments,
      }).seq
      advertised.set(item.callId, { ...item, seq })
    }
    for (const item of batch) {
      const termCall = readyTerminal.get(item.callId)
      if (!termCall) continue
      readyTerminal.delete(item.callId)
      const adv = advertised.get(item.callId)
      if (adv) {
        emitResult(adv, termCall)
        advertised.delete(item.callId)
        completedIds.add(item.callId)
      }
    }
    readyTerminal.clear()
    return true
  }

  const drainAfterStepTools = () => {
    while (advertised.size === 0) {
      if (deferred.size > 0) {
        if (stream.stepSettled) {
          onAllStepToolsFinished({ advanceStepOnly: true })
        }
        for (const [cid, c] of deferred) {
          if (deferredTerminal.has(cid)) {
            const tc = deferredTerminal.get(cid)
            readyBuffer.set(cid, tc)
            readyTerminal.set(cid, tc)
          } else if (hasAcpToolInput(c)) {
            readyBuffer.set(cid, c)
          } else {
            unready.set(cid, c)
          }
        }
        deferred.clear()
        deferredTerminal.clear()
        if (readyBuffer.size > 0) {
          const flushed = flushReadyBuffer({ forceUnready: false })
          if (!flushed) break
          continue
        }
        return
      }
      onAllStepToolsFinished({ advanceStepOnly: false })
      return
    }
  }

  const armTimer = () => {
    if (flushTimer || disposed) return
    if (coalesceMs <= 0) {
      flushReadyBuffer({ forceUnready: false })
      if (advertised.size === 0) drainAfterStepTools()
      return
    }
    flushTimer = setTimeout(() => {
      flushTimer = null
      if (disposed) return
      enqueue(() => {
        if (disposed) return
        if (flushReadyBuffer({ forceUnready: false }) && advertised.size === 0) {
          drainAfterStepTools()
        }
      })
    }, coalesceMs)
    flushTimer.unref?.()
  }

  return {
    hasTool(callId) {
      const cid = String(callId || '')
      if (!cid) return false
      return advertised.has(cid) || readyBuffer.has(cid) || unready.has(cid) || deferred.has(cid)
    },
    idleInStep() {
      return advertised.size === 0 && readyBuffer.size === 0 && unready.size === 0 && deferred.size === 0
    },
    hasPendingOrActiveTools() {
      return advertised.size > 0 || readyBuffer.size > 0 || unready.size > 0 || deferred.size > 0
    },
    onToolUpdate(mergedCall, terminal) {
      const callId = String(mergedCall.toolCallId)
      if (completedIds.has(callId)) return
      if (advertised.has(callId)) {
        const entry = advertised.get(callId)
        entry.call = mergedCall
        if (terminal) {
          emitResult(entry, mergedCall)
          advertised.delete(callId)
          completedIds.add(callId)
          if (advertised.size === 0) drainAfterStepTools()
        }
        return
      }
      if (stream.stepSettled) {
        deferred.set(callId, mergedCall)
        if (terminal) deferredTerminal.set(callId, mergedCall)
        if (advertised.size === 0) drainAfterStepTools()
        return
      }
      if (hasAcpToolInput(mergedCall) || terminal) {
        unready.delete(callId)
        readyBuffer.set(callId, mergedCall)
        if (terminal) {
          readyTerminal.set(callId, mergedCall)
          flushReadyBuffer({ forceUnready: false })
          if (advertised.size === 0) drainAfterStepTools()
        } else {
          armTimer()
        }
      } else if (!readyBuffer.has(callId)) {
        unready.set(callId, mergedCall)
      }
    },
    flushBeforeChunk() {
      if (readyBuffer.size === 0 && unready.size === 0) return
      if (!stream.stepSettled) {
        flushReadyBuffer({ forceUnready: true })
        if (advertised.size === 0) drainAfterStepTools()
      }
    },
    flushAllIncomplete(reason) {
      disposed = true
      clearTimer()
      if (!stream.stepSettled && (readyBuffer.size > 0 || unready.size > 0)) {
        flushReadyBuffer({ forceUnready: true })
      }
      while (advertised.size > 0 || deferred.size > 0 || readyBuffer.size > 0 || unready.size > 0) {
        for (const [cid, entry] of advertised) {
          session.append('tool/result', {
            turn: stream.turn,
            step: stream.step,
            message: {
              id: makeId('acp-tool-result'),
              role: 'tool',
              toolCallId: cid,
              source: { kind: 'tool', callId: cid },
              content: text(reason),
              isError: true,
            },
            error: { name: 'AcpToolError', code: 'ACP_TOOL_INCOMPLETE' },
          }, { surfaceOp: 'append', sourceEventSeqs: entry.seq === null ? [] : [entry.seq] })
          completedIds.add(cid)
          advertised.delete(cid)
        }
        if (deferred.size > 0 || unready.size > 0) {
          if (stream.stepSettled) {
            onAllStepToolsFinished({ advanceStepOnly: true })
          }
          for (const [cid, c] of deferred) {
            const chosen = deferredTerminal.get(cid) ?? c
            readyBuffer.set(cid, chosen)
            if (deferredTerminal.has(cid)) readyTerminal.set(cid, chosen)
          }
          deferred.clear()
          deferredTerminal.clear()
          for (const [cid, c] of unready) {
            if (!readyBuffer.has(cid)) readyBuffer.set(cid, c)
          }
          unready.clear()
          if (readyBuffer.size > 0) {
            flushReadyBuffer({ forceUnready: true })
          }
        }
      }
      onAllStepToolsFinished({ advanceStepOnly: false })
    },
  }
}

export function announceAcpToolIfReady(stream, session, mergedCall, pending, forceAnnounce = false) {
  const callId = String(mergedCall.toolCallId)
  let entry = pending.get(callId)
  if (!entry) {
    entry = { seq: null, announced: false, call: mergedCall, name: '', arguments: '' }
    pending.set(callId, entry)
  }
  entry.call = mergedCall
  const terminal = mergedCall.status === 'completed' || mergedCall.status === 'failed' || mergedCall.status === 'cancelled'
  if (!entry.announced && (hasAcpToolInput(mergedCall) || terminal || forceAnnounce)) {
    if (stream.stepSettled) {
      stream.nextStep()
    }
    const name = acpToolName(mergedCall)
    const args = acpToolArguments(mergedCall)
    entry.name = name
    entry.arguments = args
    stream.tool(mergedCall, { callId, name, arguments: args })
    stream.settle()
    entry.seq = session.append('tool/call', {
      turn: stream.turn,
      step: stream.step,
      callId,
      name,
      arguments: args,
    }).seq
    entry.announced = true
  }
  return entry
}

export function completeAcpTool(stream, session, mergedCall, pending) {
  const callId = String(mergedCall.toolCallId)
  const entry = announceAcpToolIfReady(stream, session, mergedCall, pending, true)
  pending.delete(callId)
  const failed = mergedCall.status === 'failed' || mergedCall.status === 'cancelled'
  session.append('tool/result', {
    turn: stream.turn,
    step: stream.step,
    message: {
      id: makeId('acp-tool-result'),
      role: 'tool',
      toolCallId: callId,
      source: { kind: 'tool', callId },
      content: acpToolContent(mergedCall),
      isError: failed,
    },
    ...(failed ? { error: { name: 'AcpToolError', code: 'ACP_TOOL_FAILED' } } : {}),
  }, { surfaceOp: 'append', sourceEventSeqs: entry.seq === null ? [] : [entry.seq] })
}

export function flushIncompleteAcpTools(stream, session, pending, reason) {
  for (const [rawId, entry] of pending) {
    const callId = String(rawId)
    const finalized = announceAcpToolIfReady(stream, session, entry.call, pending, true)
    session.append('tool/result', {
      turn: stream.turn,
      step: stream.step,
      message: {
        id: makeId('acp-tool-result'),
        role: 'tool',
        toolCallId: callId,
        source: { kind: 'tool', callId },
        content: text(reason),
        isError: true,
      },
      error: { name: 'AcpToolError', code: 'ACP_TOOL_INCOMPLETE' },
    }, { surfaceOp: 'append', sourceEventSeqs: finalized.seq === null ? [] : [finalized.seq] })
  }
  pending.clear()
}

/* -------------------------------------------------------------------------- */
/* ACP Session Config Selection & Same-ChildId Session Acquisition            */
/* -------------------------------------------------------------------------- */

async function applyAcpSelection(ctx, agent, sessionId, spec) {
  // 1. Apply native client permission/execution mode if configured
  if (typeof spec.mode === 'string' && spec.mode.length > 0) {
    if (spec.modeSource === 'setMode') {
      try {
        await agent.request(methods.agent.session.setMode, { sessionId, modeId: spec.mode })
      } catch (err) {
        ctx.logger?.warn?.(`acp-hub: setMode ${spec.mode} failed: ${String(err?.message ?? err)}`)
      }
    } else {
      const modeIds = spec.modeConfigId
        ? [spec.modeConfigId]
        : ['mode', 'permissionMode', 'approval_policy']
      for (const cid of modeIds) {
        try {
          await agent.request(methods.agent.session.setConfigOption, { sessionId, configId: cid, value: spec.mode })
          break
        } catch {}
      }
    }
  }

  // 2. Apply model BEFORE reasoning effort so per-model effort validation uses the new model
  if (typeof spec.model === 'string' && spec.model.length > 0) {
    try {
      await agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: spec.model })
    } catch (error) {
      ctx.logger?.warn?.(`acp-hub: set model=${spec.model} failed: ${String(error?.message ?? error)}`)
    }
  }

  // 3. Apply reasoning effort using detected configId (with safe fallbacks)
  if (typeof spec.reasoning === 'string' && spec.reasoning.length > 0) {
    const rIds = spec.reasoningConfigId
      ? [spec.reasoningConfigId]
      : ['reasoning_effort', 'thinkingEffort', 'thought_level', 'effort']
    for (const cid of rIds) {
      try {
        await agent.request(methods.agent.session.setConfigOption, { sessionId, configId: cid, value: spec.reasoning })
        break
      } catch {}
    }
  }

  // 4. Apply any extra custom config keys
  for (const [configId, raw] of Object.entries(spec.config ?? {})) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    if (configId === 'model' || REASONING_CONFIG_IDS.has(configId) || MODE_CONFIG_IDS.has(configId)) continue
    try {
      await agent.request(methods.agent.session.setConfigOption, { sessionId, configId, value: raw })
    } catch (error) {
      ctx.logger?.warn?.(`acp-hub: set ${configId}=${raw} failed: ${String(error?.message ?? error)}`)
    }
  }
}

export function wrapPersistenceHandle(ctx, session, handle) {
  let closed = false
  return {
    handle,
    async close() {
      if (closed) return
      closed = true
      // Yield one turn and drain `session/flush` (including `SessionProjectionCache`'s `turn/end`
      // checkpoint barrier) BEFORE closing the handle so `writer.flush()` never races `handle.closing`.
      await new Promise(r => setTimeout(r, 0))
      try { await ctx.sessions?.flush?.(session) } catch {}
      try { await handle?.close?.() } catch {}
    },
  }
}

export function computeNextTurnAndRepairOpenTail(session, fallbackPrevTurn = 0) {
  let maxTurn = fallbackPrevTurn
  let openTurn = null
  let openStep = null
  try {
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
    for (const ev of events) {
      const t = ev?.data?.turn
      if (typeof t === 'number' && Number.isSafeInteger(t) && t > maxTurn) {
        maxTurn = t
      }
      if (ev.type === 'turn/start' && typeof t === 'number') {
        openTurn = t
        openStep = null
      } else if (ev.type === 'step/start' && typeof ev?.data?.step === 'number') {
        openStep = ev.data.step
      } else if (ev.type === 'step/end') {
        openStep = null
      } else if (ev.type === 'turn/end') {
        openTurn = null
        openStep = null
      }
    }
    if (openTurn !== null) {
      if (openStep !== null) {
        try { session.append('step/end', { turn: openTurn, step: openStep }) } catch {}
      }
      try { session.append('turn/end', { turn: openTurn, reason: { kind: 'aborted' } }) } catch {}
    }
  } catch {}
  return Math.max(1, maxTurn + 1)
}

export async function acquireChildSession(ctx, childId, isContinuation, createMeta, priorTurn = 0) {
  const persistenceSvc = ctx.get?.('sessionPersistence')

  const createFreshSession = async (targetId) => {
    const childSession = ctx.sessions.prepare(targetId, { meta: createMeta })
    let handle
    if (persistenceSvc && typeof persistenceSvc.create === 'function') {
      try {
        handle = await persistenceSvc.create(childSession.header, {
          inheritedEventCount: childSession.inheritedEventCount,
        })
        const unstored = typeof childSession.snapshotEvents === 'function'
          ? childSession.snapshotEvents(0)
          : []
        if (Array.isArray(unstored) && unstored.length > 0) {
          await handle.append(unstored)
        }
      } catch (err) {
        try { await handle?.close?.() } catch {}
        handle = undefined
        ctx.logger?.warn?.(`acp-hub: create persistence ${targetId} failed: ${String(err?.message ?? err)}`)
      }
    }
    try {
      ctx.sessions.enter(childSession)
      ctx.sessions.announce(childSession)
    } catch (err) {
      try { await handle?.close?.() } catch {}
      throw err
    }
    return {
      childSession,
      persistence: wrapPersistenceHandle(ctx, childSession, handle),
      turnNo: 1,
      isNewSession: true,
    }
  }

  if (!isContinuation) {
    return await createFreshSession(childId)
  }

  // Continuation on existing childId: reuse live session or cold-restore from persistence
  let childSession = ctx.sessions.get?.(childId)
  let handle
  if (childSession) {
    if (persistenceSvc && typeof persistenceSvc.open === 'function') {
      try {
        handle = await persistenceSvc.open(childId, 'write')
      } catch (err) {
        ctx.logger?.warn?.(`acp-hub: reopen write persistence ${childId} failed: ${String(err?.message ?? err)}`)
      }
    }
    const turnNo = computeNextTurnAndRepairOpenTail(childSession, priorTurn)
    return {
      childSession,
      persistence: wrapPersistenceHandle(ctx, childSession, handle),
      turnNo,
      isNewSession: false,
    }
  }

  if (persistenceSvc && typeof persistenceSvc.open === 'function') {
    try {
      handle = await persistenceSvc.open(childId, 'write')
      const stored = await handle.read()
      childSession = ctx.sessions.prepare(childId, {
        seed: stored.events,
        meta: handle.header,
        inheritedEventCount: stored.inheritedEventCount ?? handle.header?.inheritedEventCount ?? 0,
        eventState: stored.eventState ?? 'shared-frozen',
      })
      const unstored = typeof childSession.snapshotEvents === 'function'
        ? childSession.snapshotEvents(stored.events.length)
        : []
      if (Array.isArray(unstored) && unstored.length > 0) {
        await handle.append(unstored)
      }
      ctx.sessions.enter(childSession)
      ctx.sessions.announce(childSession)
      const turnNo = computeNextTurnAndRepairOpenTail(childSession, priorTurn)
      return {
        childSession,
        persistence: wrapPersistenceHandle(ctx, childSession, handle),
        turnNo,
        isNewSession: false,
      }
    } catch (err) {
      try { await handle?.close?.() } catch {}
      ctx.logger?.warn?.(`acp-hub: cold restore ${childId} failed, falling back to new session: ${String(err?.message ?? err)}`)
    }
  }

  // Fallback if persistence file was manually deleted
  return await createFreshSession(`session-acp-${randomUUID()}`)
}

function composeTaskPrompt(spec, rawTask, isResume) {
  const instructions = typeof spec.instructions === 'string' ? spec.instructions.trim() : ''
  if (!instructions || isResume) return rawTask
  return `${instructions}\n\n---\n\n${rawTask}`
}

/* -------------------------------------------------------------------------- */
/* Core ACP Execution (Same-ChildId Multi-Turn & Cooperative Cancellation)    */
/* -------------------------------------------------------------------------- */

const activeRuns = new Map()

function terminateChildProcess(child) {
  if (!child) return
  try { child.stdin?.end?.() } catch {}
  const timerTerm = setTimeout(() => {
    try { child.kill?.('SIGTERM') } catch {}
  }, 1800)
  timerTerm.unref?.()
  const timerKill = setTimeout(() => {
    try { child.kill?.('SIGKILL') } catch {}
  }, 4500)
  timerKill.unref?.()
}

function lookupCachedCatalogCurrent(resolvedCommand, spec) {
  if (!resolvedCommand) return ''
  const baseKey = `${resolvedCommand}\u0000${(spec.args ?? []).join('\u0000')}\u0000${JSON.stringify(spec.env ?? {})}`
  return modelCatalogCache.get(baseKey)?.value?.current ?? ''
}

async function runAcp(parentAgentOrNull, ctx, spec, rawTask, agentKey, toolName, options = {}) {
  const resolvedCommand = resolveExecutable(spec.command)
  if (!resolvedCommand) {
    throw new Error(`找不到可执行命令 "${spec.command}"，请在「ACP 委派」设置页检查路径或安装对应 CLI。`)
  }

  if (options.resumeChildId && spec.allowResume === false) {
    throw new Error(`ACP agent "${spec.name}" (${agentKey}) has same-session continuation disabled (allowResume=false); omit resumeChildId to start an independent clean-slate subagent session.`)
  }

  const priorRecord = options.resumeChildId ? lookupContinuationEntry(options.resumeChildId) : null
  if (options.resumeChildId && !priorRecord) {
    throw new Error(`未找到可续派的子会话记录 "${options.resumeChildId}"。请去掉 resumeChildId 发起新委派。`)
  }
  if (priorRecord && priorRecord.agentId && priorRecord.agentId !== agentKey) {
    throw new Error(`子会话 "${options.resumeChildId}" 属于 "${priorRecord.agentId}"，不能跨智能体用 "${agentKey}" 续派。`)
  }

  const targetChildId = priorRecord ? priorRecord.childId : `session-acp-${randomUUID()}`
  if (activeRuns.has(targetChildId)) {
    throw new Error(`子会话 "${targetChildId}" 当前正在运行中，请等待本轮结束或先点击「中断任务」后再发送后续消息。`)
  }

  const parentSession = parentAgentOrNull?.session
    ?? (priorRecord?.parentSessionId ? ctx.sessions.get?.(priorRecord.parentSessionId) : undefined)
  const parentSessionId = parentSession?.id ?? priorRecord?.parentSessionId ?? ''
  const cwd = options.cwd ?? spec.cwd ?? priorRecord?.cwd ?? parentSession?.header?.cwd ?? process.cwd()
  const notifyParent = options.notifyParent !== false

  const acquired = await acquireChildSession(
    ctx,
    targetChildId,
    Boolean(priorRecord),
    {
      cwd,
      ...(parentSessionId ? { parentSession: parentSessionId } : {}),
      origin: 'subagent',
      delegationDepth: (parentSession?.header?.delegationDepth ?? 0) + 1,
    },
    Number(priorRecord?.turn ?? 0),
  )

  const childSession = acquired.childSession
  const childId = childSession.id
  const persistence = acquired.persistence
  const turnNo = acquired.turnNo
  const badgeLabel = `${spec.name} · ${agentKey}`
  const family = inferClientFamily(agentKey, spec)
  const catalogCurrent = lookupCachedCatalogCurrent(resolvedCommand, spec)
  const effectiveModel = extractEffectiveModelHint(family, spec.model, catalogCurrent)
  let lastContextWindow = resolveAgentContextWindow(family, spec.model, catalogCurrent)
  let pendingContextWindow = 0

  if (acquired.isNewSession) {
    safeAppendEvent(childSession, 'subagent/descriptor', {
      version: 3,
      mode: 'one-shot',
      provider: 'acp-hub',
      label: badgeLabel,
    }, undefined, ctx)
  }
  childSession.append('turn/start', { turn: turnNo })
  if (lastContextWindow > 0) {
    safeAppendEvent(childSession, 'request/context', { contextWindow: lastContextWindow }, undefined, ctx)
  }
  childSession.append('step/start', { turn: turnNo, step: 1 })

  const finalPromptText = composeTaskPrompt(spec, rawTask, Boolean(priorRecord))
  childSession.append('user/message', {
    id: makeId('acp-task'),
    role: 'user',
    content: text(rawTask),
    source: { kind: 'user' },
  }, { surfaceOp: 'append' })

  if (acquired.isNewSession && parentSession) {
    safeAppendEvent(parentSession, 'subagent/catalog', {
      version: 0,
      childId,
      childCreatedAt: childSession.header?.createdAt ?? Date.now(),
      mode: 'one-shot',
      label: badgeLabel,
    }, undefined, ctx)
  }

  let remoteSessionId
  let consumedSqliteRowIds = null
  const preseedReasoning = Boolean(spec.reasoning) || /thinking|:v:thinking|reasoner/i.test(`${effectiveModel} ${spec.model ?? ''}`)
  const stream = new AcpMirrorStream(
    ctx,
    childSession,
    effectiveModel || spec.name,
    turnNo,
    {
      provider: agentKey,
      sawReasoning: preseedReasoning,
      resolveStepUsage: () => consumeNewSqliteStepUsage(family, remoteSessionId, consumedSqliteRowIds),
    },
  )
  const mirrorAgent = { id: childId, session: childSession }
  publishMirrorStatus(ctx, mirrorAgent, 'running')

  const reducer = new AcpToolCallReducer()
  const state = {
    finished: false,
    cancelled: false,
    cancelReason: '',
    replaying: false,
    stepText: '',
    contextUsage: undefined,
    completedTools: new Set(),
    toolResultSeen: false,
    deferredChunks: [],
  }

  const flushPendingContextWindow = () => {
    if (pendingContextWindow > 0 && pendingContextWindow !== lastContextWindow && !stream.attempt) {
      lastContextWindow = pendingContextWindow
      pendingContextWindow = 0
      safeAppendEvent(childSession, 'request/context', { contextWindow: lastContextWindow }, undefined, ctx)
    }
  }

  const advanceToNextStep = () => {
    stream.nextStep()
    flushPendingContextWindow()
    state.toolResultSeen = false
    state.stepText = ''
  }

  const flushDeferredChunks = () => {
    if (state.deferredChunks.length === 0 || coordinator.hasPendingOrActiveTools()) return
    if (state.toolResultSeen || stream.stepSettled) {
      advanceToNextStep()
    }
    const items = state.deferredChunks.splice(0)
    for (const item of items) {
      if (item.trackAsAnswer) state.stepText += item.text
      stream.append(item.type, item.text)
    }
  }

  let child
  let agent
  let resumed = false
  let updateChain = Promise.resolve()
  const coordinator = createAcpToolCoordinator({
    stream,
    session: childSession,
    coalesceMs: 60,
    enqueue: (fn) => {
      updateChain = updateChain.then(() => {
        if (state.finished || state.replaying) return
        try {
          fn()
        } catch (err) {
          ctx.logger?.warn?.(`acp-hub: deferred tool flush error in ${childId}: ${String(err?.message ?? err)}`)
        }
      })
      return updateChain
    },
    onStepSettled: () => {
      // Tool-bearing steps are intermediate orchestration steps, never the closing answer.
      state.stepText = ''
    },
    onAllStepToolsFinished: ({ advanceStepOnly }) => {
      if (advanceStepOnly) {
        advanceToNextStep()
        return
      }
      state.toolResultSeen = true
      flushDeferredChunks()
    },
  })

  const handleStreamChunk = ({ type, text: chunkText, trackAsAnswer = false }) => {
    if (!chunkText) return
    coordinator.flushBeforeChunk()
    if (coordinator.hasPendingOrActiveTools() && stream.stepSettled) {
      state.deferredChunks.push({ type, text: chunkText, trackAsAnswer })
      return
    }
    if (state.toolResultSeen || stream.stepSettled) {
      advanceToNextStep()
    }
    if (trackAsAnswer) state.stepText += chunkText
    stream.append(type, chunkText)
  }
  const startedAt = Date.now()
  let resolveCancelGate
  const cancelGate = new Promise((resolvePromise) => { resolveCancelGate = resolvePromise })

  const cancelRun = (reason = 'user-cancelled') => {
    if (state.finished || state.cancelled) return false
    state.cancelled = true
    state.cancelReason = reason
    if (agent && remoteSessionId) {
      try {
        void agent.notify(methods.agent.session.cancel, { sessionId: remoteSessionId }).catch(() => {})
      } catch {}
    }
    const forceTimer = setTimeout(() => {
      resolveCancelGate?.({ stopReason: 'cancelled' })
      terminateChildProcess(child)
    }, 450)
    forceTimer.unref?.()
    return true
  }

  activeRuns.set(childId, {
    childId,
    parentSessionId,
    agentId: agentKey,
    label: spec.name,
    model: spec.model || effectiveModel || '',
    round: turnNo,
    startedAt,
    cancel: cancelRun,
  })

  try {
    child = ctx.subprocess.spawn({
      argv: [resolvedCommand, ...spec.args],
      cwd,
      env: buildRichEnv(spec.env),
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: 3000,
    })
    if (!child.stdin || !child.stdout) throw new Error('ACP child did not expose stdio')

    const app = createAcpClientApp({ name: 'dsh-acp-hub' })
      .onNotification(methods.client.session.update, ({ params }) => {
        const update = params?.update
        if (!update || typeof update !== 'object' || state.finished || state.replaying) {
          return Promise.resolve()
        }
        // ZCode ACP forwards nested subagent updates with _meta.zcode.parentToolUseId;
        // drop them here so internal ZCode subagent chatter never pollutes this session or final notice.
        const nestedParentId = update._meta?.zcode?.parentToolUseId
        if (nestedParentId !== undefined && nestedParentId !== null && String(nestedParentId).trim() !== '') {
          return Promise.resolve()
        }
        updateChain = updateChain.then(() => {
          if (state.finished || state.replaying) return
          try {
            switch (update.sessionUpdate) {
              case 'agent_message_chunk': {
                const chunk = extractAcpChunkText(update.content)
                handleStreamChunk({ type: 'text', text: chunk, trackAsAnswer: true })
                break
              }
              case 'agent_thought_chunk': {
                const chunk = extractAcpChunkText(update.content)
                handleStreamChunk({ type: 'reasoning', text: chunk, trackAsAnswer: false })
                break
              }
              case 'tool_call':
              case 'tool_call_update': {
                const rawCallId = String(update.toolCallId || '')
                if (rawCallId !== '' && state.completedTools.has(rawCallId)) break
                if (!coordinator.hasTool(rawCallId) && coordinator.idleInStep() && state.toolResultSeen) {
                  advanceToNextStep()
                }
                const merged = reducer.apply(update)
                const terminal = merged.status === 'completed' || merged.status === 'failed' || merged.status === 'cancelled'
                coordinator.onToolUpdate(merged, terminal)
                if (terminal) {
                  state.completedTools.add(merged.toolCallId)
                }
                break
              }
              case 'usage_update': {
                state.contextUsage = update
                if (typeof update.size === 'number' && Number.isSafeInteger(update.size) && update.size > 0 && update.size !== lastContextWindow) {
                  if (!stream.attempt) {
                    lastContextWindow = update.size
                    pendingContextWindow = 0
                    safeAppendEvent(childSession, 'request/context', { contextWindow: update.size }, undefined, ctx)
                  } else {
                    pendingContextWindow = update.size
                  }
                }
                break
              }
              case 'plan': {
                const lines = (Array.isArray(update.entries) ? update.entries : [])
                  .map(entry => `${entry.status ? `[${entry.status}] ` : ''}${entry.content ?? ''}`)
                  .filter(Boolean)
                  .join('\n')
                if (lines) {
                  handleStreamChunk({ type: 'text', text: `计划更新：\n${lines}`, trackAsAnswer: false })
                }
                break
              }
              default:
                break
            }
          } catch (updateErr) {
            ctx.logger?.warn?.(`acp-hub: session/update error in ${childId}: ${String(updateErr?.message ?? updateErr)}`)
          }
        })
        return updateChain
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        if (state.cancelled) {
          return Promise.resolve({ outcome: { outcome: 'cancelled' } })
        }
        if (spec.permission === 'allow') {
          const allow = params.options?.find(option => option.kind === 'allow_once' || option.kind === 'allow_always')
          if (allow) return Promise.resolve({ outcome: { outcome: 'selected', optionId: allow.optionId } })
        }
        return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      })

    const connection = app.connect(ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout),
    ))
    agent = connection.agent

    const initResp = await withTimeout(
      agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
      15_000,
      () => terminateChildProcess(child),
    )
    const caps = initResp?.agentCapabilities ?? {}
    const canResume = caps?.sessionCapabilities?.resume !== undefined && caps?.sessionCapabilities?.resume !== null
    const canLoad = caps?.loadSession === true
    const mcpServers = buildSessionMcpServers(spec, caps, ctx)

    if (priorRecord?.remoteSessionId && (canResume || canLoad)) {
      try {
        if (canResume) {
          const resumedResp = await withTimeout(
            agent.request(methods.agent.session.resume, {
              sessionId: priorRecord.remoteSessionId,
              cwd,
              mcpServers,
            }),
            20_000,
          )
          remoteSessionId = resumedResp?.sessionId ?? priorRecord.remoteSessionId
          resumed = true
        } else {
          state.replaying = true
          try {
            const loadedResp = await withTimeout(
              agent.request(methods.agent.session.load, {
                sessionId: priorRecord.remoteSessionId,
                cwd,
                mcpServers,
              }),
              25_000,
            )
            remoteSessionId = loadedResp?.sessionId ?? priorRecord.remoteSessionId
            resumed = true
          } finally {
            state.replaying = false
          }
        }
      } catch (resumeErr) {
        state.replaying = false
        ctx.logger?.warn?.(`acp-hub: resume ${priorRecord.remoteSessionId} failed, starting fresh: ${String(resumeErr?.message ?? resumeErr)}`)
      }
    }

    if (!remoteSessionId) {
      const created = await withTimeout(
        agent.request(methods.agent.session.new, { cwd, mcpServers }),
        20_000,
        () => terminateChildProcess(child),
      )
      remoteSessionId = created?.sessionId
      if (priorRecord && !resumed) {
        stream.append('reasoning', `[提示] 远端会话恢复不可用，已自动建立新远端会话并在当前子会话中继续记录。\n`)
      }
    }

    if (typeof remoteSessionId !== 'string' || !remoteSessionId) {
      throw new Error('ACP 智能体未返回有效 sessionId')
    }

    if (state.cancelled) throw new Error('ACP run cancelled before selection')
    await applyAcpSelection(ctx, agent, remoteSessionId, spec)
    if (state.cancelled) throw new Error('ACP run cancelled before prompt dispatch')

    recordContinuationEntry(childId, {
      remoteSessionId,
      parentSessionId,
      agentId: agentKey,
      label: spec.name,
      model: spec.model || effectiveModel || '',
      cwd,
      canResume: canResume || canLoad,
      turn: turnNo,
    })

    const initialSqliteRows = family === 'zcode'
      ? queryZcodeModelUsageRows(remoteSessionId)
      : family === 'minimax'
        ? queryMinimaxTokenUsageRows(remoteSessionId)
        : null
    consumedSqliteRowIds = Array.isArray(initialSqliteRows)
      ? new Set(initialSqliteRows.map(r => r.id))
      : null

    const resolveParentAgent = () => {
      if (parentAgentOrNull && typeof parentAgentOrNull.followup === 'function') return parentAgentOrNull
      if (parentSessionId) {
        const liveParent = ctx.get?.('agents')?.get?.(parentSessionId)
        if (liveParent && typeof liveParent.followup === 'function') return liveParent
      }
      return null
    }

    void (async () => {
      try {
        const result = await Promise.race([
          agent.request(methods.agent.session.prompt, {
            sessionId: remoteSessionId,
            prompt: [{ type: 'text', text: finalPromptText }],
          }),
          cancelGate,
        ])
        await updateChain.catch(() => {})
        coordinator.flushAllIncomplete(
          state.cancelled ? 'ACP run was cancelled before this tool completed' : 'ACP ended before this tool reported completion',
        )
        flushDeferredChunks()
        const stop = state.cancelled || result?.stopReason === 'cancelled'
          ? 'aborted'
          : result?.stopReason === 'end_turn'
            ? 'completed'
            : result?.stopReason === 'max_tokens'
              ? 'max-tokens'
              : result?.stopReason === 'refusal'
                ? 'refusal'
                : 'error'
        if (stop === 'aborted') {
          stream.append('text', `\n[已中断] ACP 子任务已停止（${state.cancelReason || 'cancelled'}）。`)
        } else if (stop !== 'completed') {
          stream.append('text', `ACP child stopped: ${String(result?.stopReason ?? 'unknown')}`)
        }
        if (!state.stepText && stop === 'completed' && !stream.stepSettled && stream.blocks.length === 0) {
          stream.append('text', 'ACP completed without a closing message.')
        }
        const { usage: finalUsage, route: finalRoute } = await resolveTurnTokenUsage(
          family,
          remoteSessionId,
          consumedSqliteRowIds,
          result?.usage,
          state.contextUsage,
          { priorSqliteRowsConsumed: stream.zcodeRowsConsumed },
        )
        stream.finishAll(finalUsage, finalRoute)
        state.finished = true
        childSession.append('step/end', { turn: turnNo, step: stream.step })
        flushPendingContextWindow()
        childSession.append('turn/end', {
          turn: turnNo,
          reason: { kind: stop === 'completed' ? 'completed' : (stop === 'aborted' ? 'aborted' : 'error') },
        })
        publishMirrorStatus(ctx, mirrorAgent, 'idle')

        const targetParent = notifyParent ? resolveParentAgent() : null
        if (targetParent) {
          const resumeHint = spec.allowResume === false
            ? `Continuation policy: clean-slate only (same-session continuation is disabled for ${spec.name}; omit resumeChildId on future calls).`
            : (canResume || canLoad)
              ? `Optional continuation (childId="${childId}"): do NOT resume by default — pass resumeChildId="${childId}" ONLY if a follow-up directly depends on this subagent's prior context/edits; omit resumeChildId to start a fresh independent subagent for unrelated tasks or unbiased review.`
              : `childId="${childId}" (external ACP agent did not advertise session resume).`

          const notice = {
            id: makeId('acp-notice'),
            role: 'user',
            content: text([
              `Background ACP subagent ${spec.name} (${agentKey}, childId=${childId}, round=${turnNo}) ${stop === 'completed' ? 'finished' : `ended with ${stop}`}.`,
              resumeHint,
              state.stepText ? `Its closing message:\n${state.stepText.slice(0, 14000)}` : 'It left no closing message.',
            ].join('\n\n')),
            source: {
              kind: 'subagent-settled',
              form: 'notice',
              summary: `${spec.name} R${turnNo} ${stop}`,
              stopReason: stop,
              senderSessionId: childId,
            },
          }
          try { targetParent.followup(notice) } catch {}
        }
      } catch (error) {
        state.finished = true
        await updateChain.catch(() => {})
        const stop = state.cancelled ? 'aborted' : 'error'
        coordinator.flushAllIncomplete(
          state.cancelled ? 'ACP run cancelled' : 'ACP stream failed before this tool reported completion',
        )
        flushDeferredChunks()
        stream.append('text', state.cancelled
          ? `\n[已中断] ACP 子任务已停止。`
          : `ACP error: ${String(error?.message ?? error)}`)
        const { usage: finalUsage, route: finalRoute } = await resolveTurnTokenUsage(
          family,
          remoteSessionId,
          consumedSqliteRowIds,
          undefined,
          state.contextUsage,
          { priorSqliteRowsConsumed: stream.zcodeRowsConsumed },
        )
        stream.finishAll(finalUsage, finalRoute)
        childSession.append('step/end', { turn: turnNo, step: stream.step })
        flushPendingContextWindow()
        childSession.append('turn/end', { turn: turnNo, reason: { kind: stop === 'aborted' ? 'aborted' : 'error' } })
        publishMirrorStatus(ctx, mirrorAgent, 'idle')
        const targetParent = notifyParent ? resolveParentAgent() : null
        if (targetParent) {
          try {
            targetParent.followup({
              id: makeId('acp-notice'),
              role: 'user',
              content: text(state.cancelled
                ? `Background ACP subagent ${spec.name} (${agentKey}, childId=${childId}, round=${turnNo}) was cancelled.`
                : `Background ACP subagent ${spec.name} (${agentKey}, childId=${childId}, round=${turnNo}) failed: ${String(error?.message ?? error)}`),
              source: {
                kind: 'subagent-settled',
                form: 'notice',
                summary: `${spec.name} R${turnNo} ${stop}`,
                stopReason: stop,
                senderSessionId: childId,
              },
            })
          } catch {}
        }
      } finally {
        activeRuns.delete(childId)
        terminateChildProcess(child)
        await persistence?.close?.()
      }
    })()

    return {
      name: toolName,
      childId,
      parentSessionId,
      startedAt,
      resumed,
      round: turnNo,
    }
  } catch (error) {
    state.finished = true
    activeRuns.delete(childId)
    coordinator.flushAllIncomplete('ACP failed to start')
    stream.append('text', `ACP startup error: ${String(error?.message ?? error)}`)
    stream.finishAll()
    childSession.append('step/end', { turn: turnNo, step: stream.step })
    childSession.append('turn/end', { turn: turnNo, reason: { kind: 'error' } })
    publishMirrorStatus(ctx, mirrorAgent, 'idle')
    terminateChildProcess(child)
    await persistence?.close?.()
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* ACP Catalog, Model<->Reasoning Linkage & Permission Mode Probe             */
/* -------------------------------------------------------------------------- */

const modelCatalogCache = new Map()

function withTimeout(promise, ms, onTimeout) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.()
        reject(new Error(`timed out after ${ms}ms`))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function findModelConfigOption(options) {
  return options.find(opt =>
    opt && (opt.id === 'model' || (opt.category === 'model' && !REASONING_CONFIG_IDS.has(opt.id))),
  )
}

function findReasoningConfigOption(options) {
  return options.find(opt =>
    opt && (opt.category === 'thought_level' || REASONING_CONFIG_IDS.has(opt.id)),
  )
}

function findModeConfigOption(options) {
  return options.find(opt =>
    opt && (opt.category === 'mode' || opt.category === '_permission' || MODE_CONFIG_IDS.has(opt.id)),
  )
}

export async function probeAcpCatalog(ctx, spec, { forceRefresh = false, targetModel = '' } = {}) {
  const resolvedCommand = resolveExecutable(spec.command)
  if (!resolvedCommand) {
    throw new Error(`找不到可执行文件: ${spec.command}`)
  }
  const effectiveModel = String(targetModel || spec.model || '').trim()
  const baseKey = `${resolvedCommand}\u0000${spec.args.join('\u0000')}\u0000${JSON.stringify(spec.env ?? {})}`
  const cached = modelCatalogCache.get(baseKey)

  if (!forceRefresh && cached !== undefined && Date.now() - cached.at < 90_000) {
    const baseVal = cached.value
    if (!effectiveModel || effectiveModel === baseVal.probedModel) {
      return baseVal
    }
    const modelHit = baseVal.models.find(m => m.value === effectiveModel)
    if (Array.isArray(modelHit?.effortOptions)) {
      return {
        ...baseVal,
        probedModel: effectiveModel,
        reasoning: modelHit.effortOptions,
        reasoningCurrent: modelHit.defaultEffort || modelHit.effortOptions[0]?.value || '',
      }
    }
    if (cached.byModel?.has(effectiveModel)) {
      const sub = cached.byModel.get(effectiveModel)
      return {
        ...baseVal,
        probedModel: effectiveModel,
        reasoning: sub.reasoning,
        reasoningCurrent: sub.reasoningCurrent,
      }
    }
  }

  const slashCommands = []
  const child = ctx.subprocess.spawn({
    argv: [resolvedCommand, ...spec.args],
    cwd: spec.cwd ?? process.cwd(),
    env: buildRichEnv(spec.env),
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
    graceMs: 1000,
  })
  if (!child.stdin || !child.stdout) throw new Error('ACP catalog process did not expose stdio')

  const app = createAcpClientApp({ name: 'dsh-acp-hub-catalog' })
    .onNotification(methods.client.session.update, ({ params }) => {
      const update = params?.update
      if (update?.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
        for (const cmd of update.availableCommands) {
          if (cmd && typeof cmd.name === 'string' && !slashCommands.some(c => c.name === cmd.name)) {
            slashCommands.push({
              name: cmd.name,
              description: typeof cmd.description === 'string' ? cmd.description.slice(0, 120) : '',
            })
          }
        }
      }
      return Promise.resolve()
    })

  const connection = app.connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)))
  const agent = connection.agent
  try {
    const initResp = await withTimeout(
      agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
      12_000,
      () => terminateChildProcess(child),
    )
    const session = await withTimeout(
      agent.request(methods.agent.session.new, { cwd: spec.cwd ?? process.cwd(), mcpServers: [] }),
      15_000,
      () => terminateChildProcess(child),
    )
    await new Promise(r => setTimeout(r, 100))

    let options = Array.isArray(session.configOptions) ? session.configOptions : []
    const modelOption = findModelConfigOption(options)
    const modeOption = findModeConfigOption(options)
    let reasoningOption = findReasoningConfigOption(options)

    // Map per-model effortOptions from session.models.availableModels._meta if present (keep raw identifier, no translation)
    const availMetaByModel = new Map()
    for (const m of session.models?.availableModels ?? []) {
      const mid = String(m?.modelId ?? '')
      if (!mid) continue
      const eff = Array.isArray(m?._meta?.effortOptions)
        ? m._meta.effortOptions.map(e => ({ value: String(e.value), name: String(e.value) }))
        : undefined
      const dflt = typeof m?._meta?.defaultEffort === 'string' ? m._meta.defaultEffort : undefined
      const supportsReasoning = m?.supportsReasoningEffort !== false && m?._meta?.supportsReasoning !== false
      availMetaByModel.set(mid, { effortOptions: eff, defaultEffort: dflt, supportsReasoning })
    }

    const rawModels = Array.isArray(modelOption?.options)
      ? modelOption.options.map(option => ({ value: String(option.value), name: String(option.name ?? option.value) }))
      : (Array.isArray(session.models?.availableModels)
        ? session.models.availableModels.map(model => ({
          value: String(model.modelId),
          name: String(model.name ?? model.label ?? model.modelId),
        }))
        : [])

    const models = rawModels.map((item) => {
      const meta = availMetaByModel.get(item.value)
      return {
        ...item,
        ...(meta?.effortOptions ? { effortOptions: meta.effortOptions } : {}),
        ...(meta?.defaultEffort ? { defaultEffort: meta.defaultEffort } : {}),
        ...(meta && !meta.supportsReasoning ? { effortOptions: [] } : {}),
      }
    })

    const initialCurrentModel = String(modelOption?.currentValue ?? session.models?.currentModelId ?? '')
    let probedModel = initialCurrentModel

    // If caller asked for a specific model (or spec has a pinned model) and we need live reasoning options:
    if (effectiveModel && effectiveModel !== initialCurrentModel && models.some(m => m.value === effectiveModel)) {
      const preMeta = models.find(m => m.value === effectiveModel)
      if (Array.isArray(preMeta?.effortOptions)) {
        probedModel = effectiveModel
      } else if (modelOption) {
        try {
          const switched = await withTimeout(
            agent.request(methods.agent.session.setConfigOption, {
              sessionId: session.sessionId,
              configId: modelOption.id || 'model',
              value: effectiveModel,
            }),
            8_000,
          )
          if (Array.isArray(switched?.configOptions)) {
            options = switched.configOptions
            reasoningOption = findReasoningConfigOption(options)
            probedModel = effectiveModel
          }
        } catch {}
      }
    }

    const activeModelMeta = models.find(m => m.value === probedModel)
    const reasoning = Array.isArray(activeModelMeta?.effortOptions)
      ? activeModelMeta.effortOptions
      : (Array.isArray(reasoningOption?.options)
        ? reasoningOption.options.map(option => ({ value: String(option.value), name: String(option.value) }))
        : [])
    const reasoningCurrent = activeModelMeta?.defaultEffort
      || String(reasoningOption?.currentValue ?? '')

    let permissionModes = null
    if (modeOption && Array.isArray(modeOption.options) && modeOption.options.length > 0) {
      permissionModes = {
        source: 'configOption',
        configId: String(modeOption.id || 'mode'),
        name: String(modeOption.name || '权限模式'),
        current: String(modeOption.currentValue ?? ''),
        options: modeOption.options.map(opt => ({
          value: String(opt.value),
          name: String(opt.name ?? opt.value),
          description: typeof opt.description === 'string' ? opt.description : '',
        })),
      }
    } else if (Array.isArray(session.modes?.availableModes) && session.modes.availableModes.length > 0) {
      permissionModes = {
        source: 'setMode',
        configId: 'mode',
        name: '会话权限模式',
        current: String(session.modes.currentModeId ?? ''),
        options: session.modes.availableModes.map(m => ({
          value: String(m.id),
          name: String(m.name ?? m.id),
          description: typeof m.description === 'string' ? m.description : '',
        })),
      }
    }

    const caps = initResp?.agentCapabilities ?? {}
    const family = inferClientFamily(spec.id, spec)
    const value = {
      models,
      modelConfigId: String(modelOption?.id || 'model'),
      current: initialCurrentModel,
      probedModel,
      reasoning,
      reasoningCurrent,
      reasoningConfigId: String(reasoningOption?.id || 'reasoning_effort'),
      permissionModes,
      agentInfo: initResp?.agentInfo ?? null,
      capabilities: {
        sessionResume: Boolean(caps?.sessionCapabilities?.resume != null),
        loadSession: Boolean(caps?.loadSession === true),
        promptImage: Boolean(caps?.promptCapabilities?.image === true),
        mcpHttp: Boolean(caps?.mcpCapabilities?.http === true || family === 'zcode'),
        mcpSse: Boolean(caps?.mcpCapabilities?.sse === true || family === 'zcode'),
      },
      slashCommands,
    }

    const byModel = cached?.byModel ?? new Map()
    if (probedModel) {
      byModel.set(probedModel, { reasoning, reasoningCurrent })
    }
    modelCatalogCache.set(baseKey, { at: Date.now(), value, byModel })

    try {
      await withTimeout(agent.request(methods.agent.session.close, { sessionId: session.sessionId }), 1200)
    } catch {}
    return value
  } finally {
    terminateChildProcess(child)
  }
}

/* -------------------------------------------------------------------------- */
/* Tool & Command Registration (Dynamic Live Reconciliation)                  */
/* -------------------------------------------------------------------------- */

const ACTIVATION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name'],
  properties: {
    kind: { type: 'string', const: 'activation' },
    name: { type: 'string' },
    agent: { type: 'string' },
    label: { type: 'string' },
    model: { type: 'string' },
    childId: { type: 'string' },
    parentSessionId: { type: 'string' },
    startedAt: { type: 'number' },
    resumed: { type: 'boolean' },
    round: { type: 'number' },
  },
}

function makeActivationOutput(defaultAgentId, defaultLabel, defaultModel) {
  return {
    schema: ACTIVATION_OUTPUT_SCHEMA,
    render: (_args, value) => text(
      `delegated to ${value.label ?? defaultLabel ?? value.name}${value.round > 1 ? ` (R${value.round})` : ''} [childId=${value.childId ?? ''}]`,
    ),
    presentationMeta: (_args, value) => ({
      kind: 'activation',
      name: value.name,
      agent: value.agent ?? defaultAgentId,
      label: value.label ?? defaultLabel ?? value.name,
      model: value.model ?? defaultModel ?? '',
      ...(value.childId === undefined ? {} : { childId: value.childId }),
      ...(value.parentSessionId === undefined ? {} : { parentSessionId: value.parentSessionId }),
      ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
      ...(value.resumed === undefined ? {} : { resumed: value.resumed }),
      ...(value.round === undefined ? {} : { round: value.round }),
    }),
  }
}

function registerDirectAgentTool(ctx, key, getSpec) {
  const initial = getSpec()
  return ctx.tools.register({
    name: key,
    description: `Delegate a self-contained task to ${initial.name} via ACP. Do NOT pass resumeChildId by default — decide per task: pass resumeChildId ONLY when directly building on a prior ${initial.name} subagent run (if allowResume is enabled); omit resumeChildId for independent tasks or unbiased review. End your turn after calling.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Complete task instructions (or follow-up message when resumeChildId is set).' },
        resumeChildId: { type: 'string', description: 'Optional childId from an earlier run of this ACP agent when continuing the same work thread (forbidden if allowResume=false).' },
        cwd: { type: 'string', description: 'Optional absolute working directory.' },
      },
    },
    output: makeActivationOutput(key, initial.name, initial.model),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const spec = getSpec()
      if (!spec || spec.enabled === false) throw new Error(`ACP agent "${key}" is currently disabled`)
      const parent = exec.agent
      if (!parent) throw new Error(`${key} requires a calling agent`)
      const task = typeof args?.prompt === 'string' ? args.prompt : ''
      if (!task.trim()) throw new Error('prompt must not be empty')
      const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined
      const resumeChildId = typeof args?.resumeChildId === 'string' && args.resumeChildId.trim()
        ? args.resumeChildId.trim()
        : undefined
      const started = await runAcp(parent, ctx, spec, task, key, key, { cwd, resumeChildId })
      return {
        kind: 'activation',
        name: started.name,
        agent: key,
        label: spec.name,
        model: spec.model ?? '',
        childId: started.childId,
        parentSessionId: started.parentSessionId,
        startedAt: started.startedAt,
        resumed: started.resumed,
        round: started.round,
      }
    },
  })
}

function registerDirectAgentCommand(ctx, key, getSpec) {
  if (typeof ctx.commands?.register !== 'function') return () => {}
  const initial = getSpec()
  return ctx.commands.register({
    name: key,
    description: `直接通过 ACP 启动 ${initial.name} 子会话（支持 --resume <childId> 同会话续派）`,
    input: { hint: '[--resume <childId>] <任务内容>' },
    handler: async ({ agent, rawInput }) => {
      const spec = getSpec()
      if (!spec || spec.enabled === false) {
        return { kind: 'error', text: `${key} 当前已停用，请先在「ACP 委派」面板启用。` }
      }
      let rest = typeof rawInput === 'string' ? rawInput.trim() : ''
      let resumeChildId
      const resumeMatch = /^--resume\s+(\S+)\s+([\s\S]+)$/.exec(rest)
      if (resumeMatch) {
        resumeChildId = resumeMatch[1]
        rest = resumeMatch[2].trim()
      }
      if (!rest) {
        return { kind: 'error', text: `用法：/${key} [--resume <childId>] <完整任务>` }
      }
      try {
        const started = await runAcp(agent, ctx, spec, rest, key, key, { resumeChildId })
        return {
          kind: 'success',
          text: `已启动 ${spec.name}${started.round > 1 ? ` 第 ${started.round} 轮（同会话续接）` : ''}（${started.childId}）。完成后自动通知本会话。`,
        }
      } catch (error) {
        return { kind: 'error', text: `${spec.name} 启动失败：${String(error?.message ?? error)}` }
      }
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Plugin Entry (`apply`)                                                     */
/* -------------------------------------------------------------------------- */

export function apply(ctx, config = {}) {
  const settingsPath = hubSettingsPath()
  const loaded = loadMergedSettings(config.agents, settingsPath, legacyMirrorSettingsPath())
  const agentsMap = loaded.map
  const deletedSet = loaded.deleted
  let promptDisclosure = loaded.promptDisclosure
  const perAgentDisposers = new Map()

  const reconcileAgentRegistrations = () => {
    for (const [id, disp] of perAgentDisposers.entries()) {
      const spec = agentsMap.get(id)
      if (!spec || spec.enabled === false) {
        try { disp.tool?.() } catch {}
        try { disp.cmd?.() } catch {}
        perAgentDisposers.delete(id)
      }
    }
    for (const [id, spec] of agentsMap.entries()) {
      if (spec.enabled === false || RESERVED_TOOL_NAMES.has(id)) continue
      if (perAgentDisposers.has(id)) continue
      const getSpec = () => agentsMap.get(id)
      let toolDisp = () => {}
      let cmdDisp = () => {}
      try {
        toolDisp = registerDirectAgentTool(ctx, id, getSpec)
      } catch (error) {
        ctx.logger?.warn?.(`acp-hub: tool register "${id}" skipped: ${String(error?.message ?? error)}`)
      }
      try {
        cmdDisp = registerDirectAgentCommand(ctx, id, getSpec)
      } catch (error) {
        ctx.logger?.warn?.(`acp-hub: command register "/${id}" skipped: ${String(error?.message ?? error)}`)
      }
      perAgentDisposers.set(id, { tool: toolDisp, cmd: cmdDisp })
    }
  }

  reconcileAgentRegistrations()

  ctx.effect(() => () => {
    for (const [, disp] of perAgentDisposers) {
      try { disp.tool?.() } catch {}
      try { disp.cmd?.() } catch {}
    }
    perAgentDisposers.clear()
    for (const [, run] of activeRuns) {
      try { run.cancel('plugin-disposed') } catch {}
    }
    activeRuns.clear()
  }, 'acp-hub: cleanup dynamic tools and active ACP children')

  // Single narrow always-visible dispatcher (`delegate_acp`) + on-demand full catalog (`list_acp_agents`)
  ctx.effect(() => ctx.tools.register({
    name: 'delegate_acp',
    description: 'Delegate a self-contained task to an external ACP agent (e.g. zcode, minimax, codebuddy, opencode, codex, claude). Do NOT pass resumeChildId by default: decide per task whether to continue a prior subagent session (pass resumeChildId ONLY when directly iterating on its prior findings/edits and the agent allows continuation) or start a fresh independent subagent session (omit resumeChildId for new topics or clean-slate unbiased review). Asynchronous: end your turn after calling; completion wakes you via notice.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['agent', 'prompt'],
      properties: {
        agent: { type: 'string', description: 'Target ACP agent id.' },
        prompt: { type: 'string', description: 'Complete task instructions (or follow-up prompt when resumeChildId is provided).' },
        resumeChildId: { type: 'string', description: 'Optional childId from a previous run of the same ACP agent ONLY when continuing the same work thread. Omit for fresh independent sessions; forbidden if the agent has allowResume=false.' },
        cwd: { type: 'string', description: 'Optional absolute working directory.' },
      },
    },
    output: makeActivationOutput('acp', 'ACP Agent', ''),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) throw new Error('delegate_acp requires a calling agent')
      const key = typeof args?.agent === 'string' ? args.agent.trim().toLowerCase() : ''
      const spec = agentsMap.get(key)
      if (!spec) {
        const available = Array.from(agentsMap.values()).filter(a => a.enabled !== false).map(a => a.id)
        throw new Error(`Unknown ACP agent "${key}". Enabled ACP agents: ${available.join(', ') || '(none)'}`)
      }
      if (spec.enabled === false) throw new Error(`ACP agent "${key}" is currently disabled`)
      const task = typeof args?.prompt === 'string' ? args.prompt : ''
      if (!task.trim()) throw new Error('prompt must not be empty')
      const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined
      const resumeChildId = typeof args?.resumeChildId === 'string' && args.resumeChildId.trim()
        ? args.resumeChildId.trim()
        : undefined
      const started = await runAcp(parent, ctx, spec, task, key, 'delegate_acp', { cwd, resumeChildId })
      return {
        kind: 'activation',
        name: key,
        agent: key,
        label: spec.name,
        model: spec.model ?? '',
        childId: started.childId,
        parentSessionId: started.parentSessionId,
        startedAt: started.startedAt,
        resumed: started.resumed,
        round: started.round,
      }
    },
  }), 'acp-hub: delegate_acp tool')

  ctx.effect(() => ctx.tools.register({
    name: 'list_acp_agents',
    description: 'Return the full routing catalog of enabled external ACP agents, including their id, display name, pinned model, reasoning effort, permission mode, executable readiness, and complete whenToUse guidance.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['agents'],
        properties: {
          agents: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'ready', 'allowResume'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                model: { type: 'string' },
                reasoning: { type: 'string' },
                mode: { type: 'string' },
                allowResume: { type: 'boolean' },
                whenToUse: { type: 'string' },
                ready: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => text(
        value.agents.length === 0
          ? 'No enabled ACP agents.'
          : value.agents.map(a => `- ${a.id} (${a.name})${a.model ? ` [${a.model}]` : ''}${a.allowResume === false ? ' [clean-slate only]' : ' [resumable on demand]'}: ${a.whenToUse || 'External ACP agent'}`).join('\n'),
      ),
    },
    isConcurrencySafe: () => true,
    async execute() {
      const list = Array.from(agentsMap.values())
        .filter(spec => spec.enabled !== false)
        .map(spec => ({
          id: spec.id,
          name: spec.name,
          model: spec.model ?? '',
          reasoning: spec.reasoning ?? '',
          mode: spec.mode ?? '',
          allowResume: spec.allowResume !== false,
          whenToUse: spec.whenToUse ?? '',
          ready: Boolean(resolveExecutable(spec.command)),
        }))
      return { agents: list }
    },
  }), 'acp-hub: list_acp_agents tool')

  if (typeof ctx.commands?.register === 'function') {
    ctx.effect(() => ctx.commands.register({
      name: 'acp-stop',
      description: '停止正在运行的 ACP 委派子会话（传入 childId 前缀或 all）',
      input: { hint: '<childId | all>' },
      handler: async ({ rawInput }) => {
        const target = typeof rawInput === 'string' ? rawInput.trim() : ''
        if (!target || target === 'all') {
          const count = activeRuns.size
          if (count === 0) return { kind: 'success', text: '当前没有正在运行的 ACP 子任务。' }
          for (const [, run] of activeRuns) run.cancel('command-stop-all')
          return { kind: 'success', text: `已发送取消信号给 ${count} 个运行中的 ACP 子任务。` }
        }
        const hit = Array.from(activeRuns.values()).find(r => r.childId === target || r.childId.startsWith(target))
        if (!hit) return { kind: 'error', text: `未找到运行中的子会话 "${target}"` }
        hit.cancel('command-stop')
        return { kind: 'success', text: `已停止 ${hit.label}（${hit.childId}）。` }
      },
    }), 'acp-hub: /acp-stop command')
  }

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'acp-hub:agents',
      order: (promptCtx.systemPrompt.getSectionOrder?.('TOOL_SUBAGENT') ?? 50) + 2,
      interpolate: false,
      text: () => buildRoutingPromptText(agentsMap, promptDisclosure),
    }), 'acp-hub: prompt section')
  })

  function serializeAgentForClient(spec) {
    const resolved = resolveExecutable(spec.command)
    return {
      id: spec.id,
      name: spec.name,
      family: inferClientFamily(spec.id, spec),
      enabled: spec.enabled !== false,
      autoLaunch: spec.autoLaunch !== false,
      allowResume: spec.allowResume !== false,
      command: spec.command,
      resolvedCommand: resolved,
      ready: Boolean(resolved),
      args: spec.args ?? [],
      commandLine: formatCommandLine(spec.command, spec.args ?? []),
      mode: spec.mode ?? '',
      modeSource: spec.modeSource ?? '',
      modeConfigId: spec.modeConfigId ?? '',
      permission: spec.permission ?? 'allow',
      cwd: spec.cwd ?? '',
      model: spec.model ?? '',
      reasoning: spec.reasoning ?? '',
      reasoningConfigId: spec.reasoningConfigId ?? '',
      whenToUse: spec.whenToUse ?? '',
      instructions: spec.instructions ?? '',
      forwardMcpIds: spec.forwardMcpIds ?? [],
      extraMcpServers: spec.extraMcpServers ?? [],
      sessionMcpCandidates: buildSessionMcpCandidatesForAgent(spec.id, spec, ctx),
      env: spec.env ?? {},
      activeCount: Array.from(activeRuns.values()).filter(r => r.agentId === spec.id).length,
    }
  }

  function buildPromptBudgetSummary() {
    const rendered = buildRoutingPromptText(agentsMap, promptDisclosure)
    return {
      promptDisclosure,
      chars: rendered.length,
      estimatedTokens: estimateTokensApprox(rendered),
      preview: rendered,
    }
  }

  const routes = [
    {
      path: '/api/acp-hub.icon',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const key = (new URL(request.url, 'http://acp-hub.invalid').searchParams.get('id') ?? '').trim().toLowerCase()
        return serveAgentIcon(key, agentsMap)
      },
    },
    {
      path: '/api/acp-hub.state',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse(200, {
        ok: true,
        promptBudget: buildPromptBudgetSummary(),
        agents: Array.from(agentsMap.values()).map(serializeAgentForClient),
        activeRuns: Array.from(activeRuns.values()).map(r => ({
          childId: r.childId,
          parentSessionId: r.parentSessionId,
          agentId: r.agentId,
          label: r.label,
          model: r.model,
          round: r.round,
          startedAt: r.startedAt,
        })),
        hostMcpCandidates: discoverRawHostDshMcpServers(ctx).map(srv => ({
          id: normalizeAcpServerName(srv.name),
          name: srv.name,
          transport: classifyMcpTransport(srv),
          wireType: classifyWireType(srv),
          summary: safeTargetSummary(srv),
          inDshHost: true,
          nativeState: 'absent',
          sourceLabel: srv.source || 'DSH 宿主',
          ready: isRawServerReady(srv),
        })),
      }),
    },
    {
      path: '/api/acp-hub.session',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const childId = (new URL(request.url, 'http://acp-hub.invalid').searchParams.get('childId') ?? '').trim()
        if (!childId) return jsonResponse(200, { ok: false, error: 'missing childId' })
        const active = activeRuns.get(childId)
        const ledger = lookupContinuationEntry(childId)
        const agentId = active?.agentId ?? ledger?.agentId ?? ''
        const spec = agentId ? agentsMap.get(agentId) : undefined
        const resolvedModel = active?.model
          || spec?.model
          || ledger?.model
          || (agentId ? extractEffectiveModelHint(inferClientFamily(agentId, spec), spec?.model, '') : '')
        return jsonResponse(200, {
          ok: true,
          session: {
            childId,
            running: Boolean(active),
            agentId,
            label: active?.label || spec?.name || ledger?.label || (agentId || 'ACP'),
            model: resolvedModel,
            round: active?.round ?? Number(ledger?.turn ?? 1),
            startedAt: active?.startedAt ?? null,
            allowResume: spec ? spec.allowResume !== false : true,
            remoteResumable: Boolean(ledger?.canResume),
            canResume: Boolean(ledger?.canResume) && Boolean(spec && spec.enabled !== false && spec.allowResume !== false),
            parentSessionId: active?.parentSessionId ?? ledger?.parentSessionId ?? '',
          },
        })
      },
    },
    {
      path: '/api/acp-hub.followup',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const childId = typeof body?.childId === 'string' ? body.childId.trim() : ''
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
        const notifyParent = Boolean(body?.notifyParent)
        if (!childId || !prompt) {
          return jsonResponse(200, { ok: false, error: 'childId 和追问内容不能为空' })
        }
        const ledger = lookupContinuationEntry(childId)
        if (!ledger || !ledger.agentId) {
          return jsonResponse(200, { ok: false, error: '未找到该 ACP 子会话的远端续接记录' })
        }
        const spec = agentsMap.get(ledger.agentId)
        if (!spec || spec.enabled === false) {
          return jsonResponse(200, { ok: false, error: `ACP 智能体 "${ledger.agentId}" 不存在或已停用` })
        }
        if (spec.allowResume === false) {
          return jsonResponse(200, { ok: false, error: `已在配置中关闭 "${spec.name}" 的同子会话续接，禁止在原会话继续追问` })
        }
        try {
          const started = await runAcp(null, ctx, spec, prompt, ledger.agentId, ledger.agentId, {
            resumeChildId: childId,
            notifyParent,
          })
          return jsonResponse(200, { ok: true, started })
        } catch (error) {
          return jsonResponse(200, { ok: false, error: String(error?.message ?? error) })
        }
      },
    },
    {
      path: '/api/acp-hub.open-source',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const id = typeof body?.id === 'string' ? body.id.trim().toLowerCase() : ''
        const action = typeof body?.action === 'string' ? body.action.trim() : ''
        const targetPath = typeof body?.targetPath === 'string' ? body.targetPath.trim() : ''
        const spec = agentsMap.get(id)
        if (!spec) return jsonResponse(200, { ok: false, error: `未知 ACP 智能体: ${id}` })
        try {
          const result = await openAllowedTrueSource(id, spec, action, targetPath, ctx)
          return jsonResponse(200, { ok: true, ...result })
        } catch (error) {
          return jsonResponse(200, { ok: false, error: String(error?.message ?? error) })
        }
      },
    },
    {
      path: '/api/acp-hub.presets',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse(200, {
        ok: true,
        presets: PRESET_TEMPLATES.map((tpl) => {
          let resolvedCommand = null
          for (const candidate of tpl.candidates) {
            const hit = resolveExecutable(candidate)
            if (hit) {
              resolvedCommand = hit
              break
            }
          }
          return {
            id: tpl.id,
            name: tpl.name,
            iconKey: tpl.iconKey,
            command: resolvedCommand ?? tpl.candidates[tpl.candidates.length - 1],
            resolvedCommand,
            installed: Boolean(resolvedCommand),
            alreadyAdded: agentsMap.has(tpl.id),
            args: tpl.args,
            commandLine: formatCommandLine(resolvedCommand ?? tpl.candidates[tpl.candidates.length - 1], tpl.args ?? []),
            permission: tpl.permission,
            whenToUse: tpl.whenToUse,
            loginHint: tpl.loginHint,
          }
        }),
      }),
    },
    {
      path: '/api/acp-hub.catalog',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const url = new URL(request.url, 'http://acp-hub.invalid')
        const id = (url.searchParams.get('id') ?? '').trim()
        const forceRefresh = url.searchParams.get('refresh') === '1'
        const targetModel = (url.searchParams.get('model') ?? '').trim()
        const spec = agentsMap.get(id)
        if (!spec) return jsonResponse(200, { ok: false, error: `未知 ACP 智能体: ${id}` })
        try {
          const catalog = await probeAcpCatalog(ctx, spec, { forceRefresh, targetModel })
          return jsonResponse(200, { ok: true, catalog })
        } catch (error) {
          return jsonResponse(200, { ok: false, error: String(error?.message ?? error) })
        }
      },
    },
    {
      path: '/api/acp-hub.inspect',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const id = (new URL(request.url, 'http://acp-hub.invalid').searchParams.get('id') ?? '').trim()
        const spec = agentsMap.get(id)
        if (!spec) return jsonResponse(200, { ok: false, error: `未知 ACP 智能体: ${id}` })
        try {
          const inspection = await inspectExternalAgent(id, spec, ctx)
          return jsonResponse(200, { ok: true, inspection })
        } catch (error) {
          return jsonResponse(200, { ok: false, error: String(error?.message ?? error) })
        }
      },
    },
    {
      path: '/api/acp-hub.save-settings',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        if (body?.promptDisclosure !== undefined) {
          promptDisclosure = normalizePromptDisclosure(body.promptDisclosure)
        }
        persistSettings(settingsPath, agentsMap, deletedSet, promptDisclosure)
        return jsonResponse(200, { ok: true, promptBudget: buildPromptBudgetSummary() })
      },
    },
    {
      path: '/api/acp-hub.save-agent',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const raw = body?.agent
        const id = typeof raw?.id === 'string' ? raw.id.trim().toLowerCase() : ''
        if (!AGENT_ID_PATTERN.test(id)) {
          return jsonResponse(200, { ok: false, error: 'ID 需以小写字母开头，仅含小写字母、数字和连字符（2–32 字符）' })
        }
        if (RESERVED_TOOL_NAMES.has(id)) {
          return jsonResponse(200, { ok: false, error: `"${id}" 与内置工具重名，请换一个 ID` })
        }
        const existing = agentsMap.get(id)
        const normalized = normalizeAgentEntry(id, raw, existing)
        if (!normalized) {
          return jsonResponse(200, { ok: false, error: '启动命令（command）不能为空' })
        }
        deletedSet.delete(id)
        agentsMap.set(id, normalized)
        persistSettings(settingsPath, agentsMap, deletedSet, promptDisclosure)
        reconcileAgentRegistrations()
        return jsonResponse(200, {
          ok: true,
          agent: serializeAgentForClient(normalized),
          promptBudget: buildPromptBudgetSummary(),
        })
      },
    },
    {
      path: '/api/acp-hub.toggle-agent',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const id = typeof body?.id === 'string' ? body.id.trim().toLowerCase() : ''
        const spec = agentsMap.get(id)
        if (!spec) return jsonResponse(200, { ok: false, error: `未找到智能体 "${id}"` })
        if (typeof body.enabled === 'boolean') spec.enabled = body.enabled
        if (typeof body.autoLaunch === 'boolean') spec.autoLaunch = body.autoLaunch
        if (typeof body.allowResume === 'boolean') spec.allowResume = body.allowResume
        persistSettings(settingsPath, agentsMap, deletedSet, promptDisclosure)
        reconcileAgentRegistrations()
        return jsonResponse(200, {
          ok: true,
          agent: serializeAgentForClient(spec),
          promptBudget: buildPromptBudgetSummary(),
        })
      },
    },
    {
      path: '/api/acp-hub.remove-agent',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const id = typeof body?.id === 'string' ? body.id.trim().toLowerCase() : ''
        if (!agentsMap.has(id)) return jsonResponse(200, { ok: false, error: `未找到智能体 "${id}"` })
        agentsMap.delete(id)
        deletedSet.add(id)
        persistSettings(settingsPath, agentsMap, deletedSet, promptDisclosure)
        reconcileAgentRegistrations()
        return jsonResponse(200, { ok: true, promptBudget: buildPromptBudgetSummary() })
      },
    },
    {
      path: '/api/acp-hub.save',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const incoming = body?.agents
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return jsonResponse(200, { ok: false, error: 'agents must be an object' })
        }
        for (const [id, raw] of Object.entries(incoming)) {
          const existing = agentsMap.get(id)
          const next = normalizeAgentEntry(id, raw, existing)
          if (next) {
            deletedSet.delete(id)
            agentsMap.set(id, next)
          }
        }
        persistSettings(settingsPath, agentsMap, deletedSet, promptDisclosure)
        reconcileAgentRegistrations()
        return jsonResponse(200, { ok: true, promptBudget: buildPromptBudgetSummary() })
      },
    },
    {
      path: '/api/acp-hub.cancel',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        const childId = typeof body?.childId === 'string' ? body.childId.trim() : ''
        if (childId === 'all') {
          let stopped = 0
          for (const [, run] of activeRuns) {
            if (run.cancel('ui-cancel-all')) stopped += 1
          }
          return jsonResponse(200, { ok: true, stopped })
        }
        const hit = activeRuns.get(childId)
        if (!hit) return jsonResponse(200, { ok: false, error: '该子任务已结束或不存在' })
        hit.cancel('ui-cancel')
        return jsonResponse(200, { ok: true, stopped: 1 })
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(() => ctx.connection.fetch.register(route), `acp-hub: ${route.path}`)
  }
}

export async function runHostContractSmokeTest() {
  const { default: assert } = await import('node:assert/strict')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const createMemorySession = (id) => {
    const events = []
    return {
      id,
      header: { id, createdAt: Date.now() },
      events,
      append(type, payload, opts) {
        const seq = events.length + 1
        events.push({ seq, type, payload, opts })
        return { seq }
      },
    }
  }

  const assertV4Invariants = (events) => {
    const advertisedTools = new Map()
    const startedTools = new Set()
    const completedTools = new Set()
    const assistantMsgSteps = new Set()
    for (const ev of events) {
      if (ev.type === 'assistant/message') {
        const key = `${ev.payload.turn}:${ev.payload.step}`
        assert.equal(assistantMsgSteps.has(key), false, `duplicate assistant/message in ${key}`)
        assistantMsgSteps.add(key)
        for (const blk of ev.payload.message.content || []) {
          if (blk.type === 'tool-call') {
            assert.equal(advertisedTools.has(blk.id), false, `repeated tool-call ${blk.id}`)
            advertisedTools.set(blk.id, {
              turn: ev.payload.turn,
              step: ev.payload.step,
              name: blk.name,
              arguments: blk.arguments,
            })
          }
        }
      } else if (ev.type === 'tool/call') {
        const adv = advertisedTools.get(ev.payload.callId)
        assert.ok(adv, `tool/call ${ev.payload.callId} has no advertised tool lifecycle`)
        assert.equal(adv.turn, ev.payload.turn)
        assert.equal(adv.step, ev.payload.step)
        assert.equal(adv.name, ev.payload.name)
        assert.equal(adv.arguments, ev.payload.arguments)
        assert.equal(startedTools.has(ev.payload.callId), false, `duplicate tool/call ${ev.payload.callId}`)
        startedTools.add(ev.payload.callId)
      } else if (ev.type === 'tool/result') {
        const cid = ev.payload.message.toolCallId
        assert.ok(startedTools.has(cid), `tool/result ${cid} before tool/call`)
        completedTools.add(cid)
      }
    }
    assert.equal(startedTools.size, advertisedTools.size, 'all advertised tools must emit tool/call')
    assert.equal(completedTools.size, startedTools.size, 'all started tools must emit tool/result')
  }

  // 1. Parallel coalescing + straggler deferral + final step answer isolation
  const ctx = { emit() {} }
  const session = createMemorySession('session-acp-contract-1')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const stream = new AcpMirrorStream(ctx, session, 'glm-test', 1, { provider: 'zcode' })
  const state = { stepText: '', toolResultSeen: false, deferredChunks: [] }
  const advanceToNextStep = () => {
    stream.nextStep()
    state.toolResultSeen = false
    state.stepText = ''
  }
  const flushDeferred = () => {
    if (state.deferredChunks.length === 0 || coordinator.hasPendingOrActiveTools()) return
    if (state.toolResultSeen || stream.stepSettled) advanceToNextStep()
    for (const c of state.deferredChunks.splice(0)) {
      if (c.trackAsAnswer) state.stepText += c.text
      stream.append(c.type, c.text)
    }
  }
  let queue = Promise.resolve()
  const coordinator = createAcpToolCoordinator({
    stream,
    session,
    coalesceMs: 25,
    enqueue: (fn) => { queue = queue.then(fn); return queue },
    onStepSettled: () => { state.stepText = '' },
    onAllStepToolsFinished: ({ advanceStepOnly }) => {
      if (advanceStepOnly) return advanceToNextStep()
      state.toolResultSeen = true
      flushDeferred()
    },
  })

  stream.append('reasoning', 'thinking step 1')
  state.stepText += 'intermediate text'
  stream.append('text', 'intermediate text')
  const r = new AcpToolCallReducer()
  coordinator.onToolUpdate(r.apply({ toolCallId: 'c1', title: 'read', rawInput: { path: 'a.js' } }), false)
  coordinator.onToolUpdate(r.apply({ toolCallId: 'c2', title: 'read', rawInput: { path: 'b.js' } }), false)
  await new Promise(res => setTimeout(res, 60))
  await queue
  assert.equal(stream.step, 1)
  assert.equal(stream.stepSettled, true)
  assert.equal(state.stepText, '')

  // Straggler arrives after Step 1 settled while c1,c2 still open
  coordinator.onToolUpdate(r.apply({ toolCallId: 'c3', title: 'bash', rawInput: { command: 'pwd' } }), false)
  assert.equal(stream.step, 1, 'straggler c3 must defer until step 1 tools finish')

  coordinator.onToolUpdate(r.apply({ toolCallId: 'c1', status: 'completed', rawOutput: 'ok1' }), true)
  coordinator.onToolUpdate(r.apply({ toolCallId: 'c2', status: 'completed', rawOutput: 'ok2' }), true)
  assert.equal(stream.step, 2, 'straggler c3 should promote into step 2')

  coordinator.onToolUpdate(r.apply({ toolCallId: 'c3', status: 'completed', rawOutput: 'ok3' }), true)
  assert.equal(state.toolResultSeen, true)

  advanceToNextStep()
  stream.append('reasoning', 'final reasoning')
  state.stepText += 'final closing answer'
  stream.append('text', 'final closing answer')
  stream.finishAll({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, totalTokens: 30 })
  session.append('step/end', { turn: 1, step: stream.step })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  assertV4Invariants(session.events)
  const msgs = session.events.filter(e => e.type === 'assistant/message')
  const lastMsg = msgs.at(-1)
  assert.equal(lastMsg.payload.step, stream.step)
  assert.ok(lastMsg.payload.message.content.some(b => b.type === 'text' && b.text === 'final closing answer'))
  assert.equal(state.stepText, 'final closing answer')

  // 2. Incomplete tool flush (both unready and active tools)
  const s2 = createMemorySession('session-acp-contract-2')
  s2.append('turn/start', { turn: 1 })
  s2.append('step/start', { turn: 1, step: 1 })
  const st2 = new AcpMirrorStream(ctx, s2, 'minimax-m3', 1, { provider: 'minimax' })
  const c2 = createAcpToolCoordinator({
    stream: st2,
    session: s2,
    coalesceMs: 60,
    onAllStepToolsFinished: ({ advanceStepOnly }) => {
      if (advanceStepOnly) st2.nextStep()
    },
  })
  const r2 = new AcpToolCallReducer()
  c2.onToolUpdate(r2.apply({ toolCallId: 'u1', title: 'bash' }), false)
  c2.onToolUpdate(r2.apply({ toolCallId: 'a1', title: 'glob', rawInput: { pattern: '*.js' } }), false)
  c2.flushAllIncomplete('cancelled')
  st2.append('text', 'aborted cleanly')
  st2.finishAll()
  s2.append('step/end', { turn: 1, step: st2.step })
  s2.append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
  assertV4Invariants(s2.events)

  // 3. MiniMax SQLite usage normalization & no-double-count guard
  const consumed = new Set([10])
  const rows = [
    { id: 10, model: 'minimax-m3.1-flash', ts: 1, input_tokens: 100, output_tokens: 20, cache_read_tokens: 500, cache_write_tokens: 0, reasoning_tokens: 0 },
    { id: 11, model: 'minimax-m3.1-flash', ts: 2, input_tokens: 250, output_tokens: 80, cache_read_tokens: 1000, cache_write_tokens: 0, reasoning_tokens: 5 },
  ]
  const stepRes = consumeNewSqliteStepUsage('minimax', 'mvs_test123', consumed, () => rows)
  assert.equal(stepRes.rowCount, 1)
  assert.equal(stepRes.usage.inputTokens, 250)
  assert.equal(stepRes.usage.cacheReadTokens, 1000)
  assert.equal(stepRes.usage.outputTokens, 80)
  assert.equal(stepRes.usage.totalTokens, 1330)
  assert.equal(stepRes.route.model, 'minimax-m3.1-flash')

  const noDoubleCount = await resolveTurnTokenUsage(
    'minimax',
    'mvs_test123',
    consumed,
    { used: 99999 },
    { used: 99999, size: 512000 },
    { priorSqliteRowsConsumed: 1, queryFn: () => rows },
  )
  assert.equal(noDoubleCount.usage, undefined)

  // 4. parseCommandLine / formatCommandLine round-trip & edge cases
  const cases = [
    ['zcode-acp', []],
    ['/usr/local/bin/mcode', ['acp']],
    ['/path/with space/my agent', ['--prefix', '', 'a"b', 'c\\d']],
  ]
  for (const [cmd, args] of cases) {
    const line = formatCommandLine(cmd, args)
    assert.deepEqual(parseCommandLine(line), { command: cmd, args })
  }
  assert.deepEqual(parseCommandLine('cmd\\'), { command: 'cmd\\', args: [] })
  assert.deepEqual(parseCommandLine('   '), { command: '', args: [] })

  // 5. parseCordisPatchMcpEntries + buildSessionMcpCandidatesForAgent + wire compliance + zero secret leaks
  const scratch = mkdtempSync(join(tmpdir(), 'acp-hub-contract-'))
  try {
    const { writeFileSync, chmodSync } = await import('node:fs')
    const binPath = join(scratch, 'dummy-mcp')
    writeFileSync(binPath, '#!/bin/sh\nexit 0\n')
    chmodSync(binPath, 0o755)
    const patchFile = join(scratch, 'cordis.patch.yml')
    writeFileSync(patchFile, [
      '- insert:',
      '    - id: mcp-chrome',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: agent-in-chrome',
      '        transport: stdio',
      `        command: '${binPath}'`,
      '        args: []',
      '- insert:',
      '    - id: mcp-mem',
      '      name: "@deepseek-ai/dsh-mcp-client"',
      '      config:',
      '        serverName: ai-memory',
      '        transport: stdio',
      `        command: '${binPath}'`,
      '        args:',
      '          [',
      '            "mcp-bridge",',
      '            "--data-dir",',
      '            "/tmp/mem"',
      '          ]',
      '        env: { SECRET_KEY: "super-secret" }',
      '- insert:',
      '    - id: mcp-magpie',
      '      name: "@deepseek-ai/dsh-mcp-client"',
      '      config:',
      '        serverName: magpie',
      '        transport: streamable-http',
      '        url: "http://127.0.0.1:3425/mcp/magpie/hub/dsh?token=secret123"',
      '        headers: { Authorization: "Bearer tok-xyz" }',
    ].join('\n'))
    const parsedHost = parseCordisPatchMcpEntries(readFileSync(patchFile, 'utf8'))
    assert.equal(parsedHost.length, 3)

    const fakeHome = join(scratch, 'home')
    mkdirSync(join(fakeHome, '.zcode', 'cli'), { recursive: true })
    writeFileSync(join(fakeHome, '.zcode', 'cli', 'config.json'), JSON.stringify({
      mcpServers: {
        'agent-in-chrome': { command: binPath, args: [], enabled: true },
        'exa': { type: 'streamable-http', url: 'https://mcp.exa.ai/mcp?exaApiKey=secret999', headers: { Authorization: 'Bearer hide' }, enabled: false },
        'on-mac': { command: binPath, args: ['--fast'], env: { API_KEY: 'hidden' }, disabled: true },
      },
    }))

    const specZ = {
      id: 'zcode',
      name: 'ZCode',
      command: binPath,
      args: [],
      forwardMcpIds: ['agent-in-chrome', 'exa', 'on-mac', 'ai-memory'],
    }
    const candidates = buildSessionMcpCandidatesForAgent('zcode', specZ, null, { homeDir: fakeHome, patchPath: patchFile })
    const serialized = JSON.stringify(candidates)
    assert.equal(serialized.includes('secret999'), false, 'query secret must be redacted')
    assert.equal(serialized.includes('super-secret'), false, 'env secret must not serialize')
    assert.equal(serialized.includes('tok-xyz'), false, 'header secret must not serialize')
    assert.equal(candidates.find(c => c.id === 'agent-in-chrome')?.nativeState, 'enabled')
    assert.equal(candidates.find(c => c.id === 'exa')?.nativeState, 'disabled')
    assert.equal(candidates.find(c => c.id === 'ai-memory')?.nativeState, 'absent')

    const wire = buildSessionMcpServers(specZ, {}, null, { homeDir: fakeHome, patchPath: patchFile })
    assert.equal(wire.some(s => s.name === 'agent-in-chrome'), false, 'natively enabled MCP must be skipped')
    const exaWire = wire.find(s => s.name === 'exa')
    assert.equal(exaWire?.type, 'http')
    const onMacWire = wire.find(s => s.name === 'on-mac')
    assert.equal('type' in onMacWire, false, 'stdio wire server must not have type property')
    assert.equal(onMacWire.command, binPath)

    // 6. safeAppendEvent & legacy migration test
    const badSess = { append() { throw new Error('schema mismatch') } }
    assert.equal(safeAppendEvent(badSess, 'subagent/descriptor', {}, undefined, null), null)

    const legPath = join(scratch, 'acp-mirror.json')
    const newPath = join(scratch, 'acp-hub.json')
    writeFileSync(legPath, JSON.stringify({ version: 3, promptDisclosure: 'compact', agents: { custom: { command: '/bin/sh', args: [] } }, deleted: [] }))
    const loadedLegacy = loadMergedSettings({}, newPath, legPath)
    assert.ok(loadedLegacy.map.has('custom'), 'legacy settings must migrate seamlessly')

    // 7. Context window resolution, chunk extraction, usage+finish frames & monotonic revisions across turns
    assert.equal(resolveAgentContextWindow('minimax', 'magpie/auto/minimax-m3.1-flash'), 1_000_000)
    assert.equal(resolveAgentContextWindow('minimax', 'magpie/auto/claude-sonnet-4'), 200_000)
    assert.equal(resolveAgentContextWindow('minimax', 'minimax-m3.1-flash'), 512_000)

    assert.equal(extractAcpChunkText('plain'), 'plain')
    assert.equal(extractAcpChunkText({ type: 'text', text: 'hello' }), 'hello')
    assert.equal(extractAcpChunkText({ type: 'thinking', text: 'thought' }), 'thought')
    assert.equal(extractAcpChunkText({ text: 'bare' }), 'bare')
    assert.equal(extractAcpChunkText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab')
    assert.equal(extractAcpChunkText({ type: 'image', text: 'ignored' }), '')

    const emittedFrames = []
    const streamCtx = {
      emit(evt, data) {
        if (evt === 'agent/assistant-stream') emittedFrames.push(data.frame)
      },
    }
    const multiSession = createMemorySession(`session-acp-contract-multi-${Date.now()}`)
    multiSession.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'acp-hub', label: 'MiniMax' })
    multiSession.append('turn/start', { turn: 1 })
    multiSession.append('request/context', { contextWindow: 1_000_000 })
    multiSession.append('step/start', { turn: 1, step: 1 })

    const sTurn1 = new AcpMirrorStream(streamCtx, multiSession, 'magpie/auto/minimax-m3.1-flash', 1, { provider: 'minimax' })
    sTurn1.tool({ toolCallId: 'tc-1', title: 'bash', rawInput: { cmd: 'ls' } })
    sTurn1.nextStep()
    sTurn1.append('text', 'Turn 1 answer')
    sTurn1.finishAll({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, totalTokens: 150 })
    multiSession.append('step/end', { turn: 1, step: sTurn1.step })
    multiSession.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const t1Chunks = emittedFrames.filter(f => f.type === 'chunk').map(f => f.chunk)
    assert.ok(t1Chunks.some(c => c.type === 'finish' && c.reason?.kind === 'tool-calls'), 'tool step must emit tool-calls finish chunk')
    assert.ok(t1Chunks.some(c => c.type === 'usage' && c.usage?.totalTokens === 150), 'final step must emit usage chunk')
    assert.ok(t1Chunks.some(c => c.type === 'finish' && c.reason?.kind === 'stop'), 'final step must emit stop finish chunk')

    const lastTurn1Rev = emittedFrames.at(-1).revision
    const framesBeforeTurn2 = emittedFrames.length

    multiSession.append('turn/start', { turn: 2 })
    multiSession.append('step/start', { turn: 2, step: 1 })
    const sTurn2 = new AcpMirrorStream(streamCtx, multiSession, 'magpie/auto/minimax-m3.1-flash', 2, { provider: 'minimax' })
    sTurn2.append('text', 'Turn 2 answer')
    sTurn2.finishAll({ inputTokens: 200, outputTokens: 40, cacheReadTokens: 50, totalTokens: 290 })
    multiSession.append('step/end', { turn: 2, step: sTurn2.step })
    multiSession.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    assert.equal(emittedFrames[framesBeforeTurn2].type, 'start')
    assert.equal(emittedFrames[framesBeforeTurn2].revision, lastTurn1Rev + 1, 'Turn 2 start revision must continue monotonically')
    for (let i = 0; i < emittedFrames.length; i += 1) {
      assert.equal(emittedFrames[i].revision, i + 1, `frame ${i} revision must be strictly sequential`)
    }
    const descIdx = multiSession.events.findIndex(e => e.type === 'subagent/descriptor')
    const turnIdx = multiSession.events.findIndex(e => e.type === 'turn/start')
    assert.ok(descIdx >= 0 && turnIdx > descIdx, 'subagent/descriptor must precede turn/start')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
