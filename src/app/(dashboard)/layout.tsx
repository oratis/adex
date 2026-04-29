import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import {
  getCurrentUser,
  getCurrentOrg,
  ensurePersonalOrg,
  isPlatformAdmin,
} from '@/lib/auth'
import { ToastProvider } from '@/components/ui/toast'
import { CommandPalette } from '@/components/layout/command-palette'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  // Safety net: legacy users without any org get one auto-created
  let ctx = await getCurrentOrg(user.id)
  if (!ctx) {
    await ensurePersonalOrg(user)
    ctx = await getCurrentOrg(user.id)
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar
          userName={user.name || user.email}
          orgName={ctx?.org.name}
          orgRole={ctx?.role}
          isPlatformAdmin={isPlatformAdmin(user)}
        />
        <main className="flex-1 p-4 pt-14 md:p-8 md:pt-8 overflow-auto">
          {children}
        </main>
        <CommandPalette />
      </div>
    </ToastProvider>
  )
}
