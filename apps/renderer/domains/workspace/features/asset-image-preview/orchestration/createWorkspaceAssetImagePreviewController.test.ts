import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAssetImagePreviewState } from '../definitions/workspaceAssetImagePreview';
import { createWorkspaceAssetImagePreviewController } from './createWorkspaceAssetImagePreviewController';

describe('workspace asset image preview controller', () => {
  const loadImage = vi.fn<(assetId: string, signal: AbortSignal) => Promise<Blob>>();
  const replace = vi.fn<(value: WorkspaceAssetImagePreviewState) => void>();
  const buildImageUrl = vi.fn<(filePath: string) => string>();
  const create = vi.fn<(blob: Blob) => string>();
  const revoke = vi.fn<(url: string) => void>();

  beforeEach(() => {
    loadImage.mockReset();
    replace.mockReset();
    buildImageUrl.mockReset();
    create.mockReset();
    revoke.mockReset();
  });

  function createController() {
    return createWorkspaceAssetImagePreviewController({
      api: { loadImage },
      state: { replace },
      mediaUrls: { buildImageUrl },
      objectUrls: { create, revoke },
    });
  }

  it('受管资产同时带 asset ID 与账本路径时，只按 durable identity 读取', async () => {
    loadImage.mockResolvedValue(new Blob(['managed-image']));
    create.mockReturnValue('blob:managed-image');
    const controller = createController();

    await controller.open({
      name: 'managed.png',
      assetId: 'asset-managed',
      filePath: '/managed/content/image.png',
      remoteUri: null,
      loadErrorMessage: '图片加载失败',
    });

    expect(loadImage).toHaveBeenCalledWith('asset-managed', expect.any(AbortSignal));
    expect(buildImageUrl).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith({
      visible: true,
      loading: false,
      src: 'blob:managed-image',
      name: 'managed.png',
      error: '',
    });
  });

  it('切换和关闭预览时中止旧请求、回收 object URL，并忽略晚到响应', async () => {
    let resolveSecond: ((blob: Blob) => void) | undefined;
    loadImage
      .mockResolvedValueOnce(new Blob(['first']))
      .mockImplementationOnce(() => new Promise<Blob>((resolve) => {
        resolveSecond = resolve;
      }));
    create.mockReturnValueOnce('blob:first');
    const controller = createController();

    await controller.open({
      name: 'first.png',
      assetId: 'asset-first',
      filePath: null,
      remoteUri: null,
      loadErrorMessage: '图片加载失败',
    });
    const firstSignal = loadImage.mock.calls[0]?.[1];

    const secondOpen = controller.open({
      name: 'second.png',
      assetId: 'asset-second',
      filePath: null,
      remoteUri: null,
      loadErrorMessage: '图片加载失败',
    });
    const secondSignal = loadImage.mock.calls[1]?.[1];

    expect(firstSignal?.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:first');

    controller.close();
    expect(secondSignal?.aborted).toBe(true);
    expect(replace).toHaveBeenLastCalledWith({
      visible: false,
      loading: false,
      src: '',
      name: '',
      error: '',
    });

    resolveSecond?.(new Blob(['late']));
    await secondOpen;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('没有 asset ID 的历史生成图片继续使用 media URL', async () => {
    buildImageUrl.mockReturnValue('media://image?path=legacy');
    const controller = createController();

    await controller.open({
      name: 'legacy.png',
      assetId: null,
      filePath: '/legacy/generated/image.png',
      remoteUri: null,
      loadErrorMessage: '图片加载失败',
    });

    expect(loadImage).not.toHaveBeenCalled();
    expect(buildImageUrl).toHaveBeenCalledWith('/legacy/generated/image.png');
    expect(replace).toHaveBeenLastCalledWith({
      visible: true,
      loading: false,
      src: 'media://image?path=legacy',
      name: 'legacy.png',
      error: '',
    });
  });
});
