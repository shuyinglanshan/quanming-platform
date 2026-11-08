import { api } from './api';

/**
 * 会话心跳
 *
 * 设计要点：
 *   1. 只在「页面可见 + 用户有操作」时上报，避免后台标签页刷请求
 *   2. 间隔由服务端下发（默认 60s），支持动态调整
 *   3. 用户 5 分钟无操作后暂停上报 —— 这代表「人可能离开了」，
 *      服务端据此在 3 天后判定闲置（而不是靠任意请求续命）
 *   4. 上报失败（会话已过期）时派发事件，由全局守卫提示重新登录
 *
 * 为什么不用「任意请求」代替心跳：
 *   轮询、预加载等自动请求会不断刷新 lastActiveAt，
 *   让「一直挂着页面」的会话永远不过期，失去闲置踢出的意义。
 */

const ACTIVE_WINDOW = 5 * 60 * 1000; // 5 分钟内有操作才算「在用」
const MIN_INTERVAL = 15_000;

let timer: number | null = null;
let lastUserAction = Date.now();
let started = false;
let currentInterval = 60_000;

/** 标记用户有操作 */
function markActive() {
  lastUserAction = Date.now();
}

/** 是否处于活跃期 */
function isActive() {
  return Date.now() - lastUserAction < ACTIVE_WINDOW;
}

async function beat() {
  // 页面不可见 / 长时间无操作 → 跳过本次心跳
  if (document.visibilityState !== 'visible') return;
  if (!isActive()) return;

  try {
    const res = await api.post<{ ok: boolean; interval: number; idleTimeout: number }>('/me/heartbeat');
    if (res?.interval && res.interval !== currentInterval) {
      currentInterval = Math.max(MIN_INTERVAL, res.interval);
      restartTimer();
    }
  } catch (err: any) {
    // 会话过期：交给全局守卫处理（不在这里重复弹窗）
    if (err?.code === 'SESSION_EXPIRED' || err?.status === 401) {
      stopHeartbeat();
    }
  }
}

function restartTimer() {
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(beat, currentInterval);
}

/** 启动心跳（登录后调用） */
export function startHeartbeat() {
  if (started) return;
  started = true;
  lastUserAction = Date.now();

  // 监听用户操作
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
  for (const e of events) {
    window.addEventListener(e, markActive, { passive: true });
  }

  // 页面重新可见时立刻补一次（避免切回来时已过期）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      markActive();
      beat();
    }
  });

  // 首次延迟 3 秒，避开登录后的请求高峰
  window.setTimeout(() => beat(), 3000);
  restartTimer();
}

/** 停止心跳（登出后调用） */
export function stopHeartbeat() {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
  started = false;
}
