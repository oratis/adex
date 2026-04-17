import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { getCurrentUser } from '@/lib/auth'
import { ToastProvider } from '@/components/ui/toast'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar userName={user.name || user.email} />
        <main className="flex-1 p-8 overflow-auto">
          {children}
        </main>
      </div>
    </ToastProvider>
  )
}
