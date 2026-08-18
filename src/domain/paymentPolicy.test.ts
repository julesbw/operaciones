import { describe, expect, it } from 'vitest'
import type {
  AttendanceRecord,
  Collaborator,
  CollaboratorCompensationHistory,
  PaymentAttendanceItem,
} from './models'
import {
  buildCollaboratorPaymentState,
  calculatePaymentSelection,
  getDefaultPaymentSelection,
  getPaymentPeriod,
} from './paymentPolicy'

const collaborator: Collaborator = {
  id: 'collaborator-1',
  name: 'Trabajador',
  storeId: 'store-1',
  restDay: 5,
  payCycleEndWeekday: 6,
  status: 'active',
  weeklyPay: 2_000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const history: CollaboratorCompensationHistory[] = [
  {
    id: 'salary-1',
    collaboratorId: collaborator.id,
    weeklyPay: 2_000,
    effectiveFrom: '2026-01-01',
    recordedAt: '2026-01-01T00:00:00.000Z',
    recordedBy: 'admin-1',
  },
]

function attendance(date: string, id = date): AttendanceRecord {
  return {
    id,
    collaboratorId: collaborator.id,
    storeId: collaborator.storeId,
    attendanceDate: date,
    status: 'present',
    recordedBy: 'admin-1',
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    version: 1,
    syncStatus: 'synced',
  }
}

function paidItem(
  record: AttendanceRecord,
  allocation: number,
): PaymentAttendanceItem {
  return {
    paymentId: 'payment-1',
    attendanceId: record.id,
    workDateSnapshot: record.attendanceDate,
    periodStart: '2026-08-02',
    periodEnd: '2026-08-08',
    weeklyPaySnapshot: 2_000,
    dailyPaySnapshot: 333,
    suggestedAllocation: allocation,
    createdAt: '2026-08-08T12:00:00.000Z',
  }
}

describe('payment policy', () => {
  it('calculates individual periods from the collaborator payday', () => {
    expect(getPaymentPeriod('2026-08-02', 6)).toEqual({
      periodStart: '2026-08-02',
      periodEnd: '2026-08-08',
    })
    expect(getPaymentPeriod('2026-08-08', 5)).toEqual({
      periodStart: '2026-08-08',
      periodEnd: '2026-08-14',
    })
  })

  it('suggests the exact weekly pay for six days in a completed period', () => {
    const records = [2, 3, 4, 5, 6, 8].map((day) =>
      attendance(`2026-08-${String(day).padStart(2, '0')}`),
    )
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: records,
      paymentItems: [],
      compensationHistory: history,
      today: '2026-08-08',
    })

    expect(state.suggestedPending).toBe(2_000)
    expect(calculatePaymentSelection(state.periods, records.map((item) => item.id)))
      .toMatchObject({ suggestedAmount: 2_000, selectedDays: 6 })
  })

  it('suggests daily pay for five worked days', () => {
    const records = [2, 3, 4, 5, 6].map((day) =>
      attendance(`2026-08-${String(day).padStart(2, '0')}`),
    )
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: records,
      paymentItems: [],
      compensationHistory: history,
      today: '2026-08-08',
    })
    expect(state.suggestedPending).toBe(1_665)
  })

  it('absorbs the weekly residue when a partial period is settled', () => {
    const records = [2, 3, 4, 5, 6, 8].map((day) =>
      attendance(`2026-08-${String(day).padStart(2, '0')}`),
    )
    const paid = records.slice(0, 3).map((record) => paidItem(record, 333))
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: records,
      paymentItems: paid,
      compensationHistory: history,
      today: '2026-08-08',
    })
    const remaining = records.slice(3).map((record) => record.id)

    expect(state.suggestedPending).toBe(1_001)
    expect(calculatePaymentSelection(state.periods, remaining).suggestedAmount)
      .toBe(1_001)
  })

  it('suggests the sixth-day residue after an early five-day payment', () => {
    const records = [2, 3, 4, 5, 6, 8].map((day) =>
      attendance(`2026-08-${String(day).padStart(2, '0')}`),
    )
    const paid = records.slice(0, 5).map((record) => paidItem(record, 333))
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: records,
      paymentItems: paid,
      compensationHistory: history,
      today: '2026-08-08',
    })
    expect(state.suggestedPending).toBe(335)
  })

  it('uses effective salary history instead of the current salary', () => {
    const state = buildCollaboratorPaymentState({
      collaborator: { ...collaborator, weeklyPay: 3_000 },
      attendance: [attendance('2026-08-02')],
      paymentItems: [],
      compensationHistory: [
        ...history,
        {
          ...history[0]!,
          id: 'salary-2',
          weeklyPay: 3_000,
          effectiveFrom: '2026-08-10',
          recordedAt: '2026-08-10T12:00:00.000Z',
        },
      ],
      today: '2026-08-13',
    })
    expect(state.periods[0]?.weeklyPay).toBe(2_000)
    expect(state.suggestedPending).toBe(333)
  })

  it('keeps a partially paid period on its original salary snapshots', () => {
    const first = attendance('2026-08-02')
    const second = attendance('2026-08-03')
    const state = buildCollaboratorPaymentState({
      collaborator: { ...collaborator, weeklyPay: 3_000 },
      attendance: [first, second],
      paymentItems: [paidItem(first, 333)],
      compensationHistory: [
        ...history,
        {
          ...history[0]!,
          id: 'salary-2',
          weeklyPay: 3_000,
          effectiveFrom: '2026-08-03',
          recordedAt: '2026-08-03T12:00:00.000Z',
        },
      ],
      today: '2026-08-08',
    })

    expect(state.periods[0]?.weeklyPay).toBe(2_000)
    expect(state.suggestedPending).toBe(333)
  })

  it('can select accumulated debt from multiple individual periods', () => {
    const records = [
      attendance('2026-08-02'),
      attendance('2026-08-09'),
    ]
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: records,
      paymentItems: [],
      compensationHistory: history,
      today: '2026-08-15',
    })
    const selection = calculatePaymentSelection(
      state.periods,
      records.map((record) => record.id),
    )

    expect(selection).toMatchObject({
      selectedDays: 2,
      selectedPeriods: 2,
      suggestedAmount: 666,
    })
  })

  it('does not select an open period by default', () => {
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: [attendance('2026-08-13')],
      paymentItems: [],
      compensationHistory: history,
      today: '2026-08-13',
    })
    expect(getDefaultPaymentSelection(state.periods)).toEqual([])
  })

  it('never includes future attendance as payable', () => {
    const state = buildCollaboratorPaymentState({
      collaborator,
      attendance: [attendance('2026-08-14')],
      paymentItems: [],
      compensationHistory: history,
      today: '2026-08-13',
    })
    expect(state.pendingDays).toBe(0)
  })

  it('keeps previous payable attendance for an inactive collaborator', () => {
    const state = buildCollaboratorPaymentState({
      collaborator: { ...collaborator, status: 'inactive' },
      attendance: [attendance('2026-08-12')],
      paymentItems: [],
      compensationHistory: history,
      today: '2026-08-17',
    })

    expect(state.pendingDays).toBe(1)
    expect(state.periods[0]?.attendance).toHaveLength(1)
    expect(state.periods[0]?.missingAttendanceDates).toEqual([])
  })
})
