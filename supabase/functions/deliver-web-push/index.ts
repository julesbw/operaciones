import { createClient, type SupabaseClient } from 'supabase'
import webpush from 'web-push'
import {
  ARRENDAMIENTOS_SOURCE_APP,
  buildWebPushPayload,
  OPERATIONS_SOURCE_APP,
  type PersistedPushNotification,
} from './pushPayload.ts'

const MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 60_000
const RETRY_MAX_MS = 60 * 60 * 1_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Delivery = {
  id: string
  source_app: string
  notification_id: string
  subscription_id: string
  channel: string
  attempt_count: number
}

type NotificationRecord = {
  id: string
  source_app: string
  event_type: string
  title: string
  message: string
  store_id: string | null
  entity_type: string
  entity_id: string
}

type RecipientRecord = {
  notification_id: string
  recipient_type: string
  recipient_id: string
}

type SubscriptionRecord = {
  id: string
  source_app: string
  auth_user_id: string
  endpoint: string
  p256dh: string
  auth: string
  paused_at: string | null
  revoked_at: string | null
}

type StoreRecord = { id: string; name: string }
type PurchaseRecord = { id: string; amount: number | string }
type TransferRecord = {
  id: string
  origin_store_id: string
  destination_store_id: string
  amount: number | string
}
type ClosingRecord = {
  id: string
  store_name_snapshot: string
  cash_to_withdraw: number | string
}

class DispatchError extends Error {
  readonly code: string
  readonly permanent: boolean

  constructor(code: string, permanent: boolean) {
    super(code)
    this.name = 'DispatchError'
    this.code = code
    this.permanent = permanent
  }
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

function configuredValue(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new DispatchError('configuration_missing', false)
  return value
}

function serviceClient(): SupabaseClient {
  return createClient(
    configuredValue('SUPABASE_URL'),
    configuredValue('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function errorCode(cause: unknown): string {
  if (cause instanceof DispatchError) return cause.code
  if (cause instanceof Error && cause.name === 'AbortError') return 'request_timeout'
  return 'remote_operation_failed'
}

async function rpc<T>(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T | undefined> {
  const result = await client.rpc(functionName, args)
  if (result.error) throw new DispatchError('database_rpc_failed', false)
  const data: unknown = result.data
  if (Array.isArray(data)) return data[0] as T | undefined
  return data as T | undefined
}

async function claimDelivery(
  client: SupabaseClient,
  deliveryId: string,
): Promise<Delivery | undefined> {
  return rpc<Delivery>(client, 'claim_notification_delivery', {
    p_delivery_id: deliveryId,
  })
}

async function completeDelivery(
  client: SupabaseClient,
  deliveryId: string,
): Promise<void> {
  await rpc<boolean>(client, 'complete_notification_delivery', {
    p_delivery_id: deliveryId,
  })
}

async function failDelivery(
  client: SupabaseClient,
  deliveryId: string,
  permanent: boolean,
  code: string,
  nextAttemptAt: Date | null,
): Promise<void> {
  await rpc<boolean>(client, 'fail_notification_delivery', {
    p_delivery_id: deliveryId,
    p_permanent: permanent,
    p_error: code,
    p_next_attempt_at: nextAttemptAt?.toISOString() ?? null,
  })
}

function retryAt(attemptCount: number): Date {
  const exponential = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  )
  const jitter = Math.floor(Math.random() * Math.max(1, exponential * 0.25))
  return new Date(Date.now() + exponential + jitter)
}

function numeric(value: number | string | null | undefined): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(result)) throw new DispatchError('reference_invalid', true)
  return result
}

async function loadOne<T>(
  client: SupabaseClient,
  table: string,
  select: string,
  id: string,
): Promise<T> {
  const result = await client
    .from(table)
    .select(select)
    .eq('id', id)
    .maybeSingle()
  if (result.error) throw new DispatchError('database_read_failed', false)
  if (!result.data) throw new DispatchError('reference_missing', true)
  return result.data as T
}

async function loadStore(
  client: SupabaseClient,
  storeId: string | null,
): Promise<string | null> {
  if (!storeId) return null
  const result = await client
    .from('stores')
    .select('id, name')
    .eq('id', storeId)
    .maybeSingle()
  if (result.error) throw new DispatchError('database_read_failed', false)
  return (result.data as StoreRecord | null)?.name ?? null
}

async function loadTransferStores(
  client: SupabaseClient,
  transfer: TransferRecord,
): Promise<{ originStoreName: string | null; destinationStoreName: string | null }> {
  const result = await client
    .from('stores')
    .select('id, name')
    .in('id', [transfer.origin_store_id, transfer.destination_store_id])
  if (result.error) throw new DispatchError('database_read_failed', false)
  const stores = new Map(
    (result.data as StoreRecord[] | null ?? []).map((store) => [store.id, store.name]),
  )
  return {
    originStoreName: stores.get(transfer.origin_store_id) ?? null,
    destinationStoreName: stores.get(transfer.destination_store_id) ?? null,
  }
}

async function loadPayloadInput(
  client: SupabaseClient,
  notification: NotificationRecord,
): Promise<PersistedPushNotification> {
  const base = {
    notificationId: notification.id,
    sourceApp: notification.source_app,
    eventType: notification.event_type,
    entityType: notification.entity_type,
    entityId: notification.entity_id,
    title: notification.title,
    message: notification.message,
  }

  if (
    notification.source_app === ARRENDAMIENTOS_SOURCE_APP &&
    notification.event_type === 'PAYMENT_REGISTERED' &&
    notification.entity_type === 'payment'
  ) {
    return base
  }

  if (notification.source_app !== OPERATIONS_SOURCE_APP) {
    throw new DispatchError('source_app_rejected', true)
  }

  if (notification.event_type === 'PURCHASE_CREATED') {
    const [purchase, storeName] = await Promise.all([
      loadOne<PurchaseRecord>(client, 'purchases', 'id, amount', notification.entity_id),
      loadStore(client, notification.store_id),
    ])
    return { ...base, storeName, amount: numeric(purchase.amount) }
  }

  if (notification.event_type === 'TRANSFER_CREATED') {
    const transfer = await loadOne<TransferRecord>(
      client,
      'merchandise_transfers',
      'id, origin_store_id, destination_store_id, amount',
      notification.entity_id,
    )
    const stores = await loadTransferStores(client, transfer)
    return { ...base, ...stores, amount: numeric(transfer.amount) }
  }

  if (notification.event_type === 'CASH_CLOSING_CLOSED') {
    const closing = await loadOne<ClosingRecord>(
      client,
      'cash_closings',
      'id, store_name_snapshot, cash_to_withdraw',
      notification.entity_id,
    )
    return {
      ...base,
      storeName: closing.store_name_snapshot,
      cashToWithdraw: numeric(closing.cash_to_withdraw),
    }
  }

  throw new DispatchError('event_type_rejected', true)
}

async function loadContext(
  client: SupabaseClient,
  delivery: Delivery,
): Promise<{
  notification: NotificationRecord
  subscription: SubscriptionRecord
}> {
  const [notificationResult, subscriptionResult] = await Promise.all([
    client
      .from('notifications')
      .select('id, source_app, event_type, title, message, store_id, entity_type, entity_id')
      .eq('id', delivery.notification_id)
      .maybeSingle(),
    client
      .from('push_subscriptions')
      .select('id, source_app, auth_user_id, endpoint, p256dh, auth, paused_at, revoked_at')
      .eq('id', delivery.subscription_id)
      .maybeSingle(),
  ])
  if (notificationResult.error || subscriptionResult.error) {
    throw new DispatchError('database_read_failed', false)
  }
  if (!notificationResult.data || !subscriptionResult.data) {
    throw new DispatchError('source_missing', true)
  }

  const notification = notificationResult.data as NotificationRecord
  const subscription = subscriptionResult.data as SubscriptionRecord
  const recipientResult = await client
    .from('notification_recipients')
    .select('notification_id, recipient_type, recipient_id')
    .eq('notification_id', notification.id)
    .eq('recipient_type', 'auth_user')
    .eq('recipient_id', subscription.auth_user_id)
    .maybeSingle()
  if (recipientResult.error) throw new DispatchError('database_read_failed', false)
  const recipient = recipientResult.data as RecipientRecord | null

  if (
    delivery.channel !== 'push' ||
    delivery.source_app !== notification.source_app ||
    subscription.source_app !== delivery.source_app ||
    !recipient ||
    recipient.recipient_id !== subscription.auth_user_id
  ) {
    throw new DispatchError('delivery_scope_rejected', true)
  }
  if (subscription.revoked_at) {
    throw new DispatchError('subscription_revoked', true)
  }
  if (subscription.paused_at) {
    throw new DispatchError('subscription_paused', true)
  }

  return { notification, subscription }
}

async function revokeSubscriptionAndAbandon(
  client: SupabaseClient,
  subscriptionId: string,
  sourceApp: string,
): Promise<void> {
  const now = new Date().toISOString()
  const subscriptionResult = await client
    .from('push_subscriptions')
    .update({ revoked_at: now, updated_at: now })
    .eq('id', subscriptionId)
    .eq('source_app', sourceApp)
  if (subscriptionResult.error) {
    throw new DispatchError('subscription_revoke_failed', false)
  }
  const deliveriesResult = await client
    .from('notification_deliveries')
    .update({
      status: 'abandoned',
      next_attempt_at: null,
      last_error: 'subscription_revoked',
      updated_at: now,
    })
    .eq('subscription_id', subscriptionId)
    .eq('source_app', sourceApp)
    .in('status', ['pending', 'failed', 'processing'])
  if (deliveriesResult.error) {
    throw new DispatchError('delivery_abandon_failed', false)
  }
}

function providerStatus(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null || !('statusCode' in cause)) {
    return undefined
  }
  const value = cause.statusCode
  return typeof value === 'number' ? value : undefined
}

function isPermanentProviderFailure(cause: unknown): boolean {
  const status = providerStatus(cause)
  return status === 400 || status === 404 || status === 410
}

async function sendPush(
  subscription: SubscriptionRecord,
  payload: PersistedPushNotification,
): Promise<void> {
  let webPushPayload: ReturnType<typeof buildWebPushPayload>
  try {
    webPushPayload = buildWebPushPayload(payload)
  } catch (cause: unknown) {
    throw new DispatchError(
      cause instanceof Error ? cause.message : 'push_payload_invalid',
      true,
    )
  }
  const vapidSubject = configuredValue('WEB_PUSH_VAPID_SUBJECT')
  const vapidPublicKey = configuredValue('WEB_PUSH_VAPID_PUBLIC_KEY')
  const vapidPrivateKey = configuredValue('WEB_PUSH_VAPID_PRIVATE_KEY')

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(webPushPayload),
      {
        TTL: 86_400,
        timeout: 10_000,
        urgency: 'normal',
        contentEncoding: 'aes128gcm',
        vapidDetails: {
          subject: vapidSubject,
          publicKey: vapidPublicKey,
          privateKey: vapidPrivateKey,
        },
      },
    )
  } catch (cause: unknown) {
    throw new DispatchError(
      isPermanentProviderFailure(cause) ? 'push_subscription_expired' : 'push_provider_unavailable',
      isPermanentProviderFailure(cause),
    )
  }
}

function deliveryIdFromBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = 'record' in body && typeof body.record === 'object' && body.record !== null
    ? body.record
    : undefined
  const candidate =
    ('deliveryId' in body ? body.deliveryId : undefined) ??
    ('delivery_id' in body ? body.delivery_id : undefined) ??
    (record && 'id' in record ? record.id : undefined)
  return isUuid(candidate) ? candidate : undefined
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new DispatchError('invalid_request', true)
  }
}

function authorized(request: Request): boolean {
  const expected = Deno.env.get('WEB_PUSH_DISPATCH_SECRET')?.trim()
  if (!expected) return false
  const explicit = request.headers.get('x-web-push-secret')?.trim() ?? ''
  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  return constantTimeEqual(expected, explicit || bearer)
}

async function dispatch(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401)

  const body = await requestBody(request)
  const deliveryId = deliveryIdFromBody(body)
  if (!deliveryId) return json({ error: 'invalid_delivery_id' }, 400)

  const client = serviceClient()
  let delivery: Delivery | undefined
  try {
    delivery = await claimDelivery(client, deliveryId)
  } catch (cause: unknown) {
    console.error('web_push_claim_failed', errorCode(cause))
    return json({ error: 'temporary_failure' }, 500)
  }
  if (!delivery) return json({ accepted: true, status: 'noop' })
  if (delivery.attempt_count > MAX_ATTEMPTS) {
    await failDelivery(client, delivery.id, true, 'attempt_limit_reached', null)
    return json({ accepted: true, status: 'abandoned' })
  }

  try {
    const context = await loadContext(client, delivery)
    const input = await loadPayloadInput(client, context.notification)
    await sendPush(context.subscription, input)
    await completeDelivery(client, delivery.id)
    return json({ accepted: true, status: 'delivered' })
  } catch (cause: unknown) {
    const dispatchError = cause instanceof DispatchError
      ? cause
      : new DispatchError('temporary_failure', false)
    const permanent = dispatchError.permanent
    await failDelivery(
      client,
      delivery.id,
      permanent,
      dispatchError.code,
      permanent || delivery.attempt_count >= MAX_ATTEMPTS
        ? null
        : retryAt(delivery.attempt_count),
    )
    if (dispatchError.code === 'push_subscription_expired') {
      await revokeSubscriptionAndAbandon(
        client,
        delivery.subscription_id,
        delivery.source_app,
      )
    }
    if (!permanent) {
      console.error('web_push_delivery_retry_scheduled', dispatchError.code)
    }
    return json({
      accepted: true,
      status: permanent || delivery.attempt_count >= MAX_ATTEMPTS
        ? 'abandoned'
        : 'retry_scheduled',
    })
  }
}

Deno.serve(async (request) => {
  try {
    return await dispatch(request)
  } catch (cause: unknown) {
    console.error('web_push_dispatch_failed', errorCode(cause))
    return json({ error: 'temporary_failure' }, 500)
  }
})
