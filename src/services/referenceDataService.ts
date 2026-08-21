import type {
  ClosingReconciliationMode,
  Collaborator,
  EntityStatus,
  Store,
  StoreStatus,
  Supplier,
  UserProfile,
} from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type { CollaboratorCompensationRow } from '../types/database'
import { mapOperatorAuthorizationError } from './operatorAuthorization'
import { operatorSessionService } from './operatorSessionService'

type StoreRow = {
  id: string
  name: string
  status: StoreStatus
  closing_reconciliation_mode: ClosingReconciliationMode
  created_at: string
  updated_at: string
}

type CollaboratorRow = {
  id: string
  name: string
  store_id: string
  rest_day: number
  pay_cycle_end_weekday: number | null
  status: EntityStatus
  created_at: string
  updated_at: string
}

type CompensationRow = Pick<
  CollaboratorCompensationRow,
  'collaborator_id' | 'weekly_pay'
>

type SupplierRow = {
  id: string
  name: string
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

class ReferenceDataService {
  listStores(): Promise<Store[]> {
    return operationsRepository.listStores()
  }

  listCollaborators(
    storeId?: string,
    includeInactive = false,
  ): Promise<Collaborator[]> {
    return operationsRepository.listCollaborators(storeId, includeInactive)
  }

  listSuppliers(activeOnly = false): Promise<Supplier[]> {
    return operationsRepository.listSuppliers(activeOnly)
  }

  async refresh(profile: UserProfile): Promise<void> {
    if (!supabase) return

    const [storesResult, collaboratorsResult, compensationResult] = await Promise.all([
      supabase
        .from('stores')
        .select('id, name, status, closing_reconciliation_mode, created_at, updated_at')
        .returns<StoreRow[]>(),
      supabase
        .from('collaborators')
        .select('id, name, store_id, rest_day, pay_cycle_end_weekday, status, created_at, updated_at')
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
        closingReconciliationMode: store.closing_reconciliation_mode,
        createdAt: store.created_at,
        updatedAt: store.updated_at,
      })),
        collaboratorsResult.data.map((collaborator) => ({
        id: collaborator.id,
        name: collaborator.name,
        storeId: collaborator.store_id,
        restDay: collaborator.rest_day,
        payCycleEndWeekday:
          collaborator.pay_cycle_end_weekday ?? undefined,
        status: collaborator.status,
        weeklyPay: compensationByCollaborator.get(collaborator.id),
        createdAt: collaborator.created_at,
        updatedAt: collaborator.updated_at,
        })),
      )

    if (profile.role === 'admin') await this.refreshPurchaseSuppliers(profile)
  }

  async refreshPurchaseSuppliers(profile: UserProfile): Promise<void> {
    if (!supabase) return
    const result = profile.role === 'admin'
      ? await supabase
          .from('suppliers')
          .select('id, name, is_active, created_by, created_at, updated_at')
          .returns<SupplierRow[]>()
      : await supabase.rpc('list_purchase_suppliers', {
          p_operator_token: operatorSessionService.getRequiredActiveToken(
            profile.id,
          ),
        })
    if (result.error) throw mapOperatorAuthorizationError(result.error)
    await operationsRepository.replaceSuppliers(
      result.data.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        isActive: supplier.is_active,
        createdBy: supplier.created_by,
        createdAt: supplier.created_at,
        updatedAt: supplier.updated_at,
      })),
    )
  }
}

export const referenceDataService = new ReferenceDataService()
