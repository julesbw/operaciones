import type { OperatorSession } from '../domain/models'
import type {
  OperatorSessionResultRow,
  ValidatedOperatorSessionResultRow,
} from '../types/database'
import { supabase } from '../lib/supabase'
import { connectivityService } from './connectivityService'

const STORAGE_KEY = 'operaciones.operator_session'

type StoredOperatorSession = OperatorSession

function mapAccount(row: OperatorSessionResultRow | ValidatedOperatorSessionResultRow) {
  return {
    id: row.account_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    storeId: row.store_id,
    storeName: row.store_name,
    collaboratorId: row.collaborator_id,
  }
}

function readStoredSession(): StoredOperatorSession | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' && parsed !== null &&
      'token' in parsed && typeof parsed.token === 'string' &&
      'account' in parsed && typeof parsed.account === 'object' && parsed.account !== null &&
      'expiresAt' in parsed && typeof parsed.expiresAt === 'string'
    ) {
      return parsed as StoredOperatorSession
    }
  } catch {
    // Una entrada corrupta no debe bloquear la aplicación ni conservar el token.
  }
  window.sessionStorage.removeItem(STORAGE_KEY)
  return undefined
}

function saveSession(session: OperatorSession): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  }
}

function clearSession(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY)
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  connectivityService.requireOnline(
    'Se necesita conexión para iniciar o validar la sesión operativa.',
  )
  return supabase
}

class OperatorSessionService {
  async login(username: string, pin: string): Promise<OperatorSession> {
    const client = requireClient()
    try {
      const { data, error } = await client.rpc('login_app_account', {
        p_username: username,
        p_pin: pin,
      })
      if (error) throw error
      const result = data?.[0]
      if (!result) throw new Error('No fue posible iniciar la sesión operativa.')
      const session: OperatorSession = {
        token: result.session_token,
        account: mapAccount(result),
        expiresAt: result.expires_at,
      }
      saveSession(session)
      return session
    } finally {
      // El PIN sólo existe durante la llamada RPC; nunca se persiste.
      pin = ''
    }
  }

  getStored(): OperatorSession | undefined {
    return readStoredSession()
  }

  async validate(): Promise<OperatorSession | undefined> {
    const stored = readStoredSession()
    if (!stored) return undefined
    try {
      const client = requireClient()
      const { data, error } = await client.rpc('validate_app_session', {
        p_session_token: stored.token,
      })
      if (error) throw error
      const result = data?.[0]
      if (!result) throw new Error('Sesión operativa inválida.')
      const session: OperatorSession = {
        token: stored.token,
        account: mapAccount(result),
        expiresAt: result.expires_at,
      }
      saveSession(session)
      return session
    } catch {
      clearSession()
      return undefined
    }
  }

  async logout(): Promise<void> {
    const stored = readStoredSession()
    try {
      if (stored && supabase && connectivityService.isNetworkAvailable()) {
        const { error } = await supabase.rpc('revoke_app_session', {
          p_session_token: stored.token,
        })
        if (error) throw error
      }
    } finally {
      clearSession()
    }
  }
}

export const operatorSessionService = new OperatorSessionService()
