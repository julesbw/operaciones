import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectivityService,
  OnlineRequiredError,
} from './connectivityService'

describe('ConnectivityService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('allows online-required operations when the network is available', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const service = new ConnectivityService()

    expect(() => service.requireOnline()).not.toThrow()
  })

  it('returns a domain error before an online-required operation runs offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    const service = new ConnectivityService()

    expect(() =>
      service.requireOnline('Se necesita conexión para cerrar el corte.'),
    ).toThrowError(OnlineRequiredError)
  })
})
