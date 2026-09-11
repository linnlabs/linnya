import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PluginDocumentImageAsset,
  PluginDocumentImageAssetRuntimePort,
} from '@plugin/backend/documentImageAsset';
import { PluginDocumentImageAssetError } from '@plugin/backend/documentImageAsset';
import type {
  BrushArtworkRenderRequest,
  BrushArtworkSourceRef,
} from '@plugin/slides/shared/brushArtwork';
import type {
  PresentationImageBinding,
  PresentationImageBindingRepositoryPort,
} from '../definitions/presentationImageBinding';
import {
  createPresentationImageSourceResolver,
  createReadOnlyPresentationImageSourceResolver,
} from './createPresentationImageSourceResolver';

function makeAsset(assetId: string): PluginDocumentImageAsset {
  return {
    assetId,
    mediaType: 'image/png',
    byteLength: 3,
    width: 1,
    height: 1,
    sha256: 'hash',
    dataUri: `data:image/png;base64,${Buffer.from(assetId).toString('base64')}`,
  };
}

function createBindingRepository(): PresentationImageBindingRepositoryPort {
  const bindings = new Map<string, PresentationImageBinding>();
  const key = (presentationId: string, sourceIdentity: string) =>
    `${presentationId}\0${sourceIdentity}`;
  return {
    find(input) {
      return bindings.get(key(input.presentationId, input.sourceIdentity)) ?? null;
    },
    bind(input) {
      const bindingKey = key(input.presentationId, input.sourceIdentity);
      const existing = bindings.get(bindingKey);
      if (existing) return existing;
      const binding = {
        presentationId: input.presentationId,
        sourceIdentity: input.sourceIdentity,
        assetId: input.assetId,
        createdAt: input.createdAt ?? 100,
      };
      bindings.set(bindingKey, binding);
      return binding;
    },
  };
}

describe('createPresentationImageSourceResolver', () => {
  let tempDir: string;
  let sourcePath: string;
  let documentImageAssets: PluginDocumentImageAssetRuntimePort;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-owned-image-'));
    sourcePath = path.join(tempDir, 'source.png');
    fs.writeFileSync(sourcePath, 'png');
    documentImageAssets = {
      adoptLocalImage: vi.fn(async () => makeAsset('asset-local')),
      adoptImageBytes: vi.fn(async () => makeAsset('asset-bytes')),
      readOwnedImage: vi.fn(async input => makeAsset(input.assetId)),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('首次采用本地文件，之后只按不可变绑定读取受管 asset', async () => {
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
    });
    const context = { documentId: 'presentation-1' };

    const first = await resolver.resolveImageSource(
      {
        kind: 'local_path',
        path: sourcePath,
      },
      context
    );
    fs.unlinkSync(sourcePath);
    const reread = await resolver.resolveImageSource(
      {
        kind: 'local_path',
        path: sourcePath,
      },
      context
    );

    expect(first).toEqual({
      kind: 'data_uri',
      dataUri: makeAsset('asset-local').dataUri,
    });
    expect(reread).toEqual(first);
    expect(documentImageAssets.adoptLocalImage).toHaveBeenCalledOnce();
    expect(documentImageAssets.readOwnedImage).toHaveBeenCalledWith({
      documentId: 'presentation-1',
      assetId: 'asset-local',
    });
  });

  it('file locator 与 conversation locator 都先解析成本地文件再接管', async () => {
    const conversationResolver = {
      resolveRelativePath: vi.fn(async () => sourcePath),
    };
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
      conversationFilePathResolver: conversationResolver,
    });

    await resolver.resolveImageSource(
      {
        kind: 'generated_asset',
        assetId: pathToFileURL(sourcePath).href,
      },
      { documentId: 'presentation-1' }
    );
    await resolver.resolveImageSource(
      {
        kind: 'generated_asset',
        assetId: 'conversation:/generated/image.png',
      },
      { documentId: 'presentation-1', conversationId: 'conversation-1' }
    );

    expect(documentImageAssets.adoptLocalImage).toHaveBeenCalledTimes(2);
    expect(conversationResolver.resolveRelativePath).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      relativePath: 'generated/image.png',
    });
  });

  it('conversation admission 缺失时保留环境错误，不伪装成本地来源缺失', async () => {
    vi.stubEnv('LINNYA_CONVERSATION_ROOT', '');
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
    });

    await expect(
      resolver.resolveImageSource(
        { kind: 'generated_asset', assetId: 'conversation:/assets/generated.png' },
        { documentId: 'presentation-1', conversationId: 'conversation-1' },
      ),
    ).rejects.toMatchObject({
      failure: { code: 'slides.environment.workspace_unavailable', sourceFixable: false },
    });
    expect(documentImageAssets.adoptLocalImage).not.toHaveBeenCalled();
  });

  it('data URI 按真实 bytes 身份绑定，重复解析不再次 ingress', async () => {
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
    });
    const source = {
      kind: 'data_uri' as const,
      dataUri: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
    };

    await resolver.resolveImageSource(source, { documentId: 'presentation-1' });
    await resolver.resolveImageSource(source, { documentId: 'presentation-1' });

    expect(documentImageAssets.adoptImageBytes).toHaveBeenCalledOnce();
    expect(documentImageAssets.readOwnedImage).toHaveBeenCalledWith({
      documentId: 'presentation-1',
      assetId: 'asset-bytes',
    });
  });

  it('Brush 只生成一次并进入既有图片 binding；尺寸变化产生新资产', async () => {
    const brushArtworkGenerator = {
      generateBrushArtwork: vi.fn(async (request: BrushArtworkRenderRequest) => ({
        bytes: new Uint8Array([1, 2, 3]),
        widthPx: request.widthPx,
        heightPx: request.heightPx,
      })),
    };
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
      brushArtworkGenerator,
    });
    const source: BrushArtworkSourceRef = {
      kind: 'brush_artwork',
      seed: 42,
      backgroundColor: '#FFF4DC',
      quality: 'standard',
      layers: [{
        fill: { kind: 'watercolor', color: '#A63D2F' },
        marks: [{ type: 'ellipse', center: [50, 50], radiusX: 32, radiusY: 24 }],
      }],
    };

    await resolver.resolveImageSource(source, {
      documentId: 'presentation-1',
      targetSizeInches: { width: 4, height: 2 },
    });
    await resolver.resolveImageSource(source, {
      documentId: 'presentation-1',
      targetSizeInches: { width: 4, height: 2 },
    });
    await resolver.resolveImageSource(source, {
      documentId: 'presentation-1',
      targetSizeInches: { width: 8, height: 4 },
    });

    expect(brushArtworkGenerator.generateBrushArtwork).toHaveBeenCalledTimes(2);
    expect(documentImageAssets.adoptImageBytes).toHaveBeenCalledTimes(2);
    expect(documentImageAssets.readOwnedImage).toHaveBeenCalledOnce();
  });

  it('只读重放直接使用历史自包含 data URI，且不执行接管写入', async () => {
    const bindingRepository = createBindingRepository();
    const resolver = createReadOnlyPresentationImageSourceResolver({
      bindingReader: bindingRepository,
      documentImageAssets,
    });
    const source = {
      kind: 'data_uri' as const,
      dataUri: `data:image/png;base64,${Buffer.from('historical-image').toString('base64')}`,
    };

    await expect(
      resolver.resolveImageSource(source, { documentId: 'presentation-1' })
    ).resolves.toEqual(source);
    expect(documentImageAssets.adoptImageBytes).not.toHaveBeenCalled();
    expect(documentImageAssets.adoptLocalImage).not.toHaveBeenCalled();
    expect(documentImageAssets.readOwnedImage).not.toHaveBeenCalled();
  });

  it('只读重放读取已有绑定，但拒绝临时读取未接管的本地来源', async () => {
    const bindingRepository = createBindingRepository();
    bindingRepository.bind({
      presentationId: 'presentation-1',
      sourceIdentity: `local_path:${sourcePath}`,
      assetId: 'asset-owned',
    });
    const resolver = createReadOnlyPresentationImageSourceResolver({
      bindingReader: bindingRepository,
      documentImageAssets,
    });

    await expect(
      resolver.resolveImageSource(
        { kind: 'local_path', path: sourcePath },
        { documentId: 'presentation-1' }
      )
    ).resolves.toEqual({
      kind: 'data_uri',
      dataUri: makeAsset('asset-owned').dataUri,
    });
    await expect(
      resolver.resolveImageSource(
        { kind: 'local_path', path: path.join(tempDir, 'unbound.png') },
        { documentId: 'presentation-1' }
      )
    ).rejects.toMatchObject({
      failure: { code: 'slides.asset.local_source_unavailable' },
    });
    expect(documentImageAssets.adoptLocalImage).not.toHaveBeenCalled();
  });

  it('远程 URL 明确要求先下载，本地图片缺少文档身份也失败', async () => {
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
    });

    await expect(
      resolver.resolveImageSource(
        {
          kind: 'external_url',
          url: 'https://example.com/image.png',
        },
        { documentId: 'presentation-1' }
      )
    ).rejects.toMatchObject({
      failure: { code: 'slides.asset.external_url_not_supported', sourceFixable: true },
    });
    await expect(
      resolver.resolveImageSource({
        kind: 'local_path',
        path: sourcePath,
      })
    ).rejects.toMatchObject({
      failure: { code: 'slides.environment.workspace_unavailable', sourceFixable: false },
    });
    expect(documentImageAssets.adoptLocalImage).not.toHaveBeenCalled();
  });

  it('按文档资产端口的失败事实区分 source remediation 与 store retry', async () => {
    const resolver = createPresentationImageSourceResolver({
      bindingRepository: createBindingRepository(),
      documentImageAssets,
    });
    vi.mocked(documentImageAssets.adoptLocalImage).mockRejectedValueOnce(
      new PluginDocumentImageAssetError('local_source_missing')
    );
    await expect(
      resolver.resolveImageSource(
        { kind: 'local_path', path: sourcePath },
        { documentId: 'presentation-1' }
      )
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.asset.local_source_unavailable',
        retryable: false,
        sourceFixable: true,
      },
    });

    vi.mocked(documentImageAssets.adoptLocalImage).mockRejectedValueOnce(
      new PluginDocumentImageAssetError('store_unavailable')
    );
    await expect(
      resolver.resolveImageSource(
        { kind: 'local_path', path: path.join(tempDir, 'other.png') },
        { documentId: 'presentation-1' }
      )
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.asset.store_unavailable',
        retryable: true,
        sourceFixable: false,
      },
    });
  });
});
