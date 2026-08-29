export type SyncErrorCode =
  | 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED'
  | 'OPERATOR_STORE_FORBIDDEN'
  | 'OPERATOR_PERMISSION_REQUIRED'
  | 'OPERATOR_SESSION_EXPIRED'
  | 'SERVER_UNREACHABLE'
  | 'LOCAL_RECORD_MISSING'
  | 'REMOTE_DELETE_UNAVAILABLE'
  | 'PAID_ATTENDANCE_IMMUTABLE'
  | 'SYNC_FAILED'

const DEFAULT_FRIENDLY_MESSAGE = 'No se pudo sincronizar esta operación'
export const PAID_ATTENDANCE_FRIENDLY_TITLE = 'Asistencia ya pagada'
export const PAID_ATTENDANCE_FRIENDLY_DETAIL =
  'Esta asistencia pertenece a un periodo pagado y ya no puede modificarse. El cambio local fue descartado y se restauró el estado del servidor.'
const REDACTED_VALUE = '[dato sensible omitido]'
const MAX_DIAGNOSTIC_LENGTH = 1_000

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate))
}

function normalizedError(value: string): string {
  return value.trim().toLocaleLowerCase('es-MX')
}

export function getSyncErrorCode(value?: string): SyncErrorCode | undefined {
  if (!value?.trim()) return undefined
  const text = normalizedError(value)

  if (
    includesAny(text, [
      'legacy_operator_attribution_required',
      'sin identidad operativa',
      'registro legacy',
    ])
  ) {
    return 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED'
  }
  if (
    includesAny(text, [
      'operator_store_forbidden',
      'expense_store_forbidden',
      'purchase_store_forbidden',
      'otra tienda',
      'tienda que ya no tienes asignada',
    ])
  ) {
    return 'OPERATOR_STORE_FORBIDDEN'
  }
  if (text.includes('paid_attendance_immutable')) {
    return 'PAID_ATTENDANCE_IMMUTABLE'
  }
  if (
    includesAny(text, [
      'operator_account_inactive',
      'operator_capability_forbidden',
      'no tiene permiso',
      'no permite realizar esta operación',
      'rol actual no permite',
      'cuenta del operador está desactivada',
    ])
  ) {
    return 'OPERATOR_PERMISSION_REQUIRED'
  }
  if (
    includesAny(text, [
      'operator_session_required',
      'operator_session_invalid',
      'operator_session_expired',
      'sesión del operador expiró',
      'sesión operativa expirada',
      'sesión expiró',
      'refresh token',
      'invalid session',
      'jwt',
      '401',
    ])
  ) {
    return 'OPERATOR_SESSION_EXPIRED'
  }
  if (
    includesAny(text, [
      'failed to fetch',
      'fetch failed',
      'networkerror',
      'network error',
      'sin conexión',
      'no respondió',
      'no fue posible contactar',
      'timeout',
      '502',
      '503',
      '504',
    ])
  ) {
    return 'SERVER_UNREACHABLE'
  }
  if (
    includesAny(text, [
      'local ya no existe',
      'local no existe',
      'local record missing',
      'registro local no existe',
    ])
  ) {
    return 'LOCAL_RECORD_MISSING'
  }
  if (
    includesAny(text, [
      'eliminación remota no está habilitada',
      'remote delete',
    ])
  ) {
    return 'REMOTE_DELETE_UNAVAILABLE'
  }
  return 'SYNC_FAILED'
}

export function toUserFacingSyncError(value?: string): string | undefined {
  const code = getSyncErrorCode(value)
  if (!code) return undefined

  if (value?.trim() === 'Supabase no respondió') return value

  switch (code) {
    case 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED':
      return 'Registro legacy sin identidad operativa'
    case 'OPERATOR_STORE_FORBIDDEN':
      return 'La operación pertenece a otra tienda'
    case 'OPERATOR_PERMISSION_REQUIRED':
      return 'El operador ya no tiene permiso'
    case 'OPERATOR_SESSION_EXPIRED':
      return 'Sesión operativa expirada'
    case 'SERVER_UNREACHABLE':
      return 'Sin conexión con el servidor'
    case 'LOCAL_RECORD_MISSING':
      return 'El registro local ya no está disponible'
    case 'REMOTE_DELETE_UNAVAILABLE':
      return 'La eliminación remota no está habilitada'
    case 'PAID_ATTENDANCE_IMMUTABLE':
      return PAID_ATTENDANCE_FRIENDLY_TITLE
    case 'SYNC_FAILED':
      return DEFAULT_FRIENDLY_MESSAGE
  }
}

type ErrorRecord = Record<string, unknown>

function isErrorRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null
}

function stringField(record: ErrorRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isErrorRecord(error)) {
    const message = stringField(error, 'message')
    if (message) return message
  }
  return String(error)
}

function diagnosticParts(error: unknown): string[] {
  if (!isErrorRecord(error)) return []
  return ['message', 'details', 'hint']
    .map((field) => stringField(error, field))
    .filter((value): value is string => Boolean(value))
}

function errorTexts(error: unknown): string[] {
  if (typeof error === 'string') return [error]
  if (!isErrorRecord(error)) return [String(error)]
  return [
    'code',
    'message',
    'details',
    'hint',
    'errorCode',
    'diagnosticError',
    'lastError',
  ]
    .map((field) => stringField(error, field))
    .filter((value): value is string => Boolean(value))
}

export function isPaidAttendanceImmutableError(error: unknown): boolean {
  return errorTexts(error).some((value) =>
    normalizedError(value).includes('paid_attendance_immutable'),
  )
}

function safeCode(value?: string): string | undefined {
  if (!value) return undefined
  const code = value.trim()
  if (!code || code.length > 64 || !/^[A-Za-z0-9_.-]+$/.test(code)) {
    return undefined
  }
  const normalized = code.toLocaleLowerCase('en-US')
  if (
    includesAny(normalized, [
      'pin',
      'token',
      'jwt',
      'authorization',
      'inspector',
    ])
  ) {
    return undefined
  }
  return code
}

export function sanitizeSyncErrorCode(value?: string): string | undefined {
  return safeCode(value)
}

export function getSafeSyncErrorCode(error: unknown): string {
  if (isErrorRecord(error)) {
    const explicitCode = safeCode(stringField(error, 'code'))
    if (explicitCode) return explicitCode
  }
  return 'SYNC_FAILED'
}

const SENSITIVE_ASSIGNMENTS: readonly RegExp[] = [
  /\bpin(?:\s*(?:code|number))?\s*[:=]\s*(?:bearer\s+)?["'`]?[^\s,;|]+["'`]?/gi,
  /\b(?:operator\s*session(?:\s*token)?|operator_session_token|session_token)\s*[:=]\s*(?:bearer\s+)?["'`]?[^\s,;|]+["'`]?/gi,
  /\b(?:jwt|authorization(?:\s+header)?|token[_\s-]*hash|access[_\s-]*token|refresh[_\s-]*token|token)\s*[:=]\s*(?:bearer\s+)?["'`]?[^\s,;|]+["'`]?/gi,
  /\b(?:pin|operator\s*session(?:\s*token)?|jwt|authorization(?:\s+header)?|token[_\s-]*hash|access[_\s-]*token|refresh[_\s-]*token|token|inspector)\s+(?:bearer\s+)?["'`]?[^\s,;|]+["'`]?/gi,
]

const SENSITIVE_TERMS: readonly RegExp[] = [
  /\boperator[_\s-]*session(?:[_\s-]*token)?\b/gi,
  /\b(?:authorization[_\s-]*header|authorization|token[_\s-]*hash|access[_\s-]*token|refresh[_\s-]*token|session[_\s-]*token|token|pin|jwt|inspector)\b/gi,
  /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
]

export function sanitizeSyncDiagnostic(value?: string): string | undefined {
  if (!value?.trim()) return undefined

  let sanitized = value.replace(/\s+/g, ' ').trim()
  for (const pattern of SENSITIVE_ASSIGNMENTS) {
    sanitized = sanitized.replace(pattern, REDACTED_VALUE)
  }
  for (const pattern of SENSITIVE_TERMS) {
    sanitized = sanitized.replace(pattern, REDACTED_VALUE)
  }
  sanitized = sanitized.replace(/\s*([·,;])\s*/g, ' $1 ')
  sanitized = sanitized.replace(/\s+/g, ' ').trim()

  if (!sanitized) return undefined
  return sanitized.slice(0, MAX_DIAGNOSTIC_LENGTH)
}

export function toFriendlySyncMessage(error: unknown): string {
  const text = [...diagnosticParts(error), errorText(error)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' · ')
  return toUserFacingSyncError(text) ?? DEFAULT_FRIENDLY_MESSAGE
}

export function buildSyncDiagnostic(
  error: unknown,
  fallback: string,
): string | undefined {
  const parts = diagnosticParts(error)
  return sanitizeSyncDiagnostic(parts.join(' · ') || fallback)
}
