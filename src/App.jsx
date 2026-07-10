import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import VideoStudio from './pages/VideoStudio';
import MusicStudio from './pages/MusicStudio';
import SoundStudio from './pages/SoundStudio';
import ImageStudio from './pages/ImageStudio';
import EngineeringLab from './pages/EngineeringLab';
import FashionStudio from './pages/FashionStudio';
import CEODashboard from './pages/CEODashboard';
import Layout from './components/Layout';
import { StudioProvider } from './context/StudioContext';

export default function App() {
  return (
    /* FORZAMOS EL FONDO NEGRO DESDE LA RAÍZ POR SI EL CSS ESTÁ MUERTO */
    <div style={{ backgroundColor: '#050505', minHeight: '100vh', width: '100%', color: '#ffffff' }}>
      <StudioProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route element={<Layout />}>
              <Route path="/video" element={<VideoStudio />} />
              <Route path="/music" element={<MusicStudio />} />
              <Route path="/sound" element={<SoundStudio />} />
              <Route path="/image" element={<ImageStudio />} />
              <Route path="/fashion" element={<FashionStudio />} />
              <Route path="/engineering" element={<EngineeringLab />} />
              <Route path="/ceo" element={<CEODashboard />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StudioProvider>
    </div>
  );
}