import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveEvidenceFromBundles } from '../../../domains/evidence';
import { BlockType } from '../../../features/knowledge-base/domain/block';
import type { OrderedKnowledgeDocumentBlock } from '../../../features/knowledge-base/document-read/definitions/knowledgeDocumentRead';
import {
  buildKnowledgeDocumentReadResult,
  selectKnowledgeDocumentReadBlocks,
} from '../../../features/knowledge-base/document-read/functions/buildKnowledgeDocumentReadResult';
import {
  createTempWorkspaceFixture,
  type TempWorkspaceFixture,
} from '../../../app-hosts/linnya/testkit/tool-fixtures/tempWorkspace';
import type { ToolContext } from '../../types';
import { captureKnowledgeReadEvidence } from './knowledgeReadEvidenceAdapter';

describe('knowledge_read Evidence 自动捕获', () => {
  let workspace: TempWorkspaceFixture | undefined;

  beforeEach(async () => {
    workspace = await createTempWorkspaceFixture('knowledge_read_evidence_');
  });

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it('把模型实际阅读的 full chunk 持久化，并只以 canonical ref 对外引用', async () => {
    const conversationId = 'conversation-knowledge-read';
    const instanceId = 'instance-knowledge-read';
    const request = {
      documentId: 'document-1',
      startChunk: 1,
      endChunk: 1,
      mode: 'full' as const,
      citationOffset: 0,
    };
    const orderedBlocks: OrderedKnowledgeDocumentBlock[] = [
      {
        blockId: 'block-1',
        block: {
          block_type: BlockType.PARAGRAPH,
          text: '这是 Agent 在 knowledge_read 中实际读到的完整原文。',
        },
      },
    ];
    const result = buildKnowledgeDocumentReadResult({
      filename: '研究报告.docx',
      selection: selectKnowledgeDocumentReadBlocks({ request, orderedBlocks }),
      citationRefs: ['Abc234'],
    });
    const context: ToolContext = {
      conversationId,
      turnId: 'turn-knowledge-read',
      research: { instanceId },
    };

    await captureKnowledgeReadEvidence({ documentId: 'document-1', result, context });

    const ref = result.data.citations.citations[0]?.ref;
    if (!ref) throw new Error('测试读取结果缺少 canonical ref');
    const resolved = await resolveEvidenceFromBundles({
      conversationId,
      instanceId,
      refs: [`[@${ref}]`],
      max_units: 1_000,
      max_chars: 1_000,
    });

    expect(result.observation).toContain(`[@${ref}]`);
    expect(result.observation).not.toMatch(/EvidenceStore|bundle_id/);
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.missing_refs).toEqual([]);
    expect(resolved.resolved[ref]).toMatchObject({
      source_type: 'knowledge_base',
      doc_id: 'document-1',
      block_id: 'block-1',
      capture_kind: 'knowledge_document_chunk',
      text: '这是 Agent 在 knowledge_read 中实际读到的完整原文。',
    });
  });
});
