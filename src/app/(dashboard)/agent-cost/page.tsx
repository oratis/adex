import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrg } from '@/lib/auth'
import { CostClient } from './client'

export const dynamic = 'force-dynamic'

export default async function AgentCostPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const ctx = await getCurrentOrg(user.id)
  if (!ctx) redirect('/login')
  return <CostClient />
}
