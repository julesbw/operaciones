export class OnlineRequiredError extends Error {
  constructor(message = 'Se necesita conexión para completar esta operación.') {
    super(message)
    this.name = 'OnlineRequiredError'
  }
}

export class ConnectivityService {
  isNetworkAvailable(): boolean {
    return typeof navigator === 'undefined' ||
      typeof navigator.onLine !== 'boolean'
      ? true
      : navigator.onLine
  }

  requireOnline(message?: string): void {
    if (!this.isNetworkAvailable()) {
      throw new OnlineRequiredError(message)
    }
  }

  subscribe(onChange: (networkAvailable: boolean) => void): () => void {
    const handleOnline = () => onChange(true)
    const handleOffline = () => onChange(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }
}

export const connectivityService = new ConnectivityService()
