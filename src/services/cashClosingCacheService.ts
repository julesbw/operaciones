import type { OperatorSession, UserProfile } from '../domain/models'
import { supabase } from '../lib/supabase'
import { operationsRepository } from '../repositories/operationsRepository'
import type { CashClosingRow } from '../types/database'
import type {
  CachedCashClosing,
  CachedCashClosingDetail,
  CashClosingDetail,
  CashClosingDetailRow,
} from '../types/cashClosingCache'
import { connectivityService } from './connectivityService'
import {
  mapOperatorAuthorizationError,
  OperatorAuthorizationError,
} from './operatorAuthorization'
import { operatorSessionService } from './operatorSessionService'

export type CashClosingCacheOptions = {
  user: UserProfile
  operatorSession?: OperatorSession
  operatorToken?: string | null
  storeId?: string
  dateFrom?: string
  dateTo?: string
}

function mapClosingAdjustment(
  adjustment: CashClosingDetailRow['adjustments'][number],
) {
  return {
    id: adjustment.id,
    cashClosingId: adjustment.cash_closing_id,
    type: adjustment.type,
    amount: Number(adjustment.amount),
    concept: adjustment.concept,
    notes: adjustment.notes ?? undefined,
    bills: adjustment.bills,
    coinsAmount: Number(adjustment.coins_amount),
    createdBy: adjustment.created_by,
    createdAt: adjustment.created_at,
  }
}

export function mapCashClosingDetail(
  detail: CashClosingDetailRow,
): CashClosingDetail {
  return {
    closing: detail.closing,
    expenses: detail.expenses,
    transfers: detail.transfers,
    payments: detail.payments,
    purchases: detail.purchases,
    adjustments: detail.adjustments.map(mapClosingAdjustment),
  }
}

function cacheClosing(
  closing: CashClosingRow,
  cachedAt: string,
): CachedCashClosing {
  return { ...closing, cachedAt }
}

class CashClosingCacheService {
  private getOperatorSession(
    user: UserProfile,
    operatorSession?: OperatorSession,
  ): OperatorSession | undefined {
    if (user.role === 'admin') return undefined

    const session =
      operatorSession ?? operatorSessionService.getRequiredActiveSession(user.id)
    if (session.account.role !== 'store_manager') {
      throw new OperatorAuthorizationError('OPERATOR_CAPABILITY_FORBIDDEN')
    }
    return session
  }

  private resolveStoreId(
    options: Pick<CashClosingCacheOptions, 'user' | 'operatorSession' | 'storeId'>,
  ): string | undefined {
    const session = this.getOperatorSession(options.user, options.operatorSession)
    if (!session) return options.storeId
    if (options.storeId && options.storeId !== session.account.storeId) {
      throw new OperatorAuthorizationError('OPERATOR_STORE_FORBIDDEN')
    }
    return session.account.storeId
  }

  private resolveOperatorToken(
    options: Pick<
      CashClosingCacheOptions,
      'user' | 'operatorSession' | 'operatorToken'
    >,
  ): string | null {
    if (options.user.role === 'admin') return null
    return (
      options.operatorToken ??
      options.operatorSession?.token ??
      operatorSessionService.getRequiredActiveToken(options.user.id)
    )
  }

  async listCached(options: CashClosingCacheOptions): Promise<CachedCashClosing[]> {
    const storeId = this.resolveStoreId(options)
    return operationsRepository.listCachedCashClosings(
      storeId,
      options.dateFrom,
      options.dateTo,
    )
  }

  async refreshList(options: CashClosingCacheOptions): Promise<CashClosingRow[]> {
    const storeId = this.resolveStoreId(options)
    if (!supabase) throw new Error('Supabase no está configurado')
    connectivityService.requireOnline(
      'Se necesita conexión para actualizar los Cortes.',
    )

    try {
      const { data, error } = await supabase.rpc('list_cash_closings', {
        p_operator_token: this.resolveOperatorToken(options),
        p_store_id: storeId ?? null,
        p_date_from: options.dateFrom ?? null,
        p_date_to: options.dateTo ?? null,
      })
      if (error) throw error
      const closings = (data ?? []).filter(
        (closing) => !storeId || closing.store_id === storeId,
      )
      const cachedAt = new Date().toISOString()
      await operationsRepository.replaceCachedCashClosingsForScope(
        closings.map((closing) => cacheClosing(closing, cachedAt)),
        storeId,
        options.dateFrom,
        options.dateTo,
      )
      return closings
    } catch (cause: unknown) {
      throw mapOperatorAuthorizationError(cause)
    }
  }

  async getCachedDetail(
    closingId: string,
    options: Pick<CashClosingCacheOptions, 'user' | 'operatorSession'>,
  ): Promise<CachedCashClosingDetail | undefined> {
    const storeId = this.resolveStoreId(options)
    return operationsRepository.getCachedCashClosingDetail(closingId, storeId)
  }

  async refreshDetail(
    closingId: string,
    options: CashClosingCacheOptions,
  ): Promise<CashClosingDetail> {
    const storeId = this.resolveStoreId(options)
    if (!supabase) throw new Error('Supabase no está configurado')
    connectivityService.requireOnline(
      'Se necesita conexión para consultar un corte cerrado.',
    )

    const { data, error } = await supabase.rpc('get_cash_closing_detail', {
      p_operator_token: this.resolveOperatorToken(options),
      p_closing_id: closingId,
    })
    if (error) throw mapOperatorAuthorizationError(error)
    if (!data) throw new Error('Supabase no devolvió el detalle del corte')
    if (storeId && data.closing.store_id !== storeId) {
      throw new OperatorAuthorizationError('OPERATOR_STORE_FORBIDDEN')
    }

    const detail = mapCashClosingDetail(data)
    await this.saveDetail(detail)
    return detail
  }

  saveClosing(closing: CashClosingRow): Promise<string> {
    return operationsRepository.saveCachedCashClosing(
      cacheClosing(closing, new Date().toISOString()),
    )
  }

  saveDetail(detail: CashClosingDetail): Promise<string> {
    const cached: CachedCashClosingDetail = {
      ...detail,
      closingId: detail.closing.id,
      cachedAt: new Date().toISOString(),
    }
    return operationsRepository.saveCachedCashClosingDetail(cached)
  }
}

export const cashClosingCacheService = new CashClosingCacheService()
