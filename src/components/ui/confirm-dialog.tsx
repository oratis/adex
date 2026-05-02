'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Modal } from './modal'
import { Button } from './button'

export type ConfirmOptions = {
  title?: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Variant of the confirm button — `danger` paints red. Default: `primary`. */
  variant?: 'primary' | 'danger'
}

type ConfirmContextValue = (opts: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

/**
 * Drop-in replacement for `window.confirm()`. Returns a Promise<boolean>.
 *
 * Usage:
 *   const confirm = useConfirm()
 *   if (!(await confirm('Delete this?'))) return
 *
 *   // Or with options:
 *   if (!(await confirm({ title: 'Delete', message: '...', variant: 'danger' }))) return
 *
 * Audit Med #17 / #18: replaces 27 native confirm() calls with a styled,
 * a11y-correct, i18n-ready dialog that matches the rest of the UI.
 */
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error(
      'useConfirm must be used within <ConfirmProvider>. Wrap the dashboard layout.'
    )
  }
  return ctx
}

type Pending = {
  options: ConfirmOptions
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<ConfirmContextValue>((arg) => {
    const options: ConfirmOptions = typeof arg === 'string' ? { message: arg } : arg
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve })
    })
  }, [])

  const close = useCallback(
    (result: boolean) => {
      if (pending) {
        pending.resolve(result)
        setPending(null)
      }
    },
    [pending]
  )

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => close(false)}
        title={pending?.options.title}
        noBackdropClose
        className="max-w-md"
        closeLabel={pending?.options.cancelLabel || 'Cancel'}
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-700 whitespace-pre-line">
            {pending?.options.message}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => close(false)}>
              {pending?.options.cancelLabel || 'Cancel'}
            </Button>
            <Button
              variant={pending?.options.variant === 'danger' ? 'danger' : 'primary'}
              onClick={() => close(true)}
              autoFocus
            >
              {pending?.options.confirmLabel || 'Confirm'}
            </Button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}
