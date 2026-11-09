import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import SetupNotice from './components/SetupNotice';
import SiteApp from './site/SiteApp';

const AdminApp = lazy(() => import('./admin/AdminApp'));
const Kiosk = lazy(() => import('./admin/Kiosk'));

export default function App() {
  if (!isConfigured) return <SetupNotice />;
  return (
    <Suspense fallback={<div className="p-8 text-stone-500">Carregando…</div>}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/ponto" element={<Kiosk />} />
        <Route path="/*" element={<SiteApp />} />
      </Routes>
    </Suspense>
  );
}
