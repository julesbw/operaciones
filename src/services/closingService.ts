import { BILL_DENOMINATIONS, EMPTY_BILLS } from '../domain/constants'
import type {
  Bills,
  CashClosingDraft,
  Expense,
  MerchandiseTransfer,
  PaidPurchase,
  Payment,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type {
  CashClosingExpenseItemRow,
  CashClosingRow,
  CashClosingPaymentItemRow,
  CashClosingPurchaseItemRow,
  CashClosingTransferItemRow,
} from '../types/database'
import type { ClosingAdjustment } from '../domain/models'
import { calculateBillsTotal } from '../utils/money'
import { connectivityService } from './connectivityService'
import { syncService } from './syncService'
import { closingAdjustmentService } from './closingAdjustmentService'

export type ClosingExpenseTotals = {
  total: number
  cash: number
}

export type ClosingOperationalTotals = {
  expensesTotal: number
  cashExpensesTotal: number
  outgoingTransfersTotal: number
  storeCashPaymentsTotal: number
  purchasesTotal: number
  cashPurchasesTotal: number
  operationalOutflowsTotal: number
  cashOutflowsTotal: number
}

export type ClosingOperationalSummary = ClosingOperationalTotals & {
  expenses: Expense[]
  outgoingTransfers: MerchandiseTransfer[]
  storeCashPayments: Payment[]
  storeCashPurchases: PaidPurchase[]
}

export type CashClosingDetail = {
  closing: CashClosingRow
  expenses: CashClosingExpenseItemRow[]
  transfers: CashClosingTransferItemRow[]
  payments: CashClosingPaymentItemRow[]
  purchases: CashClosingPurchaseItemRow[]
  adjustments: ClosingAdjustment[]
}

export type ClosingDomainErrorCode =
  | 'CLOSING_ALREADY_EXISTS'
  | 'MOVEMENT_ALREADY_ASSIGNED'
  | 'SELECTED_MOVEMENT_NOT_FOUND'
  | 'SELECTED_MOVEMENT_PENDING_SYNC'
  | 'PURCHASE_ALREADY_IN_CLOSING'

export class ClosingDomainError extends Error {
  constructor(readonly code: ClosingDomainErrorCode, message: string) {
    super(message)
    this.name = 'ClosingDomainError'
  }
}

export type ClosingSummary = ClosingOperationalTotals & {
  resultAfterExpenses: number
  resultAfterOperationalOutflows: number
  countedCash: number
  cashBalance: number
  cashToWithdraw: number
  withdrawBills: Bills
  expectedCash: number
  grossCashReconstructed: number
  difference: number
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateWithdrawBills(
  countedBills: Bills,
  balanceBills: Bills,
): Bills {
  const withdrawBills = { ...EMPTY_BILLS }
  for (const denomination of BILL_DENOMINATIONS) {
    const difference =
      countedBills[denomination.key] - balanceBills[denomination.key]
    withdrawBills[denomination.key] =
      denomination.key === 'monedas'
        ? roundMoney(difference)
        : Math.trunc(difference)
  }
  return withdrawBills
}

export function validateClosingBillCounts(draft: CashClosingDraft): string[] {
  const errors: string[] = []
  for (const denomination of BILL_DENOMINATIONS) {
    const counted = draft.bills[denomination.key]
    const balance = draft.balanceBills[denomination.key]
    const requiresInteger = denomination.key !== 'monedas'

    if (
      !Number.isFinite(counted) ||
      counted < 0 ||
      (requiresInteger && !Number.isInteger(counted))
    ) {
      errors.push(`El conteo de ${denomination.label} no es válido`)
    }
    if (
      !Number.isFinite(balance) ||
      balance < 0 ||
      (requiresInteger && !Number.isInteger(balance))
    ) {
      errors.push(`El saldo de ${denomination.label} no es válido`)
    } else if (balance > counted) {
      errors.push(
        `No pueden permanecer más ${denomination.label} de los que se contaron`,
      )
    }
  }
  return errors
}

export function calculateExpenseTotals(
  expenses: Expense[],
): ClosingExpenseTotals {
  const totals = expenses.reduce<ClosingExpenseTotals>(
    (accumulator, expense) => ({
      total: accumulator.total + expense.amount,
      cash:
        accumulator.cash +
        (expense.paymentMethod === 'efectivo' ? expense.amount : 0),
    }),
    { total: 0, cash: 0 },
  )
  return {
    total: roundMoney(totals.total),
    cash: roundMoney(totals.cash),
  }
}

export function calculateOperationalTotals(
  expenses: Expense[],
  outgoingTransfers: MerchandiseTransfer[],
  storeCashPayments: Payment[] = [],
  storeCashPurchases: PaidPurchase[] = [],
): ClosingOperationalTotals {
  const expenseTotals = calculateExpenseTotals(expenses)
  const outgoingTransfersTotal = roundMoney(
    outgoingTransfers.reduce((total, transfer) => total + transfer.amount, 0),
  )
  const storeCashPaymentsTotal = roundMoney(
    storeCashPayments.reduce(
      (total, payment) => total + payment.paidAmount,
      0,
    ),
  )
  const purchasesTotal = roundMoney(
    storeCashPurchases.reduce(
      (total, item) => total + item.payment.amount,
      0,
    ),
  )
  const cashPurchasesTotal = roundMoney(
    storeCashPurchases.reduce(
      (total, item) =>
        total +
        (item.payment.paymentMethod === 'efectivo'
          ? item.payment.amount
          : 0),
      0,
    ),
  )

  return {
    expensesTotal: expenseTotals.total,
    cashExpensesTotal: expenseTotals.cash,
    outgoingTransfersTotal,
    storeCashPaymentsTotal,
    purchasesTotal,
    cashPurchasesTotal,
    operationalOutflowsTotal: roundMoney(
      expenseTotals.total +
        outgoingTransfersTotal +
        storeCashPaymentsTotal +
        purchasesTotal,
    ),
    cashOutflowsTotal: roundMoney(
      expenseTotals.cash + storeCashPaymentsTotal + cashPurchasesTotal,
    ),
  }
}

export function selectClosingMovements(
  candidates: Pick<
    ClosingOperationalSummary,
    | 'expenses'
    | 'outgoingTransfers'
    | 'storeCashPayments'
    | 'storeCashPurchases'
  >,
  expenseIds: readonly string[],
  transferIds: readonly string[],
  paymentIds: readonly string[] = [],
  purchasePaymentIds: readonly string[] = [],
): ClosingOperationalSummary {
  const expenseIdSet = new Set(expenseIds)
  const transferIdSet = new Set(transferIds)
  const paymentIdSet = new Set(paymentIds)
  const purchasePaymentIdSet = new Set(purchasePaymentIds)
  const expenses = candidates.expenses.filter((expense) =>
    expenseIdSet.has(expense.id),
  )
  const outgoingTransfers = candidates.outgoingTransfers.filter((transfer) =>
    transferIdSet.has(transfer.id),
  )
  const storeCashPayments = candidates.storeCashPayments.filter((payment) =>
    paymentIdSet.has(payment.id),
  )
  const storeCashPurchases = candidates.storeCashPurchases.filter(({ payment }) =>
    purchasePaymentIdSet.has(payment.id),
  )

  return {
    expenses,
    outgoingTransfers,
    storeCashPayments,
    storeCashPurchases,
    ...calculateOperationalTotals(
      expenses,
      outgoingTransfers,
      storeCashPayments,
      storeCashPurchases,
    ),
  }
}

export function mergePendingStoreCashPurchases(
  remotePurchases: PaidPurchase[],
  localPurchases: PaidPurchase[],
): PaidPurchase[] {
  const remotePurchaseIds = new Set(
    remotePurchases.map(({ purchase }) => purchase.id),
  )
  return [
    ...remotePurchases,
    ...localPurchases.filter(
      ({ purchase }) =>
        purchase.syncStatus !== 'synced' &&
        !remotePurchaseIds.has(purchase.id),
    ),
  ]
}

export function calculateClosingSummary(
  draft: CashClosingDraft,
  operational: ClosingOperationalTotals,
): ClosingSummary {
  const countedCash = roundMoney(calculateBillsTotal(draft.bills))
  const cashBalance = roundMoney(calculateBillsTotal(draft.balanceBills))
  const withdrawBills = calculateWithdrawBills(
    draft.bills,
    draft.balanceBills,
  )
  const grossSales = roundMoney(draft.grossSales)
  const expectedCash = roundMoney(grossSales - operational.cashOutflowsTotal)

  return {
    ...operational,
    resultAfterExpenses: roundMoney(grossSales - operational.expensesTotal),
    resultAfterOperationalOutflows: roundMoney(
      grossSales - operational.operationalOutflowsTotal,
    ),
    countedCash,
    cashBalance,
    cashToWithdraw: roundMoney(calculateBillsTotal(withdrawBills)),
    withdrawBills,
    expectedCash,
    grossCashReconstructed: roundMoney(
      countedCash + operational.cashOutflowsTotal,
    ),
    difference: roundMoney(countedCash - expectedCash),
  }
}

export function applyClosingSummary(
  draft: CashClosingDraft,
  operational: ClosingOperationalTotals,
): CashClosingDraft {
  const summary = calculateClosingSummary(draft, operational)
  return {
    ...draft,
    grossSales: roundMoney(draft.grossSales),
    cashBalance: summary.cashBalance,
    withdrawBills: summary.withdrawBills,
    expensesTotal: summary.expensesTotal,
    cashExpensesTotal: summary.cashExpensesTotal,
    outgoingTransfersTotal: summary.outgoingTransfersTotal,
    storeCashPaymentsTotal: summary.storeCashPaymentsTotal,
    purchasesTotal: summary.purchasesTotal,
    cashPurchasesTotal: summary.cashPurchasesTotal,
    operationalOutflowsTotal: summary.operationalOutflowsTotal,
    cashOutflowsTotal: summary.cashOutflowsTotal,
    countedCash: summary.countedCash,
    cashToWithdraw: summary.cashToWithdraw,
    expectedCash: summary.expectedCash,
    difference: summary.difference,
  }
}

class ClosingService {
  async getEligibleMovements(
    storeId: string,
    businessDate: string,
  ): Promise<ClosingOperationalSummary> {
    if (supabase && connectivityService.isNetworkAvailable()) {
      try {
        const { data, error } = await supabase.rpc(
          'get_cash_closing_candidates',
          {
            p_store_id: storeId,
            p_business_date: businessDate,
          },
        )
        if (error) throw error

        const expenses: Expense[] = (data?.expenses ?? []).map((expense) => ({
          id: expense.id,
          storeId: expense.store_id,
          businessDate: expense.business_date,
          amount: Number(expense.amount),
          concept: expense.concept,
          paymentMethod: expense.payment_method,
          notes: expense.notes ?? undefined,
          createdBy: expense.created_by,
          createdAt: expense.created_at,
          updatedAt: expense.updated_at,
          version: expense.version,
          syncStatus: 'synced',
        }))
        const outgoingTransfers: MerchandiseTransfer[] = (
          data?.transfers ?? []
        ).map((transfer) => ({
          id: transfer.id,
          originStoreId: transfer.origin_store_id,
          destinationStoreId: transfer.destination_store_id,
          ticketNumber: transfer.ticket_number,
          amount: Number(transfer.amount),
          businessDate: transfer.business_date,
          notes: transfer.notes ?? undefined,
          createdBy: transfer.created_by,
          createdAt: transfer.created_at,
          updatedAt: transfer.updated_at,
          version: transfer.version,
          syncStatus: 'synced',
        }))
        const storeCashPayments: Payment[] = (data?.payments ?? []).map(
          (payment) => ({
            id: payment.id,
            collaboratorId: payment.collaborator_id,
            collaboratorNameSnapshot: payment.collaborator_name_snapshot,
            collaboratorStoreIdSnapshot:
              payment.collaborator_store_id_snapshot,
            payCycleEndWeekdaySnapshot:
              payment.pay_cycle_end_weekday_snapshot,
            businessDate: payment.business_date,
            paidAt: payment.paid_at,
            paidBy: payment.paid_by,
            suggestedAmount: Number(payment.suggested_amount),
            paidAmount: Number(payment.paid_amount),
            fundingSource: payment.funding_source,
            sourceStoreId: payment.source_store_id ?? undefined,
            notes: payment.notes ?? undefined,
            createdAt: payment.created_at,
          }),
        )
        const remoteStoreCashPurchases: PaidPurchase[] = (
          data?.purchases ?? []
        ).map((item) => ({
          purchase: {
            id: item.purchase.id,
            supplierId: item.purchase.supplier_id,
            supplierNameSnapshot: item.purchase.supplier_name_snapshot,
            businessDate: item.purchase.business_date,
            folio: item.purchase.folio ?? undefined,
            amount: Number(item.purchase.amount),
            notes: item.purchase.notes ?? undefined,
            createdBy: item.purchase.created_by,
            createdAt: item.purchase.created_at,
            updatedAt: item.purchase.updated_at,
            syncStatus: 'synced',
          },
          payment: {
            id: item.payment.id,
            purchaseId: item.payment.purchase_id,
            amount: Number(item.payment.amount),
            fundingSource: item.payment.funding_source,
            sourceStoreId: item.payment.source_store_id ?? undefined,
            paymentMethod: item.payment.payment_method,
            bills: item.payment.bills ?? undefined,
            coinsAmount: Number(item.payment.coins_amount),
            paidAt: item.payment.paid_at,
            createdBy: item.payment.created_by,
            createdAt: item.payment.created_at,
          },
        }))
        const storeCashPurchases = mergePendingStoreCashPurchases(
          remoteStoreCashPurchases,
          await operationsRepository.listStoreCashPurchases(
            storeId,
            businessDate,
          ),
        )

        return {
          expenses,
          outgoingTransfers,
          storeCashPayments,
          storeCashPurchases,
          ...calculateOperationalTotals(
            expenses,
            outgoingTransfers,
            storeCashPayments,
            storeCashPurchases,
          ),
        }
      } catch (cause: unknown) {
        console.error(
          'No fue posible consultar candidatos remotos; se usarán los datos locales',
          cause,
        )
      }
    }

    const [localExpenses, localTransfers, localPayments, localPurchases] = await Promise.all([
      operationsRepository.listExpenses(storeId, businessDate),
      operationsRepository.listMerchandiseTransfers(storeId, businessDate),
      operationsRepository.listStoreCashPayments(storeId, businessDate),
      operationsRepository.listStoreCashPurchases(storeId, businessDate),
    ])
    const expenses = localExpenses
    const outgoingTransfers = localTransfers
    const storeCashPayments = localPayments
    const storeCashPurchases = localPurchases

    return {
      expenses,
      outgoingTransfers,
      storeCashPayments,
      storeCashPurchases,
      ...calculateOperationalTotals(
        expenses,
        outgoingTransfers,
        storeCashPayments,
        storeCashPurchases,
      ),
    }
  }

  getOperationalSummary(
    candidates: Pick<
      ClosingOperationalSummary,
      | 'expenses'
      | 'outgoingTransfers'
      | 'storeCashPayments'
      | 'storeCashPurchases'
    >,
    expenseIds: readonly string[],
    transferIds: readonly string[],
    paymentIds: readonly string[],
    purchasePaymentIds: readonly string[],
  ): ClosingOperationalSummary {
    return selectClosingMovements(
      candidates,
      expenseIds,
      transferIds,
      paymentIds,
      purchasePaymentIds,
    )
  }

  listDrafts(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CashClosingDraft[]> {
    return operationsRepository.listClosingDrafts(storeId, dateFrom, dateTo)
  }

  async listClosed(
    storeId?: string,
    dateFrom?: string,
    dateTo = dateFrom,
  ): Promise<CashClosingRow[]> {
    if (!supabase || !connectivityService.isNetworkAvailable()) return []

    let query = supabase.from('cash_closings').select('*').eq('status', 'closed')
    if (storeId) query = query.eq('store_id', storeId)
    if (dateFrom) query = query.gte('business_date', dateFrom)
    if (dateTo) query = query.lte('business_date', dateTo)

    try {
      const { data, error } = await query
        .order('business_date', { ascending: false })
        .order('closing_number', { ascending: false })
      if (error) throw error
      return data
    } catch (cause: unknown) {
      console.error(
        'No fue posible consultar cortes cerrados; se conservarán los borradores locales',
        cause,
      )
      return []
    }
  }

  async getClosedDetail(id: string): Promise<CashClosingDetail> {
    if (!supabase) throw new Error('Supabase no está configurado')
    connectivityService.requireOnline(
      'Se necesita conexión para consultar un corte cerrado.',
    )

    const [closingResult, expensesResult, transfersResult, paymentsResult, purchasesResult, adjustments] = await Promise.all([
      supabase.from('cash_closings').select('*').eq('id', id).single(),
      supabase
        .from('cash_closing_expense_items')
        .select('*')
        .eq('cash_closing_id', id)
        .order('created_at'),
      supabase
        .from('cash_closing_transfer_items')
        .select('*')
        .eq('cash_closing_id', id)
        .order('created_at'),
      supabase
        .from('cash_closing_payment_items')
        .select('*')
        .eq('cash_closing_id', id)
        .order('created_at'),
      supabase
        .from('cash_closing_purchase_items')
        .select('*')
        .eq('cash_closing_id', id)
        .order('created_at'),
      closingAdjustmentService.list(id),
    ])
    if (closingResult.error) throw closingResult.error
    if (expensesResult.error) throw expensesResult.error
    if (transfersResult.error) throw transfersResult.error
    if (paymentsResult.error) throw paymentsResult.error
    if (purchasesResult.error) throw purchasesResult.error

    return {
      closing: closingResult.data,
      expenses: expensesResult.data,
      transfers: transfersResult.data,
      payments: paymentsResult.data,
      purchases: purchasesResult.data,
      adjustments,
    }
  }

  async load(
    storeId: string,
    businessDate: string,
    userId: string,
  ): Promise<CashClosingDraft | undefined> {
    const saved = await operationsRepository.getClosingDraft(
      storeId,
      businessDate,
    )
    if (!saved) return undefined

    return {
      ...saved,
      createdBy: saved.createdBy || userId,
    }
  }

  create(
    storeId: string,
    businessDate: string,
    userId: string,
  ): CashClosingDraft {
    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      storeId,
      businessDate,
      grossSales: 0,
      bills: { ...EMPTY_BILLS },
      balanceBills: { ...EMPTY_BILLS },
      withdrawBills: { ...EMPTY_BILLS },
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
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }
  }

  async save(
    draft: CashClosingDraft,
    operational: ClosingOperationalTotals,
  ): Promise<CashClosingDraft> {
    const savedDraft = {
      ...applyClosingSummary(draft, operational),
      updatedAt: new Date().toISOString(),
    }
    await operationsRepository.saveClosingDraft(savedDraft)
    return savedDraft
  }

  discard(id: string): Promise<void> {
    return operationsRepository.deleteClosingDraft(id)
  }

  async close(
    draft: CashClosingDraft,
  ): Promise<CashClosingRow> {
    if (!supabase) throw new Error('Supabase no está configurado')
    connectivityService.requireOnline(
      'Se necesita conexión para cerrar el corte.',
    )

    try {
      await syncService.process()
    } catch (cause: unknown) {
      console.error('No fue posible sincronizar antes del cierre', cause)
      throw new Error(
        'No fue posible sincronizar los movimientos del día. Intenta nuevamente.',
        { cause },
      )
    }

    const pending =
      await operationsRepository.countPendingSelectedClosingMovements(
        draft.selectedExpenseIds,
        draft.selectedTransferIds,
        draft.selectedPurchasePaymentIds,
      )
    if (
      pending.expenses > 0 ||
      pending.transfers > 0 ||
      pending.purchases > 0
    ) {
      throw new ClosingDomainError(
        'SELECTED_MOVEMENT_PENDING_SYNC',
        'Hay movimientos seleccionados pendientes de sincronizar. Sincronízalos antes de cerrar el corte.',
      )
    }

    const latestCandidates = await this.getEligibleMovements(
      draft.storeId,
      draft.businessDate,
    )
    const latestExpenseIds = new Set(
      latestCandidates.expenses.map((expense) => expense.id),
    )
    const latestTransferIds = new Set(
      latestCandidates.outgoingTransfers.map((transfer) => transfer.id),
    )
    const latestPaymentIds = new Set(
      latestCandidates.storeCashPayments.map((payment) => payment.id),
    )
    const latestPurchasePaymentIds = new Set(
      latestCandidates.storeCashPurchases.map(({ payment }) => payment.id),
    )
    if (
      draft.selectedExpenseIds.some((id) => !latestExpenseIds.has(id)) ||
      draft.selectedTransferIds.some((id) => !latestTransferIds.has(id)) ||
      draft.selectedPaymentIds.some((id) => !latestPaymentIds.has(id)) ||
      draft.selectedPurchasePaymentIds.some(
        (id) => !latestPurchasePaymentIds.has(id),
      )
    ) {
      throw new ClosingDomainError(
        'MOVEMENT_ALREADY_ASSIGNED',
        'Uno o más movimientos ya fueron incluidos en otro corte. Actualiza el resumen para continuar.',
      )
    }

    const operational = this.getOperationalSummary(
      latestCandidates,
      draft.selectedExpenseIds,
      draft.selectedTransferIds,
      draft.selectedPaymentIds,
      draft.selectedPurchasePaymentIds,
    )
    const closedDraft = applyClosingSummary(draft, operational)
    const billErrors = validateClosingBillCounts(closedDraft)
    if (billErrors.length > 0) throw new Error(billErrors[0])
    if (closedDraft.grossSales < 0) {
      throw new Error('Las ventas brutas no pueden ser negativas')
    }
    if (closedDraft.cashBalance < 0) {
      throw new Error('El saldo de caja no puede ser negativo')
    }
    if (closedDraft.cashToWithdraw < 0) {
      throw new Error('El saldo de caja no puede superar el efectivo contado')
    }

    await operationsRepository.saveClosingDraft({
      ...closedDraft,
      updatedAt: new Date().toISOString(),
    })
    const { data, error } = await supabase.rpc('close_cash_closing', {
      p_id: closedDraft.id,
      p_store_id: closedDraft.storeId,
      p_business_date: closedDraft.businessDate,
      p_gross_sales: closedDraft.grossSales,
      p_bills: closedDraft.bills,
      p_balance_bills: closedDraft.balanceBills,
      p_notes: closedDraft.notes ?? null,
      p_expense_ids: closedDraft.selectedExpenseIds,
      p_transfer_ids: closedDraft.selectedTransferIds,
      p_payment_ids: closedDraft.selectedPaymentIds,
      p_purchase_payment_ids: closedDraft.selectedPurchasePaymentIds,
    })
    if (error) {
      const domainCode = [
        'CLOSING_ALREADY_EXISTS',
        'MOVEMENT_ALREADY_ASSIGNED',
        'SELECTED_MOVEMENT_NOT_FOUND',
        'PURCHASE_ALREADY_IN_CLOSING',
      ].find((code) => error.message.includes(code)) as
        | ClosingDomainErrorCode
        | undefined
      if (domainCode) {
        const messages: Record<ClosingDomainErrorCode, string> = {
          CLOSING_ALREADY_EXISTS: 'Este corte ya fue cerrado.',
          MOVEMENT_ALREADY_ASSIGNED:
            'Uno o más movimientos ya fueron incluidos en otro corte. Actualiza el resumen para continuar.',
          SELECTED_MOVEMENT_NOT_FOUND:
            'Uno o más movimientos seleccionados ya no están disponibles. Actualiza el resumen.',
          SELECTED_MOVEMENT_PENDING_SYNC:
            'Hay movimientos seleccionados pendientes de sincronizar.',
          PURCHASE_ALREADY_IN_CLOSING:
            'Una o más Compras ya fueron incluidas en otro Corte.',
        }
        throw new ClosingDomainError(domainCode, messages[domainCode])
      }
      throw error
    }
    if (!data) throw new Error('Supabase no devolvió el corte confirmado')
    await operationsRepository.deleteClosingDraft(closedDraft.id)
    return data
  }
}

export const closingService = new ClosingService()
