export const THEME_STORAGE_KEY = 'operaciones.theme'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_COLOR_BY_THEME: Record<ResolvedTheme, string> = {
  light: '#f6f1e8',
  dark: '#241d1b',
}

export const THEME_OPTIONS: readonly {
  value: ThemePreference
  label: string
  description: string
}[] = [
  { value: 'system', label: 'Sistema', description: 'Usa la preferencia del dispositivo' },
  { value: 'light', label: 'Claro', description: 'Mantén el tema claro' },
  { value: 'dark', label: 'Oscuro', description: 'Usa el tema oscuro cálido' },
]

export function isThemePreference(
  value: string | null | undefined,
): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
): ThemePreference {
  if (!storage) return 'system'

  try {
    const stored = storage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function persistThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem'> | undefined = browserStorage(),
): void {
  if (!storage) return

  try {
    storage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private browsing and storage quotas should not prevent changing the theme.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemIsDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light'
  return preference
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement | undefined =
    typeof document === 'undefined' ? undefined : document.documentElement,
): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(preference, systemPrefersDark())
  if (!root) return resolvedTheme

  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference
  root.style.colorScheme = resolvedTheme

  const themeColor =
    typeof document === 'undefined'
      ? undefined
      : document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', THEME_COLOR_BY_THEME[resolvedTheme])

  return resolvedTheme
}
