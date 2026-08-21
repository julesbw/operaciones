import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  CashClosingDraft,
  Expense,
  MerchandiseTransfer,
  OperatorSession,
  Payment,
  Store,
  UserProfile,
} from '../domain/models'
import type { ClosingOperationalSummary } from '../services/closingService'
import { ClosingsPage, reconcileDraftSelection } from './ClosingsPage'

const timestamp = '2026-08-13T12:00:00.000Z'

const stores: Store[] = [
  {
    id: 'store-id',
    name: 'Antigua Casa Piedad',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

const user: UserProfile = {
  id: 'admin-id',
  fullName: 'Administración',
  role: 'admin',
}

const storeManagerSession: OperatorSession = {
  token: 'operator-token',
  expiresAt: '2999-01-01T00:00:00.000Z',
  account: {
    id: 'manager-id',
    username: 'manager',
    displayName: 'Encargada',
    role: 'store_manager',
    storeId: stores[0]!.id,
  },
}

const draft: CashClosingDraft = {
  id: 'draft-id',
  storeId: 'store-id',
  businessDate: '2026-08-13',
  grossSales: 0,
  bills: { b1000: 0, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0, monedas: 0 },
  balanceBills: { b1000: 0, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0, monedas: 0 },
  withdrawBills: { b1000: 0, b500: 0, b200: 0, b100: 0, b50: 0, b20: 0, monedas: 0 },
  cashBalance: 0,
  expensesTotal: 0,
  cashExpensesTotal: 0,
  outgoingTransfersTotal: 0,
  storeCashPaymentsTotal: 0,
  purchasesTotal: 0,
  cashPurchasesTotal: 0,
  operationalOutflowsTotal: 0,
  cashOutflowsTotal: 0,
  selectedExpenseIds: [],
  selectedTransferIds: [],
  selectedPaymentIds: [],
  selectedPurchasePaymentIds: [],
  knownExpenseIds: [],
  knownTransferIds: [],
  knownPaymentIds: [],
  knownPurchasePaymentIds: [],
  movementSelectionInitialized: false,
  countedCash: 0,
  cashToWithdraw: 0,
  expectedCash: 0,
  difference: 0,
  currentStep: 1,
  status: 'draft',
  createdBy: user.id,
  createdAt: timestamp,
  updatedAt: timestamp,
}

function expense(id: string): Expense {
  return {
    id,
    storeId: draft.storeId,
    businessDate: draft.businessDate,
    amount: 100,
    concept: id,
    paymentMethod: 'efectivo',
    fundingSource: 'store_cash',
    sourceStoreId: draft.storeId,
    createdBy: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    syncStatus: 'synced',
  }
}

function transfer(id: string): MerchandiseTransfer {
  return {
    id,
    originStoreId: draft.storeId,
    destinationStoreId: 'destination-id',
    ticketNumber: id,
    amount: 200,
    businessDate: draft.businessDate,
    createdBy: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    syncStatus: 'synced',
  }
}

function payment(id: string): Payment {
  return {
    id,
    collaboratorId: 'collaborator-id',
    collaboratorNameSnapshot: 'Trabajador',
    collaboratorStoreIdSnapshot: draft.storeId,
    payCycleEndWeekdaySnapshot: 6,
    businessDate: draft.businessDate,
    paidAt: timestamp,
    paidBy: user.id,
    suggestedAmount: 300,
    paidAmount: 300,
    fundingSource: 'store_cash',
    sourceStoreId: draft.storeId,
    createdAt: timestamp,
  }
}

function candidates(
  expenses: Expense[],
  transfers: MerchandiseTransfer[],
  payments: Payment[] = [],
): ClosingOperationalSummary {
  return {
    expenses,
    outgoingTransfers: transfers,
    storeCashPayments: payments,
    storeCashPurchases: [],
    expensesTotal: expenses.length * 100,
    cashExpensesTotal: expenses.length * 100,
    outgoingTransfersTotal: transfers.length * 200,
    storeCashPaymentsTotal: payments.length * 300,
    purchasesTotal: 0,
    cashPurchasesTotal: 0,
    operationalOutflowsTotal:
      expenses.length * 100 + transfers.length * 200 + payments.length * 300,
    cashOutflowsTotal: expenses.length * 100 + payments.length * 300,
  }
}

describe('ClosingsPage entry view', () => {
  it('opens on history and does not render the guided flow automatically', () => {
    const markup = renderToStaticMarkup(
      <ClosingsPage stores={stores} user={user} />,
    )

    expect(markup).toContain('Cortes')
    expect(markup).toContain('Filtrar cortes por tienda')
    expect(markup).toContain('Crear nuevo corte')
    expect(markup.match(/expense-date-control/g)).toHaveLength(2)
    expect(markup).toContain('grid grid-cols-2 gap-x-2')
    expect(markup).toContain('aria-label="Fecha inicial"')
    expect(markup).toContain('aria-label="Fecha final"')
    expect(markup).not.toContain('¿Cuánto vendió la tienda?')
  })

  it('shows only the assigned store to a store manager', () => {
    const markup = renderToStaticMarkup(
      <ClosingsPage
        operatorSession={storeManagerSession}
        stores={stores}
        user={{ ...user, role: 'cashier', storeId: stores[0]!.id }}
      />,
    )

    expect(markup).toContain('Cortes')
    expect(markup).toContain('Filtrar cortes por tienda')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('>Todas<')
    expect(markup).not.toContain('Agregar ajuste')
  })

  it('renders nothing for a cashier even if invoked directly', () => {
    const markup = renderToStaticMarkup(
      <ClosingsPage
        stores={stores}
        user={{ ...user, role: 'cashier', storeId: stores[0]!.id }}
      />,
    )

    expect(markup).toBe('')
  })
})

describe('reconcileDraftSelection', () => {
  it('selects every eligible movement the first time', () => {
    expect(
      reconcileDraftSelection(
        draft,
        candidates(
          [expense('expense-1')],
          [transfer('transfer-1')],
          [payment('payment-1')],
        ),
      ),
    ).toMatchObject({
      selectedExpenseIds: ['expense-1'],
      selectedTransferIds: ['transfer-1'],
      selectedPaymentIds: ['payment-1'],
      movementSelectionInitialized: true,
    })
  })

  it('keeps exclusions, drops consumed ids and selects newly eligible ids', () => {
    const initialized = {
      ...draft,
      selectedExpenseIds: [],
      selectedTransferIds: ['transfer-consumed'],
      selectedPaymentIds: ['payment-consumed'],
      knownExpenseIds: ['expense-excluded'],
      knownTransferIds: ['transfer-consumed'],
      knownPaymentIds: ['payment-consumed'],
      movementSelectionInitialized: true,
    }

    expect(
      reconcileDraftSelection(
        initialized,
        candidates(
          [expense('expense-excluded'), expense('expense-new')],
          [transfer('transfer-new')],
          [payment('payment-new')],
        ),
      ),
    ).toMatchObject({
      selectedExpenseIds: ['expense-new'],
      selectedTransferIds: ['transfer-new'],
      selectedPaymentIds: ['payment-new'],
      knownExpenseIds: ['expense-excluded', 'expense-new'],
      knownTransferIds: ['transfer-new'],
      knownPaymentIds: ['payment-new'],
    })
  })
})
