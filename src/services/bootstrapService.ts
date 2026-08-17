import { db } from '../db/database'
import type { LocalAppContext } from '../domain/models'
import { isSupabaseConfigured } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import {
  DEMO_COLLABORATORS,
  DEMO_COMPENSATION_HISTORY,
  DEMO_SUPPLIERS,
  DEMO_STORES,
} from './demoData'

class BootstrapService {
  async initializeLocal(): Promise<LocalAppContext | undefined> {
    await db.open()

    if (!isSupabaseConfigured) {
      await this.seedDemoReferenceData()
    }

    return operationsRepository.getLocalAppContext()
  }

  async seedDemoReferenceData(): Promise<void> {
    await db.transaction(
      'rw',
      db.stores,
      db.collaborators,
      db.compensationHistory,
      db.suppliers,
      async () => {
        if ((await db.stores.count()) === 0) {
          await db.stores.bulkAdd(DEMO_STORES)
        }

        if ((await db.collaborators.count()) === 0) {
          await db.collaborators.bulkAdd(DEMO_COLLABORATORS)
        }

        if ((await db.compensationHistory.count()) === 0) {
          await db.compensationHistory.bulkAdd(DEMO_COMPENSATION_HISTORY)
        }

        if ((await db.suppliers.count()) === 0) {
          await db.suppliers.bulkAdd(DEMO_SUPPLIERS)
        }
      },
    )
  }
}

export const bootstrapService = new BootstrapService()
