import type {
  Collaborator,
  EntityStatus,
  Store,
  StoreStatus,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type { CollaboratorCompensationRow } from '../types/database'

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

type CompensationRow = Pick<
  CollaboratorCompensationRow,
  'collaborator_id' | 'weekly_pay'
>

class ReferenceDataService {
  listStores(): Promise<Store[]> {
    return operationsRepository.listStores()
  }

  listCollaborators(storeId?: string): Promise<Collaborator[]> {
    return operationsRepository.listCollaborators(storeId)
  }

  async refresh(): Promise<void> {
    if (!supabase) return

    const [storesResult, collaboratorsResult, compensationResult] = await Promise.all([
      supabase
        .from('stores')
        .select('id, name, status, created_at, updated_at')
        .returns<StoreRow[]>(),
      supabase
        .from('collaborators')
        .select('id, name, store_id, rest_day, status, created_at, updated_at')
        .eq('status', 'active')
        .returns<CollaboratorRow[]>(),
      supabase
        .from('collaborator_compensation')
        .select('collaborator_id, weekly_pay')
        .returns<CompensationRow[]>(),
    ])

    if (storesResult.error) throw storesResult.error
    if (collaboratorsResult.error) throw collaboratorsResult.error
    if (compensationResult.error) throw compensationResult.error

    const compensationByCollaborator = new Map(
      compensationResult.data.map((compensation) => [
        compensation.collaborator_id,
        Number(compensation.weekly_pay),
      ]),
    )

    await operationsRepository.replaceReferenceData(
      storesResult.data.map((store) => ({
        id: store.id,
        name: store.name,
        status: store.status,
        createdAt: store.created_at,
        updatedAt: store.updated_at,
      })),
      collaboratorsResult.data.map((collaborator) => ({
        id: collaborator.id,
        name: collaborator.name,
        storeId: collaborator.store_id,
        restDay: collaborator.rest_day,
        status: collaborator.status,
        weeklyPay: compensationByCollaborator.get(collaborator.id),
        createdAt: collaborator.created_at,
        updatedAt: collaborator.updated_at,
      })),
    )
  }
}

export const referenceDataService = new ReferenceDataService()
