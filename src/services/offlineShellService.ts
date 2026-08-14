const SHELL_VERIFICATION_TIMEOUT_MS = 10_000

class OfflineShellService {
  async ensureReady(): Promise<void> {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error('El modo offline no terminó de instalarse')),
          SHELL_VERIFICATION_TIMEOUT_MS,
        )
      }),
    ])
    const worker = registration.active
    if (!worker) throw new Error('El modo offline todavía no está activo')

    const ready = await new Promise<boolean>((resolve, reject) => {
      const channel = new MessageChannel()
      const timeout = window.setTimeout(
        () => reject(new Error('No fue posible verificar el modo offline')),
        SHELL_VERIFICATION_TIMEOUT_MS,
      )
      channel.port1.addEventListener(
        'message',
        (event: MessageEvent<{ ready?: boolean }>) => {
          window.clearTimeout(timeout)
          resolve(event.data.ready === true)
        },
        { once: true },
      )
      channel.port1.start()
      worker.postMessage({ type: 'VERIFY_APP_SHELL' }, [channel.port2])
    })

    if (!ready) throw new Error('El app shell no está disponible sin conexión')
  }
}

export const offlineShellService = new OfflineShellService()
