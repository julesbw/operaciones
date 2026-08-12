import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FilterChipGroup } from './FilterChipGroup'

type ChipButton = ReactElement<{
  'aria-pressed': boolean
  className: string
  onClick: () => void
}>

describe('FilterChipGroup', () => {
  const options = [
    { value: 'pending', label: 'Pendientes' },
    { value: 'paid', label: 'Pagados' },
  ] as const

  it('renders accessible options and the selected state', () => {
    const markup = renderToStaticMarkup(
      <FilterChipGroup
        ariaLabel="Filtrar pagos"
        options={options}
        value="paid"
        onChange={() => undefined}
      />,
    )

    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Filtrar pagos"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('Pagados')
    expect(markup).toContain('filter-chip-group')
  })

  it('reports the value of the selected option', () => {
    const onChange = vi.fn()
    const group = FilterChipGroup({
      ariaLabel: 'Filtrar pagos',
      options,
      value: 'pending',
      onChange,
    }) as ReactElement<{ children: ChipButton[] }>

    group.props.children[1]?.props.onClick()

    expect(onChange).toHaveBeenCalledWith('paid')
  })

  it('keeps many options in the same horizontally scrollable group', () => {
    const manyOptions = Array.from({ length: 8 }, (_, index) => ({
      value: `store-${index}`,
      label: `Tienda ${index}`,
    }))
    const markup = renderToStaticMarkup(
      <FilterChipGroup
        ariaLabel="Filtrar tiendas"
        options={manyOptions}
        value="store-0"
        onChange={() => undefined}
      />,
    )

    expect(markup.match(/<button/g)).toHaveLength(8)
    expect(markup).not.toContain('<select')
    expect(markup).toContain('filter-chip-group')
  })
})
