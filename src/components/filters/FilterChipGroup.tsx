export type FilterChipOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

type FilterChipGroupProps<T extends string> = {
  ariaLabel: string
  options: readonly FilterChipOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

export function FilterChipGroup<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  disabled = false,
}: FilterChipGroupProps<T>) {
  return (
    <div
      aria-label={ariaLabel}
      className="filter-chip-group"
      role="group"
    >
      {options.map((option) => {
        const selected = value === option.value

        return (
          <button
            aria-pressed={selected}
            className={selected ? 'filter-chip-active' : 'filter-chip-item'}
            disabled={disabled || option.disabled}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
