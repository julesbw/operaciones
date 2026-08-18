import type { Collaborator, EntityStatus } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import { connectivityService } from './connectivityService'
import { getOperationalDate } from '../utils/date'

export type CollaboratorInput = {
  name: string
  storeId: string
  restDay: number
  payCycleEndWeekday: number
  weeklyPay: number
}

class CollaboratorService {
  private mapRow(data: {
    id: string
    name: string
    store_id: string
    rest_day: number
    pay_cycle_end_weekday: number | null
    status: EntityStatus
    created_at: string
    updated_at: string
  }, weeklyPay?: number): Collaborator {
    return {
      id: data.id,
      name: data.name,
      storeId: data.store_id,
      restDay: data.rest_day,
      payCycleEndWeekday: data.pay_cycle_end_weekday ?? undefined,
      weeklyPay,
      status: data.status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  }

  async create(input: CollaboratorInput): Promise<Collaborator> {
    const name = input.name.trim()
    if (!name) throw new Error('Escribe el nombre del colaborador')
    if (!input.storeId) throw new Error('Selecciona una tienda')
    if (!Number.isInteger(input.restDay) || input.restDay < 0 || input.restDay > 6) {
      throw new Error('Selecciona un día de descanso válido')
    }
    if (
      !Number.isInteger(input.payCycleEndWeekday) ||
      input.payCycleEndWeekday < 0 ||
      input.payCycleEndWeekday > 6
    ) {
      throw new Error('Selecciona un día de raya válido')
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
      payCycleEndWeekday: input.payCycleEndWeekday,
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
        p_pay_cycle_end_weekday: input.payCycleEndWeekday,
      })
      if (error) throw error

      collaborator = this.mapRow(data, weeklyPay)
    }

    await operationsRepository.saveCollaborators([collaborator])
    if (!supabase) {
      await operationsRepository.saveCompensationHistory([
        {
          id: crypto.randomUUID(),
          collaboratorId: collaborator.id,
          weeklyPay,
          effectiveFrom: getOperationalDate(),
          recordedAt: collaborator.updatedAt,
          recordedBy: 'demo-admin',
        },
      ])
    }
    return collaborator
  }

  async update(
    id: string,
    input: CollaboratorInput,
  ): Promise<Collaborator> {
    const name = input.name.trim()
    if (!id) throw new Error('El colaborador no es válido')
    if (!name) throw new Error('Escribe el nombre del colaborador')
    if (!input.storeId) throw new Error('Selecciona una tienda')
    if (!Number.isInteger(input.restDay) || input.restDay < 0 || input.restDay > 6) {
      throw new Error('Selecciona un día de descanso válido')
    }
    if (
      !Number.isInteger(input.payCycleEndWeekday) ||
      input.payCycleEndWeekday < 0 ||
      input.payCycleEndWeekday > 6
    ) {
      throw new Error('Selecciona un día de raya válido')
    }
    if (!Number.isFinite(input.weeklyPay) || input.weeklyPay < 0) {
      throw new Error('Escribe un pago semanal válido')
    }

    const weeklyPay = Math.round(input.weeklyPay * 100) / 100
    if (!supabase) {
      const existing = await operationsRepository.getCollaborator(id)
      if (!existing) throw new Error('El colaborador ya no existe')
      const collaborator: Collaborator = {
        ...existing,
        name,
        storeId: input.storeId,
        restDay: input.restDay,
        payCycleEndWeekday: input.payCycleEndWeekday,
        weeklyPay,
        updatedAt: new Date().toISOString(),
      }
      await operationsRepository.saveCollaborators([collaborator])
      if (existing.weeklyPay !== weeklyPay) {
        await operationsRepository.saveCompensationHistory([
          {
            id: crypto.randomUUID(),
            collaboratorId: id,
            weeklyPay,
            effectiveFrom: getOperationalDate(),
            recordedAt: collaborator.updatedAt,
            recordedBy: 'demo-admin',
          },
        ])
      }
      return collaborator
    }

    connectivityService.requireOnline(
      'Se necesita conexión para actualizar un colaborador.',
    )
    const { data, error } = await supabase.rpc('update_collaborator', {
      p_id: id,
      p_name: name,
      p_store_id: input.storeId,
      p_rest_day: input.restDay,
      p_weekly_pay: weeklyPay,
      p_pay_cycle_end_weekday: input.payCycleEndWeekday,
    })
    if (error) throw error

    const collaborator = this.mapRow(data, weeklyPay)
    await operationsRepository.saveCollaborators([collaborator])
    return collaborator
  }

  async setStatus(
    id: string,
    status: Extract<EntityStatus, 'active' | 'inactive'>,
  ): Promise<Collaborator> {
    if (!id) throw new Error('El colaborador no es válido')
    if (status !== 'active' && status !== 'inactive') {
      throw new Error('El estado del colaborador no es válido')
    }

    const existing = await operationsRepository.getCollaborator(id)
    if (!existing) throw new Error('El colaborador ya no existe')

    if (supabase) {
      connectivityService.requireOnline(
        'Se necesita conexión para cambiar el estado de un colaborador.',
      )
      const { data, error } = await supabase.rpc('set_collaborator_status', {
        p_id: id,
        p_status: status,
      })
      if (error) throw error
      const collaborator = this.mapRow(data, existing.weeklyPay)
      await operationsRepository.saveCollaborators([collaborator])
      return collaborator
    }

    const collaborator: Collaborator = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    }
    await operationsRepository.saveCollaborators([collaborator])
    return collaborator
  }
}

export const collaboratorService = new CollaboratorService()
