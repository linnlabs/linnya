import { describe, expect, it } from 'vitest';
import type { ApplicationSurfaceCitationSearch } from '@plugin/renderer/pluginContribution';
import { createKnowledgeCitationSearchPort } from './createKnowledgeCitationSearchPort';
import { registerKnowledgeCitationSearchPort } from '@/domains/editor/ports/knowledgeCitationSearchPort';
import { searchInMultipleKbs } from '@/domains/editor/features/citation/services/citationKbSearchService';
import { readHistoricalKnowledgeSnapshot } from '@/domains/conversation/features/citation-presentation/orchestration/readHistoricalKnowledgeSnapshot';

const candidate = (score: number) => ({
  docId: 'doc-a', docTitle: '原件', blockId: 'block-a', score, text: 'saved evidence',
});
const signal = () => new AbortController().signal;

describe('Editor knowledge citation Host boundary', () => {
  it('calls the application surface contribution and fails when it is unavailable', async () => {
    let search: ApplicationSurfaceCitationSearch | null = {
      listProjectLibraries: async () => [{ id: 'kb-a', name: '资料库' }],
      searchLibrary: async () => [],
    };
    const port = createKnowledgeCitationSearchPort({ readSearch: () => search });
    expect(port.isAvailable()).toBe(true);
    expect(await port.listProjectLibraries('project-a', signal())).toEqual([{ id: 'kb-a', name: '资料库' }]);
    search = null;
    expect(port.isAvailable()).toBe(false);
    await expect(port.listProjectLibraries('project-a', signal())).rejects.toThrow('未启用');
  });

  it('keeps the captured project, ranks and deduplicates successful libraries while exposing partial failure', async () => {
    const calls: unknown[] = [];
    const port = createKnowledgeCitationSearchPort({
      readSearch: () => ({
        listProjectLibraries: async () => [],
        async searchLibrary(request) {
          calls.push(request);
          if (request.kbId === 'broken') throw new Error('索引需重建');
          return [candidate(request.kbId === 'kb-a' ? 0.5 : 0.8)];
        },
      }),
    });
    const dispose = registerKnowledgeCitationSearchPort(port);
    try {
      const result = await searchInMultipleKbs({
        projectId: 'project-a', signal: signal(),
        kbIds: ['kb-a', 'kb-b', 'broken'], kbIdToName: {}, query: ' saved ', editorMessage: key => key,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ kbId: 'kb-b', score: 0.8, blockId: 'block-a' });
      expect(result.errorsByKbId).toEqual({ broken: '索引需重建' });
      expect(result.hasPartialFailure).toBe(true);
      expect(calls).toEqual(['kb-a', 'kb-b', 'broken'].map(kbId => ({
        kbId, projectId: 'project-a', query: 'saved', topK: 5,
      })));
    } finally { dispose(); }
  });

  it('rejects late results after scope cancellation or plugin deactivation', async () => {
    for (const reason of ['scope', 'disabled']) {
      let available = true;
      let finish: (() => void) | undefined;
      const waiting = new Promise<void>(resolve => { finish = resolve; });
      const search: ApplicationSurfaceCitationSearch = {
        listProjectLibraries: async () => [],
        searchLibrary: async () => { await waiting; return [candidate(1)]; },
      };
      const port = createKnowledgeCitationSearchPort({ readSearch: () => (available ? search : null) });
      const controller = new AbortController();
      const pending = port.searchLibrary({ projectId: 'project-a', kbId: 'kb-a', query: 'query', topK: 5 }, controller.signal);
      const rejected = expect(pending).rejects.toThrow(reason === 'scope' ? /abort/i : '未启用');
      if (reason === 'scope') controller.abort(); else available = false;
      finish?.();
      await rejected;
    }
  });

  it('reads stored historical evidence through the Host without an active knowledge plugin', async () => {
    const paths: string[] = [];
    const result = await readHistoricalKnowledgeSnapshot({ conversationId: 'conversation/a', bundleId: 'bundle/a' }, async input => {
      paths.push(String(input));
      return Response.json({ bundle: { entries: [{ text: 'saved evidence' }] } });
    });
    expect(paths).toEqual(['/api/v1/knowledge-base/citation-snapshots/bundles/bundle%2Fa?conversation_id=conversation%2Fa']);
    expect(result).toEqual({ bundle: { entries: [{ text: 'saved evidence' }] } });
  });
});
