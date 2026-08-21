import type { RuntimeStoreScope } from '../../domain/capabilities'
import type { Store } from '../../domain/models'
import {
  FilterChipGroup,
  type FilterChipOption,
} from './FilterChipGroup'

export const ALL_STORES = 'all'
export type StoreScopeValue = typeof ALL_STORES | Store['id']

type StoreScopeSelectorProps = {
  ariaLabel: string
  stores: readonly Store[]
  scope: RuntimeStoreScope
  value: StoreScopeValue
  onChange: (value: StoreScopeValue) => void
  fixedPresentation?: 'hidden' | 'locked'
  includeInactive?: boolean
}

export function StoreScopeSelector({
  ariaLabel,
  stores,
  scope,
  value,
  onChange,
  fixedPresentation = 'hidden',
  includeInactive = false,
}: StoreScopeSelectorProps) {
  const availableStores = stores.filter(
    (store) => includeInactive || store.status === 'active',
  )

  if (scope.kind === 'unavailable') return null

  if (scope.kind === 'fixed') {
    if (fixedPresentation === 'hidden') return null

    const assignedStore = availableStores.find(
      (store) => store.id === scope.storeId,
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
