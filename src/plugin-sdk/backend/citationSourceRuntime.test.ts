import { describe, expect, it } from 'vitest';
import { KnowledgeSearchResultSchema } from '@app/schemas';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { createCitationSourceResolver } from './citationSourceRuntime';

describe('plugin Citation source runtime', () => {
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
