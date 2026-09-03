import { describe, expect, it } from 'vitest';
import {
  buildPresentationExportFileName,
  parsePresentationImageExportProgress,
  parsePresentationExportRequest,
} from './functions';

describe('presentation export shared rules', () => {
  it('严格恢复三种互斥请求，不替 backend 补默认值', () => {
    expect(parsePresentationExportRequest({
      nodeId: 'deck-1',
      targetToken: 'target-1',
      format: 'pptx',
      chartMode: 'native',
    })).toMatchObject({ format: 'pptx', chartMode: 'native' });
    expect(parsePresentationExportRequest({
      nodeId: 'deck-1',
      targetToken: 'target-2',
      format: 'images',
      widthPx: 1920,
      exportId: 'export-2',
    })).toMatchObject({ format: 'images', widthPx: 1920, exportId: 'export-2' });
    expect(parsePresentationExportRequest({
      nodeId: 'deck-1',
      targetToken: 'target-3',
      format: 'pdf',
    })).toMatchObject({ format: 'pdf' });

    expect(() => parsePresentationExportRequest({
      nodeId: 'deck-1',
      targetToken: 'target-4',
      format: 'pptx',
    })).toThrow('chartMode');
    expect(() => parsePresentationExportRequest({
      nodeId: 'deck-1',
      targetToken: 'target-5',
      format: 'images',
      widthPx: 1920,
    })).toThrow('exportId');
  });

  it('严格恢复一次图片导出的页级进度', () => {
    expect(parsePresentationImageExportProgress({
      exportId: 'export-1',
      completedPages: 3,
      totalPages: 12,
    })).toEqual({
      exportId: 'export-1',
      completedPages: 3,
      totalPages: 12,
    });
    expect(() => parsePresentationImageExportProgress({
      exportId: 'export-1',
      completedPages: 13,
      totalPages: 12,
    })).toThrow('page progress');
  });

  it('为三种 artifact 生成稳定安全的建议文件名', () => {
    expect(buildPresentationExportFileName(' Q2:计划? ', 'pptx')).toBe('Q2-计划-.pptx');
    expect(buildPresentationExportFileName('复盘', 'images')).toBe('复盘-images.zip');
    expect(buildPresentationExportFileName('复盘', 'pdf')).toBe('复盘.pdf');
  });
});
