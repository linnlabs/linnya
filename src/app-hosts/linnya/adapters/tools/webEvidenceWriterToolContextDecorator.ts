import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { attachWebEvidenceWriter } from '../../../../tools/web/shared/orchestration/webEvidenceWriterContext';
import { saveEvidenceBundleFromToolContext } from '../../../../tools/evidence/evidenceBundleToolContextAdapter';
import { assertToolConversationScopeContext } from './conversation-scope';

/** 只有会产生 Web capture 的工具需要 Evidence writer。 */
export const WEB_EVIDENCE_PRODUCER_TOOL_NAMES = ['web_search', 'web_read'] as const;

function isToolExecutionContext(value: unknown): value is ToolExecutionContext {
  return typeof value === 'object' && value !== null;
}

/**
 * 在 Host 组合边界把 Web owner DTO 映射为 Evidence write command。
 * Web 不需要认识 Evidence 的存储字段或 ToolContext scope 投影。
 */
export function decorateWebEvidenceWriterToolContext(contextValue: unknown): void {
  if (!isToolExecutionContext(contextValue)) {
    throw new Error('Web evidence writer decorator requires a ToolContext-like host object.');
  }
  assertToolConversationScopeContext(contextValue, '[WebEvidenceWriter]');
  attachWebEvidenceWriter(contextValue, {
    async save(params) {
      const { bundleId } = await saveEvidenceBundleFromToolContext({
        context: contextValue,
        kind: 'web_evidence',
        query: params.query,
        summary: params.summary,
        items: params.items.map((item) => ({
          ref_id: item.ref,
          source_type: 'web',
          title: item.title,
          snippet: item.snippet,
          content_text: item.contentText,
          captured_at_ms: item.capturedAtMs,
          url: item.url,
          normalized_url: item.canonicalUrl,
          ...(item.siteName ? { site_name: item.siteName } : {}),
          ...(item.publishedAt ? { published_at: item.publishedAt } : {}),
          capture_kind: item.captureKind,
        })),
      });
      return { bundleId };
    },
  });
}
