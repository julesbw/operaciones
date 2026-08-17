import { describe, expect, it } from 'vitest'
import { normalizedSupplierName } from './supplierService'

describe('normalizedSupplierName', () => {
  it('treats casing and surrounding or repeated spaces as equivalent', () => {
    expect(normalizedSupplierName(' Bimbo ')).toBe('bimbo')
    expect(normalizedSupplierName('BIMBO')).toBe('bimbo')
    expect(normalizedSupplierName('Abarrotera   del Norte')).toBe(
      'abarrotera del norte',
    )
  })
})
