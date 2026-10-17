import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { resolveEvidenceFromBundles } from 'src/domains/evidence';
import { requireToolConversationScope } from './conversation-scope';
import {
  attachWebSearchAcquisitions,
  attachWebSearchSnapshotReader,
  type WebSearchAcquisition,
} from 'src/tools/web/websearch/deep/ports/webSearchSnapshotReader';
import { readToolContextWorkingHistory } from '@linnlabs/linnkit/runtime-kernel';

export function decorateDeepWebSnapshotToolContext(context: ToolExecutionContext): void {
  const scope = requireToolConversationScope({ context, errorPrefix: '[DeepWebSnapshot]' });
  attachWebSearchSnapshotReader(context, {
    async read(bundleId, ref) {
      const result = await resolveEvidenceFromBundles({
        ...scope,
        refs: [ref],
        bundle_id: bundleId,
        max_units: 100000,
        max_chars: 100000,
      });
      const item = result.resolved[ref];
      if (
        !item ||
        item.source_type !== 'web' ||
        !item.url ||
        (item.capture_kind !== 'web_page' && item.capture_kind !== 'web_search_result' && item.capture_kind !== 'web_file') ||
        result.conflicts.length ||
        result.incomplete_refs.length
      ) {
        throw new Error('Selected web capture is unavailable or invalid');
      }
      return { text: item.text, url: item.url, captureKind: item.capture_kind };
    },
  });
  const acquisitions: WebSearchAcquisition[] = [];
  for (const event of readToolContextWorkingHistory(context)) {
    if (
      event.type !== 'tool_output' ||
      (event.tool_name !== 'search_web' && event.tool_name !== 'web_read')
    )
      continue;
    acquisitions.push({
      toolName: event.tool_name,
      callId: event.tool_call_id,
      status: event.status,
      ...(event.data !== undefined ? { data: event.data } : {}),
      observation: event.observation,
      timestamp: event.timestamp,
    });
  }
  attachWebSearchAcquisitions(context, { list: () => acquisitions });
}
