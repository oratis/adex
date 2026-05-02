'use client'

import { cn } from '@/lib/utils'
import { useEffect, useId, useRef } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  /** ARIA label for the close button (i18n). Default: "Close" */
  closeLabel?: string
  /** If true, clicking the backdrop does NOT close — useful for confirmations. */
  noBackdropClose?: boolean
}

/**
 * Accessible modal dialog. Audit Med #20:
 *  - role=dialog + aria-modal + aria-labelledby
 *  - Initial focus moved to dialog on open
 *  - Tab/Shift-Tab cycle stays inside the dialog (focus trap)
 *  - Restores focus to the previously-focused element on close
 *  - Escape closes; backdrop click closes (unless `noBackdropClose`)
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  closeLabel = 'Close',
  noBackdropClose,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    // Focus the dialog itself (or the first focusable child) on next tick.
    requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      ;(first || dialogRef.current)?.focus()
    })

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('aria-hidden'))
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    // Lock body scroll while modal is open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (noBackdropClose) return
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto outline-none',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label={closeLabel}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              &times;
            </button>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
