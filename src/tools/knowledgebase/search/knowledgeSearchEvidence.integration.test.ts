import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeSearchResult } from '@app/schemas';
import { resolveEvidenceFromBundles } from '../../../domains/evidence';
import {
  createTempWorkspaceFixture,
  type TempWorkspaceFixture,
} from '../../../app-hosts/linnya/testkit/tool-fixtures/tempWorkspace';
import type { ToolContext } from '../../types';
import {
  captureDeepKnowledgeSearchEvidence,
  captureShallowKnowledgeSearchEvidence,
} from './knowledgeSearchEvidenceAdapter';

function createShallowResult(): KnowledgeSearchResult {
  return {
    data: {
      query: '产品模型',
      search_strategy: 'shallow',
      search_mode: 'global',
      doc_name: null,
      citations: {
        query: '产品模型',
        searchMode: 'global',
        citations: [
          {
            ref: 'Abc234',
            index: 1,
            sourceType: 'knowledge_base',
            docId: 'document-1',
            blockId: 'block-1',
            docTitle: '产品模型.md',
            snippet: '搜索摘要',
          },
        ],
      },
    },
    observation: [
      "Result 1 [@Abc234]: Document '产品模型.md'",
      '  ├─ Hit:  "搜索摘要"',
      "  (Ref: doc_id='document-1', block_id='block-1', 匹配类型: 语义匹配)",
    ].join('\n'),
  };
}

describe('Knowledge Search Evidence 自动捕获', () => {
  let workspace: TempWorkspaceFixture | undefined;

  beforeEach(async () => {
    workspace = await createTempWorkspaceFixture('knowledge_search_evidence_');
  });

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it('shallow 保存摘要，deep 实际发射全文后同 ref 稳定升级', async () => {
    const conversationId = 'conversation-knowledge-search';
    const instanceId = 'instance-knowledge-search';
    const context: ToolContext = {
      conversationId,
      turnId: 'turn-knowledge-search',
      research: { instanceId },
    };

    await captureShallowKnowledgeSearchEvidence({ result: createShallowResult(), context });
    await captureDeepKnowledgeSearchEvidence({
      query: '产品模型',
      context,
      emittedEvidence: [
        {
          ref: 'Abc234',
          docId: 'document-1',
          blockId: 'block-1',
          docTitle: '产品模型.md',
          text: 'Deep Search 实际展示给 Agent 的完整块正文。',
        },
      ],
    });

    const resolved = await resolveEvidenceFromBundles({
      conversationId,
      instanceId,
      refs: ['[@Abc234]'],
      max_units: 1_000,
      max_chars: 1_000,
    });

    expect(resolved.missing_refs).toEqual([]);
    expect(resolved.resolved['Abc234']).toMatchObject({
      capture_kind: 'knowledge_document_chunk',
      text: 'Deep Search 实际展示给 Agent 的完整块正文。',
    });
  });
});
