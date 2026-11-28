import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DocumentPreviewContent } from '@app/schemas';
import { createDocumentPreviewOperations, createFilePreviewCache } from '../../../index';
import type { PreviewNode } from '../../../definitions/documentPreview';

const request = { documentId: 'doc', projectId: 'p1', widthPx: 640, pixelRatio: 1 };
function fixture() {
  let node: PreviewNode | null = { id: 'doc', projectId: 'p1', name: 'Document', nodeType: 'fake-plugin-type', deletedAt: null };
  let enabled = true;
  let revision = 'v1';
  const cache = new Map<string, DocumentPreviewContent>();
  const render = vi.fn(async () => ({ revisionKey: revision, summary: 'Current text' }));
  const provider = { getRevision: () => revision, render };
  const operations = createDocumentPreviewOperations({ context: {}, readNode: () => node, readTextSnapshot: () => 'Saved snapshot', resolveProvider: () => enabled ? provider : null, cache: { read: async key => cache.get(key) ?? null, write: async (key, value) => { cache.set(key, value); } } });
  return { operations, render, setNode: (value: PreviewNode | null) => { node = value; }, disable: () => { enabled = false; }, update: () => { revision = 'v2'; } };
}

describe('document preview business lifecycle', () => {
  it.each(['{broken', '{"revisionKey":3}'])('rebuilds a malformed cache entry without hiding filesystem failures: %s', async broken => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'document-preview-corrupt-'));
    try {
      const cache = createFilePreviewCache(root), content = { revisionKey: 'v1', summary: 'Current preview' };
      await cache.write('identity', content);
      const [filename] = await readdir(root);
      await writeFile(path.join(root, filename), broken);
      expect(await cache.read('identity')).toBeNull();
      expect(await readdir(root)).toEqual([]);
      await cache.write('identity', content);
      expect(await cache.read('identity')).toEqual(content);
      await rm(path.join(root, filename));
      await writeFile(root + '-not-a-directory', 'file');
      await expect(createFilePreviewCache(root + '-not-a-directory').read('identity')).rejects.toMatchObject({ code: 'ENOTDIR' });
    } finally { await rm(root, { recursive: true, force: true }); await rm(root + '-not-a-directory', { force: true }); }
  });
  it('reuses only the same content version and still follows title changes', async () => {
    const f = fixture();
    expect((await f.operations.read(request)).content?.summary).toBe('Current text');
    f.setNode({ id: 'doc', projectId: 'p1', name: 'Renamed', nodeType: 'fake-plugin-type', deletedAt: null });
    expect((await f.operations.read(request)).title).toBe('Renamed');
    expect(f.render).toHaveBeenCalledTimes(1);
    f.update();
    expect((await f.operations.read(request)).content?.revisionKey).toBe('v2');
    expect(f.render).toHaveBeenCalledTimes(2);
  });
  it('provides an explicit text snapshot when disabled, without invoking the provider', async () => {
    const f = fixture(); f.disable();
    const result = await f.operations.read(request);
    expect(result.status).toBe('plugin_unavailable');
    expect(result.content?.summary).toBe('Saved snapshot');
    expect(f.render).not.toHaveBeenCalled();
  });
  it('does not read foreign or deleted content', async () => {
    const f = fixture();
    f.setNode({ id: 'doc', projectId: 'p2', name: 'Secret', nodeType: 'fake-plugin-type', deletedAt: null });
    expect(await f.operations.read(request)).toEqual({ documentId: 'doc', title: null, nodeType: null, status: 'outside_project' });
    f.setNode(null);
    expect((await f.operations.read(request)).status).toBe('deleted');
    expect(f.render).not.toHaveBeenCalled();
  });
  it('rechecks project ownership after asynchronous generation and cached reads', async () => {
    const f = fixture();
    f.render.mockImplementationOnce(async () => {
      f.setNode({ id: 'doc', projectId: 'p2', name: 'Secret', nodeType: 'fake-plugin-type', deletedAt: null });
      return { revisionKey: 'v1', summary: 'Must not escape' };
    });
    expect((await f.operations.read(request)).status).toBe('outside_project');
  });
  it('discards content when its revision changes during generation', async () => {
    const f = fixture();
    f.render.mockImplementationOnce(async () => {
      f.update();
      return { revisionKey: 'v1', summary: 'Stale reference title' };
    });
    const stale = await f.operations.read(request);
    expect(stale.status).toBe('preview_unavailable'); expect(stale.content).toBeUndefined();
    expect((await f.operations.read(request)).content?.revisionKey).toBe('v2');
    expect(f.render).toHaveBeenCalledTimes(2);
  });
  it('rechecks revisions after disk reads and cache writes before publishing', async () => {
    let revision = 'v1';
    let mutateOnRead = true;
    const cached = { revisionKey: 'v1', summary: 'Cached private reference' };
    const provider = { getRevision: () => revision, render: async () => ({ revisionKey: revision, summary: 'Rendered reference' }) };
    const operations = createDocumentPreviewOperations({ context: {},
      readNode: () => ({ id: 'doc', projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: null }),
      readTextSnapshot: () => null, resolveProvider: () => provider,
      cache: {
        read: async () => { if (mutateOnRead) { revision = 'v2'; return cached; } return null; },
        write: async () => { revision = 'v3'; },
      },
    });
    expect((await operations.read(request)).content).toBeUndefined();
    mutateOnRead = false;
    expect((await operations.read(request)).content).toBeUndefined();
    expect((await operations.read(request)).content?.revisionKey).toBe('v3');
  });
  it('coalesces simultaneous requests for the same immutable version', async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.operations.read(request)));
    expect(results.every(result => result.status === 'ready')).toBe(true);
    expect(f.render).toHaveBeenCalledTimes(1);
  });
  it('bounds queued and active rendering without starting unbounded hidden workers', async () => {
    let active = 0;
    let maximum = 0;
    const release: Array<() => void> = [];
    const render = async () => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => release.push(resolve));
      active -= 1;
      return { revisionKey: 'v1', summary: 'Text' };
    };
    const operations = createDocumentPreviewOperations({ context: {}, readNode: id => ({ id, projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: null }), readTextSnapshot: () => null, resolveProvider: () => ({ getRevision: () => 'v1', render }), cache: { read: async () => null, write: async () => {} } });
    const jobs = Array.from({ length: 80 }, (_, index) => operations.read({ ...request, documentId: `doc-${index}` }));
    for (let round = 0; round < 100; round += 1) {
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const done of release.splice(0)) done();
    }
    const results = await Promise.all(jobs);
    expect(maximum).toBe(2);
    expect(results.filter(result => result.status === 'ready')).toHaveLength(64);
    expect(results.filter(result => result.status === 'preview_unavailable')).toHaveLength(16);
  });
  it('shares one render across request sizes only when the provider declares its content size independent', async () => {
    const node = { id: 'doc', projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: null };
    for (const [sizeIndependent, renders] of [[true, 1], [false, 2]] as const) {
      const cache = new Map<string, DocumentPreviewContent>();
      const render = vi.fn(async () => ({ revisionKey: 'v1', summary: 'Text' }));
      const operations = createDocumentPreviewOperations({ context: {}, readNode: () => node, readTextSnapshot: () => null,
        resolveProvider: () => ({ sizeIndependent, getRevision: () => 'v1', render }),
        cache: { read: async key => cache.get(key) ?? null, write: async (key, value) => { cache.set(key, value); } } });
      // 悬停（640 宽、2 倍屏）与画布卡（320 宽、1 倍）读同一版本。
      await operations.read({ ...request, pixelRatio: 2 });
      await operations.read({ ...request, widthPx: 320 });
      expect(render).toHaveBeenCalledTimes(renders);
    }
  });
  it('renders covers at fixed sizes so cards of nearby widths share one image', async () => {
    const cache = new Map<string, DocumentPreviewContent>();
    const render = vi.fn(async (_input: { readonly widthPx: number; readonly pixelRatio: number }) => ({ revisionKey: 'v1', summary: 'Cover' }));
    const operations = createDocumentPreviewOperations({ context: {},
      readNode: () => ({ id: 'doc', projectId: 'p1', name: 'Deck', nodeType: 'fake', deletedAt: null }),
      readTextSnapshot: () => null, resolveProvider: () => ({ getRevision: () => 'v1', render }),
      cache: { read: async key => cache.get(key) ?? null, write: async (key, value) => { cache.set(key, value); } } });
    // 画布上两张不同宽度的卡，以及拖宽其中一张之后。
    for (const widthPx of [336, 412, 640]) await operations.read({ ...request, widthPx });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toMatchObject({ widthPx: 640, pixelRatio: 1 });
    // 悬停在 2 倍屏上要的是另一档，不能拿 1 倍的图放大。
    await operations.read({ ...request, pixelRatio: 1.5 });
    expect(render.mock.calls[1]?.[0]).toMatchObject({ widthPx: 640, pixelRatio: 2 });
    // 卡片再宽也不低于它的显示宽度。
    await operations.read({ ...request, widthPx: 700 });
    expect(render.mock.calls[2]?.[0]).toMatchObject({ widthPx: 1280, pixelRatio: 1 });
  });
  it('serves preview image bytes only for a readable document in the requested project, and rechecks after the read', async () => {
    let node: PreviewNode | null = { id: 'doc', projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: null };
    const bytes = new Uint8Array([1, 2, 3]);
    const readImage = vi.fn(async () => ({ mimeType: 'image/png' as const, bytes }));
    let provider: { getRevision(): string; render(): Promise<DocumentPreviewContent>; readImage?: typeof readImage } | null = { getRevision: () => 'v1', render: async () => ({ revisionKey: 'v1', summary: '' }), readImage };
    const operations = createDocumentPreviewOperations({ context: {}, readNode: () => node, readTextSnapshot: () => null, resolveProvider: () => provider, cache: { read: async () => null, write: async () => {} } });
    const image = { documentId: 'doc', projectId: 'p1', source: { assetId: 'asset' }, maxEdgePx: 512 as const };
    expect(await operations.readImage(image)).toEqual({ mimeType: 'image/png', bytes });
    expect(readImage).toHaveBeenLastCalledWith(expect.objectContaining({ documentId: 'doc', source: { assetId: 'asset' }, maxEdgePx: 512 }));
    // 别的项目、已删除、类型停用或不提供图片：不调用内容方。
    expect(await operations.readImage({ ...image, projectId: 'p2' })).toBeNull();
    node = { id: 'doc', projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: 1 };
    expect(await operations.readImage(image)).toBeNull();
    node = { id: 'doc', projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: null };
    const serving = provider;
    provider = null;
    expect(await operations.readImage(image)).toBeNull();
    provider = { getRevision: () => 'v1', render: serving.render };
    expect(await operations.readImage(image)).toBeNull();
    expect(readImage).toHaveBeenCalledTimes(1);
    // 读取期间文档移出项目：字节不交付。
    provider = serving;
    readImage.mockImplementationOnce(async () => {
      node = { id: 'doc', projectId: 'p2', name: 'Doc', nodeType: 'fake', deletedAt: null };
      return { mimeType: 'image/png' as const, bytes };
    });
    expect(await operations.readImage(image)).toBeNull();
    await expect(operations.readImage({ ...image, source: { src: 'https://example.com/a.png' } })).rejects.toThrow();
  });
  it('roundtrips a derived disk cache and can rebuild after directory removal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'document-preview-'));
    try {
      const cache = createFilePreviewCache(root);
      const content = { revisionKey: 'v1', summary: 'Example' };
      await cache.write('identity', content);
      expect(await cache.read('identity')).toEqual(content);
      await rm(root, { recursive: true, force: true });
      expect(await cache.read('identity')).toBeNull();
      await cache.write('identity', content);
      expect(await cache.read('identity')).toEqual(content);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
