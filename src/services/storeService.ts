import type { Store } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import { connectivityService } from './connectivityService'

type StoreUpdateInput = Pick<
  Partial<Store>,
  'name' | 'status' | 'closingReconciliationMode'
>

export function buildStoreUpdate(
  input: StoreUpdateInput,
  updatedAt: string,
): StoreUpdateInput & Pick<Store, 'updatedAt'> {
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.closingReconciliationMode !== undefined
      ? { closingReconciliationMode: input.closingReconciliationMode }
      : {}),
    updatedAt,
  }
}

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
      closingReconciliationMode: 'normal',
      createdAt: now,
      updatedAt: now,
    }

    if (supabase) {
      connectivityService.requireOnline(
        'Se necesita conexión para crear una tienda.',
      )
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
    changes: StoreUpdateInput,
  ): Promise<void> {
    const normalizedChanges = buildStoreUpdate(
      changes,
      new Date().toISOString(),
    )
    if (changes.name !== undefined && !normalizedChanges.name) {
      throw new Error('El nombre de la tienda no puede quedar vacío')
    }

    if (supabase) {
      connectivityService.requireOnline(
        'Se necesita conexión para modificar una tienda.',
      )
      const { error } = await supabase
        .from('stores')
        .update({
          ...(normalizedChanges.name !== undefined
            ? { name: normalizedChanges.name }
            : {}),
          ...(normalizedChanges.status !== undefined
            ? { status: normalizedChanges.status }
            : {}),
          ...(normalizedChanges.closingReconciliationMode !== undefined
            ? {
                closing_reconciliation_mode:
                  normalizedChanges.closingReconciliationMode,
              }
            : {}),
        })
        .eq('id', store.id)
      if (error) throw error
    }
    await operationsRepository.updateStore(store.id, normalizedChanges)
  }
}

export const storeService = new StoreService()
