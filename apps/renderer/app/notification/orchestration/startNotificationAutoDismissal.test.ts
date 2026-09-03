import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { startNotificationAutoDismissal } from './startNotificationAutoDismissal';
import { useNotificationStore } from '../store/notificationStore';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startNotificationAutoDismissal', () => {
  it('按通知请求的 duration 自动隐藏', () => {
    const store = useNotificationStore();
    const stop = startNotificationAutoDismissal(store);
    store.show('保存成功', 'success', 1_200);

    vi.advanceTimersByTime(1_199);
    expect(store.isVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.isVisible).toBe(false);
    stop();
  });

  it('新通知替换旧通知并从新请求重新计时', () => {
    const store = useNotificationStore();
    const stop = startNotificationAutoDismissal(store);
    store.show('第一条', 'info', 1_000);
    vi.advanceTimersByTime(600);
    store.show('第二条', 'warning', 1_000);

    vi.advanceTimersByTime(400);
    expect(store.isVisible).toBe(true);
    expect(store.message).toBe('第二条');
    vi.advanceTimersByTime(600);
    expect(store.isVisible).toBe(false);
    stop();
  });

  it('duration 为零时不自动隐藏', () => {
    const store = useNotificationStore();
    const stop = startNotificationAutoDismissal(store);
    store.show('持续显示', 'info', 0);

    vi.runAllTimers();
    expect(store.isVisible).toBe(true);
    stop();
  });

  it('停止编排时清理尚未触发的 timer', () => {
    const store = useNotificationStore();
    const stop = startNotificationAutoDismissal(store);
    store.show('停止前', 'info', 500);
    stop();

    vi.runAllTimers();
    expect(store.isVisible).toBe(true);
  });
});
