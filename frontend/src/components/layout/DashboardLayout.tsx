import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { Sidebar } from './Sidebar'
import { TopNavbar } from './TopNavbar'

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { pathname } = useLocation()
  const isChat = pathname === '/app/ai'

  return (
    <div className="min-h-screen bg-bg text-ink landing-frost">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-56">
        <TopNavbar onMenuClick={() => setSidebarOpen(true)} />
        <main className={clsx('animate-fade-in', isChat ? 'p-0' : 'p-5 sm:p-6 lg:p-8')}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
