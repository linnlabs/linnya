import { createHash } from 'node:crypto';
import { requireToolConversationScope } from 'src/app-hosts/linnya/adapters/tools/conversation-scope';
import type { ToolContext } from '../../../../types';
import type { WebEvidenceCaptureItem } from '../../definitions/webEvidenceCapture';
import type { WebEvidenceWriter } from '../../ports/webEvidenceWriter';
import type { WebCacheRuntime } from '../webCacheFactory';

function createEvidenceKey(params: {
  runtime: WebCacheRuntime;
  context: ToolContext;
  query: string;
  summary?: string;
  items: readonly WebEvidenceCaptureItem[];
}): string {
  const scope = requireToolConversationScope({
    context: params.context,
    errorPrefix: '[web_evidence_cache]',
  });
  const contentIdentity = params.items.map((item) => ({
    ref: item.ref,
    canonicalUrl: item.canonicalUrl,
    captureKind: item.captureKind,
    contentHash: createHash('sha256').update(item.contentText).digest('hex'),
  }));
  return JSON.stringify({
    namespace: params.runtime.cache.namespace,
    conversationId: scope.conversationId,
    instanceId: scope.instanceId,
    turnId: params.context.turnId ?? null,
    parentToolCallId: params.context.parentToolCallId ?? null,
    query: params.query,
    summary: params.summary ?? null,
    items: contentIdentity,
  });
}

/** 只在同一 artifact scope 与同一次工具执行语义内合并相同 Evidence 写入。 */
export async function saveEvidenceWithInFlight(params: {
  runtime: WebCacheRuntime;
  writer: WebEvidenceWriter;
  context: ToolContext;
  query: string;
  summary?: string;
  items: readonly WebEvidenceCaptureItem[];
}): Promise<{ bundleId: string }> {
  const key = createEvidenceKey(params);
  const result = await params.runtime.evidenceWrites.run(
    key,
    params.context.abortSignal,
    async () => params.writer.save({
      query: params.query,
      summary: params.summary,
      items: params.items,
    }),
  );
  return result.value;
}
