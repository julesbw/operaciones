export type BodyScrollLockOptions = {
  restoreScroll?: boolean | (() => boolean)
}

type BodyStyleSnapshot = {
  body: {
    overflow: string
    overscrollBehavior: string
    position: string
    top: string
    width: string
  }
  html: {
    overflow: string
    overscrollBehavior: string
  }
}

type ActiveBodyScrollLock = {
  restoreScroll: boolean | (() => boolean) | undefined
  scrollY: number
  styles: BodyStyleSnapshot
}

let activeLock: ActiveBodyScrollLock | undefined
let lockCount = 0

function canLockBody(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    Boolean(document.body && document.documentElement)
  )
}

function shouldRestoreScroll(
  restoreScroll: boolean | (() => boolean) | undefined,
): boolean {
  return typeof restoreScroll === 'function'
    ? restoreScroll()
    : restoreScroll ?? true
}

export function acquireBodyScrollLock(
  options: BodyScrollLockOptions = {},
): () => void {
  if (!canLockBody()) return () => undefined

  if (lockCount === 0 || !activeLock) {
    const scrollY = window.scrollY
    const body = document.body
    const html = document.documentElement

    activeLock = {
      restoreScroll: options.restoreScroll,
      scrollY,
      styles: {
        body: {
          overflow: body.style.overflow,
          overscrollBehavior: body.style.overscrollBehavior,
          position: body.style.position,
          top: body.style.top,
          width: body.style.width,
        },
        html: {
          overflow: html.style.overflow,
          overscrollBehavior: html.style.overscrollBehavior,
        },
      },
    }

    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
  }

  lockCount += 1
  let released = false

  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount > 0 || !activeLock) return

    const lock = activeLock
    activeLock = undefined
    const body = document.body
    const html = document.documentElement

    body.style.overflow = lock.styles.body.overflow
    body.style.overscrollBehavior = lock.styles.body.overscrollBehavior
    body.style.position = lock.styles.body.position
    body.style.top = lock.styles.body.top
    body.style.width = lock.styles.body.width
    html.style.overflow = lock.styles.html.overflow
    html.style.overscrollBehavior = lock.styles.html.overscrollBehavior

    if (shouldRestoreScroll(lock.restoreScroll)) {
      window.scrollTo(0, lock.scrollY)
    }
  }
}
