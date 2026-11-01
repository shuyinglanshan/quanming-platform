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
          toastOptions={{
            classNames: {
              toast: 'glass-strong !rounded-2xl !border-white/12 !text-slate-100',
              description: '!text-slate-400',
              actionButton: '!bg-violet-500 !text-white',
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
