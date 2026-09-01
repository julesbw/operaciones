import { useEffect, useRef } from 'react'
import {
  acquireBodyScrollLock,
  type BodyScrollLockOptions,
} from '../utils/bodyScrollLock'

export function useBodyScrollLock(
  locked: boolean,
  options?: BodyScrollLockOptions,
): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    if (!locked) return
    return acquireBodyScrollLock(optionsRef.current)
  }, [locked])
}
