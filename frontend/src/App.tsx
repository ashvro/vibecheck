import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DashboardLayout } from './components/layout/DashboardLayout'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/dashboard/OverviewPage'
import { AIAssistantPage } from './pages/dashboard/AIAssistantPage'
import { CommunityPage } from './pages/dashboard/CommunityPage'
import { ClubsPage } from './pages/dashboard/ClubsPage'
import { LMSPage } from './pages/dashboard/LMSPage'
import { AnalyticsPage } from './pages/dashboard/AnalyticsPage'
import { ProfilePage } from './pages/dashboard/ProfilePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="ai" element={<AIAssistantPage />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="clubs" element={<ClubsPage />} />
          <Route path="lms" element={<LMSPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
