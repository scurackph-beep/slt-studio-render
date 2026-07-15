import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import MusicStudio from './pages/MusicStudio';
import VideoStudio from './pages/VideoStudio';
import ImageStudio from './pages/ImageStudio';
import SoundStudio from './pages/SoundStudio';
import FashionStudio from './pages/FashionStudio';
import EngineeringLab from './pages/EngineeringLab';
import ContactPage from './pages/ContactPage';
import CEODashboard from './pages/CEODashboard';
import InfoPage from './pages/InfoPage';
import ProfilePage from './pages/ProfilePage';
import LibraryPage from './pages/LibraryPage';
import VirtualAssist from './pages/VirtualAssist';
import { AuthProvider } from './context/AuthContext';
import { StudioProvider } from './context/StudioContext';
import SiteGate from './components/SiteGate';

export default function App() {
  return (
    <SiteGate>
      <AuthProvider>
        <StudioProvider>
          <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="music" element={<MusicStudio />} />
          <Route path="video" element={<VideoStudio />} />
          <Route path="image" element={<ImageStudio />} />
          <Route path="sound" element={<SoundStudio />} />
          <Route path="fashion" element={<FashionStudio />} />
          <Route path="engineering" element={<EngineeringLab />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="ceo" element={<CEODashboard />} />
          <Route path="about" element={<InfoPage type="about" />} />
          <Route path="careers" element={<InfoPage type="careers" />} />
          <Route path="privacy" element={<InfoPage type="privacy" />} />
          <Route path="terms" element={<InfoPage type="terms" />} />
          <Route path="sitemap" element={<InfoPage type="sitemap" />} />
          <Route path="subscription" element={<InfoPage type="subscription" />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<InfoPage type="settings" />} />
          <Route path="help" element={<InfoPage type="help" />} />
          <Route path="assist" element={<VirtualAssist />} />
          <Route path="*" element={<InfoPage type="not-found" />} />
        </Route>
        </Routes>
        </BrowserRouter>
        </StudioProvider>
      </AuthProvider>
    </SiteGate>
  );
}
