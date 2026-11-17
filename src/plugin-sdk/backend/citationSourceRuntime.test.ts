import { describe, expect, it } from 'vitest';
import { KnowledgeSearchResultSchema } from '@app/schemas';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { captureKnowledgeCitationEvidence, createCitationSourceResolver } from './citationSourceRuntime';
import { resolveEvidenceFromBundles } from 'src/domains/evidence';
import { createTempWorkspaceFixture } from 'src/app-hosts/linnya/testkit/tool-fixtures/tempWorkspace';

describe('plugin Citation source runtime', () => {
  it('保存插件实际展示的正文而不暴露存储身份，其他会话不能读取', async () => {
    const workspace = await createTempWorkspaceFixture('plugin-citation-capture-');
    try {
      const context = { conversationId: 'capturing-conversation', research: { instanceId: 'capturing-instance' } };
      await expect(captureKnowledgeCitationEvidence({ context, query: 'query', items: [{
        ref: 'Abc234', title: 'Original document', snippet: 'short excerpt', contentText: 'actual visible source',
        capturedAtMs: 1, captureKind: 'knowledge_document_chunk', documentId: 'doc-1', blockId: 'block-1',
      }] })).resolves.toBeUndefined();
      const scope = { instanceId: 'capturing-instance', refs: ['Abc234'], max_units: 1000, max_chars: 1000 };
      expect((await resolveEvidenceFromBundles({ ...scope, conversationId: 'capturing-conversation' })).resolved.Abc234)
        .toMatchObject({ doc_id: 'doc-1', text: 'actual visible source' });
      expect((await resolveEvidenceFromBundles({ ...scope, conversationId: 'another-conversation' })).missing_refs)
        .toEqual(['Abc234']);
    } finally { await workspace.cleanup(); }
  });
  it('只向插件投影 Host 已接纳的来源身份', async () => {
    const result = KnowledgeSearchResultSchema.parse({
      data: {
        query: 'query',
        search_strategy: 'shallow',
        search_mode: 'global',
        doc_name: null,
        citations: {
          query: 'query',
          searchMode: 'global',
          citations: [{
            ref: 'Abc234',
            index: 1,
            sourceType: 'knowledge_base',
            docId: 'doc-1',
            blockId: 'block-1',
            docTitle: 'Knowledge title',
            snippet: 'Knowledge snapshot',
          }],
        },
      },
      observation: 'knowledge result',
    });
    const event = createToolOutputEvent(
      'event-1',
      'conversation-1',
      'turn-1',
      'knowledge_search',
      'call-1',
      {
        status: 'success',
        data: result.data,
        observation: result.observation,
      },
    );
    const context = createToolContextFixture({ historyEvents: [event] });

    await expect(
      createCitationSourceResolver(context).resolveSources(['Abc234'])
    ).resolves.toEqual([{
      sourceType: 'knowledge_base',
      ref: 'Abc234',
      docId: 'doc-1',
      blockId: 'block-1',
      title: 'Knowledge title',
      snippet: 'Knowledge snapshot',
    }]);
  });
});
