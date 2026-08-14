import type { Collaborator } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import { connectivityService } from './connectivityService'

export type CollaboratorInput = {
  name: string
  storeId: string
  restDay: number
  weeklyPay: number
}

class CollaboratorService {
  async create(input: CollaboratorInput): Promise<Collaborator> {
    const name = input.name.trim()
    if (!name) throw new Error('Escribe el nombre del colaborador')
    if (!input.storeId) throw new Error('Selecciona una tienda')
    if (!Number.isInteger(input.restDay) || input.restDay < 0 || input.restDay > 6) {
      throw new Error('Selecciona un día de descanso válido')
    }
    if (!Number.isFinite(input.weeklyPay) || input.weeklyPay < 0) {
      throw new Error('Escribe un pago semanal válido')
    }

    const id = crypto.randomUUID()
    const weeklyPay = Math.round(input.weeklyPay * 100) / 100
    const now = new Date().toISOString()
    let collaborator: Collaborator = {
      id,
      name,
      storeId: input.storeId,
      restDay: input.restDay,
      weeklyPay,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    if (supabase) {
      connectivityService.requireOnline(
        'Se necesita conexión para crear un colaborador.',
      )
      const { data, error } = await supabase.rpc('create_collaborator', {
        p_id: id,
        p_name: name,
        p_store_id: input.storeId,
        p_rest_day: input.restDay,
        p_weekly_pay: weeklyPay,
      })
      if (error) throw error

      collaborator = {
        id: data.id,
        name: data.name,
        storeId: data.store_id,
        restDay: data.rest_day,
        weeklyPay,
        status: data.status,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }
    }

    await operationsRepository.saveCollaborators([collaborator])
    return collaborator
  }
}

export const collaboratorService = new CollaboratorService()
