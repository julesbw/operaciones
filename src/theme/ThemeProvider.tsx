import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  applyThemePreference,
  isThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveThemePreference,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from './theme'

type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const fallbackThemeContext: ThemeContextValue = {
  preference: 'system',
  resolvedTheme: 'light',
  setPreference: () => undefined,
}

const ThemeContext = createContext<ThemeContextValue>(fallbackThemeContext)

function initialPreference(): ThemePreference {
  if (typeof document !== 'undefined') {
    const bootstrappedPreference = document.documentElement.dataset.themePreference
    if (isThemePreference(bootstrappedPreference)) return bootstrappedPreference
  }
  return readThemePreference()
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveThemePreference(preference, systemPrefersDark()),
  )

  const syncDocumentTheme = useCallback((nextPreference: ThemePreference) => {
    const nextResolvedTheme = applyThemePreference(nextPreference)
    setResolvedTheme(nextResolvedTheme)
    return nextResolvedTheme
  }, [])

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      persistThemePreference(nextPreference)
      syncDocumentTheme(nextPreference)
      setPreferenceState(nextPreference)
    },
    [syncDocumentTheme],
  )

  useEffect(() => {
    syncDocumentTheme(preference)

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : undefined

    const handleSystemThemeChange = () => {
      if (preference === 'system') syncDocumentTheme(preference)
    }
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      const nextPreference = isThemePreference(event.newValue)
        ? event.newValue
        : 'system'
      setPreferenceState(nextPreference)
    }

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleSystemThemeChange)
      } else {
        mediaQuery.addListener(handleSystemThemeChange)
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange)
    }

    return () => {
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', handleSystemThemeChange)
        } else {
          mediaQuery.removeListener(handleSystemThemeChange)
        }
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange)
      }
    }
  }, [preference, syncDocumentTheme])

  const contextValue = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  )

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
