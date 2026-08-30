import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DashboardSkeleton,
  DelayedSkeletonFallback,
  ListPageSkeleton,
  SettingsSkeleton,
} from './Skeletons'

describe('shared loading skeletons', () => {
  it('approximates dashboard, list and settings geometry', () => {
    const dashboard = renderToStaticMarkup(<DashboardSkeleton />)
    const list = renderToStaticMarkup(<ListPageSkeleton />)
    const settings = renderToStaticMarkup(<SettingsSkeleton />)

    expect(dashboard).toContain('aria-label="Cargando resumen"')
    expect(dashboard).toContain('skeleton-block')
    expect(list).toContain('aria-label="Cargando lista"')
    expect(list).toContain('sm:grid-cols-3')
    expect(settings).toContain('aria-label="Cargando ajustes"')
    expect(settings).toContain('border-b')
  })

  it('keeps a delayed fallback structurally present without showing it immediately', () => {
    const markup = renderToStaticMarkup(
      <DelayedSkeletonFallback kind="list" delayMs={120} />,
    )

    expect(markup).toContain('class="invisible"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('skeleton-block')
  })

  it('does not expose the old generic loading copy', () => {
    const markup = renderToStaticMarkup(<ListPageSkeleton />)

    expect(markup).not.toContain('Cargando sección')
  })
})
