'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

export type Toast = {
  id: string
  title?: string
  description?: string
  variant: ToastVariant
  duration: number
}

type ToastContextValue = {
  toasts: Toast[]
  toast: (opts: {
    title?: string
    description?: string
    variant?: ToastVariant
    duration?: number
  }) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Silent no-op fallback so pages don't crash if provider is missing.
    return {
      toasts: [] as Toast[],
      toast: () => '',
      dismiss: () => {},
    }
  }
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback<ToastContextValue['toast']>(
    ({ title, description, variant = 'info', duration = 4000 }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((ts) => [...ts, { id, title, description, variant, duration }])
      return id
    },
    []
  )

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: Toast[]
  dismiss: (id: string) => void
}) {
  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return
    const timer = setTimeout(() => dismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, dismiss])

  const variantStyles: Record<ToastVariant, string> = {
    success: 'bg-green-50 border-green-200 text-green-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
  }

  const icons: Record<ToastVariant, string> = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠',
  }

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-right-5',
        variantStyles[toast.variant]
      )}
      role="status"
    >
      <div className="text-lg leading-none mt-0.5">{icons[toast.variant]}</div>
      <div className="flex-1 min-w-0">
        {toast.title && <div className="font-semibold text-sm">{toast.title}</div>}
        {toast.description && (
          <div className="text-sm opacity-90 mt-0.5 break-words">{toast.description}</div>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="opacity-60 hover:opacity-100 text-sm leading-none mt-0.5"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
