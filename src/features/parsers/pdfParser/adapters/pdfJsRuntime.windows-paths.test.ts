import { describe, expect, it, vi } from 'vitest';

// 在 Mac CI 也让正式适配器产生 Windows 目录分隔符；PDF.js 本体不替换。
vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual, default: actual.win32 };
});

import { createTextPdf } from '../testkit/createTextPdf';
import { openPdfDocument } from './pdfJsRuntime';

describe('PDF.js Windows resource paths', () => {
  it('Windows 形态资源目录仍能通过真实 PDF.js factory 并打开 PDF', async () => {
    // 空文字页不依赖本机上的 Windows 文件系统；完整资源读取由 Windows 安装态验收覆盖。
    const opening = openPdfDocument(createTextPdf([null]));
    await expect(opening).resolves.toMatchObject({ document: { numPages: 1 } });
    const opened = await opening;
    try {
      expect(opened.document.numPages).toBe(1);
      expect((await opened.document.getPage(1)).view).toEqual([0, 0, 595, 842]);
    } finally {
      await opened.close();
    }
  });
});
