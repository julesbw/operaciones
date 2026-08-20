import type { AppAccount, AppAccountRole } from '../domain/models'
import type { AppAccountResultRow } from '../types/database'
import { supabase } from '../lib/supabase'
import { connectivityService } from './connectivityService'

export type AppAccountInput = {
  displayName: string
  username: string
  role: AppAccountRole
  storeId: string
  collaboratorId?: string | null
}

export type CreateAppAccountInput = AppAccountInput & { pin: string }

const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/
const PIN_PATTERN = /^\d{6}$/

export function normalizeAppAccountUsername(username: string): string {
  return username.trim().toLocaleLowerCase('en-US')
}

export function assertAppAccountPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error('El PIN debe tener exactamente 6 dígitos.')
  }
}

function assertInput(input: AppAccountInput): AppAccountInput {
  const displayName = input.displayName.trim()
  const username = normalizeAppAccountUsername(input.username)
  if (!displayName || displayName.length > 120) {
    throw new Error('Escribe un nombre válido.')
  }
  if (!USERNAME_PATTERN.test(username) || username.length > 60) {
    throw new Error('El username sólo puede usar letras, números, punto, guion o guion bajo.')
  }
  if (input.role !== 'cashier' && input.role !== 'store_manager') {
    throw new Error('Selecciona un rol operativo válido.')
  }
  if (!input.storeId) throw new Error('Selecciona una tienda.')
  return { ...input, displayName, username }
}

function mapRow(row: AppAccountResultRow): AppAccount {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    storeId: row.store_id,
    storeName: row.store_name,
    collaboratorId: row.collaborator_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  connectivityService.requireOnline(
    'Se necesita conexión para administrar usuarios.',
  )
  return supabase
}

class AppAccountService {
  async list(): Promise<AppAccount[]> {
    const client = requireClient()
    const { data, error } = await client.rpc('list_app_accounts')
    if (error) throw error
    return (data ?? []).map(mapRow)
  }

  async create(input: CreateAppAccountInput): Promise<AppAccount> {
    const cleanInput = assertInput(input)
    assertAppAccountPin(input.pin)
    const client = requireClient()
    const { data, error } = await client.rpc('create_app_account', {
      p_display_name: cleanInput.displayName,
      p_username: cleanInput.username,
      p_role: cleanInput.role,
      p_store_id: cleanInput.storeId,
      p_collaborator_id: cleanInput.collaboratorId ?? null,
      p_pin: input.pin,
    })
    if (error) throw error
    const account = data?.[0]
    if (!account) throw new Error('No fue posible crear el usuario.')
    return mapRow(account)
  }

  async update(id: string, input: AppAccountInput): Promise<AppAccount> {
    if (!id) throw new Error('El usuario no es válido.')
    const cleanInput = assertInput(input)
    const client = requireClient()
    const { data, error } = await client.rpc('update_app_account', {
      p_id: id,
      p_display_name: cleanInput.displayName,
      p_username: cleanInput.username,
      p_role: cleanInput.role,
      p_store_id: cleanInput.storeId,
      p_collaborator_id: cleanInput.collaboratorId ?? null,
    })
    if (error) throw error
    const account = data?.[0]
    if (!account) throw new Error('El usuario ya no existe.')
    return mapRow(account)
  }

  async setStatus(id: string, isActive: boolean): Promise<AppAccount> {
    if (!id) throw new Error('El usuario no es válido.')
    const client = requireClient()
    const { data, error } = await client.rpc('set_app_account_status', {
      p_id: id,
      p_is_active: isActive,
    })
    if (error) throw error
    const account = data?.[0]
    if (!account) throw new Error('El usuario ya no existe.')
    return mapRow(account)
  }

  async resetPin(id: string, pin: string): Promise<void> {
    if (!id) throw new Error('El usuario no es válido.')
    assertAppAccountPin(pin)
    const client = requireClient()
    const { error } = await client.rpc('reset_app_account_pin', {
      p_id: id,
      p_pin: pin,
    })
    if (error) throw error
  }
}

export const appAccountService = new AppAccountService()
