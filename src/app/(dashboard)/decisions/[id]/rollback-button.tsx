'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/utils'

export function RollbackButton({ id }: { id: string }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  async function rollback() {
    if (
      !(await confirm({
        title: 'Roll back decision',
        message: 'Roll back every reversible step in this decision?',
        confirmLabel: 'Roll back',
        variant: 'danger',
      }))
    )
      return
    setBusy(true)
    try {
      const res = await fetch(api(`/api/agent/decisions/${id}/rollback`), { method: 'POST' })
      const data = await res.json()
      if (data.error) alert(data.error)
      else {
        alert(`Rollback decision created: ${data.rollbackDecisionId} (${data.status})`)
        window.location.reload()
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button onClick={rollback} disabled={busy}>
      {busy ? 'Rolling back…' : 'Roll back this decision'}
    </Button>
  )
}
