import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  PresentationExportRequest,
  PresentationImageExportProgress,
} from '@plugin/slides/shared/presentationExport';
import { registerSlidesDocumentSaveParticipant } from '../../documentRuntime';
import { runPresentationExport } from './presentationExportWorkflow';
import { usePresentationExportStore } from '../store/presentationExportStore';
import { useSlidesStore } from '../../../store/slidesStore';

const requestTargetMock = vi.hoisted(() => vi.fn());
const exportPresentationMock = vi.hoisted(() => vi.fn());
const onImageExportProgressMock = vi.hoisted(() => vi.fn());
const showNotificationMock = vi.hoisted(() => vi.fn());

vi.mock('@plugin/renderer/exportArtifact', () => ({
  requestExportArtifactTarget: requestTargetMock,
}));

vi.mock('@plugin/renderer/workspaceRuntime', () => ({
  notifyWorkspaceDocumentOpened: vi.fn(),
  showWorkspaceNotification: showNotificationMock,
}));

vi.mock('../../../services/slidesApi', () => ({
  slidesApi: {
    exportPresentation: exportPresentationMock,
    onPresentationImageExportProgress: onImageExportProgressMock,
  },
}));

describe('runPresentationExport', () => {
  let unregister: (() => void) | undefined;
  afterEach(() => unregister?.());
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    useSlidesStore().currentDeckId = 'deck-1';
  });

  it('保存位置取消后不调用 backend，并保留当前独立弹窗', async () => {
    const store = usePresentationExportStore();
    store.open('images');
    requestTargetMock.mockResolvedValueOnce({ status: 'cancelled' });

    await runPresentationExport('images');

    expect(exportPresentationMock).not.toHaveBeenCalled();
    expect(store.activeDialog).toBe('images');
    expect(store.isExporting).toBe(false);
  });

  it('PPTX 默认关闭图表图片化，完成后关闭弹窗并提示文件名', async () => {
    const store = usePresentationExportStore();
    store.open('pptx');
    requestTargetMock.mockResolvedValueOnce({
      status: 'selected',
      target: { token: 'target-1', fileName: 'Deck.pptx' },
    });
    exportPresentationMock.mockResolvedValueOnce({
      format: 'pptx',
      fileName: 'Deck.pptx',
      byteLength: 123,
    });

    await runPresentationExport('pptx');

    expect(exportPresentationMock).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      targetToken: 'target-1',
      format: 'pptx',
      chartMode: 'native',
    });
    expect(store.activeDialog).toBeNull();
    expect(showNotificationMock).toHaveBeenCalledWith(
      '已导出 Deck.pptx',
      'success',
      2500,
    );
  });

  it('选定导出目标后等待保存屏障，再读取后端文稿', async () => {
    usePresentationExportStore().open('pptx');
    let finishSave!: () => void;
    const saved = new Promise<void>(resolve => { finishSave = resolve; });
    unregister = registerSlidesDocumentSaveParticipant({ readDocumentId: () => 'deck-1', save: async () => { await saved; return true; } });
    requestTargetMock.mockResolvedValueOnce({ status: 'selected', target: { token: 'target', fileName: 'Deck.pptx' } });
    exportPresentationMock.mockResolvedValueOnce({ format: 'pptx', fileName: 'Deck.pptx', byteLength: 1 });
    const exporting = runPresentationExport('pptx');
    await Promise.resolve();
    expect(exportPresentationMock).not.toHaveBeenCalled();
    finishSave(); await exporting;
    expect(exportPresentationMock).toHaveBeenCalledOnce();
  });

  it('保存失败时不导出旧 revision，并在弹窗显示真实错误', async () => {
    const store = usePresentationExportStore();
    store.open('pptx');
    unregister = registerSlidesDocumentSaveParticipant({ readDocumentId: () => 'deck-1',
      save: async () => { throw new Error('Unsaved text'); } });
    requestTargetMock.mockResolvedValueOnce({ status: 'selected', target: { token: 'target', fileName: 'Deck.pptx' } });
    await runPresentationExport('pptx');
    expect(exportPresentationMock).not.toHaveBeenCalled();
    expect(store.activeDialog).toBe('pptx');
    expect(showNotificationMock).toHaveBeenCalledWith('导出失败：Unsaved text', 'error', 4000);
  });

  it('图片导出只接纳本次导出的页级进度，并在完成后取消订阅', async () => {
    const store = usePresentationExportStore();
    const stopProgress = vi.fn();
    let emitProgress: ((progress: {
      exportId: string;
      completedPages: number;
      totalPages: number;
    }) => void) | undefined;
    store.open('images');
    requestTargetMock.mockResolvedValueOnce({
      status: 'selected',
      target: { token: 'target-images', fileName: 'Deck-images.zip' },
    });
    onImageExportProgressMock.mockImplementationOnce((
      callback: (progress: PresentationImageExportProgress) => void,
    ) => {
      emitProgress = callback;
      return stopProgress;
    });
    exportPresentationMock.mockImplementationOnce(async (request: PresentationExportRequest) => {
      if (request.format !== 'images') throw new Error('Expected image export request');
      emitProgress?.({ exportId: 'another-export', completedPages: 9, totalPages: 9 });
      emitProgress?.({ exportId: request.exportId, completedPages: 2, totalPages: 5 });
      expect(store.completedImagePages).toBe(2);
      expect(store.totalImagePages).toBe(5);
      return {
        format: 'images',
        fileName: 'Deck-images.zip',
        byteLength: 456,
      };
    });

    await runPresentationExport('images');

    expect(exportPresentationMock).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      targetToken: 'target-images',
      exportId: expect.any(String),
      format: 'images',
      widthPx: 1920,
    });
    expect(stopProgress).toHaveBeenCalledOnce();
    expect(store.activeDialog).toBeNull();
  });
});
