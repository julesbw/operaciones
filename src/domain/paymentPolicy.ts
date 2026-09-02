import type {
  AttendanceRecord,
  Collaborator,
  CollaboratorCompensationHistory,
  PaymentAttendanceItem,
} from './models'
import { getEffectiveAttendanceType } from './models'

const DAY_MILLISECONDS = 86_400_000

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type ShiftConsolidation = {
  fullShifts: number
  halfShifts: number
  pairedHalves: number
  remainingHalf: number
  equivalentFullShifts: number
}

export function consolidateShifts(
  fullShifts: number,
  halfShifts: number,
): ShiftConsolidation {
  const pairedHalves = Math.floor(halfShifts / 2)
  const remainingHalf = halfShifts % 2
  return {
    fullShifts,
    halfShifts,
    pairedHalves,
    remainingHalf,
    equivalentFullShifts: fullShifts + pairedHalves,
  }
}

export type ShiftPaymentCalculation = ShiftConsolidation & {
  dailyPay: number
  halfPay: number
  amount: number
  weeklyPayApplied: boolean
}

export function calculateShiftPayment(options: {
  weeklyPay: number
  fullShifts: number
  halfShifts: number
  weeklyPayEligible?: boolean
}): ShiftPaymentCalculation {
  const { weeklyPay, fullShifts, halfShifts } = options
  const consolidation = consolidateShifts(fullShifts, halfShifts)
  const dailyPay = Math.floor(weeklyPay / 6)
  const halfPay = Math.floor(dailyPay / 2)
  const weeklyPayApplied =
    options.weeklyPayEligible !== false &&
    consolidation.equivalentFullShifts === 6 &&
    consolidation.remainingHalf === 0
  const amount = weeklyPayApplied
    ? weeklyPay
    : consolidation.equivalentFullShifts * dailyPay +
      consolidation.remainingHalf * halfPay

  return {
    ...consolidation,
    dailyPay,
    halfPay,
    amount,
    weeklyPayApplied,
  }
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function addCalendarDays(value: string, days: number): string {
  return formatDate(new Date(parseDate(value).getTime() + days * DAY_MILLISECONDS))
}

export function getCalendarWeekday(value: string): number {
  return parseDate(value).getUTCDay()
}

export function getPaymentPeriod(
  workDate: string,
  payCycleEndWeekday: number,
): { periodStart: string; periodEnd: string } {
  const daysUntilEnd =
    (payCycleEndWeekday - getCalendarWeekday(workDate) + 7) % 7
  const periodEnd = addCalendarDays(workDate, daysUntilEnd)
  return {
    periodStart: addCalendarDays(periodEnd, -6),
    periodEnd,
  }
}

export type PayableAttendance = AttendanceRecord & {
  paid: boolean
}

export type CollaboratorPaymentPeriod = {
  key: string
  periodStart: string
  periodEnd: string
  open: boolean
  weeklyPay?: number
  dailyPay?: number
  halfPay?: number
  workedDays: number
  fullShifts: number
  halfShifts: number
  pairedHalves: number
  remainingHalf: number
  equivalentFullShifts: number
  paidDays: number
  pendingDays: number
  suggestedAllocated: number
  policyTarget?: number
  suggestedPending?: number
  attendance: PayableAttendance[]
  missingAttendanceDates: string[]
}

export type CollaboratorPaymentState = {
  collaborator: Collaborator
  periods: CollaboratorPaymentPeriod[]
  pendingDays: number
  pendingPeriods: number
  suggestedPending?: number
  salaryHistoryMissing: boolean
}

function applicableSalary(
  collaboratorId: string,
  referenceDate: string,
  history: CollaboratorCompensationHistory[],
): number | undefined {
  return history
    .filter(
      (entry) =>
        entry.collaboratorId === collaboratorId &&
        entry.effectiveFrom <= referenceDate,
    )
    // ES2022 target: keep Array#sort explicit.
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort(
      (left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom) ||
        right.recordedAt.localeCompare(left.recordedAt),
    )[0]?.weeklyPay
}

function enumerateMissingDates(
  periodStart: string,
  periodEnd: string,
  today: string,
  restDay: number,
  attendance: AttendanceRecord[],
): string[] {
  const finalDate = periodEnd < today ? periodEnd : today
  const recordedDates = new Set(attendance.map((record) => record.attendanceDate))
  const dates: string[] = []
  for (
    let date = periodStart;
    date <= finalDate;
    date = addCalendarDays(date, 1)
  ) {
    if (getCalendarWeekday(date) !== restDay && !recordedDates.has(date)) {
      dates.push(date)
    }
  }
  return dates
}

function paymentAttendanceType(
  record: AttendanceRecord,
  paymentItem?: PaymentAttendanceItem,
): 'full' | 'half' | null {
  return (
    paymentItem?.attendanceTypeSnapshot ??
    getEffectiveAttendanceType(record.status, record.attendanceType)
  )
}

export function buildCollaboratorPaymentState(options: {
  collaborator: Collaborator
  attendance: AttendanceRecord[]
  paymentItems: PaymentAttendanceItem[]
  compensationHistory: CollaboratorCompensationHistory[]
  today: string
}): CollaboratorPaymentState {
  const {
    collaborator,
    paymentItems,
    compensationHistory,
    today,
  } = options
  if (collaborator.payCycleEndWeekday === undefined) {
    return {
      collaborator,
      periods: [],
      pendingDays: 0,
      pendingPeriods: 0,
      suggestedPending: undefined,
      salaryHistoryMissing: false,
    }
  }

  const paidItemByAttendance = new Map(
    paymentItems.map((item) => [item.attendanceId, item]),
  )
  const presentAttendance = options.attendance.filter(
    (record) =>
      record.collaboratorId === collaborator.id &&
      record.status === 'present' &&
      record.attendanceDate <= today,
  )
  const allAttendance = options.attendance.filter(
    (record) =>
      record.collaboratorId === collaborator.id &&
      record.attendanceDate <= today,
  )
  const grouped = new Map<string, AttendanceRecord[]>()
  for (const record of presentAttendance) {
    const period = getPaymentPeriod(
      record.attendanceDate,
      collaborator.payCycleEndWeekday,
    )
    const records = grouped.get(period.periodStart) ?? []
    records.push(record)
    grouped.set(period.periodStart, records)
  }

  const periods = [...grouped.entries()].map<CollaboratorPaymentPeriod>(
    ([periodStart, records]) => {
      const periodEnd = getPaymentPeriod(
        records[0]!.attendanceDate,
        collaborator.payCycleEndWeekday!,
      ).periodEnd
      // oxlint-disable-next-line unicorn/no-array-sort
      records.sort((left, right) =>
        left.attendanceDate.localeCompare(right.attendanceDate),
      )
      const priorItem = records
        .map((record) => paidItemByAttendance.get(record.id))
        .find((item): item is PaymentAttendanceItem => Boolean(item))
      const salaryReference = periodEnd < today ? periodEnd : today
      const weeklyPay =
        priorItem?.weeklyPaySnapshot ??
        applicableSalary(
          collaborator.id,
          salaryReference,
          compensationHistory,
        )
      const dailyPay =
        priorItem?.dailyPaySnapshot ??
        (weeklyPay === undefined ? undefined : Math.floor(weeklyPay / 6))
      const halfPay =
        dailyPay === undefined ? undefined : Math.floor(dailyPay / 2)
      const fullShifts = records.filter(
        (record) =>
          paymentAttendanceType(record, paidItemByAttendance.get(record.id)) ===
          'full',
      ).length
      const halfShifts = records.filter(
        (record) =>
          paymentAttendanceType(record, paidItemByAttendance.get(record.id)) ===
          'half',
      ).length
      const open = periodEnd > today
      const shiftCalculation =
        weeklyPay === undefined
          ? undefined
          : calculateShiftPayment({
              weeklyPay,
              fullShifts,
              halfShifts,
              weeklyPayEligible: !open,
            })
      const suggestedAllocated = roundMoney(
        records.reduce(
          (total, record) =>
            total +
            (paidItemByAttendance.get(record.id)?.suggestedAllocation ?? 0),
          0,
        ),
      )
      const paidDays = records.filter((record) =>
        paidItemByAttendance.has(record.id),
      ).length
      const pendingDays = records.length - paidDays
      const policyTarget =
        shiftCalculation?.amount
      const suggestedPending =
        policyTarget === undefined
          ? undefined
          : roundMoney(Math.max(0, policyTarget - suggestedAllocated))
      const periodAttendance = allAttendance.filter(
        (record) =>
          record.attendanceDate >= periodStart &&
          record.attendanceDate <= periodEnd,
      )

      return {
        key: `${collaborator.id}:${periodStart}`,
        periodStart,
        periodEnd,
        open,
        weeklyPay,
        dailyPay,
        halfPay,
        workedDays: records.length,
        fullShifts,
        halfShifts,
        pairedHalves: shiftCalculation?.pairedHalves ?? 0,
        remainingHalf: shiftCalculation?.remainingHalf ?? 0,
        equivalentFullShifts: shiftCalculation?.equivalentFullShifts ?? 0,
        paidDays,
        pendingDays,
        suggestedAllocated,
        policyTarget,
        suggestedPending,
        attendance: records.map((record) => ({
          ...record,
          paid: paidItemByAttendance.has(record.id),
        })),
        missingAttendanceDates:
          collaborator.status === 'active'
            ? enumerateMissingDates(
                periodStart,
                periodEnd,
                today,
                collaborator.restDay,
                periodAttendance,
              )
            : [],
      }
    },
  )
  // Oldest debt is intentionally shown first.
  // oxlint-disable-next-line unicorn/no-array-sort
  periods.sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart),
  )

  const pendingPeriods = periods.filter((period) => period.pendingDays > 0)
  const suggestions = pendingPeriods.map((period) => period.suggestedPending)
  return {
    collaborator,
    periods,
    pendingDays: pendingPeriods.reduce(
      (total, period) => total + period.pendingDays,
      0,
    ),
    pendingPeriods: pendingPeriods.length,
    suggestedPending: suggestions.some(
      (suggestion) => suggestion === undefined,
    )
      ? undefined
      : roundMoney(
          suggestions.reduce<number>(
            (total, suggestion) => total + (suggestion ?? 0),
            0,
          ),
        ),
    salaryHistoryMissing: pendingPeriods.some(
      (period) => period.weeklyPay === undefined,
    ),
  }
}

export type PaymentSelectionSummary = {
  attendanceIds: string[]
  selectedDays: number
  selectedPeriods: number
  suggestedAmount?: number
}

export function calculatePaymentSelection(
  periods: CollaboratorPaymentPeriod[],
  selectedAttendanceIds: Iterable<string>,
): PaymentSelectionSummary {
  const selectedIds = new Set(selectedAttendanceIds)
  let selectedDays = 0
  let selectedPeriods = 0
  let suggestedAmount = 0
  let salaryMissing = false

  for (const period of periods) {
    const pending = period.attendance.filter((record) => !record.paid)
    const selected = pending.filter((record) => selectedIds.has(record.id))
    if (selected.length === 0) continue
    selectedDays += selected.length
    selectedPeriods += 1
    if (
      period.dailyPay === undefined ||
      period.policyTarget === undefined ||
      period.weeklyPay === undefined
    ) {
      salaryMissing = true
      continue
    }
    if (selected.length === pending.length) {
      suggestedAmount += period.policyTarget - period.suggestedAllocated
      continue
    }

    const selectedFullShifts = selected.filter(
      (record) =>
        getEffectiveAttendanceType(record.status, record.attendanceType) ===
        'full',
    ).length
    const selectedHalfShifts = selected.filter(
      (record) =>
        getEffectiveAttendanceType(record.status, record.attendanceType) ===
        'half',
    ).length
    suggestedAmount += calculateShiftPayment({
      weeklyPay: period.weeklyPay,
      fullShifts: selectedFullShifts,
      halfShifts: selectedHalfShifts,
      weeklyPayEligible: false,
    }).amount
  }

  return {
    attendanceIds: [...selectedIds],
    selectedDays,
    selectedPeriods,
    suggestedAmount: salaryMissing ? undefined : roundMoney(suggestedAmount),
  }
}

export function getDefaultPaymentSelection(
  periods: CollaboratorPaymentPeriod[],
): string[] {
  return periods.flatMap((period) =>
    period.open
      ? []
      : period.attendance
          .filter((record) => !record.paid)
          .map((record) => record.id),
  )
}
