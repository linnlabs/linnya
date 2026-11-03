import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryDocumentReferences, readDocumentReference } from './documentReferences';
afterEach(() => vi.unstubAllGlobals());
describe('document reference renderer projection', () => {
  it('scopes candidates to the requested project and admits only typed identity/state results', async () => {
    const query = vi.fn(async () => [{ documentId: 'doc', projectId: 'project', nodeType: 'document', title: 'Title', path: 'workspace:/Title.md' }]);
    vi.stubGlobal('window', { electronAPI: { 'document-references:search': query, 'document-references:resolve': async () => ({ documentId: 'doc', title: null, nodeType: null, path: null, status: 'outside_project' }) } });
    expect((await queryDocumentReferences({ projectId: 'project', keyword: 'Title' }))[0]?.documentId).toBe('doc'); expect(query).toHaveBeenCalledWith({ projectId: 'project', keyword: 'Title', limit: 20 });
    expect((await readDocumentReference({ projectId: 'other', documentId: 'doc' })).status).toBe('outside_project');
    await expect(queryDocumentReferences({ projectId: '', keyword: 'Title' })).rejects.toThrow(); expect(query).toHaveBeenCalledTimes(1);
  });
});
