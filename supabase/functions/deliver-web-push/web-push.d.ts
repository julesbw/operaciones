declare module 'web-push' {
  type PushSubscription = {
    endpoint: string
    keys: {
      p256dh: string
      auth: string
    }
  }

  type VapidDetails = {
    subject: string
    publicKey: string
    privateKey: string
  }

  type SendOptions = {
    TTL?: number
    timeout?: number
    urgency?: 'very-low' | 'low' | 'normal' | 'high'
    contentEncoding?: 'aesgcm' | 'aes128gcm'
    vapidDetails?: VapidDetails
  }

  const webpush: {
    sendNotification(
      subscription: PushSubscription,
      payload: string,
      options: SendOptions,
    ): Promise<unknown>
  }

  export default webpush
}
