import { describe, expect, it, vi } from 'vitest';
import { createToolOutputEvent } from 'linnkit/contracts';
import { KnowledgeSearchResultSchema, WebSearchResultSchema } from '@app/schemas';
import { createCitationSourceResolver } from '../orchestration/createCitationSourceResolver';
import type { ResolveEvidenceResult } from 'src/domains/evidence';

const EMPTY_EVIDENCE: ResolveEvidenceResult = {
  resolved: {},
  missing_refs: [],
  incomplete_refs: [],
  scanned_bundle_count: 0,
  scanned_bundle_files: [],
  hit_sources: {},
  conflicts: [],
};

function successEvent(
  toolName: string,
  result: { data: unknown; observation: string },
  id: string
) {
  return createToolOutputEvent(id, 'conversation-1', 'turn-1', toolName, `call_${id}`, {
    status: 'success',
    observation: result.observation,
    data: result.data,
  });
}

describe('citation source resolver', () => {
  it('复用 Conversation producer admission 读取别名工具的 Knowledge/Web 快照', async () => {
    const knowledge = KnowledgeSearchResultSchema.parse({
      data: {
        query: 'query',
        search_strategy: 'shallow',
        search_mode: 'global',
        doc_name: null,
        citations: {
          query: 'query',
          searchMode: 'global',
          citations: [
            {
              ref: 'Abc234',
              index: 1,
              sourceType: 'knowledge_base',
              docId: 'doc-1',
              blockId: 'block-1',
              docTitle: 'Knowledge title',
              snippet: 'Knowledge snapshot',
            },
          ],
        },
      },
      observation: 'knowledge result',
    });
    const web = WebSearchResultSchema.parse({
      data: {
        query: 'query',
        resultCount: 1,
        citations: {
          query: 'query',
          searchMode: 'web',
          citations: [
            {
              ref: 'Def567',
              index: 2,
              sourceType: 'web',
              url: 'https://example.com/article',
              docTitle: 'Web title',
              snippet: 'Web snapshot',
            },
          ],
        },
        evidence_store: { bundle_id: '0123456789abcdef' },
        cacheStatus: 'miss',
      },
      observation: 'web result',
    });
    const resolveEvidence = vi.fn(async () => EMPTY_EVIDENCE);
    const resolver = createCitationSourceResolver({
      events: [
        successEvent('search_in_knowledge_base', knowledge, 'knowledge'),
        successEvent('web_search', web, 'web'),
      ],
      resolveEvidence,
    });

    await expect(resolver.resolveSources(['Abc234', 'Def567'])).resolves.toEqual([
      expect.objectContaining({ sourceType: 'knowledge_base', ref: 'Abc234' }),
      expect.objectContaining({ sourceType: 'web', ref: 'Def567' }),
    ]);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });

  it('只对当前历史未命中的 ref 使用 conversation Evidence fallback', async () => {
    const resolveEvidence = vi.fn(
      async (refs: readonly string[]): Promise<ResolveEvidenceResult> => ({
        ...EMPTY_EVIDENCE,
        resolved: {
          Abc234: {
            ref: 'Abc234',
            bundle_id: '0123456789abcdef',
            instance_id: 'child-1',
            source_type: 'web',
            title: 'Evidence title',
            snippet: 'Evidence snapshot',
            url: 'https://example.com/evidence',
            text: 'Evidence snapshot',
            text_truncated: false,
          },
        },
        missing_refs: refs.filter(ref => ref !== 'Abc234'),
      })
    );
    const resolver = createCitationSourceResolver({ events: [], resolveEvidence });

    await expect(resolver.resolveSources(['Abc234'])).resolves.toEqual([
      expect.objectContaining({
        sourceType: 'web',
        ref: 'Abc234',
        url: 'https://example.com/evidence',
      }),
    ]);
    expect(resolveEvidence).toHaveBeenCalledWith(['Abc234']);
  });

  it('从 RuntimeEvent 的 read_file owner data 复用文档持久化引用快照', async () => {
    const event = createToolOutputEvent(
      'read-file',
      'conversation-1',
      'turn-1',
      'read_file',
      'call_read_file',
      {
        status: 'success',
        observation: 'document body [@Abc234]',
        data: {
          path: '/report.md',
          inode: 'workspace:doc-1',
          content_type: 'text/markdown',
          node: {
            name: 'report.md',
            path: '/report.md',
            inode: 'workspace:doc-1',
            type: 'document',
            source: 'workspace_node',
            is_virtual: false,
            parent_id: null,
            updated_at: 0,
          },
          offset: 0,
          limit: 100,
          truncated: false,
          has_more: false,
          citations: {
            citations: [
              {
                sourceType: 'knowledge_base',
                ref: 'Abc234',
                index: 1,
                docId: 'knowledge-doc-1',
                blockId: 'block-1',
                docTitle: 'Persisted source',
                snippet: 'Persisted snapshot',
              },
            ],
          },
          citation_diagnostics: [],
        },
      }
    );
    const resolveEvidence = vi.fn(async () => EMPTY_EVIDENCE);
    const resolver = createCitationSourceResolver({
      events: [event],
      resolveEvidence,
    });

    await expect(resolver.resolveSources(['Abc234'])).resolves.toEqual([
      expect.objectContaining({
        sourceType: 'knowledge_base',
        ref: 'Abc234',
        docId: 'knowledge-doc-1',
        blockId: 'block-1',
        snippet: 'Persisted snapshot',
      }),
    ]);
    expect(resolveEvidence).not.toHaveBeenCalled();
  });

  it('合法的会话图片 read_file 不是 citation producer，也不会破坏后续写入', async () => {
    const event = createToolOutputEvent(
      'read-image',
      'conversation-1',
      'turn-1',
      'read_file',
      'call_read_image',
      {
        status: 'success',
        observation: '图片已回流模型。',
        data: {
          source: 'conversation_file',
          path: 'images/source.png',
          relative_path: 'images/source.png',
          file_name: 'source.png',
          content_type: 'image/png',
        },
      }
    );
    const resolveEvidence = vi.fn(async () => EMPTY_EVIDENCE);
    const resolver = createCitationSourceResolver({
      events: [event],
      resolveEvidence,
    });

    await expect(resolver.resolveSources(['Abc234'])).rejects.toThrow('无法验证引用');
    expect(resolveEvidence).toHaveBeenCalledWith(['Abc234']);
  });

  it('producer 合同损坏或 Evidence 冲突时明确失败', async () => {
    const brokenEvent = createToolOutputEvent(
      'broken',
      'conversation-1',
      'turn-1',
      'web_search',
      'call_broken',
      { status: 'success', observation: 'broken', data: { citations: {} } }
    );
    const brokenResolver = createCitationSourceResolver({
      events: [brokenEvent],
      resolveEvidence: async () => EMPTY_EVIDENCE,
    });
    await expect(brokenResolver.resolveSources(['Abc234'])).rejects.toThrow();

    const conflictResolver = createCitationSourceResolver({
      events: [],
      resolveEvidence: async () => ({
        ...EMPTY_EVIDENCE,
        conflicts: [
          {
            ref: 'Abc234',
            kept_bundle_id: '0123456789abcdef',
            kept_instance_id: 'agent-1',
            ignored_bundle_ids: ['fedcba9876543210'],
            ignored_instance_ids: ['agent-2'],
          },
        ],
      }),
    });
    await expect(conflictResolver.resolveSources(['Abc234'])).rejects.toThrow('冲突引用');
  });
});
