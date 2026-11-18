import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn<(channel: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>>();
vi.mock('../services/knowledgeRequestSession', () => ({ invokeKnowledgeRequest: invoke }));

const { knowledgeCitationSearch } = await import('./knowledgeCitationSearch');

const library = (id: string) => ({
  id, name: id, documentCount: 1,
  createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z',
});
const signal = () => new AbortController().signal;

describe('knowledge citation search contribution', () => {
  beforeEach(() => invoke.mockReset());

  it('lists only libraries linked to the project and fails on a relationship read error', async () => {
    invoke.mockImplementation(async channel => {
      if (channel === 'list-project-kb-links') return ['kb-a'];
      return [library('kb-a'), library('kb-other-project')];
    });
    expect(await knowledgeCitationSearch.listProjectLibraries('project-a', signal())).toEqual([{ id: 'kb-a', name: 'kb-a' }]);

    invoke.mockRejectedValueOnce(new Error('关系不可读'));
    await expect(knowledgeCitationSearch.listProjectLibraries('project-a', signal())).rejects.toThrow('关系不可读');
  });

  it('sends the captured project with the search so the Backend re-checks scope', async () => {
    invoke.mockResolvedValue({
      results: [{
        docId: 'doc-a', docTitle: '原件', blockId: 'block-a', score: 0.8, text: 'saved evidence',
        matchType: 'semantic', blockType: 'paragraph',
      }],
    });
    const results = await knowledgeCitationSearch.searchLibrary({ projectId: 'project-a', kbId: 'kb-a', query: 'saved', topK: 5 }, signal());
    expect(invoke).toHaveBeenCalledWith('search', {
      kbId: 'kb-a', projectId: 'project-a', request: { query: 'saved', topK: 5, useReranking: true },
    }, expect.any(AbortSignal));
    expect(results).toEqual([{ docId: 'doc-a', docTitle: '原件', blockId: 'block-a', page: undefined, score: 0.8, text: 'saved evidence' }]);
  });
});
