import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveEvidenceFromBundles, saveEvidenceBundle } from 'src/domains/evidence';
import {
  createTempWorkspaceFixture,
  type TempWorkspaceFixture,
} from 'src/app-hosts/linnya/testkit/tool-fixtures/tempWorkspace';
import { parseEvidenceBundleItems } from '../../functions/parseEvidenceBundleItems';

describe('Evidence ref 解析规则', () => {
  let workspace: TempWorkspaceFixture | undefined;

  beforeEach(async () => {
    workspace = await createTempWorkspaceFixture('knowledge_evidence_quality_');
  });

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it('同一 canonical ref 和 block 应稳定选择 full chunk，不受 bundle 文件顺序影响', async () => {
    const scope = {
      conversationId: 'conversation-knowledge-quality',
      instanceId: 'instance-knowledge-quality',
    };
    const common = {
      ref_id: 'Abc234',
      source_type: 'knowledge_base' as const,
      title: 'Knowledge document',
      captured_at_ms: 1,
      doc_id: 'document-1',
      block_id: 'block-1',
      doc_name: 'Knowledge document',
    };

    await saveEvidenceBundle({
      scope,
      kind: 'knowledge_evidence',
      query: 'search capture',
      items: [
        {
          ...common,
          capture_kind: 'knowledge_search_result',
          snippet: '搜索摘录',
          content_text: '搜索摘录',
        },
      ],
    });
    await saveEvidenceBundle({
      scope,
      kind: 'knowledge_evidence',
      query: 'full read capture',
      items: [
        {
          ...common,
          capture_kind: 'knowledge_document_chunk',
          snippet: '完整读取正文',
          content_text: '完整读取正文，包含搜索摘录之外的上下文。',
        },
      ],
    });

    const result = await resolveEvidenceFromBundles({
      ...scope,
      refs: ['[@Abc234]'],
      max_units: 100,
      max_chars: 1_000,
    });

    expect(result.conflicts).toEqual([]);
    expect(result.missing_refs).toEqual([]);
    expect(result.resolved['Abc234']).toMatchObject({
      doc_id: 'document-1',
      block_id: 'block-1',
      capture_kind: 'knowledge_document_chunk',
      text: '完整读取正文，包含搜索摘录之外的上下文。',
    });
  });

  it('历史 assemble_evidence 项没有 capture_kind 时按 full chunk 读取', async () => {
    const entries = parseEvidenceBundleItems({
      version: 1,
      kind: 'assemble_evidence',
      items: [
        {
          source_type: 'knowledge_base',
          ref_id: 'Def567',
          doc_id: 'document-2',
          block_id: 'block-2',
          title: 'Historical document',
          snippet: '历史完整块正文',
          content_text: '历史完整块正文',
          captured_at_ms: 1,
          doc_name: 'Historical document',
        },
      ],
    });

    expect(entries).toEqual([
      {
        status: 'complete',
        item: expect.objectContaining({
          ref: 'Def567',
          capture_kind: 'knowledge_document_chunk',
          content_text: '历史完整块正文',
        }),
      },
    ]);
  });

  it('同一 ref 指向不同 Knowledge block 时报告真正冲突', async () => {
    const scope = {
      conversationId: 'conversation-knowledge-conflict',
      instanceId: 'instance-knowledge-conflict',
    };
    const createItem = (blockId: string) => ({
      ref_id: 'Ghi789',
      source_type: 'knowledge_base' as const,
      title: 'Conflicting document',
      snippet: `block ${blockId}`,
      content_text: `block ${blockId}`,
      captured_at_ms: 1,
      capture_kind: 'knowledge_document_chunk' as const,
      doc_id: 'document-conflict',
      block_id: blockId,
    });

    await saveEvidenceBundle({
      scope,
      kind: 'knowledge_evidence',
      query: 'first pointer',
      items: [createItem('block-1')],
    });
    await saveEvidenceBundle({
      scope,
      kind: 'knowledge_evidence',
      query: 'second pointer',
      items: [createItem('block-2')],
    });

    const result = await resolveEvidenceFromBundles({
      ...scope,
      refs: ['Ghi789'],
      max_units: 100,
      max_chars: 1_000,
    });

    expect(result.missing_refs).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        ref: 'Ghi789',
        ignored_bundle_ids: [expect.stringMatching(/^[a-f0-9]{16}$/)],
      }),
    ]);
  });

  it('字符硬上限只截断返回预览，不改变持久快照', async () => {
    const scope = {
      conversationId: 'conversation-evidence-budget',
      instanceId: 'instance-evidence-budget',
    };
    await saveEvidenceBundle({
      scope,
      kind: 'knowledge_evidence',
      query: 'budget',
      items: [
        {
          ref_id: 'Jkm234',
          source_type: 'knowledge_base',
          title: 'Budget document',
          snippet: 'abcdefgh',
          content_text: 'abcdefgh',
          captured_at_ms: 1,
          capture_kind: 'knowledge_document_chunk',
          doc_id: 'document-budget',
          block_id: 'block-budget',
        },
      ],
    });

    const result = await resolveEvidenceFromBundles({
      ...scope,
      refs: ['Jkm234'],
      max_units: 100,
      max_chars: 4,
    });

    expect(result.resolved['Jkm234']).toMatchObject({
      text: 'abcd',
      text_truncated: true,
    });
    expect(result.resolved['Jkm234']).not.toHaveProperty('text_full');
  });
});
