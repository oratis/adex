'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react'

type Theme = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'adex.theme'

// Custom event so multiple ThemeProvider readers stay in sync within the
// same tab (the native 'storage' event only fires across tabs).
const THEME_CHANGE = 'adex:theme-change'

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // ignore
  }
  return 'system'
}

function subscribeTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(THEME_CHANGE, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(THEME_CHANGE, cb)
    window.removeEventListener('storage', cb)
  }
}

function subscribeSystem(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

function getSystemIsDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyThemeClass(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Subscribed stores — no state-in-effect issue
  const theme = useSyncExternalStore(
    subscribeTheme,
    readStoredTheme,
    () => 'system' as Theme
  )

  const systemIsDark = useSyncExternalStore(
    subscribeSystem,
    getSystemIsDark,
    () => false
  )

  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme

  // Imperative side-effect: sync DOM class when resolvedTheme changes
  useEffect(() => {
    applyThemeClass(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, t)
    } catch {
      // storage may be unavailable
    }
    window.dispatchEvent(new Event(THEME_CHANGE))
  }, [])

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    return {
      theme: 'light',
      resolvedTheme: 'light',
      setTheme: () => {},
      toggle: () => {},
    }
  }
  return ctx
}
