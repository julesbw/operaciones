import {
  useRef,
  type ChangeEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'

export type DatePickerButtonProps = {
  'aria-label': string
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  variant?: 'control' | 'field'
  children: ReactNode
}

type DatePickerInput = Pick<HTMLInputElement, 'click'> & {
  showPicker?: () => void
}

export function openDatePicker(input: DatePickerInput | null) {
  if (!input) return

  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
      return
    } catch {
      // Some browsers expose showPicker but reject the call in unsupported contexts.
    }
  }

  input.click()
}

export function DatePickerButton({
  ...props
}: DatePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return <DatePickerButtonView {...props} inputRef={inputRef} />
}

export function DatePickerButtonView({
  'aria-label': ariaLabel,
  children,
  className,
  disabled = false,
  inputRef,
  max,
  min,
  onChange,
  variant = 'control',
  value,
}: DatePickerButtonProps & {
  inputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <span
      className="date-picker-button"
    >
      <button
        aria-label={ariaLabel}
        className={[
          variant === 'field' ? 'field relative' : 'expense-date-control',
          className,
          'date-picker-button-trigger',
        ].filter(Boolean).join(' ')}
        disabled={disabled}
        type="button"
        onClick={() => openDatePicker(inputRef.current)}
      >
        <span aria-hidden="true" className="date-picker-button-label">{children}</span>
      </button>
      <input
        ref={inputRef}
        aria-hidden="true"
        className="date-picker-button-input"
        disabled={disabled}
        max={max}
        min={min}
        tabIndex={-1}
        type="date"
        value={value}
        onChange={onChange}
      />
    </span>
  )
}
