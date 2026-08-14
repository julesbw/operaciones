import type { AppRole, UserProfile } from '../domain/models'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { DEMO_ADMIN, DEMO_CASHIER } from './demoData'

const DEMO_SESSION_KEY = 'operaciones-demo-session'

type ProfileRow = {
  id: string
  full_name: string
  role: AppRole
  store_id: string | null
}

async function loadRemoteProfile(userId: string): Promise<UserProfile> {
  if (!supabase) throw new Error('Supabase no está configurado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, store_id')
    .eq('id', userId)
    .single<ProfileRow>()

  if (error) throw error

  let storeName: string | undefined
  if (data.store_id) {
    const result = await supabase
      .from('stores')
      .select('name')
      .eq('id', data.store_id)
      .single<{ name: string }>()
    if (result.error) throw result.error
    storeName = result.data.name
  }

  return {
    id: data.id,
    fullName: data.full_name,
    role: data.role,
    storeId: data.store_id ?? undefined,
    storeName,
  }
}

class AuthService {
  async getSessionUserId(): Promise<string | undefined> {
    if (!isSupabaseConfigured) {
      const savedRole = localStorage.getItem(DEMO_SESSION_KEY)
      if (savedRole === 'admin') return DEMO_ADMIN.id
      if (savedRole === 'cashier') return DEMO_CASHIER.id
      return undefined
    }

    const { data, error } = await supabase!.auth.getSession()
    if (error) throw error
    return data.session?.user.id
  }

  async loadProfile(userId: string): Promise<UserProfile> {
    if (!isSupabaseConfigured) {
      if (userId === DEMO_ADMIN.id) return DEMO_ADMIN
      if (userId === DEMO_CASHIER.id) return DEMO_CASHIER
      throw new Error('La sesión de demostración no es válida')
    }
    return loadRemoteProfile(userId)
  }

  async restore(): Promise<UserProfile | undefined> {
    const userId = await this.getSessionUserId()
    return userId ? this.loadProfile(userId) : undefined
  }

  async signIn(email: string, password: string): Promise<UserProfile> {
    if (!supabase) throw new Error('Supabase no está configurado')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    return loadRemoteProfile(data.user.id)
  }

  signInDemo(role: AppRole): UserProfile {
    localStorage.setItem(DEMO_SESSION_KEY, role)
    return role === 'admin' ? DEMO_ADMIN : DEMO_CASHIER
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(DEMO_SESSION_KEY)
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
  }
}

export const authService = new AuthService()
