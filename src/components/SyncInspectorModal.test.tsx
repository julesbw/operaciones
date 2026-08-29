import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { OperatorSession, UserProfile } from '../domain/models'
import type {
  SyncInspectorItem,
  SyncInspectorSnapshot,
} from '../services/syncInspectorService'
import { SyncInspectorModal } from './SyncInspectorModal'

const user: UserProfile = {
  id: 'technical-user',
  fullName: 'Terminal Centro',
  role: 'cashier',
  storeId: 'store-center',
}

const operatorSession: OperatorSession = {
  token: 'operator-token-must-not-render',
  expiresAt: '2999-01-01T00:00:00.000Z',
  account: {
    id: 'operator-a',
    username: 'operator-a',
    displayName: 'María López',
    role: 'cashier',
    storeId: 'store-center',
  },
}

const item: SyncInspectorItem = {
  id: 'expense:expense-id',
  entityType: 'expense',
  entityId: 'expense-id',
  operation: 'insert',
  description: 'Gasto · $350',
  detail: 'Gasolina',
  storeId: 'store-center',
  storeName: 'Tienda Centro',
  ownerId: 'technical-user',
  operatorAccountId: 'operator-a',
  businessDate: '2026-08-28',
  createdAt: '2026-08-28T15:00:00.000Z',
  status: 'pending',
  retryCount: 0,
}

const snapshot: SyncInspectorSnapshot = {
  items: [item],
  summary: { total: 1, pending: 1, syncing: 0, error: 0 },
}

function renderInspector(
  overrides: Partial<{
    snapshot: SyncInspectorSnapshot
    user: UserProfile
    operatorSession: OperatorSession
    networkAvailable: boolean
  }> = {},
) {
  return renderToStaticMarkup(
    <SyncInspectorModal
      loading={false}
      networkAvailable={true}
      onClose={vi.fn()}
      onRefresh={vi.fn()}
      onSync={vi.fn()}
      open
      snapshot={snapshot}
      syncing={false}
      user={user}
      operatorSession={operatorSession}
      {...overrides}
    />,
  )
}

describe('SyncInspectorModal', () => {
  it('shows the operation, store, current operator, status, attempts and dates', () => {
    const markup = renderInspector()

    expect(markup).toContain('Detalle de sincronización')
    expect(markup).toContain('Gasto · $350')
    expect(markup).toContain('Gasolina')
    expect(markup).toContain('Tienda Centro')
    expect(markup).toContain('María López')
    expect(markup).toContain('Pendiente')
    expect(markup).toContain('Alta')
    expect(markup).toContain('Intentos')
    expect(markup).toContain('Último intento')
    expect(markup).toContain('No disponible')
    expect(markup).toContain('Sincronizar ahora')
    expect(markup).not.toContain('operator-token-must-not-render')
  })

  it('does not attribute another operator or expose diagnostics to a cashier', () => {
    const otherOperatorItem: SyncInspectorItem = {
      ...item,
      id: 'expense:other',
      entityId: 'other',
      operatorAccountId: 'operator-b',
      status: 'error',
      retryCount: 2,
      lastError: 'Unexpected error PIN=123456 token_hash=secret',
      errorCode: 'SYNC_FAILED',
      diagnosticError:
        'PIN=123456 · OperatorSession token=operator-secret · token_hash=secret',
    }
    const markup = renderInspector({
      snapshot: {
        items: [
          otherOperatorItem,
          {
            ...item,
            id: 'attendance:legacy',
            entityId: 'legacy',
            operatorAccountId: null,
          },
        ],
        summary: { total: 2, pending: 1, syncing: 0, error: 1 },
      },
    })

    expect(markup).toContain('Cuenta operativa · operator-b')
    expect(markup).toContain('Sin identidad operativa (legacy)')
    expect(markup).toContain('No se pudo sincronizar esta operación')
    expect(markup).not.toContain('Diagnóstico')
    expect(markup).not.toContain('PIN=123456')
    expect(markup).not.toContain('token_hash=secret')
    expect(markup).not.toContain('operator-secret')
  })

  it('shows technical diagnostics only to administrators', () => {
    const markup = renderInspector({
      user: { ...user, role: 'admin', storeId: undefined },
      snapshot: {
        items: [
          {
            ...item,
            status: 'error',
            errorCode: 'P0001',
            diagnosticError: 'Attendance already belongs to a confirmed payment',
          },
        ],
        summary: { total: 1, pending: 0, syncing: 0, error: 1 },
      },
    })

    expect(markup).toContain('Diagnóstico')
    expect(markup).toContain('entityType')
    expect(markup).toContain('entityId')
    expect(markup).toContain('retryCount')
    expect(markup).toContain('lastAttemptAt')
    expect(markup).toContain('P0001')
    expect(markup).toContain('Attendance already belongs to a confirmed payment')
  })

  it('shows the paid-attendance reconciliation message without technical details to operators', () => {
    const markup = renderInspector({
      snapshot: {
        items: [
          {
            ...item,
            status: 'error',
            errorCode: '55000',
            diagnosticError: 'PAID_ATTENDANCE_IMMUTABLE',
          },
        ],
        summary: { total: 1, pending: 0, syncing: 0, error: 1 },
      },
    })

    expect(markup).toContain('Asistencia ya pagada')
    expect(markup).toContain('Esta asistencia pertenece a un periodo pagado')
    expect(markup).toContain('El cambio local fue descartado')
    expect(markup).not.toContain('PAID_ATTENDANCE_IMMUTABLE')
  })
})
