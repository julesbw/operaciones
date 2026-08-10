import type { Store } from '../domain/models'

export const ALL_STORES = 'all'
export type StoreFilterValue = typeof ALL_STORES | string

type StoreFilterProps = {
  ariaLabel: string
  stores: Store[]
  value: StoreFilterValue
  onChange: (value: StoreFilterValue) => void
}

export function StoreFilter({
  ariaLabel,
  stores,
  value,
  onChange,
}: StoreFilterProps) {
  if (stores.length > 4) {
    return (
      <select
        aria-label={ariaLabel}
        className="compact-field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ALL_STORES}>Todas las tiendas</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>{store.name}</option>
        ))}
      </select>
    )
  }

  return (
    <div
      aria-label={ariaLabel}
      className="flex max-w-full gap-2 overflow-x-auto pb-1"
      role="group"
    >
      <button
        aria-pressed={value === ALL_STORES}
        className={value === ALL_STORES ? 'store-filter-active' : 'store-filter-item'}
        type="button"
        onClick={() => onChange(ALL_STORES)}
      >
        Todas
      </button>
      {stores.map((store) => (
        <button
          aria-pressed={value === store.id}
          className={value === store.id ? 'store-filter-active' : 'store-filter-item'}
          key={store.id}
          type="button"
          onClick={() => onChange(store.id)}
        >
          {store.name}
        </button>
      ))}
    </div>
  )
}
