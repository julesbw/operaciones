type LazyPageFallbackProps = {
  message?: string
}

export function LazyPageFallback({
  message = 'Cargando sección…',
}: LazyPageFallbackProps) {
  return (
    <section
      aria-live="polite"
      className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white/70 px-6 py-12"
      role="status"
    >
      <div className="flex items-center gap-3 text-sm font-semibold text-slate-500">
        <span
          aria-hidden="true"
          className="size-2.5 animate-pulse rounded-full bg-teal-600"
        />
        <span>{message}</span>
      </div>
    </section>
  )
}
