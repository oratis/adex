import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, isPlatformAdmin } from '@/lib/auth'
import { CronSecretsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function CronSecretsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) notFound()
  return <CronSecretsClient />
}
