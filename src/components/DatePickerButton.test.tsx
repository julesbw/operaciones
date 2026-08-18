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
    const button = DatePickerButtonView({
      'aria-label': 'Fecha inicial',
      children: '01/08/2026',
      inputRef: { current: input as unknown as HTMLInputElement },
      onChange: vi.fn(),
      value: '2026-08-01',
    })

    button.props.onClick()

    expect(showPicker).toHaveBeenCalledOnce()
    expect(input.click).not.toHaveBeenCalled()
  })

  it('falls back to input.click and propagates input changes', () => {
    const input = { click: vi.fn() }
    const onChange = vi.fn()
    const button = DatePickerButtonView({
      'aria-label': 'Fecha final',
      children: '18/08/2026',
      inputRef: { current: input as unknown as HTMLInputElement },
      onChange,
      value: '2026-08-18',
    })
    const inputElement = button.props.children[1]
    const changeEvent = { target: { value: '2026-08-17' } }

    button.props.onClick()
    inputElement.props.onChange(changeEvent)

    expect(input.click).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(changeEvent)
  })
})
