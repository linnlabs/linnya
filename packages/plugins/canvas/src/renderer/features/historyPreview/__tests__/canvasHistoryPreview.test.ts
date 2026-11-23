// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasSnapshot, CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
import { createCanvasHistoryPreview } from '../orchestration/createCanvasHistoryPreview';
import type { CanvasHistoryPreviewOptions } from '../definitions/canvasHistoryPreview';
import { canvasVersionBudgetNotice } from '..';
import { CanvasUserError } from '../../localization';
const state = vi.hoisted(() => ({ installed: vi.fn(), destroyed: vi.fn(), createKernel: vi.fn() }));
vi.mock('../../../kernel', () => ({ createPixiCanvasKernel: state.createKernel }));
const snapshot = (documentId: string): CanvasSnapshot => ({
  schemaVersion: 1,
  documentId,
  sequence: 0,
  elements: [],
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function fixture(
  read: (documentId: string, versionId: string) => Promise<CanvasSnapshot>,
  readBudget = async (documentId: string): Promise<CanvasVersionBudgetStatus> => ({
    documentId,
    usedBytes: 0,
    budgetBytes: 1,
    overBudgetBytes: 0,
  }),
  createRaster: CanvasHistoryPreviewOptions['createRaster'] = () => ({
    refresh: vi.fn(),
    dispose: vi.fn(),
  })
) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  state.createKernel.mockImplementation(async (options: { readonly readonly: boolean }) => {
    expect(options.readonly).toBe(true);
    return {
      canvas: document.createElement('canvas'),
      setElements: state.installed,
      setAppearance: vi.fn(),
      fit: vi.fn(),
      resize: vi.fn(),
      renderableCards: () => [],
      destroy: state.destroyed,
    };
  });
  return createCanvasHistoryPreview({
    host: document.createElement('div'),
    read,
    readBudget,
    readAppearance: () => ({ dark: false, material: 'paper', overview: 'titles' }),
    createRaster,
    observeResolution: () => () => {},
    createContent: () => ({
      create: vi.fn(),
      stageImage: vi.fn(),
      releaseStagedImages: vi.fn(),
      resolveImageSource: vi.fn(),
      open: vi.fn(),
      documentTitles: () => new Map(),
      contentKey: () => '',
      refreshReferences: async () => {},
      refreshVisible: vi.fn(),
      thumbnailCards: () => new Set(),
      retry: vi.fn(),
      subscribe: () => () => {},
      dispose: vi.fn(),
    }),
  });
}
it('快速切换历史时旧读取不能覆盖最新版本，销毁只读资源', async () => {
  let resolveOld!: (value: CanvasSnapshot) => void;
  const preview = fixture(documentId =>
    documentId === 'old'
      ? new Promise(resolve => {
          resolveOld = resolve;
        })
      : Promise.resolve(snapshot('new'))
  );
  const old = preview.open('old', 'v1');
  await preview.open('new', 'v2');
  resolveOld(snapshot('old'));
  await old;
  expect(state.installed).toHaveBeenCalledExactlyOnceWith([]);
  expect(state.createKernel).toHaveBeenCalledTimes(1);
  expect(preview.state.phase.value).toBe('ready');
  preview.dispose();
  expect(state.destroyed).toHaveBeenCalledOnce();
});
it('失败保留明确错误，关闭后迟到读取不创建场景', async () => {
  const failed = fixture(async () => {
    throw new CanvasUserError('历史已删除');
  });
  await failed.open('document', 'v1');
  expect(failed.state.error.value).toBe('历史已删除');
  expect(state.createKernel).not.toHaveBeenCalled();
  let resolve!: (value: CanvasSnapshot) => void;
  const closing = fixture(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const pending = closing.open('document', 'v2');
  closing.dispose();
  resolve(snapshot('document'));
  await pending;
  expect(state.createKernel).not.toHaveBeenCalled();
});
it('预算变化通知优先于打开期间的旧读取，超软预算明确解释保留的最近版本', async () => {
  let resolve!: (status: CanvasVersionBudgetStatus) => void;
  const preview = fixture(
    async () => snapshot('doc'),
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const opening = preview.open('doc', 'v1');
  preview.budgetChanged({
    documentId: 'doc',
    usedBytes: 160,
    budgetBytes: 100,
    overBudgetBytes: 60,
  });
  resolve({ documentId: 'doc', usedBytes: 80, budgetBytes: 100, overBudgetBytes: 0 });
  await opening;
  expect(preview.state.budget.value?.overBudgetBytes).toBe(60);
  expect(canvasVersionBudgetNotice(preview.state.budget.value)).toContain('最近5个版本');
  preview.budgetChanged({
    documentId: 'other',
    usedBytes: 0,
    budgetBytes: 100,
    overBudgetBytes: 0,
  });
  expect(preview.state.budget.value?.documentId).toBe('doc');
  preview.dispose();
});
it('场景装配中途抛错销毁已创建的 kernel 与已装配资源，随后重新打开可恢复', async () => {
  const raster = { refresh: vi.fn(), dispose: vi.fn() };
  let failures = 1;
  const preview = fixture(
    async documentId => snapshot(documentId),
    undefined,
    () => {
      if (failures-- > 0) throw new Error('raster_unavailable');
      return raster;
    }
  );
  await preview.open('doc', 'v1');
  expect(preview.state.phase.value).toBe('failed');
  expect(state.createKernel).toHaveBeenCalledTimes(1);
  expect(state.destroyed).toHaveBeenCalledOnce();
  await preview.open('doc', 'v2');
  expect(preview.state.phase.value).toBe('ready');
  expect(state.createKernel).toHaveBeenCalledTimes(2);
  expect(state.destroyed).toHaveBeenCalledOnce();
  preview.dispose();
  expect(raster.dispose).toHaveBeenCalledOnce();
  expect(state.destroyed).toHaveBeenCalledTimes(2);
});
