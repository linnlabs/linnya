// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { slidesApi } from '../../../services/slidesApi';
import { importSlideImage } from './importSlideImage';

vi.mock('../../../services/slidesApi', () => ({ slidesApi: { importImage: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

it('一次读入并接管，使用后端确认的尺寸，同时保留只供当前预览的 data URI', async () => {
  const decode = vi.fn(() => { throw new Error('Import must not decode just to inspect dimensions'); });
  vi.stubGlobal('createImageBitmap', decode);
  vi.mocked(slidesApi.importImage).mockResolvedValue({ assetId: 'owned-image', width: 640, height: 480 });
  const file = new File(['image bytes'], 'figure.png', { type: 'image/png' });
  const imported = await importSlideImage('deck', file);
  expect(imported).toEqual({ assetId: 'owned-image', width: 640, height: 480,
    previewSource: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=' });
  expect(slidesApi.importImage).toHaveBeenCalledExactlyOnceWith('deck', 'aW1hZ2UgYnl0ZXM=');
  expect(decode).not.toHaveBeenCalled();
});
