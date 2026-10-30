import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { WatchPage } from './pages/WatchPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="watch/:id" element={<WatchPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
