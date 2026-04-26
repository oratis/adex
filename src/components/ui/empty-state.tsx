import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card, CardContent } from './card'
import { Button } from './button'

/**
 * Reusable empty-state card. Every dashboard page that can show "no data
 * yet" should use this instead of a bare "No X" string. Cuts perceived
 * dead-end friction for first-time users.
 */
export function EmptyState({
  emoji,
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  emoji?: string
  title: string
  description?: string | ReactNode
  primaryAction?: { label: string; href?: string; onClick?: () => void }
  secondaryAction?: { label: string; href?: string; onClick?: () => void }
}) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        {emoji && <div className="text-5xl mb-3">{emoji}</div>}
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        {description && (
          <div className="text-sm text-gray-600 max-w-md mx-auto">{description}</div>
        )}
        {(primaryAction || secondaryAction) && (
          <div className="flex justify-center gap-2 mt-6">
            {primaryAction && renderButton(primaryAction, 'primary')}
            {secondaryAction && renderButton(secondaryAction, 'outline')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function renderButton(
  a: { label: string; href?: string; onClick?: () => void },
  variant: 'primary' | 'outline'
) {
  if (a.href) {
    return (
      <Link href={a.href}>
        <Button variant={variant}>{a.label}</Button>
      </Link>
    )
  }
  return (
    <Button variant={variant} onClick={a.onClick}>
      {a.label}
    </Button>
  )
}
