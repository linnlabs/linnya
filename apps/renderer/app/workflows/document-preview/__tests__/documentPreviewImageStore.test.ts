// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentPreviewImageRequest, DocumentPreviewImageResult } from '@app/schemas';
import { createDocumentPreviewImageStore } from '../orchestration/createDocumentPreviewImageStore';

vi.mock('@plugin/renderer/documentPreview', () => ({ readDocumentPreviewImage: vi.fn() }));
const request: DocumentPreviewImageRequest = {
  documentId: 'doc',
  projectId: 'project',
  source: { assetId: 'asset' },
  maxEdgePx: 1024,
};
const bytes = (): DocumentPreviewImageResult => ({
  mimeType: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
});
let created = 0;
const revoked: string[] = [];
beforeEach(() => {
  created = 0;
  revoked.length = 0;
  // jsdom 没有 blob 地址，这里只记录创建与撤销。
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++created}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {
    revoked.push(url);
  });
});
afterEach(() => vi.restoreAllMocks());

it('悬停、画布卡与详情同时要同一张图的同一档时只取一次，最后一个使用方释放后才撤销地址', async () => {
  const read = vi.fn(async () => bytes());
  const store = createDocumentPreviewImageStore(read);
  const [hover, card] = await Promise.all([store.acquire(request), store.acquire(request)]);
  const detail = await store.acquire(request);
  expect(read).toHaveBeenCalledTimes(1);
  expect(new Set([hover.url, card.url, detail.url])).toEqual(new Set(['blob:preview-1']));
  // 另一档、另一篇文档各是各的。
  const larger = await store.acquire({ ...request, maxEdgePx: 2048 });
  expect(larger.url).toBe('blob:preview-2');
  hover.release();
  hover.release();
  card.release();
  await Promise.resolve();
  expect(revoked).toEqual([]);
  detail.release();
  await vi.waitFor(() => expect(revoked).toEqual(['blob:preview-1']));
  // 全部释放后再要，重新取，得到新地址。
  const again = await store.acquire(request);
  expect(read).toHaveBeenCalledTimes(3);
  expect(again.url).toBe('blob:preview-3');
});

it('取不到的图片明确失败，失败不被记住，也没有地址需要撤销', async () => {
  const read = vi.fn<(input: DocumentPreviewImageRequest) => Promise<DocumentPreviewImageResult>>();
  read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('ipc closed'));
  const store = createDocumentPreviewImageStore(read);
  await expect(store.acquire(request)).rejects.toThrow('unavailable');
  await expect(store.acquire(request)).rejects.toThrow('ipc closed');
  read.mockResolvedValueOnce(bytes());
  expect((await store.acquire(request)).url).toBe('blob:preview-1');
  expect(revoked).toEqual([]);
});
