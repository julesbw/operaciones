import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  isDynamicImportChunkError,
  lazyChunkRecoveryService,
} from '../services/lazyChunkRecovery'
import { LazyPageFallback } from './LazyPageFallback'

type LazyPageErrorBoundaryProps = {
  children: ReactNode
  resetKey: string
}

type LazyPageErrorBoundaryState = {
  error?: unknown
  recovering: boolean
}

function ReloadAction() {
  return (
    <button
      className="button-secondary mt-5"
      type="button"
      onClick={() => window.location.reload()}
    >
      Actualizar
    </button>
  )
}

function ManualRecoveryFallback() {
  return (
    <section
      aria-labelledby="lazy-page-recovery-title"
      className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-10 text-center"
      role="alert"
    >
      <h2
        className="text-lg font-black text-amber-950"
        id="lazy-page-recovery-title"
      >
        No fue posible cargar esta sección
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-amber-900">
        Actualiza la aplicación para volver a intentar cargar la versión
        disponible.
      </p>
      <ReloadAction />
    </section>
  )
}

function RenderErrorFallback() {
  return (
    <section
      aria-labelledby="lazy-page-error-title"
      className="rounded-3xl border border-red-200 bg-red-50 px-6 py-10 text-center"
      role="alert"
    >
      <h2
        className="text-lg font-black text-red-950"
        id="lazy-page-error-title"
      >
        No fue posible mostrar esta sección
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-red-900">
        Intenta actualizar la aplicación. Si el problema continúa, vuelve a
        iniciar sesión cuando tengas conexión.
      </p>
      <ReloadAction />
    </section>
  )
}

export class LazyPageErrorBoundary extends Component<
  LazyPageErrorBoundaryProps,
  LazyPageErrorBoundaryState
> {
  state: LazyPageErrorBoundaryState = {
    recovering: false,
  }

  static getDerivedStateFromError(
    error: unknown,
  ): LazyPageErrorBoundaryState {
    return {
      error,
      recovering: isDynamicImportChunkError(error),
    }
  }

  componentDidCatch(error: unknown, _errorInfo: ErrorInfo): void {
    if (!isDynamicImportChunkError(error)) return

    void lazyChunkRecoveryService
      .recover()
      .then((result) => {
        if (result === 'manual') {
          this.setState({ error, recovering: false })
        }
      })
      .catch(() => {
        this.setState({ error, recovering: false })
      })
  }

  componentDidUpdate(
    previousProps: LazyPageErrorBoundaryProps,
  ): void {
    if (
      previousProps.resetKey !== this.props.resetKey &&
      this.state.error
    ) {
      this.setState({ error: undefined, recovering: false })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    if (isDynamicImportChunkError(this.state.error)) {
      return this.state.recovering ? (
        <LazyPageFallback message="Actualizando la aplicación…" />
      ) : (
        <ManualRecoveryFallback />
      )
    }
    return <RenderErrorFallback />
  }
}
