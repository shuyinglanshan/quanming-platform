import { SessionExpiredGuard } from '@/components/session-expired-guard';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { lazy, Suspense } from 'react';
import SiteLayout from './components/layout/site-layout';
import RequireAuth from './components/require-auth';

/**
 * 路由级懒加载
 *
 * 问题：此前所有页面都是同步 import，导致首页必须下载
 *      包含管理后台、个人中心等全部代码（409KB）。
 *      而首屏真正用到的只有首页。
 *
 * 改为 lazy 后：
 *   · 首屏只加载 HomePage
 *   · 其他页面在访问时才拉取对应 chunk
 *   · 各页面 chunk 独立缓存，互不影响
 *
 * 这对弱网与低端设备尤其重要：首屏可交互时间显著提前。
 */
const HomePage = lazy(() => import('./pages/home'));
const LoginPage = lazy(() => import('./pages/login'));
const RegisterPage = lazy(() => import('./pages/register'));
const ProfilePage = lazy(() => import('./pages/profile'));
const AboutPage = lazy(() => import('./pages/about'));
const AdminPage = lazy(() => import('./pages/admin'));
const NameDetailPage = lazy(() => import('./pages/name-detail'));
const NotificationsPage = lazy(() => import('./pages/notifications'));
const NotFoundPage = lazy(() => import('./pages/not-found'));
const FeedbackPage = lazy(() => import('./pages/feedback'));
const CourtListPage = lazy(() => import('./pages/court').then((m) => ({ default: m.CourtListPage })));
const CourtDetailPage = lazy(() => import('./pages/court').then((m) => ({ default: m.CourtDetailPage })));

/** 页面切换时的轻量占位，避免白屏 */
function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <div className="size-6 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />
        <span className="text-[12.5px]">加载中…</span>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <SessionExpiredGuard />
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/names/:id" element={<NameDetailPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/court" element={<CourtListPage />} />
          <Route path="/court/:id" element={<CourtDetailPage />} />
          <Route
            path="/me"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <NotificationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth staff>
                <AdminPage />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </>
  );
}
