import { useState } from 'react'
import {
  FilterChipGroup,
  type FilterChipOption,
} from '../components/filters/FilterChipGroup'
import type { StoreScopeValue } from '../components/filters/StoreScopeSelector'
import { UsersIcon } from '../components/icons'
import type { Store, UserProfile } from '../domain/models'
import { AttendancePage } from './AttendancePage'
import { PaymentsPage } from './PaymentsPage'

type CollaboratorsTab = 'attendance' | 'payments'

const TAB_OPTIONS: readonly FilterChipOption<CollaboratorsTab>[] = [
  { value: 'attendance', label: 'Asistencias' },
  { value: 'payments', label: 'Pagos' },
]

type CollaboratorsPageProps = {
  attendanceStoreFilter: StoreScopeValue
  stores: Store[]
  user: UserProfile
  onDataChanged: () => void
  onAttendanceStoreFilterChange: (value: StoreScopeValue) => void
}

export function CollaboratorsPage({
  attendanceStoreFilter,
  stores,
  user,
  onDataChanged,
  onAttendanceStoreFilterChange,
}: CollaboratorsPageProps) {
  const [tab, setTab] = useState<CollaboratorsTab>('attendance')

  return (
    <section>
      <div className="flex items-center gap-3">
        <UsersIcon className="size-8 text-teal-700" />
        <h1 className="page-title">Colaboradores</h1>
      </div>

      {user.role === 'admin' && (
        <div className="mt-5 sm:mt-7">
          <FilterChipGroup
            ariaLabel="Sección de Colaboradores"
            options={TAB_OPTIONS}
            value={tab}
            onChange={setTab}
          />
        </div>
      )}

      <div className="mt-6">
        {tab === 'attendance' && (
          <AttendancePage
            embedded
            stores={stores}
            storeFilter={attendanceStoreFilter}
            user={user}
            onDataChanged={onDataChanged}
            onStoreFilterChange={onAttendanceStoreFilterChange}
          />
        )}
        {tab === 'payments' && user.role === 'admin' && (
          <PaymentsPage embedded stores={stores} user={user} />
        )}
      </div>
    </section>
  )
}
