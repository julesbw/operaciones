import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireBodyScrollLock } from './bodyScrollLock'

function createDom() {
  const body = {
    style: {
      overflow: 'auto',
      overscrollBehavior: 'auto',
      position: 'relative',
      top: '12px',
      width: '80%',
    },
  }
  const documentElement = {
    style: {
      overflow: 'scroll',
      overscrollBehavior: 'auto',
    },
  }
  const scrollTo = vi.fn()

  vi.stubGlobal('window', { scrollTo, scrollY: 240 })
  vi.stubGlobal('document', { body, documentElement })

  return { body, documentElement, scrollTo }
}

describe('bodyScrollLock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the page locked until the last consumer releases it', () => {
    const { body, documentElement, scrollTo } = createDom()
    const releaseOuter = acquireBodyScrollLock()
    const releaseInner = acquireBodyScrollLock()

    expect(body.style).toMatchObject({
      overflow: 'hidden',
      overscrollBehavior: 'none',
      position: 'fixed',
      top: '-240px',
      width: '100%',
    })
    expect(documentElement.style).toMatchObject({
      overflow: 'hidden',
      overscrollBehavior: 'none',
    })

    releaseInner()
    expect(body.style.overflow).toBe('hidden')
    expect(scrollTo).not.toHaveBeenCalled()

    releaseOuter()
    expect(body.style).toMatchObject({
      overflow: 'auto',
      overscrollBehavior: 'auto',
      position: 'relative',
      top: '12px',
      width: '80%',
    })
    expect(documentElement.style).toMatchObject({
      overflow: 'scroll',
      overscrollBehavior: 'auto',
    })
    expect(scrollTo).toHaveBeenCalledWith(0, 240)
  })

  it('can leave the scroll position untouched when the consumer navigates away', () => {
    const { scrollTo } = createDom()
    const release = acquireBodyScrollLock({ restoreScroll: false })

    release()

    expect(scrollTo).not.toHaveBeenCalled()
  })
})
