// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasSnapshot } from '@plugin/canvas/shared';
import { createCanvasHistoryPreview } from '../orchestration/createCanvasHistoryPreview';
const state = vi.hoisted(() => ({ installed: vi.fn(), destroyed: vi.fn(), createKernel: vi.fn() }));
vi.mock('../../../kernel', () => ({ createPixiCanvasKernel: state.createKernel }));
vi.mock('../../../orchestration/createCanvasRasterPresentation', () => ({ createCanvasRasterPresentation: () => ({ refresh: vi.fn(), dispose: vi.fn() }) }));
const snapshot = (documentId: string): CanvasSnapshot => ({ schemaVersion: 1, documentId, sequence: 0, elements: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function fixture(read: (documentId: string, versionId: string) => Promise<CanvasSnapshot>) {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  state.createKernel.mockImplementation(async (options: { readonly readonly: boolean }) => {
    expect(options.readonly).toBe(true);
    return { canvas: document.createElement('canvas'), setElements: state.installed, fit: vi.fn(), resize: vi.fn(), destroy: state.destroyed };
  });
  return createCanvasHistoryPreview({ host: document.createElement('div'), staging: document.createElement('div'), read,
    createContent: () => ({ create: vi.fn(), stageImage: vi.fn(), resolveImageSource: vi.fn(), open: vi.fn(), documentTitles: () => new Map(), dispose: vi.fn() }),
  });
}
it('快速切换历史时旧读取不能覆盖最新版本，销毁只读资源', async () => {
  let resolveOld!: (value: CanvasSnapshot) => void;
  const preview = fixture(documentId => documentId === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(snapshot('new')));
  const old = preview.open('old', 'v1'); await preview.open('new', 'v2');
  resolveOld(snapshot('old')); await old;
  expect(state.installed).toHaveBeenCalledExactlyOnceWith([]);
  expect(state.createKernel).toHaveBeenCalledTimes(1);
  expect(preview.state.phase.value).toBe('ready'); preview.dispose(); expect(state.destroyed).toHaveBeenCalledOnce();
});
it('失败保留明确错误，关闭后迟到读取不创建场景', async () => {
  const failed = fixture(async () => { throw new Error('历史已删除'); });
  await failed.open('document', 'v1'); expect(failed.state.error.value).toBe('历史已删除'); expect(state.createKernel).not.toHaveBeenCalled();
  let resolve!: (value: CanvasSnapshot) => void;
  const closing = fixture(() => new Promise(done => { resolve = done; })); const pending = closing.open('document', 'v2'); closing.dispose(); resolve(snapshot('document')); await pending;
  expect(state.createKernel).not.toHaveBeenCalled();
});
