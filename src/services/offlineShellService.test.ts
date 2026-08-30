import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OfflineShellService,
  type OfflineShellStatus,
} from './offlineShellService'

function workerFor(status: OfflineShellStatus): ServiceWorker {
  return {
    postMessage: vi.fn((_message: unknown, transfer: Transferable[]) => {
      const port = transfer[0] as MessagePort
      queueMicrotask(() => port.postMessage(status))
    }),
  } as unknown as ServiceWorker
}

function installBrowserGlobals(
  registration: ServiceWorkerRegistration,
): void {
  vi.stubGlobal('window', {
    clearTimeout,
    setTimeout,
  })
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: Promise.resolve(registration),
    },
  })
}

describe('OfflineShellService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('accepts only a ready shell from the client release', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('RELEASE_ID', 'release-a')
    const registration = {
      active: workerFor({ ready: true, releaseId: 'release-a' }),
      update: vi.fn(async () => undefined),
    } as unknown as ServiceWorkerRegistration
    installBrowserGlobals(registration)

    await expect(new OfflineShellService().ensureReady()).resolves.toBeUndefined()
  })

  it('waits for the new active worker when the current one is from an older release', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('RELEASE_ID', 'release-b')
    const oldWorker = workerFor({ ready: true, releaseId: 'release-a' })
    const newWorker = workerFor({ ready: true, releaseId: 'release-b' })
    const registration = {
      active: oldWorker,
      update: vi.fn(async () => {
        registration.active = newWorker
      }),
    } as unknown as ServiceWorkerRegistration & {
      active: ServiceWorker
    }
    installBrowserGlobals(registration)

    await expect(new OfflineShellService().ensureReady()).resolves.toBeUndefined()
    expect(registration.update).toHaveBeenCalledOnce()
  })
})
