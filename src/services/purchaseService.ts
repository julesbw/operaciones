import { EMPTY_CENTRAL_CASH_BILLS } from '../domain/constants'
import type {
  CreatePurchaseInput,
  PaidPurchase,
  Purchase,
  PurchasePayment,
  SyncQueueItem,
  UserProfile,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type {
  PurchasePaymentRow,
  PurchaseRow,
} from '../types/database'
import { getLocalDate } from '../utils/date'
import { calculateBillsTotal } from '../utils/money'
import { centralCashService } from './centralCashService'
import { connectivityService } from './connectivityService'

export type PurchaseDomainErrorCode =
  | 'PURCHASE_REQUIRES_ADMIN'
  | 'PURCHASE_SUPPLIER_REQUIRED'
  | 'PURCHASE_SUPPLIER_INACTIVE'
  | 'PURCHASE_INVALID_AMOUNT'
  | 'PURCHASE_INVALID_DATE'
  | 'PURCHASE_CENTRAL_CASH_REQUIRES_ONLINE'
  | 'PURCHASE_INSUFFICIENT_CENTRAL_CASH'
  | 'PURCHASE_BILLS_MISMATCH'
  | 'PURCHASE_STORE_REQUIRED'
  | 'PURCHASE_STORE_FORBIDDEN'
  | 'PURCHASE_ALREADY_IN_CLOSING'
  | 'PURCHASE_LOCKED'
  | 'PURCHASE_REQUEST_ID_CONFLICT'

const ERROR_MESSAGES: Record<PurchaseDomainErrorCode, string> = {
  PURCHASE_REQUIRES_ADMIN: 'Sólo administración puede registrar Compras.',
  PURCHASE_SUPPLIER_REQUIRED: 'Selecciona un proveedor activo.',
  PURCHASE_SUPPLIER_INACTIVE:
    'El proveedor ya no está activo. Actualiza el catálogo.',
  PURCHASE_INVALID_AMOUNT: 'El monto debe ser mayor a cero.',
  PURCHASE_INVALID_DATE: 'La fecha de la compra no puede ser futura.',
  PURCHASE_CENTRAL_CASH_REQUIRES_ONLINE:
    'Necesitas conexión para confirmar una compra desde Caja Central.',
  PURCHASE_INSUFFICIENT_CENTRAL_CASH:
    'Caja Central no tiene saldo o denominaciones suficientes.',
  PURCHASE_BILLS_MISMATCH:
    'Las denominaciones no coinciden con el monto de la compra.',
  PURCHASE_STORE_REQUIRED: 'Selecciona una tienda activa.',
  PURCHASE_STORE_FORBIDDEN: 'La tienda seleccionada no está permitida.',
  PURCHASE_ALREADY_IN_CLOSING: 'La compra ya pertenece a un Corte cerrado.',
  PURCHASE_LOCKED: 'La compra ya tiene efecto financiero y es de sólo lectura.',
  PURCHASE_REQUEST_ID_CONFLICT:
    'La solicitud ya se utilizó para una compra diferente.',
}

export class PurchaseDomainError extends Error {
  constructor(readonly code: PurchaseDomainErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code])
    this.name = 'PurchaseDomainError'
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function sameBills(
  left: PurchasePayment['bills'],
  right: CreatePurchaseInput['bills'],
): boolean {
  if (!left || !right) return left === right
  return (Object.keys(EMPTY_CENTRAL_CASH_BILLS) as Array<keyof typeof left>).every(
    (key) => left[key] === right[key],
  )
}

function isSamePurchaseRequest(
  purchase: Purchase,
  payment: PurchasePayment,
  input: CreatePurchaseInput,
): boolean {
  return (
    payment.id === input.paymentId &&
    purchase.supplierId === input.supplierId &&
    purchase.businessDate === input.businessDate &&
    (purchase.folio ?? '') === (input.folio?.trim() ?? '') &&
    roundMoney(purchase.amount) === roundMoney(input.amount) &&
    (purchase.notes ?? '') === (input.notes?.trim() ?? '') &&
    payment.fundingSource === input.fundingSource &&
    payment.sourceStoreId === input.sourceStoreId &&
    payment.paymentMethod === input.paymentMethod &&
    sameBills(payment.bills, input.bills) &&
    roundMoney(payment.coinsAmount) === roundMoney(input.coinsAmount ?? 0)
  )
}

function mapPurchase(row: PurchaseRow, synced = true): Purchase {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierNameSnapshot: row.supplier_name_snapshot,
    businessDate: row.business_date,
    folio: row.folio ?? undefined,
    amount: Number(row.amount),
    notes: row.notes ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: synced ? 'synced' : 'pending',
  }
}

function mapPayment(row: PurchasePaymentRow): PurchasePayment {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    amount: Number(row.amount),
    fundingSource: row.funding_source,
    sourceStoreId: row.source_store_id ?? undefined,
    paymentMethod: row.payment_method,
    bills: row.bills ?? undefined,
    coinsAmount: Number(row.coins_amount),
    paidAt: row.paid_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function purchaseError(cause: unknown): Error {
  if (!cause || typeof cause !== 'object') {
    return new Error('No fue posible registrar la compra.')
  }
  const text = [
    'message' in cause ? cause.message : '',
    'details' in cause ? cause.details : '',
  ].join(' ')
  const code = Object.keys(ERROR_MESSAGES).find((candidate) =>
    String(text).includes(candidate),
  ) as PurchaseDomainErrorCode | undefined
  return code
    ? new PurchaseDomainError(code)
    : cause instanceof Error
      ? cause
      : new Error(String(text))
}

export function validatePurchaseInput(input: CreatePurchaseInput): void {
  if (!input.supplierId) {
    throw new PurchaseDomainError('PURCHASE_SUPPLIER_REQUIRED')
  }
  if (!input.businessDate) {
    throw new PurchaseDomainError(
      'PURCHASE_INVALID_AMOUNT',
      'Selecciona la fecha de la compra.',
    )
  }
  if (input.businessDate > getLocalDate()) {
    throw new PurchaseDomainError(
      'PURCHASE_INVALID_DATE',
    )
  }
  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    roundMoney(input.amount) <= 0
  ) {
    throw new PurchaseDomainError('PURCHASE_INVALID_AMOUNT')
  }
  if ((input.folio?.trim().length ?? 0) > 80) {
    throw new PurchaseDomainError(
      'PURCHASE_INVALID_AMOUNT',
      'El folio no puede exceder 80 caracteres.',
    )
  }
  if ((input.notes?.trim().length ?? 0) > 500) {
    throw new PurchaseDomainError(
      'PURCHASE_INVALID_AMOUNT',
      'Las notas no pueden exceder 500 caracteres.',
    )
  }
  if (input.fundingSource === 'store_cash' && !input.sourceStoreId) {
    throw new PurchaseDomainError('PURCHASE_STORE_REQUIRED')
  }
  if (input.fundingSource === 'central_cash' && input.sourceStoreId) {
    throw new PurchaseDomainError('PURCHASE_STORE_FORBIDDEN')
  }

  if (input.paymentMethod === 'efectivo') {
    if (!input.bills) {
      throw new PurchaseDomainError('PURCHASE_BILLS_MISMATCH')
    }
    const total = calculateBillsTotal({
      ...input.bills,
      monedas: input.coinsAmount ?? 0,
    })
    if (roundMoney(total) !== roundMoney(input.amount)) {
      throw new PurchaseDomainError('PURCHASE_BILLS_MISMATCH')
    }
    if (
      Object.values(input.bills).some(
        (count) => !Number.isInteger(count) || count < 0,
      ) ||
      !Number.isFinite(input.coinsAmount ?? 0) ||
      (input.coinsAmount ?? 0) < 0
    ) {
      throw new PurchaseDomainError('PURCHASE_BILLS_MISMATCH')
    }
  } else if (input.bills || (input.coinsAmount ?? 0) !== 0) {
    throw new PurchaseDomainError('PURCHASE_BILLS_MISMATCH')
  }
}

class PurchaseService {
  list(options?: Parameters<typeof operationsRepository.listPaidPurchases>[0]) {
    return operationsRepository.listPaidPurchases(options)
  }

  async refreshRemote(): Promise<void> {
    if (!supabase || !connectivityService.isNetworkAvailable()) return
    const [purchasesResult, paymentsResult] = await Promise.all([
      supabase.from('purchases').select('*').returns<PurchaseRow[]>(),
      supabase
        .from('purchase_payments')
        .select('*')
        .returns<PurchasePaymentRow[]>(),
    ])
    if (purchasesResult.error) throw purchaseError(purchasesResult.error)
    if (paymentsResult.error) throw purchaseError(paymentsResult.error)
    const paymentByPurchase = new Map(
      paymentsResult.data.map((payment) => [payment.purchase_id, payment]),
    )
    const items = purchasesResult.data.flatMap((purchase) => {
      const payment = paymentByPurchase.get(purchase.id)
      return payment
        ? [{ purchase: mapPurchase(purchase), payment: mapPayment(payment) }]
        : []
    })
    await operationsRepository.saveRemotePaidPurchases(items)
  }

  async create(
    input: CreatePurchaseInput,
    user: UserProfile,
  ): Promise<PaidPurchase> {
    if (user.role !== 'admin') {
      throw new PurchaseDomainError('PURCHASE_REQUIRES_ADMIN')
    }
    validatePurchaseInput(input)

    const existing = await operationsRepository.getPurchase(input.purchaseId)
    if (existing) {
      const payment = await operationsRepository.getPurchasePaymentByPurchaseId(
        existing.id,
      )
      if (payment && isSamePurchaseRequest(existing, payment, input)) {
        return { purchase: existing, payment }
      }
      throw new PurchaseDomainError('PURCHASE_REQUEST_ID_CONFLICT')
    }

    const supplier = await operationsRepository.getSupplier(input.supplierId)
    if (!supplier) throw new PurchaseDomainError('PURCHASE_SUPPLIER_REQUIRED')
    if (!supplier.isActive) {
      throw new PurchaseDomainError('PURCHASE_SUPPLIER_INACTIVE')
    }
    if (input.fundingSource === 'store_cash') {
      const sourceStore = (await operationsRepository.listStores()).find(
        (store) => store.id === input.sourceStoreId,
      )
      if (sourceStore?.status !== 'active') {
        throw new PurchaseDomainError('PURCHASE_STORE_FORBIDDEN')
      }
    }

    if (input.fundingSource === 'central_cash') {
      if (!supabase || !connectivityService.isNetworkAvailable()) {
        throw new PurchaseDomainError(
          'PURCHASE_CENTRAL_CASH_REQUIRES_ONLINE',
        )
      }
      const result = await this.callCreateRpc(input, new Date().toISOString())
      await operationsRepository.saveConfirmedPaidPurchase(
        result.purchase,
        result.payment,
      )
      await Promise.all([
        centralCashService.getSummary(),
        centralCashService.listMovements(),
      ])
      return result
    }

    const now = new Date().toISOString()
    const amount = roundMoney(input.amount)
    const purchase: Purchase = {
      id: input.purchaseId,
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.name,
      businessDate: input.businessDate,
      folio: input.folio?.trim() || undefined,
      amount,
      notes: input.notes?.trim() || undefined,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    }
    const payment: PurchasePayment = {
      id: input.paymentId,
      purchaseId: purchase.id,
      amount,
      fundingSource: input.fundingSource,
      sourceStoreId: input.sourceStoreId,
      paymentMethod: input.paymentMethod,
      bills: input.bills,
      coinsAmount: roundMoney(input.coinsAmount ?? 0),
      paidAt: now,
      createdBy: user.id,
      createdAt: now,
    }
    const queueItem: SyncQueueItem = {
      id: `purchase:${purchase.id}`,
      entityType: 'purchase',
      entityId: purchase.id,
      operation: 'insert',
      createdAt: now,
      attempts: 0,
    }
    await operationsRepository.savePaidPurchaseWithQueue(
      purchase,
      payment,
      queueItem,
    )
    return { purchase, payment }
  }

  async sync(purchaseId: string): Promise<void> {
    const purchase = await operationsRepository.getPurchase(purchaseId)
    const payment =
      await operationsRepository.getPurchasePaymentByPurchaseId(purchaseId)
    if (!purchase || !payment) {
      throw new Error('La compra local ya no existe.')
    }
    const result = await this.callCreateRpc(
      {
        purchaseId: purchase.id,
        paymentId: payment.id,
        supplierId: purchase.supplierId,
        businessDate: purchase.businessDate,
        folio: purchase.folio,
        amount: purchase.amount,
        notes: purchase.notes,
        fundingSource: payment.fundingSource,
        sourceStoreId: payment.sourceStoreId,
        paymentMethod: payment.paymentMethod,
        bills: payment.bills,
        coinsAmount: payment.coinsAmount,
      },
      purchase.createdAt,
    )
    await operationsRepository.saveConfirmedPaidPurchase(
      { ...result.purchase, syncStatus: purchase.syncStatus },
      result.payment,
    )
  }

  private async callCreateRpc(
    input: CreatePurchaseInput,
    createdAt: string,
  ): Promise<PaidPurchase> {
    if (!supabase) {
      throw new PurchaseDomainError('PURCHASE_CENTRAL_CASH_REQUIRES_ONLINE')
    }
    const { data, error } = await supabase.rpc('create_paid_purchase', {
      p_purchase_id: input.purchaseId,
      p_payment_id: input.paymentId,
      p_supplier_id: input.supplierId,
      p_business_date: input.businessDate,
      p_folio: input.folio?.trim() || null,
      p_amount: roundMoney(input.amount),
      p_notes: input.notes?.trim() || null,
      p_funding_source: input.fundingSource,
      p_source_store_id: input.sourceStoreId ?? null,
      p_payment_method: input.paymentMethod,
      p_bills: input.paymentMethod === 'efectivo' ? input.bills! : null,
      p_coins_amount:
        input.paymentMethod === 'efectivo'
          ? roundMoney(input.coinsAmount ?? 0)
          : 0,
      p_created_at: createdAt,
    })
    if (error) throw purchaseError(error)
    if (!data?.purchase || !data.payment) {
      throw new Error('Supabase no confirmó la compra.')
    }
    return {
      purchase: mapPurchase(data.purchase),
      payment: mapPayment(data.payment),
    }
  }
}

export const purchaseService = new PurchaseService()

export const EMPTY_PURCHASE_BILLS = { ...EMPTY_CENTRAL_CASH_BILLS }
