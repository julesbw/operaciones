import type {
  PaymentFundingSource,
  PaymentMethod,
} from './models'

export function requiresCashBreakdown(options: {
  fundingSource: PaymentFundingSource
  paymentMethod: PaymentMethod
  cashBreakdownEnabled: boolean
}): boolean {
  return (
    options.paymentMethod === 'efectivo' &&
    (options.fundingSource === 'central_cash' ||
      (options.fundingSource === 'store_cash' &&
        options.cashBreakdownEnabled))
  )
}

export function cashBreakdownEnabledAfterFundingSourceChange(options: {
  currentFundingSource: PaymentFundingSource
  nextFundingSource: PaymentFundingSource
  hasCapturedBreakdown: boolean
}): boolean {
  return (
    options.nextFundingSource === 'central_cash' ||
    (options.currentFundingSource === 'central_cash' &&
      options.hasCapturedBreakdown)
  )
}
