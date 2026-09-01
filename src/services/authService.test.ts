import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pauseForLogout: vi.fn(),
  supabaseSignOut: vi.fn(),
  removeItem: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { signOut: mocks.supabaseSignOut } },
}))

vi.mock('./pushNotificationService', () => ({
  pushNotificationService: {
    pauseForLogout: mocks.pauseForLogout,
  },
}))

import { authService } from './authService'

describe('AuthService logout', () => {
  beforeEach(() => {
    mocks.pauseForLogout.mockReset()
    mocks.supabaseSignOut.mockReset()
    mocks.removeItem.mockReset()
    mocks.pauseForLogout.mockResolvedValue(undefined)
    mocks.supabaseSignOut.mockResolvedValue({ error: null })
    vi.stubGlobal('localStorage', { removeItem: mocks.removeItem })
  })

  it('pauses the current Push device before signing out Supabase', async () => {
    const order: string[] = []
    mocks.pauseForLogout.mockImplementation(async (authUserId?: string) => {
      expect(authUserId).toBe('admin-id')
      order.push('push')
    })
    mocks.supabaseSignOut.mockImplementation(async () => {
      order.push('supabase')
      return { error: null }
    })

    await expect(authService.signOut('admin-id')).resolves.toBeUndefined()

    expect(order).toEqual(['push', 'supabase'])
    expect(mocks.supabaseSignOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mocks.removeItem).toHaveBeenCalledWith('operaciones-demo-session')
  })

  it('continues logout if Push cleanup unexpectedly rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.pauseForLogout.mockRejectedValue(new Error('push failure'))

    await expect(authService.signOut()).resolves.toBeUndefined()

    expect(mocks.supabaseSignOut).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      'No fue posible limpiar Push antes del logout',
      'push_cleanup_failed',
    )
    consoleError.mockRestore()
  })
})
