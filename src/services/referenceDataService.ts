import type {
  Collaborator,
  EntityStatus,
  Store,
  StoreStatus,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'

type StoreRow = {
  id: string
  name: string
  status: StoreStatus
  created_at: string
  updated_at: string
}

type CollaboratorRow = {
  id: string
  name: string
  store_id: string
  rest_day: number
  status: EntityStatus
  created_at: string
  updated_at: string
}

class ReferenceDataService {
  listStores(): Promise<Store[]> {
    return operationsRepository.listStores()
  }

  listCollaborators(storeId: string): Promise<Collaborator[]> {
    return operationsRepository.listCollaborators(storeId)
  }

  async refresh(): Promise<void> {
    if (!supabase) return

    const [storesResult, collaboratorsResult] = await Promise.all([
      supabase
        .from('stores')
        .select('id, name, status, created_at, updated_at')
        .returns<StoreRow[]>(),
      supabase
        .from('collaborators')
        .select('id, name, store_id, rest_day, status, created_at, updated_at')
        .eq('status', 'active')
        .returns<CollaboratorRow[]>(),
    ])

    if (storesResult.error) throw storesResult.error
    if (collaboratorsResult.error) throw collaboratorsResult.error

    await Promise.all([
      operationsRepository.saveStores(
        storesResult.data.map((store) => ({
          id: store.id,
          name: store.name,
          status: store.status,
          createdAt: store.created_at,
          updatedAt: store.updated_at,
        })),
      ),
      operationsRepository.saveCollaborators(
        collaboratorsResult.data.map((collaborator) => ({
          id: collaborator.id,
          name: collaborator.name,
          storeId: collaborator.store_id,
          restDay: collaborator.rest_day,
          status: collaborator.status,
          createdAt: collaborator.created_at,
          updatedAt: collaborator.updated_at,
        })),
      ),
    ])
  }
}

export const referenceDataService = new ReferenceDataService()
