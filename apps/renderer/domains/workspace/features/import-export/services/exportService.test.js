// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prepare, savePdf, notify } = vi.hoisted(() => ({
  prepare: vi.fn(),
  savePdf: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('@/domains/editor/document-export', () => ({ prepareMarkdownHtmlForPdf: prepare }));
vi.mock('../../../../../shared/stores/file', () => ({ useFileStore: () => ({ fileName: '研究.md' }) }));
vi.mock('@/app/notification', () => ({ useNotificationStore: () => ({ show: notify }) }));
vi.mock('../../../functions/resolveCurrentWorkspaceMessage', () => ({ resolveCurrentWorkspaceMessage: key => key }));

import { exportAsPDF } from './exportService';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('electronAPI', { exportPDF: savePdf });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  savePdf.mockResolvedValue({ success: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Markdown PDF 交付', () => {
  it('等待全部图表准备完成后，交付静态图片 HTML 而非原始标题占位', async () => {
    let complete;
    prepare.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const exporting = exportAsPDF({ getHTML: () => '<figure>原始标题</figure>' });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith('<figure>原始标题</figure>'));
    expect(savePdf).not.toHaveBeenCalled();
    complete('<figure><img src="data:image/svg+xml,complete-chart"></figure>');
    await exporting;
    expect(savePdf).toHaveBeenCalledOnce();
    const [name, options] = savePdf.mock.calls[0];
    expect(name).toBe('研究.pdf');
    expect(options.htmlContent).toContain('data:image/svg+xml,complete-chart');
    expect(options.htmlContent).not.toContain('原始标题');
    expect(notify).not.toHaveBeenCalled();
  });

  it('图表生成失败时提示用户，不继续打开保存或生成缺图 PDF', async () => {
    prepare.mockRejectedValueOnce(new Error('chart render failed'));
    await exportAsPDF({ getHTML: () => '<figure>图表</figure>' });
    expect(savePdf).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('workspace.export.service.pdfUnavailable', 'error', 4000);
  });
});
