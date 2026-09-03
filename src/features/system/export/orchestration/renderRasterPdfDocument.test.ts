import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDesktopRasterPdfDocumentPortForTesting,
  installDesktopRasterPdfDocumentPort,
} from '../../../../app-hosts/linnya/desktop-capabilities';
import { ExportArtifactRequestInvalidError } from '../definitions/exportErrors';
import { renderRasterPdfDocument } from './renderRasterPdfDocument';

afterEach(clearDesktopRasterPdfDocumentPortForTesting);

describe('renderRasterPdfDocument', () => {
  it('校验插件 raster 合同后原样调用 Desktop capability', async () => {
    const request = {
      pageWidthInches: 13.333,
      pageHeightInches: 7.5,
      pages: [new Uint8Array([137, 80, 78, 71])],
    };
    const render = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    installDesktopRasterPdfDocumentPort({ render });

    await expect(renderRasterPdfDocument(request)).resolves.toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
    expect(render).toHaveBeenCalledWith(request);
  });

  it('在进入 Desktop capability 前拒绝空页面', () => {
    const render = vi.fn(async () => new Uint8Array([1]));
    installDesktopRasterPdfDocumentPort({ render });

    expect(() => renderRasterPdfDocument({
      pageWidthInches: 13.333,
      pageHeightInches: 7.5,
      pages: [],
    })).toThrow(ExportArtifactRequestInvalidError);
    expect(render).not.toHaveBeenCalled();
  });
});
