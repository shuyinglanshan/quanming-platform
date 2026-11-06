import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { LiquidPointer } from './components/liquid-pointer';
import { AuthProvider } from './lib/auth';
import { NotificationProvider } from './lib/notifications';
import { RateAlertListener } from './components/rate-alert-listener';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <RateAlertListener />
          <LiquidPointer />
        <App />
        </NotificationProvider>

        <Toaster
          position="top-center"
          theme="dark"
          // 显式设置自动消失时间与堆叠上限，避免提示常驻遮挡页面
          duration={2600}
          visibleToasts={2}
          closeButton={false}
          richColors={false}
          toastOptions={{
            duration: 2600,
            classNames: {
              toast: 'glass-strong !rounded-2xl !border-white/12 !text-slate-100 !text-[13px]',
              description: '!text-slate-400 !text-[12px]',
              actionButton: '!bg-violet-500 !text-white',
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
