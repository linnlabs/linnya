import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import {
  attachCitationRefAllocator,
  createCitationRefAllocator,
} from '../../../../domains/citation';
import { DatabaseService } from '../../../../electron-main/services/database';
import { SqliteCitationRefClaimStore } from '../persistence/citation-ref-claims/sqliteCitationRefClaimStore';
import { CITATION_PRODUCER_TOOL_NAMES } from './citationSequenceToolContextDecorator';
import { requireToolConversationScope } from './conversation-scope';

export const CITATION_REF_ALLOCATOR_TOOL_NAMES = CITATION_PRODUCER_TOOL_NAMES;

interface CitationRefAllocatorToolContext extends ToolExecutionContext {
  readonly databaseService?: DatabaseService;
}

function isCitationRefAllocatorToolContext(
  value: unknown
): value is CitationRefAllocatorToolContext {
  return typeof value === 'object' && value !== null;
}

/** 为 live producer 绑定 Conversation 级原子 ref 分配端口。 */
export function decorateCitationRefAllocatorToolContext(contextValue: unknown): void {
  if (!isCitationRefAllocatorToolContext(contextValue)) {
    throw new Error('Citation ref allocator decorator requires a ToolContext-like host object.');
  }
  if (!(contextValue.databaseService instanceof DatabaseService)) {
    throw new Error('Citation ref allocator decorator requires an initialized DatabaseService.');
  }
  const { conversationId } = requireToolConversationScope({
    context: contextValue,
    errorPrefix: '[CitationRefAllocator]',
  });
  attachCitationRefAllocator(
    contextValue,
    createCitationRefAllocator({
      conversationId,
      claimStore: new SqliteCitationRefClaimStore(contextValue.databaseService.getDb()),
    })
  );
}
