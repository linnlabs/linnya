import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDocumentPreview, listDocumentPreviewTypes } from './documentPreview';
afterEach(() => vi.unstubAllGlobals());
describe('document preview renderer admission', () => {
  it('passes only admitted requests and rejects invalid provider output', async () => {
    const read = vi.fn(async () => ({ documentId: 'doc', title: 'Example', nodeType: 'fake', status: 'ready', content: { revisionKey: 'v1', summary: 'Example' } }));
    vi.stubGlobal('window', { electronAPI: { 'document-preview:read': read, 'document-preview:types': async () => [{ nodeType: 'fake', label: 'Fake', pluginId: 'test-plugin', enabled: true, hasPreview: true }] } });
    expect((await readDocumentPreview({ documentId: 'doc', projectId: 'p1', widthPx: 640, pixelRatio: 1 })).content?.revisionKey).toBe('v1');
    expect((await listDocumentPreviewTypes())[0]?.nodeType).toBe('fake');
    await expect(readDocumentPreview({ documentId: 'doc', projectId: 'p1', widthPx: 0, pixelRatio: 1 })).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
