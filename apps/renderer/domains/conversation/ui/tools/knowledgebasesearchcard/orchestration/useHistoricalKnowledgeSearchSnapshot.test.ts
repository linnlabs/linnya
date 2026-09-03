import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerKnowledgeSearchHistoryPort } from '../../../../ports/knowledgeSearchHistoryPort';
import type { HistoricalKnowledgeSearchSnapshotPointerPresentation } from '../definitions/knowledgeSearchPresentation';
import { useHistoricalKnowledgeSearchSnapshot } from './useHistoricalKnowledgeSearchSnapshot';

const source: HistoricalKnowledgeSearchSnapshotPointerPresentation = {
  kind: 'historical-snapshot-pointer',
  query: 'legacy',
  requestedDeepSearch: true,
  bundleId: 'abcdef0123456789',
  count: 1,
};

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
  vi.restoreAllMocks();
});

function snapshotRecord() {
  return {
    version: 1,
    kind: 'citation_snapshot',
    created_at_ms: 1,
    conversation_id: 'conversation-1',
    tool_name: 'search_knowledge_base',
    query: 'legacy',
    citations: [],
    result: {
      data: {
        documents: [{
          id: 'legacy-1',
          title: 'Legacy',
          snippet: 'legacy snippet',
          doc_id: 'doc-old',
          doc_name: 'Legacy.md',
          block_id: 'block-old',
        }],
        search_mode: 'global',
        doc_name: null,
        query: 'legacy',
        display_title: 'legacy search',
        citations: { query: 'legacy', searchMode: 'global', citations: [] },
      },
      observation: 'legacy evidence',
    },
  };
}

describe('useHistoricalKnowledgeSearchSnapshot', () => {
  it('通过窄 port 读取并复用历史结果 projector', async () => {
    const readCitationSnapshot = vi.fn(async () => snapshotRecord());
    unregister = registerKnowledgeSearchHistoryPort({ readCitationSnapshot });
    const controller = useHistoricalKnowledgeSearchSnapshot({
      source: () => source,
      conversationId: () => 'conversation-1',
    });

    await controller.load();

    expect(readCitationSnapshot).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      bundleId: source.bundleId,
    });
    expect(controller.state.value).toMatchObject({
      kind: 'ready',
      presentation: {
        kind: 'results',
        actualStrategy: 'deep',
        files: [{ docId: 'doc-old', docName: 'Legacy.md' }],
      },
    });
  });

  it('损坏 bundle 明确失败，不降级为空结果', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    unregister = registerKnowledgeSearchHistoryPort({
      readCitationSnapshot: async () => ({ kind: 'citation_snapshot', result: {} }),
    });
    const controller = useHistoricalKnowledgeSearchSnapshot({
      source: () => source,
      conversationId: () => 'conversation-1',
    });

    await controller.load();

    expect(controller.state.value).toEqual({ kind: 'error' });
    expect(console.error).toHaveBeenCalledWith(
      '[KnowledgeSearchCard] 读取历史 Citation Snapshot 失败',
      expect.objectContaining({
        bundleId: source.bundleId,
        conversationId: 'conversation-1',
      }),
    );
  });
});
