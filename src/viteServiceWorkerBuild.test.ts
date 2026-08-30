import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  precacheAssetPaths,
  renderServiceWorker,
} from '../vite.config'

describe('service worker build generation', () => {
  it('includes every emitted file, including dynamic chunks, and excludes the worker itself', () => {
    expect(
      precacheAssetPaths([
        'assets/PaymentsPage-hash.js',
        'index.html',
        'assets/index-hash.js',
        'sw.js',
      ]),
    ).toEqual([
      '/assets/PaymentsPage-hash.js',
      '/assets/index-hash.js',
      '/index.html',
    ])
  })

  it('renders a runnable worker without unreplaced build placeholders', () => {
    const template = readFileSync(
      new URL('../public/sw.js', import.meta.url),
      'utf8',
    )
    const source = renderServiceWorker(
      template,
      'release-test',
      ['/assets/PaymentsPage-hash.js', '/index.html'],
    )

    expect(source).toContain('const RELEASE_ID = "release-test"')
    expect(source).toContain('/assets/PaymentsPage-hash.js')
    expect(source).not.toContain('__RELEASE_ID__')
    expect(source).not.toContain('const PRECACHE_ASSETS = []')
    expect(() => new Script(source)).not.toThrow()
  })
})
