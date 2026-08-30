import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}))

vi.mock('./offlineShellService', () => ({
  offlineShellService: {
    getStatus: mocks.getStatus,
  },
}))

import {
  isDynamicImportChunkError,
  LAZY_CHUNK_RELOAD_STORAGE_KEY,
  LazyChunkRecoveryService,
  releaseTransitionKey,
} from './lazyChunkRecovery'

describe('lazy chunk recovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('recognizes browser dynamic-import failures without matching normal errors', () => {
    expect(
      isDynamicImportChunkError(
        new TypeError('Failed to fetch dynamically imported module: /assets/page.js'),
      ),
    ).toBe(true)
    expect(
      isDynamicImportChunkError(new TypeError('Importing a module script failed.')),
    ).toBe(true)
    expect(
      isDynamicImportChunkError(
        new TypeError('error loading dynamically imported module'),
      ),
    ).toBe(true)
    expect(isDynamicImportChunkError(new Error('Failed to load data'))).toBe(false)
    expect(isDynamicImportChunkError(undefined)).toBe(false)
  })

  it('creates a transition only when the active worker differs', () => {
    expect(releaseTransitionKey('release-a', 'release-b')).toBe('release-a→release-b')
    expect(releaseTransitionKey('release-a', 'release-a')).toBeUndefined()
    expect(releaseTransitionKey(undefined, 'release-b')).toBeUndefined()
  })

  it('reloads once for a release transition and then falls back manually', async () => {
    vi.stubEnv('RELEASE_ID', 'release-a')
    const reload = vi.fn()
    const values = new Map<string, string>()
    const sessionStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    }
    vi.stubGlobal('window', {
      location: { reload },
      sessionStorage,
    })
    mocks.getStatus.mockResolvedValue({ ready: true, releaseId: 'release-b' })

    const service = new LazyChunkRecoveryService()
    await expect(service.recover()).resolves.toBe('reloaded')
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      LAZY_CHUNK_RELOAD_STORAGE_KEY,
      'release-a→release-b',
    )
    expect(reload).toHaveBeenCalledOnce()

    await expect(service.recover()).resolves.toBe('manual')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('uses the final fallback when the active release cannot be checked', async () => {
    vi.stubEnv('RELEASE_ID', 'release-a')
    const reload = vi.fn()
    vi.stubGlobal('window', {
      location: { reload },
      sessionStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
      },
    })
    mocks.getStatus.mockRejectedValue(new Error('worker unavailable'))

    await expect(new LazyChunkRecoveryService().recover()).resolves.toBe('manual')
    expect(reload).not.toHaveBeenCalled()
  })
})
