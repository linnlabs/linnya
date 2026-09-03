import { readToolContextWorkingHistory } from 'linnkit/runtime-kernel';
import type { ToolExecutionContext } from 'linnkit/runtime-kernel';
import {
  attachCitationSourceResolver,
} from '../../../../domains/citation';
import { resolveEvidenceFromBundles } from '../../../../domains/evidence';
import {
  assertToolConversationScopeContext,
  requireToolConversationScope,
} from './conversation-scope';
import { createCitationSourceResolver } from './citation-source-resolution/orchestration/createCitationSourceResolver';

export const DOCUMENT_CITATION_WRITE_TOOL_NAMES = ['write_file', 'edit_file'] as const;

function isToolExecutionContext(value: unknown): value is ToolExecutionContext {
  return typeof value === 'object' && value !== null;
}

/** 为 Workspace 写工具绑定当前 conversation 的严格 Citation 来源 provider。 */
export function decorateDocumentCitationWriteToolContext(contextValue: unknown): void {
  if (!isToolExecutionContext(contextValue)) {
    throw new Error('Document citation write decorator requires a ToolContext-like host object.');
  }
  assertToolConversationScopeContext(contextValue, '[DocumentCitationWrite]');
  const events = readToolContextWorkingHistory(contextValue);
  attachCitationSourceResolver(
    contextValue,
    createCitationSourceResolver({
      events,
      async resolveEvidence(refs) {
        const { conversationId, instanceId } = requireToolConversationScope({
          context: contextValue,
          errorPrefix: '[DocumentCitationWrite]',
        });
        return resolveEvidenceFromBundles({
          conversationId,
          instanceId,
          scope: 'conversation',
          refs: [...refs],
          max_units: 500,
          max_chars: 500,
        });
      },
    })
  );
}
