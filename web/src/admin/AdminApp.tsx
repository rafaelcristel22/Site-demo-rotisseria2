import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './ui';
import Layout from './Layout';
import Login, { ResetPassword } from './Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const Pos = lazy(() => import('./pages/Pos'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Delivery = lazy(() => import('./pages/Delivery'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Customers = lazy(() => import('./pages/Customers'));
const Marketing = lazy(() => import('./pages/Marketing'));
const Finance = lazy(() => import('./pages/Finance'));
const TimeClock = lazy(() => import('./pages/TimeClock'));
const HR = lazy(() => import('./pages/HR'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Reports = lazy(() => import('./pages/Reports'));
const Assistant = lazy(() => import('./pages/Assistant'));
const SalesRegisters = lazy(() => import('./pages/SalesRegisters'));
const Audit = lazy(() => import('./pages/Audit'));
const Settings = lazy(() => import('./pages/Settings'));

function Gate({ perm, children }: { perm?: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const ok = !perm || (Array.isArray(perm) ? perm.some(can) : can(perm));
  return ok ? <>{children}</> : <div className="p-8 text-stone-600">Você não tem permissão para acessar esta área. Fale com o administrador.</div>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  if (can('kitchen.operate')) return <Navigate to="/admin/cozinha" replace />;
  if (can('pos.operate')) return <Navigate to="/admin/pdv" replace />;
  if (can('delivery.driver')) return <Navigate to="/admin/entregas" replace />;
  return <Navigate to="/admin/ponto" replace />;
}

function Shell() {
  const { session, me, loading, signOut } = useAuth();
  if (loading) return <div className="p-8 text-stone-500">Carregando…</div>;
  if (!session) return <Login />;
  if (!me) return <div className="mx-auto max-w-md p-8"><p className="font-semibold">Seu acesso não tem perfil interno.</p><button className="btn-outline mt-4" onClick={signOut}>Sair</button></div>;
  if (!me.is_active) return (
    <div className="mx-auto max-w-md p-8"><h1 className="heading text-2xl">Acesso aguardando liberação</h1>
      <p className="mt-2 text-stone-600">Seu usuário foi criado, mas um administrador precisa liberar o acesso e definir seu papel.</p><button className="btn-outline mt-4" onClick={signOut}>Sair</button></div>);
  return (
    <Layout>
      <Suspense fallback={<p className="text-stone-500">Carregando…</p>}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="pedidos" element={<Gate perm="orders.view"><Orders /></Gate>} />
          <Route path="pdv" element={<Gate perm="pos.operate"><Pos /></Gate>} />
          <Route path="cozinha" element={<Gate perm="kitchen.operate"><Kitchen /></Gate>} />
          <Route path="entregas" element={<Gate perm={['delivery.manage', 'delivery.driver']}><Delivery /></Gate>} />
          <Route path="cardapio" element={<Gate perm="catalog.view"><Catalog /></Gate>} />
          <Route path="estoque" element={<Gate perm="inventory.view"><Inventory /></Gate>} />
          <Route path="compras" element={<Gate perm="purchases.view"><Purchases /></Gate>} />
          <Route path="clientes" element={<Gate perm="customers.view"><Customers /></Gate>} />
          <Route path="marketing" element={<Gate perm="marketing.view"><Marketing /></Gate>} />
          <Route path="financeiro" element={<Gate perm="finance.view"><Finance /></Gate>} />
          <Route path="ponto" element={<TimeClock />} />
          <Route path="rh" element={<Gate perm="hr.view"><HR /></Gate>} />
          <Route path="folha" element={<Gate perm="payroll.view"><Payroll /></Gate>} />
          <Route path="relatorios" element={<Gate perm="reports.view"><Reports /></Gate>} />
          <Route path="assistente" element={<Gate perm="ai.use"><Assistant /></Gate>} />
          <Route path="vendas" element={<Gate perm={['sales.view', 'pos.manage']}><SalesRegisters /></Gate>} />
          <Route path="auditoria" element={<Gate perm="audit.view"><Audit /></Gate>} />
          <Route path="configuracoes" element={<Gate perm="settings.view"><Settings /></Gate>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider><ToastProvider>
      <Routes>
        <Route path="redefinir-senha" element={<ResetPassword />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </ToastProvider></AuthProvider>
  );
}
