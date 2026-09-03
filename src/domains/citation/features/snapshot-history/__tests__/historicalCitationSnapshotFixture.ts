import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  CitationSnapshotBundleRecordV1Schema,
  type CitationSnapshotBundleRecordV1,
  type HistoricalKnowledgeSearchResult,
} from '@app/schemas';
import { pathManager } from '../../../../../shared/utils/pathManager';

/** 只供本 feature 验证已停止生产的 CitationSnapshot 历史记录。 */
export async function writeHistoricalCitationSnapshotFixture(params: {
  readonly conversationId: string;
  readonly instanceId: string;
  readonly turnId?: string;
  readonly toolCallId?: string;
  readonly query: string;
  readonly args?: CitationSnapshotBundleRecordV1['args'];
  readonly result: HistoricalKnowledgeSearchResult;
}): Promise<{ bundleId: string; filePath: string }> {
  const bundleId = createHash('sha256')
    .update(JSON.stringify({
      conversationId: params.conversationId,
      query: params.query,
      result: params.result,
    }))
    .digest('hex')
    .slice(0, 16);
  const record = CitationSnapshotBundleRecordV1Schema.parse({
    version: 1,
    kind: 'citation_snapshot',
    created_at_ms: Date.now(),
    conversation_id: params.conversationId,
    turn_id: params.turnId,
    tool_call_id: params.toolCallId,
    tool_name: 'search_knowledge_base',
    query: params.query,
    args: params.args,
    citations: params.result.data.citations.citations.map(citation => ({
      ...citation,
      sourceType: 'knowledge_base' as const,
    })),
    result: params.result,
  });
  const filePath = pathManager.getConversationCitationSnapshotBundleFilePath({
    conversationId: params.conversationId,
    instanceId: params.instanceId,
    bundleId,
  });
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return { bundleId, filePath };
}
