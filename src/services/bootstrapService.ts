import { db } from '../db/database'
import { isSupabaseConfigured } from '../lib/supabase'
import { DEMO_COLLABORATORS, DEMO_STORES } from './demoData'

class BootstrapService {
  async initialize(): Promise<void> {
    await db.open()

    if (isSupabaseConfigured) return

    await db.transaction('rw', db.stores, db.collaborators, async () => {
      if ((await db.stores.count()) === 0) {
        await db.stores.bulkAdd(DEMO_STORES)
      }

      if ((await db.collaborators.count()) === 0) {
        await db.collaborators.bulkAdd(DEMO_COLLABORATORS)
      }
    })
  }
}

export const bootstrapService = new BootstrapService()
