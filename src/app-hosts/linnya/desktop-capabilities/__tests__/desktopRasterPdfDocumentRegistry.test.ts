import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearDesktopRasterPdfDocumentPortForTesting,
  getDesktopRasterPdfDocumentPort,
  installDesktopRasterPdfDocumentPort,
} from '..';

afterEach(clearDesktopRasterPdfDocumentPortForTesting);

describe('Desktop raster PDF registry', () => {
  it('冻结同一 App owner 的唯一 Chromium raster adapter', () => {
    const port = { render: vi.fn(async () => new Uint8Array([1])) };
    installDesktopRasterPdfDocumentPort(port);
    installDesktopRasterPdfDocumentPort(port);

    expect(getDesktopRasterPdfDocumentPort()).toBe(port);
    expect(() => installDesktopRasterPdfDocumentPort({
      render: vi.fn(async () => new Uint8Array([2])),
    })).toThrow('已安装另一实现');
  });
});
