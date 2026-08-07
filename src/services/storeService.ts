import type { Store } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'

class StoreService {
  list() {
    return operationsRepository.listStores()
  }

  async create(name: string): Promise<Store> {
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('Escribe el nombre de la tienda')
    const now = new Date().toISOString()
    const store: Store = {
      id: crypto.randomUUID(),
      name: normalizedName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    if (supabase) {
      const { error } = await supabase.from('stores').insert({
        id: store.id,
        name: store.name,
        status: store.status,
      })
      if (error) throw error
    }
    await operationsRepository.saveStore(store)
    return store
  }

  async update(
    store: Store,
    changes: { name?: string; status?: Store['status'] },
  ): Promise<void> {
    const normalizedChanges = {
      ...changes,
      name: changes.name?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    }
    if (changes.name !== undefined && !normalizedChanges.name) {
      throw new Error('El nombre de la tienda no puede quedar vacío')
    }

    if (supabase) {
      const { error } = await supabase
        .from('stores')
        .update({
          ...(normalizedChanges.name ? { name: normalizedChanges.name } : {}),
          ...(normalizedChanges.status ? { status: normalizedChanges.status } : {}),
        })
        .eq('id', store.id)
      if (error) throw error
    }
    await operationsRepository.updateStore(store.id, normalizedChanges)
  }
}

export const storeService = new StoreService()
