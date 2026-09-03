import type { CitationRefAllocatorPort } from '../../../../domains/citation';

export interface AgentKnowledgeSearchHit {
  readonly ref: string;
  readonly docId: string;
  readonly blockId: string;
  readonly docName: string;
  readonly snippet: string;
  readonly pageNumber?: number;
}

export interface AgentKnowledgeSearchOutput {
  readonly observation: string;
  readonly hits: readonly AgentKnowledgeSearchHit[];
}

interface AgentKnowledgeSearchEvidence {
  readonly docId: string;
  readonly blockId: string;
  readonly docName: string;
  readonly snippet: string;
  readonly pageNumber?: number;
}

function readRequiredString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  index: number
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Knowledge search result[${index}] requires non-empty ${field}`);
  }
  return value;
}

/**
 * 检索层的 Python-compatible payload 只允许在应用边界解释一次。
 * observation formatter 与工具结构化结果必须共同消费这组已校验事实，禁止再从文本反解析。
 */
function projectAgentKnowledgeSearchEvidence(
  records: readonly Readonly<Record<string, unknown>>[]
): AgentKnowledgeSearchEvidence[] {
  return records.map((record, index) => {
    const docId = readRequiredString(record, 'doc_id', index);
    const blockId = readRequiredString(record, 'block_id', index);
    const docName = readRequiredString(record, 'doc_title', index);
    const snippet = readRequiredString(record, 'document', index);
    const pageNumber = record['page_number'];
    if (
      pageNumber !== undefined &&
      (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || pageNumber <= 0)
    ) {
      throw new Error(`Knowledge search result[${index}] has invalid page_number`);
    }
    return {
      docId,
      blockId,
      docName,
      snippet,
      ...(typeof pageNumber === 'number' ? { pageNumber } : {}),
    };
  });
}

/** 搜索应用层一次性接纳 refs；observation 与结构化工具结果共同消费这组事实。 */
export async function allocateAgentKnowledgeSearchEvidence(
  records: readonly Readonly<Record<string, unknown>>[],
  allocator: CitationRefAllocatorPort
): Promise<{
  readonly refs: readonly string[];
  readonly hits: readonly AgentKnowledgeSearchHit[];
}> {
  const evidence = projectAgentKnowledgeSearchEvidence(records);
  const refs = await allocator.allocate(
    evidence.map(hit => ({
      sourceType: 'knowledge_base' as const,
      docId: hit.docId,
      blockId: hit.blockId,
    }))
  );
  if (refs.length !== evidence.length) {
    throw new Error('Knowledge citation allocator returned a misaligned batch.');
  }
  return {
    refs,
    hits: evidence.map((hit, index) => {
      const ref = refs[index];
      if (!ref) throw new Error('Knowledge citation allocator returned an incomplete batch.');
      return { ref, ...hit };
    }),
  };
}
