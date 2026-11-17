import { describe, expect, it } from 'vitest';
import { createKnowledgeCitationSearchPort } from './createKnowledgeCitationSearchPort';
import { registerKnowledgeCitationSearchPort } from '@/domains/editor/ports/knowledgeCitationSearchPort';
import { searchInMultipleKbs } from '@/domains/editor/features/citation/services/citationKbSearchService';
import { readHistoricalKnowledgeSnapshot } from '@/domains/conversation/features/citation-presentation/orchestration/readHistoricalKnowledgeSnapshot';

const library = (id: string) => ({
  id, name: id, documentCount: 1,
  createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z',
});
const candidate = (score: number) => ({
  docId: 'doc-a', docTitle: '原件', blockId: 'block-a', score, text: 'saved evidence',
  matchType: 'semantic', blockType: 'paragraph',
});

describe('Editor knowledge citation Host boundary', () => {
  it('lists only explicitly linked libraries and fails on a relationship read error', async () => {
    let failed = false;
    const port = createKnowledgeCitationSearchPort({
      isAvailable: () => true,
      invoke: async channel => {
        if (channel === 'list-project-kb-links') return failed
          ? { success: false, error: '关系不可读', failureKind: 'application' }
          : { success: true, data: ['kb-a'] };
        return { success: true, data: [library('kb-a'), library('kb-other-project')] };
      },
    });
    expect(await port.listProjectLibraries('project-a', new AbortController().signal)).toEqual([{ id: 'kb-a', name: 'kb-a' }]);
    failed = true;
    await expect(port.listProjectLibraries('project-a', new AbortController().signal)).rejects.toThrow('关系不可读');
  });

  it('keeps the captured project, ranks and deduplicates successful libraries while exposing partial failure', async () => {
    const calls: unknown[] = [];
    const port = createKnowledgeCitationSearchPort({
      isAvailable: () => true,
      invoke: async (_channel, payload) => {
        calls.push(payload);
        if (typeof payload === 'object' && payload !== null && 'kbId' in payload) {
          if (payload.kbId === 'broken') return { success: false, error: '索引需重建', failureKind: 'application' };
          return { success: true, data: { results: [candidate(payload.kbId === 'kb-a' ? 0.5 : 0.8)] } };
        }
        throw new Error('unexpected request');
      },
    });
    const dispose = registerKnowledgeCitationSearchPort(port);
    try {
      const result = await searchInMultipleKbs({
        projectId: 'project-a', signal: new AbortController().signal,
        kbIds: ['kb-a', 'kb-b', 'broken'], kbIdToName: {}, query: ' saved ', editorMessage: key => key,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ kbId: 'kb-b', score: 0.8, blockId: 'block-a' });
      expect(result.errorsByKbId).toEqual({ broken: '索引需重建' });
      expect(result.hasPartialFailure).toBe(true);
      expect(calls).toEqual(['kb-a', 'kb-b', 'broken'].map(kbId => ({
        kbId, projectId: 'project-a', request: { query: 'saved', topK: 5, useReranking: true },
      })));
    } finally { dispose(); }
  });

  it('rejects late results after scope cancellation or plugin deactivation', async () => {
    for (const reason of ['scope', 'disabled']) {
      let available = true;
      let finish: (() => void) | undefined;
      const waiting = new Promise<void>(resolve => { finish = resolve; });
      const port = createKnowledgeCitationSearchPort({
        isAvailable: () => available,
        invoke: async () => { await waiting; return { success: true, data: { results: [candidate(1)] } }; },
      });
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
