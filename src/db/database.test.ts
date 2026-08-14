import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { OperationsDatabase } from './database'

const LEGACY_SCHEMA = {
  stores: '&id, name, status, updatedAt',
  collaborators: '&id, storeId, [storeId+status], updatedAt',
  attendanceRecords:
    '&id, collaboratorId, storeId, attendanceDate, &[collaboratorId+attendanceDate], [storeId+attendanceDate], syncStatus',
  expenses:
    '&id, storeId, businessDate, [storeId+businessDate], syncStatus, createdAt',
  syncQueue:
    '&id, &[entityType+entityId], entityType, createdAt, nextAttemptAt',
  closingDrafts: '&id, &[storeId+businessDate], updatedAt',
}

describe('OperationsDatabase closing draft migration', () => {
  it('preserves a v3 draft and maps its former opening balance', async () => {
    const databaseName = `operations-test-${crypto.randomUUID()}`
    const legacyDatabase = new Dexie(databaseName)
    legacyDatabase.version(3).stores(LEGACY_SCHEMA)
    await legacyDatabase.open()
    await legacyDatabase.table('closingDrafts').put({
      id: 'legacy-closing',
      storeId: 'store-id',
      businessDate: '2026-08-10',
      grossSales: 16_000,
      openingBalance: 2_000,
      otherMovements: 0,
      bills: {
        b1000: 15,
        b500: 0,
        b200: 0,
        b100: 0,
        b50: 0,
        b20: 0,
        monedas: 0,
      },
      updatedAt: '2026-08-10T12:00:00.000Z',
    })
    legacyDatabase.close()

    const upgradedDatabase = new OperationsDatabase(databaseName)
    try {
      await upgradedDatabase.open()
      const migrated = await upgradedDatabase.closingDrafts.get('legacy-closing')

      expect(upgradedDatabase.verno).toBe(11)
      expect(
        upgradedDatabase.tables.some(
          (table) => table.name === 'merchandiseTransfers',
        ),
      ).toBe(true)
      expect(
        upgradedDatabase.tables.some(
          (table) => table.name === 'appContexts',
        ),
      ).toBe(true)
      expect(
        upgradedDatabase.tables.some(
          (table) => table.name === 'paymentAttendanceItems',
        ),
      ).toBe(true)
      expect(
        upgradedDatabase.tables.some(
          (table) => table.name === 'exportCandidates',
        ),
      ).toBe(true)
      expect(
        upgradedDatabase.tables.some((table) => table.name === 'exportBatches'),
      ).toBe(true)
      expect(migrated).toMatchObject({
        cashBalance: 2_000,
        balanceBills: {
          monedas: 2_000,
        },
        currentStep: 1,
        status: 'draft',
        createdAt: '2026-08-10T12:00:00.000Z',
        outgoingTransfersTotal: 0,
        storeCashPaymentsTotal: 0,
        operationalOutflowsTotal: 0,
        cashOutflowsTotal: 0,
        selectedExpenseIds: [],
        selectedTransferIds: [],
        selectedPaymentIds: [],
        knownExpenseIds: [],
        knownTransferIds: [],
        knownPaymentIds: [],
        movementSelectionInitialized: false,
      })
      expect(migrated).not.toHaveProperty('openingBalance')
      expect(migrated).not.toHaveProperty('otherMovements')
    } finally {
      upgradedDatabase.close()
      await upgradedDatabase.delete()
    }
  })
})
