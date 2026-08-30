import { useEffect, useState, type ReactNode } from 'react'

type SkeletonBlockProps = {
  className: string
  dark?: boolean
}

function SkeletonBlock({ className, dark = false }: SkeletonBlockProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton-block${dark ? ' skeleton-block-dark' : ''} ${className}`}
    />
  )
}

function ListRows({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={index}>
          <SkeletonBlock className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock
              className={`h-3 rounded ${index % 3 === 0 ? 'w-3/5' : 'w-2/3'}`}
            />
            <SkeletonBlock className="h-2.5 w-2/5 rounded" />
          </div>
          <SkeletonBlock className="h-8 w-20 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

function SettingsRows({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={index}>
          <SkeletonBlock className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-2/5 rounded" />
            <SkeletonBlock className="h-2.5 w-1/3 rounded" />
          </div>
          <SkeletonBlock className="h-8 w-20 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

function SkeletonShell({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <section aria-label={label} className="space-y-5" role="status">
      {children}
    </section>
  )
}

export function DashboardSkeleton() {
  return (
    <SkeletonShell label="Cargando resumen">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SkeletonBlock className="mb-3 h-3 w-36 rounded" />
          <SkeletonBlock className="h-10 w-56 max-w-[75vw] rounded-xl" />
        </div>
        <SkeletonBlock className="h-7 w-32 rounded-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <article className="stat-card" key={index}>
            <SkeletonBlock className="size-11 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-2.5 w-24 rounded" />
              <SkeletonBlock className="h-7 w-28 rounded" />
            </div>
          </article>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <article className="hero-card min-h-[250px]">
          <div className="relative z-[1] max-w-lg space-y-4">
            <SkeletonBlock dark className="h-3 w-24 rounded" />
            <SkeletonBlock dark className="h-9 w-full max-w-md rounded-xl" />
            <SkeletonBlock dark className="h-3 w-full max-w-sm rounded" />
            <SkeletonBlock dark className="h-10 w-32 rounded-xl" />
          </div>
        </article>

        <article className="panel flex min-h-[250px] flex-col">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-3">
              <SkeletonBlock className="h-2.5 w-24 rounded" />
              <SkeletonBlock className="h-7 w-44 rounded" />
            </div>
            <SkeletonBlock className="size-11 shrink-0 rounded-2xl" />
          </div>
          <div className="mt-5 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-full rounded" />
            <SkeletonBlock className="h-3 w-4/5 rounded" />
          </div>
          <SkeletonBlock className="mt-6 h-4 w-36 rounded" />
        </article>
      </div>

      <SkeletonBlock className="h-20 w-full rounded-2xl" />
    </SkeletonShell>
  )
}

type ListPageSkeletonProps = {
  rows?: number
  rowsOnly?: boolean
}

export function ListPageSkeleton({
  rows = 5,
  rowsOnly = false,
}: ListPageSkeletonProps) {
  if (rowsOnly) return <ListRows rows={rows} />

  return (
    <SkeletonShell label="Cargando lista">
      <div>
        <SkeletonBlock className="h-10 w-52 max-w-[75vw] rounded-xl" />
        <SkeletonBlock className="mt-3 h-3 w-72 max-w-full rounded" />
      </div>

      <div className="panel grid gap-3 p-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="space-y-2" key={index}>
            <SkeletonBlock className="h-2.5 w-20 rounded" />
            <SkeletonBlock className="h-11 w-full rounded-xl" />
          </div>
        ))}
      </div>

      <div className="hidden sm:block">
        <article className="summary-strip">
          <SkeletonBlock className="h-8 w-36 rounded" />
          <SkeletonBlock className="h-4 w-40 rounded" />
        </article>
      </div>

      <article className="panel overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <SkeletonBlock className="h-5 w-32 rounded" />
          <SkeletonBlock className="size-5 rounded" />
        </div>
        <ListRows rows={rows} />
      </article>
    </SkeletonShell>
  )
}

type SettingsSkeletonProps = {
  rows?: number
  rowsOnly?: boolean
}

export function SettingsSkeleton({
  rows = 4,
  rowsOnly = false,
}: SettingsSkeletonProps) {
  if (rowsOnly) return <SettingsRows rows={rows} />

  return (
    <SkeletonShell label="Cargando ajustes">
      <div>
        <SkeletonBlock className="h-10 w-44 rounded-xl" />
        <SkeletonBlock className="mt-3 h-3 w-64 max-w-full rounded" />
      </div>

      <div className="flex gap-2 overflow-hidden border-b border-slate-200 pb-px">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock className="h-11 w-28 shrink-0 rounded-t-xl" key={index} />
        ))}
      </div>

      <article className="panel overflow-hidden p-0">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <SkeletonBlock className="h-5 w-44 rounded" />
          <SkeletonBlock className="mt-2 h-2.5 w-72 max-w-full rounded" />
        </div>
        <SettingsRows rows={rows} />
      </article>
    </SkeletonShell>
  )
}

type DelayedSkeletonFallbackProps = {
  kind: 'dashboard' | 'list' | 'settings'
  delayMs?: number
}

export function DelayedSkeletonFallback({
  kind,
  delayMs = 120,
}: DelayedSkeletonFallbackProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs])

  const skeleton =
    kind === 'dashboard' ? (
      <DashboardSkeleton />
    ) : kind === 'settings' ? (
      <SettingsSkeleton />
    ) : (
      <ListPageSkeleton />
    )

  return (
    <div
      aria-hidden={!visible}
      className={visible ? undefined : 'invisible'}
    >
      {skeleton}
    </div>
  )
}
