import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PluginDocumentSvgAsset,
  PluginDocumentSvgAssetRuntimePort,
} from '@plugin/backend/documentSvgAsset';
import { PluginDocumentSvgAssetError } from '@plugin/backend/documentSvgAsset';
import type {
  PresentationSvgGraphicBinding,
  PresentationSvgGraphicBindingRepositoryPort,
} from '../definitions/presentationSvgGraphicBinding';
import { createPresentationSvgGraphicOwner } from './createPresentationSvgGraphicOwner';

const SVG_SOURCE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M 0 0 L 100 50" fill="none" stroke="#123456"/></svg>';

function createBindingRepository(): PresentationSvgGraphicBindingRepositoryPort {
  const bindings = new Map<string, PresentationSvgGraphicBinding>();
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
      const binding: PresentationSvgGraphicBinding = {
        presentationId: input.presentationId,
        sourceIdentity: input.sourceIdentity,
        assetId: input.assetId,
        contentHash: input.contentHash,
        byteLength: input.byteLength,
        viewBox: input.viewBox,
        createdAt: input.createdAt ?? 100,
      };
      bindings.set(bindingKey, binding);
      return binding;
    },
  };
}

function createDocumentSvgAssets(): PluginDocumentSvgAssetRuntimePort {
  const assets = new Map<string, PluginDocumentSvgAsset>();
  return {
    adoptCanonicalSvg: vi.fn(async input => {
      const asset: PluginDocumentSvgAsset = {
        assetId: `svg-${input.contentHash}`,
        mediaType: 'image/svg+xml',
        byteLength: Buffer.byteLength(input.canonicalSvg, 'utf8'),
        sha256: input.contentHash,
        canonicalSvg: input.canonicalSvg,
      };
      assets.set(asset.assetId, asset);
      return asset;
    }),
    readOwnedSvg: vi.fn(async input => {
      const asset = assets.get(input.assetId);
      if (!asset) throw new PluginDocumentSvgAssetError('managed_asset_unavailable');
      return asset;
    }),
  };
}

describe('createPresentationSvgGraphicOwner', () => {
  let tempDir: string;
  let sourcePath: string;
  let bindingRepository: PresentationSvgGraphicBindingRepositoryPort;
  let documentSvgAssets: PluginDocumentSvgAssetRuntimePort;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-owned-svg-'));
    sourcePath = path.join(tempDir, 'graphic.svg');
    fs.writeFileSync(sourcePath, SVG_SOURCE, 'utf8');
    bindingRepository = createBindingRepository();
    documentSvgAssets = createDocumentSvgAssets();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('inline SVG 通过 canonical admission 后接管，并按内容身份稳定复用', async () => {
    const owner = createPresentationSvgGraphicOwner({
      bindingRepository,
      documentSvgAssets,
    });
    const context = { documentId: 'presentation-1' };

    const first = await owner.ownSource({ kind: 'inline_svg', svg: SVG_SOURCE }, context);
    const reread = await owner.ownSource({ kind: 'inline_svg', svg: SVG_SOURCE }, context);

    expect(first).toEqual(reread);
    expect(first).toMatchObject({
      kind: 'owned_svg',
      viewBox: { width: 100, height: 50 },
    });
    expect(documentSvgAssets.adoptCanonicalSvg).toHaveBeenCalledOnce();
    expect(documentSvgAssets.readOwnedSvg).toHaveBeenCalledWith({
      documentId: 'presentation-1',
      assetId: first.assetId,
    });
  });

  it('本地路径首次写入获胜，源文件删除后仍只读取原 owned asset', async () => {
    const owner = createPresentationSvgGraphicOwner({
      bindingRepository,
      documentSvgAssets,
    });
    const source = { kind: 'local_path' as const, path: sourcePath };

    const first = await owner.ownSource(source, { documentId: 'presentation-1' });
    fs.unlinkSync(sourcePath);
    const reread = await owner.ownSource(source, { documentId: 'presentation-1' });

    expect(reread).toEqual(first);
    expect(documentSvgAssets.adoptCanonicalSvg).toHaveBeenCalledOnce();
    expect(documentSvgAssets.readOwnedSvg).toHaveBeenCalledOnce();
  });

  it('file 与 conversation locator 都在首次接管时解析为宿主文件', async () => {
    const conversationResolver = { resolveRelativePath: vi.fn(async () => sourcePath) };
    const owner = createPresentationSvgGraphicOwner({
      bindingRepository,
      documentSvgAssets,
      conversationFilePathResolver: conversationResolver,
    });

    await owner.ownSource(
      { kind: 'conversation_file', locator: pathToFileURL(sourcePath).href },
      { documentId: 'presentation-1' }
    );
    await owner.ownSource(
      { kind: 'conversation_file', locator: 'conversation:/generated/diagram.svg' },
      { documentId: 'presentation-1', conversationId: 'conversation-1' }
    );

    expect(documentSvgAssets.adoptCanonicalSvg).toHaveBeenCalledTimes(2);
    expect(conversationResolver.resolveRelativePath).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      relativePath: 'generated/diagram.svg',
    });
  });

  it('拒绝 SVG 文字和失效来源，并保留可修复的稳定错误码', async () => {
    const owner = createPresentationSvgGraphicOwner({
      bindingRepository,
      documentSvgAssets,
    });

    await expect(
      owner.ownSource(
        {
          kind: 'inline_svg',
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>字</text></svg>',
        },
        { documentId: 'presentation-1' }
      )
    ).rejects.toMatchObject({
      failure: { code: 'slides.svg.unsupported_element', sourceFixable: true },
    });
    await expect(
      owner.ownSource(
        { kind: 'local_path', path: path.join(tempDir, 'missing.svg') },
        { documentId: 'presentation-1' }
      )
    ).rejects.toMatchObject({
      failure: { code: 'slides.svg.source_unavailable', sourceFixable: true },
    });
    expect(documentSvgAssets.adoptCanonicalSvg).not.toHaveBeenCalled();
  });

  it('绑定事实与受管资产不一致时拒绝继续渲染', async () => {
    const owner = createPresentationSvgGraphicOwner({
      bindingRepository,
      documentSvgAssets,
    });
    const first = await owner.ownSource(
      { kind: 'inline_svg', svg: SVG_SOURCE },
      { documentId: 'presentation-1' }
    );
    vi.mocked(documentSvgAssets.readOwnedSvg).mockResolvedValue({
      assetId: first.assetId,
      mediaType: 'image/svg+xml',
      byteLength: first.byteLength,
      sha256: 'tampered-hash',
      canonicalSvg: '',
    });

    await expect(
      owner.ownSource({ kind: 'inline_svg', svg: SVG_SOURCE }, { documentId: 'presentation-1' })
    ).rejects.toMatchObject({
      failure: { code: 'slides.svg.binding_conflict', sourceFixable: false },
    });
    expect(first.kind).toBe('owned_svg');
  });
});
