import { Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import SiteLayout from './components/layout/site-layout';
import HomePage from './pages/home';
import LoginPage from './pages/login';
import RegisterPage from './pages/register';
import ProfilePage from './pages/profile';
import AboutPage from './pages/about';
import AdminPage from './pages/admin';
import NameDetailPage from './pages/name-detail';
import NotificationsPage from './pages/notifications';
import NotFoundPage from './pages/not-found';
import FeedbackPage from './pages/feedback';
import { CourtListPage, CourtDetailPage } from './pages/court';
import RequireAuth from './components/require-auth';

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
    </>
  );
}
