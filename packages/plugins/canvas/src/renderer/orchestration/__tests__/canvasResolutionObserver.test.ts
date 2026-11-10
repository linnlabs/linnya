// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installCanvasResolutionObserver } from '../installCanvasResolutionObserver';
afterEach(() => vi.unstubAllGlobals());
it('CSS宽高未变时DPR变化仍触发重采样，并重新订阅新DPR；关闭释放当前订阅', () => {
  vi.stubGlobal('devicePixelRatio', 1);
  const listeners = new Set<() => void>(), queries: string[] = [], changed = vi.fn();
  vi.stubGlobal('matchMedia', (query: string) => { queries.push(query); return { addEventListener: (_event: string, callback: () => void) => listeners.add(callback), removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback) }; });
  const close = installCanvasResolutionObserver(changed); expect(queries).toEqual(['(resolution: 1dppx)']);
  vi.stubGlobal('devicePixelRatio', 2); [...listeners][0]?.(); expect(changed).toHaveBeenCalledOnce(); expect(queries).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']); expect(listeners.size).toBe(1);
  close(); expect(listeners.size).toBe(0);
});
