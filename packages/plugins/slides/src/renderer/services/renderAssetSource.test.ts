import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderAssetRef } from '../types/render';
import {
  clearRenderableImageSourceCache,
  getRenderableImageSourceKey,
  resolveRenderableImageResource,
  resolveRenderableImageSource,
  summarizeRenderableImageSource,
} from './renderAssetSource';

describe('renderAssetSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRenderableImageSourceCache();
    vi.stubGlobal('window', {
      electronAPI: {
        onApiPortSet: vi.fn(),
      },
    });
  });

  it('returns data uri and external url unchanged', async () => {
    const dataAsset: RenderAssetRef = { type: 'data', dataUri: 'data:image/png;base64,AAA' };
    const externalAsset: RenderAssetRef = { type: 'external', url: 'https://example.com/a.png' };

    await expect(resolveRenderableImageSource(dataAsset)).resolves.toBe(dataAsset.dataUri);
    await expect(resolveRenderableImageSource(externalAsset)).resolves.toBe(externalAsset.url);
  });

  it('loads absolute embedded file paths through electron api as data urls', async () => {
    const loadImageAsDataURL = vi.fn(async () => ({
      success: true,
      dataUrl: 'data:image/png;base64,LOCAL',
    }));
    window.electronAPI = {
      ...window.electronAPI,
      loadImageAsDataURL,
    };

    const asset: RenderAssetRef = { type: 'embedded', partPath: '/tmp/slides-local.png' };

    await expect(resolveRenderableImageSource(asset)).resolves.toBe('data:image/png;base64,LOCAL');
    expect(loadImageAsDataURL).toHaveBeenCalledWith('/tmp/slides-local.png');
  });

  it('invalidates cached local image data when file size or mtime changes', async () => {
    const loadImageAsDataURL = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        dataUrl: 'data:image/png;base64,V1',
      })
      .mockResolvedValueOnce({
        success: true,
        dataUrl: 'data:image/png;base64,V2',
      });
    const statImageFile = vi
      .fn()
      .mockResolvedValueOnce({ success: true, size: 10, mtimeMs: 100 })
      .mockResolvedValueOnce({ success: true, size: 10, mtimeMs: 100 })
      .mockResolvedValueOnce({ success: true, size: 11, mtimeMs: 200 });
    window.electronAPI = {
      ...window.electronAPI,
      loadImageAsDataURL,
      statImageFile,
    };

    const asset: RenderAssetRef = { type: 'embedded', partPath: '/tmp/slides-local.png' };

    await expect(resolveRenderableImageSource(asset)).resolves.toBe('data:image/png;base64,V1');
    await expect(resolveRenderableImageSource(asset)).resolves.toBe('data:image/png;base64,V1');
    await expect(resolveRenderableImageSource(asset)).resolves.toBe('data:image/png;base64,V2');
    expect(loadImageAsDataURL).toHaveBeenCalledTimes(2);
  });

  it('keeps ppt embedded media paths unchanged', async () => {
    const loadImageAsDataURL = vi.fn();
    window.electronAPI = {
      ...window.electronAPI,
      loadImageAsDataURL,
    };

    const asset: RenderAssetRef = { type: 'embedded', partPath: '../media/image1.png' };

    await expect(resolveRenderableImageSource(asset)).resolves.toBe('../media/image1.png');
    expect(loadImageAsDataURL).not.toHaveBeenCalled();
  });

  it('builds stable semantic keys for equivalent image sources', () => {
    const embeddedKey = getRenderableImageSourceKey({
      type: 'embedded',
      partPath: '/tmp/slides-local.png',
    });
    const externalKey = getRenderableImageSourceKey({
      type: 'external',
      url: 'https://example.com/a.png',
    });
    const dataKey = getRenderableImageSourceKey('data:image/png;base64,AAA');

    expect(embeddedKey).toMatch(/^embedded:\d+:[0-9a-f]{16}$/);
    expect(externalKey).toMatch(/^external:\d+:[0-9a-f]{16}$/);
    expect(dataKey).toMatch(/^raw:\d+:[0-9a-f]{16}$/);
    expect(getRenderableImageSourceKey({
      type: 'external',
      url: 'https://example.com/a.png',
    })).toBe(externalKey);
    expect(dataKey).not.toContain('base64');
    expect(externalKey).not.toContain('example.com');
  });

  it('returns the compact key together with the final renderable source', async () => {
    const dataUri = `data:image/png;base64,${'A'.repeat(1024)}`;

    const resolved = await resolveRenderableImageResource({ type: 'data', dataUri });

    expect(resolved?.source).toBe(dataUri);
    expect(resolved?.cacheKey).toMatch(/^data:1046:[0-9a-f]{16}$/);
    expect(resolved?.cacheKey.length).toBeLessThan(40);
  });

  it('summarizes image sources without exposing data bytes or filesystem paths', () => {
    const summary = summarizeRenderableImageSource({
      type: 'data',
      dataUri: `data:image/png;base64,${'A'.repeat(180)}`,
    });

    expect(summary.refType).toBe('data');
    expect(summary.rawKind).toBe('data-uri');
    expect(summary.length).toBeGreaterThan(180);
    expect(JSON.stringify(summary)).not.toContain('AAAA');

    const absolutePathSummary = summarizeRenderableImageSource({ type: 'embedded', partPath: '/tmp/a.png' });
    expect(absolutePathSummary).toMatchObject({
      refType: 'embedded',
      rawKind: 'absolute-path',
      isAbsoluteFilesystemPath: true,
    });
    expect(JSON.stringify(absolutePathSummary)).not.toContain('/tmp/a.png');
    expect(summarizeRenderableImageSource({ type: 'embedded', partPath: '../media/image1.png' })).toMatchObject({
      refType: 'embedded',
      rawKind: 'relative-or-token',
      isAbsoluteFilesystemPath: false,
    });
  });
});
