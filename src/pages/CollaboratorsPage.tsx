import { useState } from 'react'
import {
  FilterChipGroup,
  type FilterChipOption,
} from '../components/filters/FilterChipGroup'
import { lazyNamedPage } from '../components/lazyPage'
import type { StoreScopeValue } from '../components/filters/StoreScopeSelector'
import { hasCapability } from '../domain/capabilities'
import { UsersIcon } from '../components/icons'
import type { OperatorSession, Store, UserProfile } from '../domain/models'
import { AttendancePage } from './AttendancePage'

const LazyPaymentsPage = lazyNamedPage(
  () => import('./PaymentsPage'),
  'PaymentsPage',
)

type CollaboratorsTab = 'attendance' | 'payments'

const TAB_OPTIONS: readonly FilterChipOption<CollaboratorsTab>[] = [
  { value: 'attendance', label: 'Asistencias' },
  { value: 'payments', label: 'Pagos' },
]

type CollaboratorsPageProps = {
  attendanceStoreFilter: StoreScopeValue
  operatorAccountId?: string | null
  operatorSession?: OperatorSession
  stores: Store[]
  user: UserProfile
  dataRevision?: number
  onDataChanged: () => void
  onAttendanceStoreFilterChange: (value: StoreScopeValue) => void
  onSync?: () => Promise<void>
}

export function CollaboratorsPage({
  attendanceStoreFilter,
  operatorAccountId,
  operatorSession,
  stores,
  user,
  dataRevision = 0,
  onDataChanged,
  onAttendanceStoreFilterChange,
  onSync,
}: CollaboratorsPageProps) {
  const [tab, setTab] = useState<CollaboratorsTab>('attendance')
  const canViewPayments = hasCapability(
    { technicalUser: user, operatorSession },
    'payments',
  )

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
            operatorSession={operatorSession}
            operatorAccountId={operatorAccountId}
            dataRevision={dataRevision}
            onDataChanged={onDataChanged}
            onStoreFilterChange={onAttendanceStoreFilterChange}
            onSync={onSync}
          />
        )}
        {tab === 'payments' && canViewPayments && (
          <LazyPaymentsPage
            dataRevision={dataRevision}
            embedded
            stores={stores}
            user={user}
          />
        )}
      </div>
    </section>
  )
}
