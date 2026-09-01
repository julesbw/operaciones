import { describe, expect, it } from 'vitest'
import {
  applyThemePreference,
  isThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveThemePreference,
  THEME_STORAGE_KEY,
} from './theme'

describe('theme preference', () => {
  it('accepts only the supported preferences', () => {
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
  })

  it('falls back to system for missing or invalid device values', () => {
    expect(readThemePreference()).toBe('system')
    expect(readThemePreference({ getItem: () => 'sepia' })).toBe('system')
    expect(readThemePreference({ getItem: () => 'dark' })).toBe('dark')
  })

  it('resolves system from the operating system preference', () => {
    expect(resolveThemePreference('system', true)).toBe('dark')
    expect(resolveThemePreference('system', false)).toBe('light')
    expect(resolveThemePreference('light', true)).toBe('light')
    expect(resolveThemePreference('dark', false)).toBe('dark')
  })

  it('persists the preference under a device-only key', () => {
    let key = ''
    let value = ''
    persistThemePreference('dark', {
      setItem: (nextKey, nextValue) => {
        key = nextKey
        value = nextValue
      },
    })

    expect(key).toBe(THEME_STORAGE_KEY)
    expect(value).toBe('dark')
  })

  it('applies the resolved theme to the document root without requiring React', () => {
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: '' },
    } as unknown as HTMLElement

    expect(applyThemePreference('dark', root)).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.themePreference).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })
})
