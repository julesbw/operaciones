import type { Supplier } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type { SupplierRow } from '../types/database'
import { connectivityService } from './connectivityService'

export function normalizedSupplierName(value: string): string {
  return value
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLocaleLowerCase('es-MX')
}

function validateName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Escribe el nombre del proveedor.')
  if (name.length > 120) {
    throw new Error('El nombre no puede exceder 120 caracteres.')
  }
  return name
}

function duplicateError(cause: unknown): Error {
  if (
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    cause.code === '23505'
  ) {
    return new Error('Ya existe un proveedor con ese nombre.')
  }
  return cause instanceof Error
    ? cause
    : new Error('No fue posible guardar el proveedor.')
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

class SupplierService {
  list(activeOnly = false): Promise<Supplier[]> {
    return operationsRepository.listSuppliers(activeOnly)
  }

  async create(nameValue: string, userId: string): Promise<Supplier> {
    const name = validateName(nameValue)
    if (!supabase) {
      await this.assertUniqueName(name)
      const now = new Date().toISOString()
      const supplier: Supplier = {
        id: crypto.randomUUID(),
        name,
        isActive: true,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }
      await operationsRepository.saveSupplier(supplier)
      return supplier
    }

    connectivityService.requireOnline(
      'Se necesita conexión para crear un proveedor.',
    )
    const id = crypto.randomUUID()
    const { data, error } = await supabase
      .from('suppliers')
      .insert({ id, name })
      .select('id, name, is_active, created_by, created_at, updated_at')
      .single()
    if (error) throw duplicateError(error)
    const supplier = mapSupplier(data)
    await operationsRepository.saveSupplier(supplier)
    return supplier
  }

  async update(
    supplier: Supplier,
    changes: { name?: string; isActive?: boolean },
  ): Promise<Supplier> {
    const name =
      changes.name === undefined ? supplier.name : validateName(changes.name)
    if (!supabase) {
      await this.assertUniqueName(name, supplier.id)
      const updated: Supplier = {
        ...supplier,
        name,
        isActive: changes.isActive ?? supplier.isActive,
        updatedAt: new Date().toISOString(),
      }
      await operationsRepository.saveSupplier(updated)
      return updated
    }

    connectivityService.requireOnline(
      'Se necesita conexión para modificar un proveedor.',
    )
    const { data, error } = await supabase
      .from('suppliers')
      .update({
        ...(changes.name === undefined ? {} : { name }),
        ...(changes.isActive === undefined
          ? {}
          : { is_active: changes.isActive }),
      })
      .eq('id', supplier.id)
      .select('id, name, is_active, created_by, created_at, updated_at')
      .single()
    if (error) throw duplicateError(error)
    const updated = mapSupplier(data)
    await operationsRepository.saveSupplier(updated)
    return updated
  }

  private async assertUniqueName(name: string, exceptId?: string): Promise<void> {
    const normalized = normalizedSupplierName(name)
    const duplicate = (await operationsRepository.listSuppliers()).some(
      (supplier) =>
        supplier.id !== exceptId &&
        normalizedSupplierName(supplier.name) === normalized,
    )
    if (duplicate) throw new Error('Ya existe un proveedor con ese nombre.')
  }
}

export const supplierService = new SupplierService()
