export type OperatorAuthorizationErrorCode =
  | 'OPERATOR_SESSION_REQUIRED'
  | 'OPERATOR_SESSION_INVALID'
  | 'OPERATOR_SESSION_EXPIRED'
  | 'OPERATOR_ACCOUNT_INACTIVE'
  | 'OPERATOR_CAPABILITY_FORBIDDEN'
  | 'OPERATOR_STORE_FORBIDDEN'
  | 'LEGACY_OPERATOR_ATTRIBUTION_REQUIRED'

const MESSAGES: Record<OperatorAuthorizationErrorCode, string> = {
  OPERATOR_SESSION_REQUIRED: 'Inicia sesión como operador para continuar.',
  OPERATOR_SESSION_INVALID: 'La sesión del operador ya no es válida.',
  OPERATOR_SESSION_EXPIRED: 'La sesión del operador expiró. Inicia sesión nuevamente.',
  OPERATOR_ACCOUNT_INACTIVE: 'La cuenta del operador está desactivada.',
  OPERATOR_CAPABILITY_FORBIDDEN: 'Tu rol actual no permite realizar esta operación.',
  OPERATOR_STORE_FORBIDDEN: 'La operación pertenece a una tienda que ya no tienes asignada.',
  LEGACY_OPERATOR_ATTRIBUTION_REQUIRED:
    'Existe un cambio anterior sin identidad operativa. Debe revisarse antes de sincronizar.',
}

export class OperatorAuthorizationError extends Error {
  constructor(readonly code: OperatorAuthorizationErrorCode) {
    super(MESSAGES[code])
    this.name = 'OperatorAuthorizationError'
  }

  get requiresLogin(): boolean {
    return this.code === 'OPERATOR_SESSION_REQUIRED' ||
      this.code === 'OPERATOR_SESSION_INVALID' ||
      this.code === 'OPERATOR_SESSION_EXPIRED' ||
      this.code === 'OPERATOR_ACCOUNT_INACTIVE' ||
      this.code === 'OPERATOR_STORE_FORBIDDEN'
  }
}

export function mapOperatorAuthorizationError(cause: unknown): Error {
  if (!cause || typeof cause !== 'object') {
    return new Error('No fue posible autorizar la operación.')
  }
  const text = [
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ].join(' ')
  const code = Object.keys(MESSAGES).find((candidate) =>
    String(text).includes(candidate),
  ) as OperatorAuthorizationErrorCode | undefined
  return code
    ? new OperatorAuthorizationError(code)
    : cause instanceof Error
      ? cause
      : new Error(String(text))
}
