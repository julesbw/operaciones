import { offlineShellService } from './offlineShellService'

export const LAZY_CHUNK_RELOAD_STORAGE_KEY =
  'la-piedad-operaciones:lazy-chunk-reload'

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /chunkloaderror/i,
  /loading (?:chunk|css chunk) [^\s]+ failed/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /failed to load module script/i,
]

export type LazyChunkRecoveryResult = 'reloaded' | 'manual'

export function isDynamicImportChunkError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false

  const error = cause as { name?: unknown; message?: unknown }
  const name = typeof error.name === 'string' ? error.name : ''
  const message = typeof error.message === 'string' ? error.message : ''
  const diagnostic = `${name} ${message}`

  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(diagnostic),
  )
}

export function releaseTransitionKey(
  clientReleaseId: string | undefined,
  activeReleaseId: string | undefined,
): string | undefined {
  const client = clientReleaseId?.trim()
  const active = activeReleaseId?.trim()
  if (!client || !active || client === active) return undefined
  return `${client}→${active}`
}

export class LazyChunkRecoveryService {
  async recover(): Promise<LazyChunkRecoveryResult> {
    if (typeof window === 'undefined') return 'manual'

    const clientReleaseId = import.meta.env.RELEASE_ID?.trim()
    let activeReleaseId: string | undefined
    try {
      activeReleaseId = (await offlineShellService.getStatus()).releaseId
    } catch {
      return 'manual'
    }

    const transition = releaseTransitionKey(clientReleaseId, activeReleaseId)
    if (!transition) return 'manual'

    try {
      if (
        window.sessionStorage.getItem(LAZY_CHUNK_RELOAD_STORAGE_KEY) ===
        transition
      ) {
        return 'manual'
      }
      window.sessionStorage.setItem(
        LAZY_CHUNK_RELOAD_STORAGE_KEY,
        transition,
      )
    } catch {
      return 'manual'
    }

    try {
      window.location.reload()
      return 'reloaded'
    } catch {
      return 'manual'
    }
  }
}

export const lazyChunkRecoveryService = new LazyChunkRecoveryService()
