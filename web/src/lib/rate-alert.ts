/**
 * 全局请求风控提醒
 * 接口返回 429 时，由 api 层派发事件，UI 层统一弹出提示，
 * 避免每个调用点各写一遍 toast。
 */

export type RateAlertDetail = {
  message: string;
  code?: string;
  retryAfter?: number;
  strikes?: number;
  threshold?: number;
};

const EVENT = 'qm:rate-alert';

export function emitRateAlert(detail: RateAlertDetail) {
  window.dispatchEvent(new CustomEvent<RateAlertDetail>(EVENT, { detail }));
}

export function onRateAlert(handler: (detail: RateAlertDetail) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<RateAlertDetail>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
