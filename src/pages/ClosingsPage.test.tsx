import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  CashClosingDraft,
  Expense,
  MerchandiseTransfer,
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
  operationalOutflowsTotal: 0,
  cashOutflowsTotal: 0,
  selectedExpenseIds: [],
  selectedTransferIds: [],
  knownExpenseIds: [],
  knownTransferIds: [],
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

function candidates(
  expenses: Expense[],
  transfers: MerchandiseTransfer[],
): ClosingOperationalSummary {
  return {
    expenses,
    outgoingTransfers: transfers,
    expensesTotal: expenses.length * 100,
    cashExpensesTotal: expenses.length * 100,
    outgoingTransfersTotal: transfers.length * 200,
    storeCashPaymentsTotal: 0,
    operationalOutflowsTotal: expenses.length * 100 + transfers.length * 200,
    cashOutflowsTotal: expenses.length * 100,
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
    expect(markup).not.toContain('¿Cuánto vendió la tienda?')
  })
})

describe('reconcileDraftSelection', () => {
  it('selects every eligible movement the first time', () => {
    expect(
      reconcileDraftSelection(
        draft,
        candidates([expense('expense-1')], [transfer('transfer-1')]),
      ),
    ).toMatchObject({
      selectedExpenseIds: ['expense-1'],
      selectedTransferIds: ['transfer-1'],
      movementSelectionInitialized: true,
    })
  })

  it('keeps exclusions, drops consumed ids and selects newly eligible ids', () => {
    const initialized = {
      ...draft,
      selectedExpenseIds: [],
      selectedTransferIds: ['transfer-consumed'],
      knownExpenseIds: ['expense-excluded'],
      knownTransferIds: ['transfer-consumed'],
      movementSelectionInitialized: true,
    }

    expect(
      reconcileDraftSelection(
        initialized,
        candidates(
          [expense('expense-excluded'), expense('expense-new')],
          [transfer('transfer-new')],
        ),
      ),
    ).toMatchObject({
      selectedExpenseIds: ['expense-new'],
      selectedTransferIds: ['transfer-new'],
      knownExpenseIds: ['expense-excluded', 'expense-new'],
      knownTransferIds: ['transfer-new'],
    })
  })
})
