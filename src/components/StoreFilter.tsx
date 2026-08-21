import type { Store } from '../domain/models'
import {
  ALL_STORES,
  StoreScopeSelector,
  type StoreScopeValue,
} from './filters/StoreScopeSelector'

export { ALL_STORES }
export type StoreFilterValue = StoreScopeValue

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
  return (
    <StoreScopeSelector
      ariaLabel={ariaLabel}
      scope={{ kind: 'global' }}
      stores={stores}
      value={value}
      onChange={onChange}
    />
  )
}
