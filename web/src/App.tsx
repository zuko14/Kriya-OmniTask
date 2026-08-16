import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider } from './lib/authContext';
import { RouteGuard } from './shell/RouteGuard';
import { AppShell } from './shell/AppShell';
import { AsyncState } from './components/AsyncState';

// Lazy-loaded pages for optimized code splitting
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const ExecutiveOverview = lazy(() => import('./pages/app/ExecutiveOverview').then((m) => ({ default: m.ExecutiveOverview })));
const HumanAttention = lazy(() => import('./pages/app/HumanAttention').then((m) => ({ default: m.HumanAttention })));
const CustomerList = lazy(() => import('./pages/app/CustomerList').then((m) => ({ default: m.CustomerList })));
const CustomerDetail = lazy(() => import('./pages/app/CustomerDetail').then((m) => ({ default: m.CustomerDetail })));
const Conversations = lazy(() => import('./pages/app/Conversations').then((m) => ({ default: m.Conversations })));
const AgentFleet = lazy(() => import('./pages/app/AgentFleet').then((m) => ({ default: m.AgentFleet })));
const AgentDetail = lazy(() => import('./pages/app/AgentDetail').then((m) => ({ default: m.AgentDetail })));
const WorkflowList = lazy(() => import('./pages/app/WorkflowList').then((m) => ({ default: m.WorkflowList })));
const WorkflowDetail = lazy(() => import('./pages/app/WorkflowDetail').then((m) => ({ default: m.WorkflowDetail })));
const BusinessIntelligence = lazy(() => import('./pages/app/BusinessIntelligence').then((m) => ({ default: m.BusinessIntelligence })));
const AnalyticsDashboard = lazy(() => import('./pages/app/AnalyticsDashboard').then((m) => ({ default: m.AnalyticsDashboard })));
const KnowledgeCenter = lazy(() => import('./pages/app/KnowledgeCenter').then((m) => ({ default: m.KnowledgeCenter })));
const BillingSubscription = lazy(() => import('./pages/app/BillingSubscription').then((m) => ({ default: m.BillingSubscription })));
const TenantSettings = lazy(() => import('./pages/app/TenantSettings').then((m) => ({ default: m.TenantSettings })));

const PlatformOverview = lazy(() => import('./pages/platform/PlatformOverview').then((m) => ({ default: m.PlatformOverview })));
const PlatformTenants = lazy(() => import('./pages/platform/PlatformTenants').then((m) => ({ default: m.PlatformTenants })));
const PlatformFleet = lazy(() => import('./pages/platform/PlatformFleet').then((m) => ({ default: m.PlatformFleet })));
const PlatformModelHealth = lazy(() => import('./pages/platform/PlatformModelHealth').then((m) => ({ default: m.PlatformModelHealth })));
const PlatformSecurity = lazy(() => import('./pages/platform/PlatformSecurity').then((m) => ({ default: m.PlatformSecurity })));
const PlatformBilling = lazy(() => import('./pages/platform/PlatformBilling').then((m) => ({ default: m.PlatformBilling })));
const PlatformAudit = lazy(() => import('./pages/platform/PlatformAudit').then((m) => ({ default: m.PlatformAudit })));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<AsyncState status="loading" />}>{children}</Suspense>;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <PageSuspense>
                <Login />
              </PageSuspense>
            }
          />

          <Route
            path="/app"
            element={
              <RouteGuard>
                <AppShell plane="client" />
              </RouteGuard>
            }
          >
            <Route path="overview" element={<PageSuspense><ExecutiveOverview /></PageSuspense>} />
            <Route path="attention" element={<PageSuspense><HumanAttention /></PageSuspense>} />
            <Route path="customers" element={<PageSuspense><CustomerList /></PageSuspense>} />
            <Route path="customers/:id" element={<PageSuspense><CustomerDetail /></PageSuspense>} />
            <Route path="conversations" element={<PageSuspense><Conversations /></PageSuspense>} />
            <Route path="agents" element={<PageSuspense><AgentFleet /></PageSuspense>} />
            <Route path="agents/:id" element={<PageSuspense><AgentDetail /></PageSuspense>} />
            <Route path="workflows" element={<PageSuspense><WorkflowList /></PageSuspense>} />
            <Route path="workflows/:slug" element={<PageSuspense><WorkflowDetail /></PageSuspense>} />
            <Route path="analytics" element={<PageSuspense><AnalyticsDashboard /></PageSuspense>} />
            <Route path="bi" element={<PageSuspense><BusinessIntelligence /></PageSuspense>} />
            <Route path="knowledge" element={<PageSuspense><KnowledgeCenter /></PageSuspense>} />
            <Route path="billing" element={<PageSuspense><BillingSubscription /></PageSuspense>} />
            <Route path="settings" element={<PageSuspense><TenantSettings /></PageSuspense>} />
          </Route>

          <Route
            path="/platform"
            element={
              <RouteGuard requirePlatformRole>
                <AppShell plane="platform" />
              </RouteGuard>
            }
          >
            <Route path="overview" element={<PageSuspense><PlatformOverview /></PageSuspense>} />
            <Route path="tenants" element={<PageSuspense><PlatformTenants /></PageSuspense>} />
            <Route path="fleet" element={<PageSuspense><PlatformFleet /></PageSuspense>} />
            <Route path="models" element={<PageSuspense><PlatformModelHealth /></PageSuspense>} />
            <Route path="security" element={<PageSuspense><PlatformSecurity /></PageSuspense>} />
            <Route path="billing" element={<PageSuspense><PlatformBilling /></PageSuspense>} />
            <Route path="audit" element={<PageSuspense><PlatformAudit /></PageSuspense>} />
          </Route>

          <Route path="*" element={<Navigate to="/app/overview" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
