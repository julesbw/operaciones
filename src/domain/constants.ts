import type { Bills, CentralCashBills } from './models'

export const EMPTY_BILLS: Bills = {
  b1000: 0,
  b500: 0,
  b200: 0,
  b100: 0,
  b50: 0,
  b20: 0,
  monedas: 0,
}

export const EMPTY_CENTRAL_CASH_BILLS: CentralCashBills = {
  b1000: 0,
  b500: 0,
  b200: 0,
  b100: 0,
  b50: 0,
  b20: 0,
}

export const BILL_DENOMINATIONS = [
  { key: 'b1000', label: '$1,000', value: 1000 },
  { key: 'b500', label: '$500', value: 500 },
  { key: 'b200', label: '$200', value: 200 },
  { key: 'b100', label: '$100', value: 100 },
  { key: 'b50', label: '$50', value: 50 },
  { key: 'b20', label: '$20', value: 20 },
  { key: 'monedas', label: 'Monedas', value: 1 },
] as const satisfies ReadonlyArray<{
  key: keyof Bills
  label: string
  value: number
}>

export const WEEKDAYS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const
