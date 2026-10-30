import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SearchPage } from './pages/SearchPage';
import { TrendingPage } from './pages/TrendingPage';
import { WatchPage } from './pages/WatchPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { StudioLayout } from './pages/studio/StudioLayout';
import { ContentPage } from './pages/studio/ContentPage';
import { MonetizationPage } from './pages/studio/MonetizationPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { RevenuePage } from './pages/admin/RevenuePage';
import { DashboardPage } from './pages/studio/DashboardPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="feed/subscriptions" element={<SubscriptionsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="feed/trending" element={<TrendingPage />} />
          <Route path="watch/:id" element={<WatchPage />} />
        </Route>

        <Route path="/auth">
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
        </Route>

        <Route path="/studio" element={<StudioLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="content" element={<ContentPage />} />
          <Route path="monetization" element={<MonetizationPage />} />
        </Route>
        <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/revenue" element={<RevenuePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
