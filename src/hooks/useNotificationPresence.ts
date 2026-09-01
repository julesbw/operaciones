import { useEffect } from 'react'
import {
  NOTIFICATION_PRESENCE_HEARTBEAT_MS,
  notificationPresenceService,
} from '../services/notificationPresenceService'

export function isNotificationPresenceActive(
  visibilityState: DocumentVisibilityState | string,
  hasFocus: boolean,
): boolean {
  return visibilityState === 'visible' && hasFocus
}

function documentIsActive(): boolean {
  if (typeof document === 'undefined') return false
  const hasFocus =
    typeof document.hasFocus !== 'function' || document.hasFocus()
  return isNotificationPresenceActive(document.visibilityState, hasFocus)
}

type UseNotificationPresenceOptions = {
  enabled: boolean
  networkAvailable: boolean
}

export function useNotificationPresence({
  enabled,
  networkAvailable,
}: UseNotificationPresenceOptions): void {
  useEffect(() => {
    if (
      !enabled ||
      !networkAvailable ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return
    }

    let mounted = true
    const release = () => {
      if (!mounted) return
      void notificationPresenceService.release().catch(() => undefined)
    }
    const heartbeatIfActive = () => {
      if (!mounted) return
      if (!documentIsActive()) {
        release()
        return
      }
      void notificationPresenceService.heartbeat().catch(() => undefined)
    }

    heartbeatIfActive()
    const interval = window.setInterval(
      heartbeatIfActive,
      NOTIFICATION_PRESENCE_HEARTBEAT_MS,
    )
    document.addEventListener('visibilitychange', heartbeatIfActive)
    window.addEventListener('focus', heartbeatIfActive)
    window.addEventListener('blur', release)

    return () => {
      mounted = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', heartbeatIfActive)
      window.removeEventListener('focus', heartbeatIfActive)
      window.removeEventListener('blur', release)
    }
  }, [enabled, networkAvailable])
}
