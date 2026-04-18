'use client'

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import { LOCALES, translate, type Locale } from '@/lib/i18n'

type I18nContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'adex.locale'
const LOCALE_CHANGE = 'adex:locale-change'

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v && (LOCALES as readonly string[]).includes(v)) return v as Locale
  } catch {
    // ignore
  }
  // Auto-detect from browser once
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  if (nav.toLowerCase().startsWith('zh')) return 'zh'
  return 'en'
}

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(LOCALE_CHANGE, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(LOCALE_CHANGE, cb)
    window.removeEventListener('storage', cb)
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(
    subscribe,
    readStoredLocale,
    () => 'en'
  )

  const setLocale = useCallback((l: Locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(LOCALE_CHANGE))
  }, [])

  const t = useCallback((key: string) => translate(locale, key), [locale])

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    return {
      locale: 'en',
      setLocale: () => {},
      t: (key: string) => translate('en', key),
    }
  }
  return ctx
}
