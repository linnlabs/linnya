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
    const operations = createDocumentPreviewOperations({ context: {}, readNode: () => ({ id: 'doc', projectId: 'p1', name: 'Doc', nodeType: 'fake', deletedAt: null }), readTextSnapshot: () => null, resolveProvider: () => ({ getRevision: () => 'v1', render }), cache: { read: async () => null, write: async () => {} } });
    const jobs = Array.from({ length: 80 }, (_, index) => operations.read({ ...request, widthPx: 120 + index }));
    for (let round = 0; round < 100; round += 1) {
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const done of release.splice(0)) done();
    }
    const results = await Promise.all(jobs);
    expect(maximum).toBe(2);
    expect(results.filter(result => result.status === 'ready')).toHaveLength(64);
    expect(results.filter(result => result.status === 'preview_unavailable')).toHaveLength(16);
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
