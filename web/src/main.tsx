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

/**
 * 移除首屏骨架
 *
 * index.html 中的 #app-boot 在 JS 加载完成前提供视觉反馈，
 * React 首次渲染后淡出并移除，避免遮挡页面。
 */
function dismissBootScreen() {
  const boot = document.getElementById('app-boot');
  if (!boot) return;
  boot.style.opacity = '0';
  window.setTimeout(() => boot.remove(), 260);
}

/** 旧设备兜底：5 秒内未完成挂载则给出可读提示 */
window.setTimeout(() => {
  const boot = document.getElementById('app-boot');
  if (!boot) return;
  const ring = boot.querySelector('.boot-ring');
  if (ring) ring.remove();
  const tip = document.createElement('div');
  tip.style.cssText = 'font-size:12px;line-height:1.7;text-align:center;color:#64748b;padding:0 24px';
  tip.textContent = '加载较慢，请检查网络后刷新页面；若持续无法打开，请尝试更新浏览器。';
  boot.appendChild(tip);
}, 5000);

/**
 * 旧设备兼容兜底
 *
 * 背景：构建目标已设为 es2019，语法层面已降级（?? / ?. 等），
 * 但**运行时 API** 不受 target 影响，仍需手动兜底：
 *
 *   · Array.prototype.at  —— Chrome 92+ / Safari 15.4+ / Firefox 90+
 *   · String.prototype.at —— 同上
 *   · Object.hasOwn       —— Chrome 93+ / Safari 15.4+
 *   · ResizeObserver      —— Chrome 64+ / iOS 13.4+
 *
 * 缺任何一个都会在旧设备上抛错，导致整页白屏。
 * 这里做最小化补齐，不做完整 polyfill（避免体积膨胀）。
 */
function installCompatShims() {
  // Array.prototype.at / String.prototype.at
  const atImpl = function at(this: any, n: number) {
    const len = this.length >>> 0;
    let idx = Math.trunc(n) || 0;
    if (idx < 0) idx += len;
    return idx >= 0 && idx < len ? this[idx] : undefined;
  };
  if (!(Array.prototype as any).at) {
    Object.defineProperty(Array.prototype, 'at', { value: atImpl, writable: true, configurable: true });
  }
  if (!(String.prototype as any).at) {
    Object.defineProperty(String.prototype, 'at', {
      value: function (this: string, n: number) {
        const chars = Array.from(this);
        return atImpl.call(chars, n);
      },
      writable: true,
      configurable: true,
    });
  }

  // Object.hasOwn
  if (!(Object as any).hasOwn) {
    (Object as any).hasOwn = (obj: any, key: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(obj, key);
  }

  // ResizeObserver：极简实现，仅避免「构造即报错」导致的崩溃
  // 说明：不实现真实观测能力（旧设备上相关动画会退化为静态），
  //      但保证应用能正常启动与交互
  if (typeof (window as any).ResizeObserver === 'undefined') {
    class SimpleResizeObserver {
      private cb: any;
      constructor(cb: any) { this.cb = cb; }
      observe(target: any) {
        // 首次触发一次，让依赖它的组件拿到初始尺寸
        try {
          this.cb([{ target, contentRect: target.getBoundingClientRect() }], this);
        } catch { /* 忽略 */ }
      }
      unobserve() {}
      disconnect() {}
    }
    (window as any).ResizeObserver = SimpleResizeObserver;
  }

  // IntersectionObserver（懒加载图片用，同理做空实现兜底）
  if (typeof (window as any).IntersectionObserver === 'undefined') {
    class SimpleIntersectionObserver {
      private cb: any;
      constructor(cb: any) { this.cb = cb; }
      observe(target: any) {
        try { this.cb([{ target, isIntersecting: true }], this); } catch { /* 忽略 */ }
      }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    (window as any).IntersectionObserver = SimpleIntersectionObserver;
  }
}

installCompatShims();

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

// React 首帧渲染完成后移除骨架
requestAnimationFrame(() => {
  requestAnimationFrame(dismissBootScreen);
});
