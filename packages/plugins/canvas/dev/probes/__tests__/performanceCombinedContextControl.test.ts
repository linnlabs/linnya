import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCanvasCombinedContextControl } from '../performanceCombinedContextControl';
import { readCanvasPerformanceContextControl } from '../performanceContextControl';

interface State {
  order: string[]; stagingEffective: boolean; tileEffective: boolean;
  tileInstallFailure: Error | null; tileFinishFailure: Error | null; host: HTMLElement | null;
}
const state = vi.hoisted((): State => ({ order: [], stagingEffective: true, tileEffective: true,
  tileInstallFailure: null, tileFinishFailure: null, host: null }));
vi.mock('../performanceStagingContextControl', () => ({
  createCanvasStagingContextControl(arm: string) {
    state.order.push(`install-staging:${arm}`);
    return { finish() { state.order.push('restore-staging'); return { effective: state.stagingEffective }; } };
  },
}));
vi.mock('../performanceTileContextControl', () => ({
  createCanvasTileContextControl(host: HTMLElement, arm: string) {
    state.order.push(`install-tile:${arm}`); state.host = host;
    if (state.tileInstallFailure) { state.order.push('tile-self-cleanup'); throw state.tileInstallFailure; }
    return { finish() { state.order.push('restore-tile'); if (state.tileFinishFailure) throw state.tileFinishFailure; return { effective: state.tileEffective }; } };
  },
}));
beforeEach(() => {
  state.order.length = 0; state.stagingEffective = state.tileEffective = true;
  state.tileInstallFailure = state.tileFinishFailure = null; state.host = null;
  vi.stubGlobal('document', { createElement: () => ({}) });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('组合只选同一臂并先staging后tile，完整收口按逆序恢复；旧单变量不能混入', () => {
  for (const arm of ['A', 'B'] as const) {
    const config = readCanvasPerformanceContextControl({ combined: arm, staging: undefined, tile: undefined, bodyTrace: true });
    expect(config).toEqual({ kind: 'staging-and-tile', arm });
    const host = document.createElement('div'), control = createCanvasCombinedContextControl(host, arm);
    expect(state.host).toBe(host); expect(control.finish()).toMatchObject({ effective: true, staging: { effective: true }, tile: { effective: true } });
    expect(state.order).toEqual([`install-staging:${arm}`, `install-tile:${arm}`, 'restore-tile', 'restore-staging']);
    state.order.length = 0;
  }
  for (const other of ['staging', 'tile'] as const) expect(() => readCanvasPerformanceContextControl({
    combined: 'B', staging: other === 'staging' ? 'A' : undefined, tile: other === 'tile' ? 'A' : undefined, bodyTrace: true,
  })).toThrow('conflicting');
});

it('任一子owner真实资格无效时保留子事实，组合不把另一侧有效冒充完整实验', () => {
  for (const invalid of ['staging', 'tile']) {
    state.stagingEffective = invalid !== 'staging'; state.tileEffective = invalid !== 'tile';
    const result = createCanvasCombinedContextControl(document.createElement('div'), 'B').finish();
    expect(result.effective).toBe(false); expect(result.staging.effective).toBe(state.stagingEffective); expect(result.tile.effective).toBe(state.tileEffective);
  }
});

it('tile部分安装或收口异常保留原异常身份，仍清理已经安装的staging', () => {
  const installFailure = new Error('native_install_failed'); state.tileInstallFailure = installFailure;
  let caught: unknown;
  try { createCanvasCombinedContextControl(document.createElement('div'), 'A'); } catch (error) { caught = error; }
  expect(caught).toBe(installFailure);
  expect(state.order).toEqual(['install-staging:A', 'install-tile:A', 'tile-self-cleanup', 'restore-staging']);
  state.order.length = 0; state.tileInstallFailure = null;
  const finishFailure = new Error('native_restore_failed'); state.tileFinishFailure = finishFailure;
  const control = createCanvasCombinedContextControl(document.createElement('div'), 'B');
  try { control.finish(); } catch (error) { caught = error; }
  expect(caught).toBe(finishFailure);
  expect(state.order).toEqual(['install-staging:B', 'install-tile:B', 'restore-tile', 'restore-staging']);
});
