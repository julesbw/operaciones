import { Children, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BillCounterView, type BillCounts } from './BillCounter'

const emptyBills: BillCounts = {
  b1000: 0,
  b500: 0,
  b200: 0,
  b100: 0,
  b50: 0,
  b20: 0,
}

function inputsFor(view: ReturnType<typeof BillCounterView>) {
  const rootProps = view.props as { children: ReactElement[] }
  const rows = rootProps.children[0] as ReactElement<{ children: ReactElement[] }>
  return Children.toArray(rows.props.children).filter(
    (child) => (child as ReactElement).type === 'label',
  ) as ReactElement[]
}

type InputProps = {
  value?: string
  placeholder?: string
  onChange: (event: { target: { value: string } }) => void
}

function inputAt(view: ReturnType<typeof BillCounterView>, index: number) {
  const label = inputsFor(view)[index]!
  const children = Children.toArray(
    (label.props as { children: ReactElement[] }).children,
  ) as ReactElement[]
  return children.find((child) => child.type === 'input')! as ReactElement<InputProps>
}

describe('BillCounter', () => {
  it('renders zero counts as empty inputs with a zero placeholder', () => {
    const view = BillCounterView({ value: emptyBills, onChange: vi.fn() })
    const input = inputAt(view, 0)

    expect(input.props.value).toBe('')
    expect(input.props.placeholder).toBe('0')
  })

  it('converts writing and clearing into numeric state', () => {
    const onChange = vi.fn()
    const view = BillCounterView({ value: emptyBills, onChange })
    const input = inputAt(view, 1)

    input.props.onChange({ target: { value: '5' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyBills, b500: 5 })

    input.props.onChange({ target: { value: '12' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyBills, b500: 12 })

    onChange.mockClear()
    const populatedView = BillCounterView({
      value: { ...emptyBills, b500: 5 },
      onChange,
    })
    const populatedInput = inputAt(populatedView, 1)
    populatedInput.props.onChange({ target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(emptyBills)
  })

  it('rejects non-integer values and clamps configured maximums', () => {
    const onChange = vi.fn()
    const view = BillCounterView({
      maxCounts: { b500: 2 },
      onChange,
      value: emptyBills,
    })
    const input = inputAt(view, 1)

    input.props.onChange({ target: { value: '-2' } })
    input.props.onChange({ target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()

    input.props.onChange({ target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ ...emptyBills, b500: 2 })
  })
})
