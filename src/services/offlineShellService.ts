const SHELL_VERIFICATION_TIMEOUT_MS = 10_000

export type OfflineShellStatus = {
  ready: boolean
  releaseId?: string
}

type ShellVerificationMessage = {
  ready?: unknown
  releaseId?: unknown
}

function remainingTime(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

export class OfflineShellService {
  async ensureReady(): Promise<void> {
    if (
      !import.meta.env.PROD ||
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return
    }

    const expectedReleaseId = import.meta.env.RELEASE_ID?.trim()
    if (!expectedReleaseId) {
      throw new Error('La aplicación no tiene un release identificable')
    }

    const deadline = Date.now() + SHELL_VERIFICATION_TIMEOUT_MS
    const registration = await this.waitForRegistration(deadline)
    await this.waitForReady(registration, expectedReleaseId, deadline)
  }

  async getStatus(): Promise<OfflineShellStatus> {
    if (
      !import.meta.env.PROD ||
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return { ready: false }
    }

    const deadline = Date.now() + SHELL_VERIFICATION_TIMEOUT_MS
    try {
      const registration = await this.waitForRegistration(deadline)
      if (!registration.active) return { ready: false }
      return await this.verify(registration.active, remainingTime(deadline))
    } catch {
      return { ready: false }
    }
  }

  private async waitForRegistration(
    deadline: number,
  ): Promise<ServiceWorkerRegistration> {
    const timeout = remainingTime(deadline)
    if (timeout <= 0) {
      throw new Error('El service worker no está disponible')
    }

    return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('El modo offline no terminó de instalarse'))
      }, timeout)
      void navigator.serviceWorker.ready.then(
        (registration) => {
          window.clearTimeout(timer)
          resolve(registration)
        },
        (cause: unknown) => {
          window.clearTimeout(timer)
          reject(cause)
        },
      )
    })
  }

  private async waitForReady(
    registration: ServiceWorkerRegistration,
    expectedReleaseId: string,
    deadline: number,
    updateRequested = false,
  ): Promise<void> {
    const timeLeft = remainingTime(deadline)
    if (timeLeft <= 0) {
      throw new Error('El app shell no está disponible sin conexión')
    }

    const worker = registration.active
    if (worker) {
      const status = await this.verify(worker, timeLeft)
      if (status.ready && status.releaseId === expectedReleaseId) return
    }

    if (!updateRequested) {
      try {
        await registration.update()
      } catch (cause: unknown) {
        console.warn('No fue posible buscar la actualización del worker', cause)
      }
    }

    await wait(Math.min(100, remainingTime(deadline)))
    return this.waitForReady(
      registration,
      expectedReleaseId,
      deadline,
      true,
    )
  }

  private verify(
    worker: ServiceWorker,
    timeoutMilliseconds: number,
  ): Promise<OfflineShellStatus> {
    return new Promise<OfflineShellStatus>((resolve, reject) => {
      if (timeoutMilliseconds <= 0) {
        reject(new Error('No fue posible verificar el modo offline'))
        return
      }

      const channel = new MessageChannel()
      const timeout = window.setTimeout(
        () => reject(new Error('No fue posible verificar el modo offline')),
        timeoutMilliseconds,
      )
      channel.port1.addEventListener(
        'message', (event: MessageEvent<ShellVerificationMessage>) => {
          window.clearTimeout(timeout)
          const releaseId =
            typeof event.data.releaseId === 'string'
              ? event.data.releaseId
              : undefined
          resolve({
            ready: event.data.ready === true,
            releaseId,
          })
        },
        { once: true },
      )
      channel.port1.start()
      try {
        worker.postMessage({ type: 'VERIFY_APP_SHELL' }, [channel.port2])
      } catch (cause: unknown) {
        window.clearTimeout(timeout)
        reject(cause)
      }
    })
  }
}

export const offlineShellService = new OfflineShellService()
