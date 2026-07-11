import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import MusicStudio from './pages/MusicStudio';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          {/* El index por defecto lo mandamos al Music Studio por ahora */}
          <Route index element={<MusicStudio />} />
          <Route path="music" element={<MusicStudio />} />
          <Route path="video" element={<div style={{padding: '2rem'}}>🎬 Video Studio en construcción...</div>} />
          <Route path="*" element={<div style={{padding: '2rem'}}>Página no encontrada o en desarrollo...</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}