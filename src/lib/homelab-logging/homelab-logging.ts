/**
 * Homelab structured logging — drop this file into any Next.js project as lib/homelab-logging.ts
 *
 * Server-side: pino → stdout JSON (consumed by Promtail)
 * Client-side: console wrapper matching the same JSON schema
 *
 * Usage:
 *   import { getLogger, getRequestLogger } from '@/lib/homelab-logging'
 *   const logger = getLogger('MyRoute')
 *   logger.info({ scan_id: 'abc' }, 'scan started')
 *
 *   // In a Server Component / route handler with correlation IDs:
 *   const logger = getRequestLogger('MyRoute', correlationId, sessionId)
 */

export interface LogFields {
  [key: string]: unknown
}

export interface BoundLogger {
  debug(fields: LogFields, msg: string): void
  info(fields: LogFields, msg: string): void
  warn(fields: LogFields, msg: string): void
  error(fields: LogFields, msg: string): void
  child(bindings: LogFields): BoundLogger
}

const BASE = {
  host_id: process.env.NEXT_PUBLIC_HOST_ID ?? process.env.HOST_ID ?? 'unknown',
  project: process.env.NEXT_PUBLIC_LOG_PROJECT ?? process.env.LOG_PROJECT ?? 'unknown',
  service: process.env.NEXT_PUBLIC_LOG_SERVICE ?? process.env.LOG_SERVICE ?? 'web',
}

// ── Server-side (Node.js) ────────────────────────────────────────────────────

let _pino: ReturnType<typeof import('pino')> | null = null

function getServerPino() {
  if (_pino) return _pino
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pino = require('pino') as typeof import('pino')
  _pino = pino({
    level: (process.env.LOG_LEVEL ?? 'info').toLowerCase(),
    base: BASE,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) { return { level: label } },
    },
  })
  return _pino
}

function makeServerLogger(name: string, extra: LogFields = {}): BoundLogger {
  const child = getServerPino().child({ logger: name, ...extra })
  return {
    debug: (f, m) => child.debug(f, m),
    info:  (f, m) => child.info(f, m),
    warn:  (f, m) => child.warn(f, m),
    error: (f, m) => child.error(f, m),
    child: (b) => makeServerLogger(name, { ...extra, ...b }),
  }
}

// ── Client-side (browser) ───────────────────────────────────────────────────

function makeClientLogger(name: string, extra: LogFields = {}): BoundLogger {
  const base = { ...BASE, logger: name, ...extra }
  const fmt = (level: string, fields: LogFields, msg: string) =>
    JSON.stringify({ level, message: msg, timestamp: new Date().toISOString(), ...base, ...fields })
  return {
    debug: (f, m) => console.debug(fmt('debug', f, m)),
    info:  (f, m) => console.info(fmt('info', f, m)),
    warn:  (f, m) => console.warn(fmt('warn', f, m)),
    error: (f, m) => console.error(fmt('error', f, m)),
    child: (b) => makeClientLogger(name, { ...extra, ...b }),
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** General-purpose logger. Detects server vs. browser automatically. */
export function getLogger(name: string): BoundLogger {
  return typeof window === 'undefined'
    ? makeServerLogger(name)
    : makeClientLogger(name)
}

/**
 * Logger pre-bound with correlation_id and optional session_id.
 * Use this in Server Components and API route handlers where you have request context.
 */
export function getRequestLogger(
  name: string,
  correlationId: string,
  sessionId?: string,
): BoundLogger {
  const extra: LogFields = { correlation_id: correlationId }
  if (sessionId) extra.session_id = sessionId
  return typeof window === 'undefined'
    ? makeServerLogger(name, extra)
    : makeClientLogger(name, extra)
}
