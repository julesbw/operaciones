import {
  CENTRAL_CASH_MOVEMENT_TYPES,
  PAYMENT_FUNDING_SOURCES,
  PAYMENT_METHODS,
  type CentralCashBills,
  type CentralCashMovementType,
  type PaymentFundingSource,
  type PaymentMethod,
} from '../domain/models'

export const FORM_DRAFT_VERSION = 1 as const
export const FORM_DRAFT_SAVE_DEBOUNCE_MS = 250

export type FormDraftKind = 'expense' | 'purchase' | 'centralCash'

export type FormDraftRecord<T> = {
  version: typeof FORM_DRAFT_VERSION
  ownerId: string
  createdAt: string
  updatedAt: string
  data: T
}

export type ExpenseDraftData = {
  formStoreId: string
  formDate: string
  amount: string
  concept: string
  requestId: string
  fundingSource: PaymentFundingSource
  paymentMethod: PaymentMethod
  bills: CentralCashBills
  coinsAmount: number
  cashBreakdownOpen: boolean
  notes: string
}

export type PurchaseDraftData = {
  supplierId: string
  businessDate: string
  folio: string
  amount: string
  fundingSource: PaymentFundingSource
  sourceStoreId: string
  paymentMethod: PaymentMethod
  bills: CentralCashBills
  coinsAmount: number
  cashBreakdownOpen: boolean
  notes: string
  purchaseId: string
  paymentId: string
}

export type CentralCashDraftData = {
  id: string
  movementType: CentralCashMovementType
  businessDate: string
  concept: string
  amount: number
  bills: CentralCashBills
  coinsAmount: string
  notes: string
}

const STORAGE_KEYS: Record<FormDraftKind, string> = {
  expense: 'operaciones.form-draft.expense',
  purchase: 'operaciones.form-draft.purchase',
  centralCash: 'operaciones.form-draft.central-cash',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isCentralCashBills(value: unknown): value is CentralCashBills {
  if (!isRecord(value)) return false
  return (
    isNonNegativeInteger(value.b1000) &&
    isNonNegativeInteger(value.b500) &&
    isNonNegativeInteger(value.b200) &&
    isNonNegativeInteger(value.b100) &&
    isNonNegativeInteger(value.b50) &&
    isNonNegativeInteger(value.b20)
  )
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === 'string' &&
    (PAYMENT_METHODS as readonly string[]).includes(value)
  )
}

function isFundingSource(value: unknown): value is PaymentFundingSource {
  return (
    typeof value === 'string' &&
    (PAYMENT_FUNDING_SOURCES as readonly string[]).includes(value)
  )
}

function isCentralCashMovementType(
  value: unknown,
): value is CentralCashMovementType {
  return (
    typeof value === 'string' &&
    (CENTRAL_CASH_MOVEMENT_TYPES as readonly string[]).includes(value)
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeDecimalInput(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value === '') return true
  if (!/^\d*\.?\d*$/.test(value)) return false
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 0
}

export function isExpenseDraftData(value: unknown): value is ExpenseDraftData {
  if (!isRecord(value)) return false
  return (
    typeof value.formStoreId === 'string' &&
    typeof value.formDate === 'string' &&
    typeof value.amount === 'string' &&
    typeof value.concept === 'string' &&
    isNonEmptyString(value.requestId) &&
    isFundingSource(value.fundingSource) &&
    isPaymentMethod(value.paymentMethod) &&
    isCentralCashBills(value.bills) &&
    isNonNegativeFiniteNumber(value.coinsAmount) &&
    typeof value.cashBreakdownOpen === 'boolean' &&
    typeof value.notes === 'string'
  )
}

export function isPurchaseDraftData(value: unknown): value is PurchaseDraftData {
  if (!isRecord(value)) return false
  return (
    typeof value.supplierId === 'string' &&
    typeof value.businessDate === 'string' &&
    typeof value.folio === 'string' &&
    typeof value.amount === 'string' &&
    isFundingSource(value.fundingSource) &&
    typeof value.sourceStoreId === 'string' &&
    isPaymentMethod(value.paymentMethod) &&
    isCentralCashBills(value.bills) &&
    isNonNegativeFiniteNumber(value.coinsAmount) &&
    typeof value.cashBreakdownOpen === 'boolean' &&
    typeof value.notes === 'string' &&
    isNonEmptyString(value.purchaseId) &&
    isNonEmptyString(value.paymentId)
  )
}

export function isCentralCashDraftData(
  value: unknown,
): value is CentralCashDraftData {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id) &&
    isCentralCashMovementType(value.movementType) &&
    typeof value.businessDate === 'string' &&
    typeof value.concept === 'string' &&
    isNonNegativeFiniteNumber(value.amount) &&
    isCentralCashBills(value.bills) &&
    isNonNegativeDecimalInput(value.coinsAmount) &&
    typeof value.notes === 'string'
  )
}

function getStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

function readRaw(kind: FormDraftKind): unknown {
  const storage = getStorage()
  if (!storage) return undefined
  try {
    const raw = storage.getItem(STORAGE_KEYS[kind])
    if (!raw) return undefined
    return JSON.parse(raw) as unknown
  } catch {
    try {
      storage.removeItem(STORAGE_KEYS[kind])
    } catch {
      // Storage puede estar disponible pero no permitir operaciones en ese contexto.
    }
    return undefined
  }
}

function removeRaw(kind: FormDraftKind): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEYS[kind])
  } catch {
    // La limpieza es best effort; nunca debe interrumpir el flujo del formulario.
  }
}

function isDraftRecord<T>(
  value: unknown,
  isData: (data: unknown) => data is T,
): value is FormDraftRecord<T> {
  if (!isRecord(value)) return false
  return (
    value.version === FORM_DRAFT_VERSION &&
    isNonEmptyString(value.ownerId) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    isData(value.data)
  )
}

class FormDraftService {
  read<T>(
    kind: FormDraftKind,
    ownerId: string,
    isData: (data: unknown) => data is T,
  ): FormDraftRecord<T> | undefined {
    if (!ownerId) return undefined
    const value = readRaw(kind)
    if (value === undefined) return undefined

    if (!isDraftRecord(value, isData)) {
      removeRaw(kind)
      return undefined
    }
    return value.ownerId === ownerId ? value : undefined
  }

  save<T>(
    kind: FormDraftKind,
    ownerId: string,
    data: T,
  ): FormDraftRecord<T> | undefined {
    if (!ownerId) return undefined
    const storage = getStorage()
    if (!storage) return undefined

    const current = readRaw(kind)
    const now = new Date().toISOString()
    const createdAt =
      isRecord(current) &&
      current.version === FORM_DRAFT_VERSION &&
      current.ownerId === ownerId &&
      isNonEmptyString(current.createdAt)
        ? current.createdAt
        : now
    const record: FormDraftRecord<T> = {
      version: FORM_DRAFT_VERSION,
      ownerId,
      createdAt,
      updatedAt: now,
      data,
    }

    try {
      storage.setItem(STORAGE_KEYS[kind], JSON.stringify(record))
      return record
    } catch {
      return undefined
    }
  }

  clear(kind: FormDraftKind, ownerId: string): void {
    if (!ownerId) return
    const storage = getStorage()
    if (!storage) return
    const current = readRaw(kind)
    if (isRecord(current) && current.ownerId !== ownerId) return
    removeRaw(kind)
  }
}

export const formDraftService = new FormDraftService()
