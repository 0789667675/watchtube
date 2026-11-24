import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SearchPage } from './pages/SearchPage';
import { TrendingPage } from './pages/TrendingPage';
import { ShortsPage } from './pages/ShortsPage';
import { ForYouPage } from './pages/ForYouPage';
import { WatchPage } from './pages/WatchPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { AcceptInvitationPage } from './pages/auth/AcceptInvitationPage';
import { StudioLayout } from './pages/studio/StudioLayout';
import { ContentPage } from './pages/studio/ContentPage';
import { MonetizationPage } from './pages/studio/MonetizationPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { RevenuePage } from './pages/admin/RevenuePage';
import { DashboardPage } from './pages/studio/DashboardPage';
import { ChannelPage } from './pages/ChannelPage';
import { SettingsPage } from './pages/studio/SettingsPage';
import { CommentsPage } from './pages/studio/CommentsPage';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { ProfilePage } from './pages/ProfilePage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="feed/subscriptions" element={<SubscriptionsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="feed/trending" element={<TrendingPage />} />
            <Route path="feed/for-you" element={<ForYouPage />} />
            <Route path="feed/shorts" element={<ShortsPage />} />
            <Route path="shorts" element={<ShortsPage />} />
            <Route path="channel/:handle" element={<ChannelPage />} />
            <Route path="watch/:id" element={<WatchPage />} />
            <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          </Route>

          <Route path="/auth">
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="accept-invite" element={<AcceptInvitationPage />} />
          </Route>

          <Route path="/studio" element={<RequireAuth><StudioLayout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="content" element={<ContentPage />} />
            <Route path="monetization" element={<MonetizationPage />} />
            <Route path="comments" element={<CommentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="/admin" element={<RequireAuth><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/revenue" element={<RequireAuth><RevenuePage /></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
