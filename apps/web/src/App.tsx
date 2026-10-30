import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { WatchPage } from './pages/WatchPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { StudioLayout } from './pages/studio/StudioLayout';
import { ContentPage } from './pages/studio/ContentPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="watch/:id" element={<WatchPage />} />
        </Route>

        <Route path="/auth">
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
        </Route>

        <Route path="/studio" element={<StudioLayout />}>
          <Route path="content" element={<ContentPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
