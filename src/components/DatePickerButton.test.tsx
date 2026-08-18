import { describe, expect, it, vi } from 'vitest'
import {
  DatePickerButtonView,
} from './DatePickerButton'

describe('DatePickerButton', () => {
  it('opens the native picker from the button click', () => {
    const showPicker = vi.fn()
    const input = {
      click: vi.fn(),
      showPicker,
    }
    const view = DatePickerButtonView({
      'aria-label': 'Fecha inicial',
      children: '01/08/2026',
      inputRef: { current: input as unknown as HTMLInputElement },
      onChange: vi.fn(),
      value: '2026-08-01',
    })

    const button = view.props.children[0]
    button.props.onClick()

    expect(showPicker).toHaveBeenCalledOnce()
    expect(input.click).not.toHaveBeenCalled()
  })

  it('falls back to input.click and propagates input changes', () => {
    const input = { click: vi.fn() }
    const onChange = vi.fn()
    const view = DatePickerButtonView({
      'aria-label': 'Fecha final',
      children: '18/08/2026',
      inputRef: { current: input as unknown as HTMLInputElement },
      onChange,
      value: '2026-08-18',
    })
    const button = view.props.children[0]
    const inputElement = view.props.children[1]
    const changeEvent = { target: { value: '2026-08-17' } }

    button.props.onClick()
    inputElement.props.onChange(changeEvent)

    expect(input.click).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(changeEvent)
  })

  it('keeps the native input as the shared controlled field', () => {
    const onChange = vi.fn()
    const view = DatePickerButtonView({
      'aria-label': 'Fecha de operación',
      children: '18/08/2026',
      disabled: true,
      inputRef: { current: null },
      max: '2026-08-31',
      min: '2026-08-01',
      onChange,
      value: '2026-08-18',
    })
    const button = view.props.children[0]
    const inputElement = view.props.children[1]

    expect(button.props['aria-label']).toBe('Fecha de operación')
    expect(inputElement.props.value).toBe('2026-08-18')
    expect(inputElement.props.onChange).toBe(onChange)
    expect(inputElement.props.min).toBe('2026-08-01')
    expect(inputElement.props.max).toBe('2026-08-31')
    expect(inputElement.props.disabled).toBe(true)
    expect(inputElement.props.onClick).toBeUndefined()
  })
})
