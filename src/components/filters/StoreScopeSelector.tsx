import type { AppRole, Store } from '../../domain/models'
import {
  FilterChipGroup,
  type FilterChipOption,
} from './FilterChipGroup'

export const ALL_STORES = 'all'
export type StoreScopeValue = typeof ALL_STORES | Store['id']

type StoreScopeSelectorProps = {
  ariaLabel: string
  stores: readonly Store[]
  role: AppRole
  assignedStoreId?: string
  value: StoreScopeValue
  onChange: (value: StoreScopeValue) => void
  cashierPresentation?: 'hidden' | 'locked'
  includeInactive?: boolean
}

export function StoreScopeSelector({
  ariaLabel,
  stores,
  role,
  assignedStoreId,
  value,
  onChange,
  cashierPresentation = 'hidden',
  includeInactive = false,
}: StoreScopeSelectorProps) {
  const availableStores = stores.filter(
    (store) => includeInactive || store.status === 'active',
  )

  if (role === 'cashier') {
    if (cashierPresentation === 'hidden') return null

    const assignedStore = availableStores.find(
      (store) => store.id === assignedStoreId,
    )
    if (!assignedStore) return null

    return (
      <FilterChipGroup
        ariaLabel={ariaLabel}
        disabled
        options={[{ value: assignedStore.id, label: assignedStore.name }]}
        value={assignedStore.id}
        onChange={onChange}
      />
    )
  }

  const options: FilterChipOption<StoreScopeValue>[] = [
    { value: ALL_STORES, label: 'Todas' },
    ...availableStores.map((store) => ({
      value: store.id,
      label: store.name,
    })),
  ]

  return (
    <FilterChipGroup
      ariaLabel={ariaLabel}
      options={options}
      value={value}
      onChange={onChange}
    />
  )
}
