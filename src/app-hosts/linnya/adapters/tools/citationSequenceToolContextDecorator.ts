import type { ToolExecutionContext } from 'linnkit/runtime-kernel';
import { readToolContextWorkingHistory } from 'linnkit/runtime-kernel';
import {
  attachCitationSequence,
  computeTurnCitationOffset,
} from '../../../../domains/citation';

/** 只有正式产出 canonical citations 的工具需要 Citation domain admission。 */
export const CITATION_PRODUCER_TOOL_NAMES = [
  'knowledge_search',
  'search_in_knowledgebase',
  'knowledge_read',
  'web_search',
  'web_read',
  'read_file',
] as const;

function isToolExecutionContext(value: unknown): value is ToolExecutionContext {
  return typeof value === 'object' && value !== null;
}

/**
 * 把 Linnkit 的通用 conversation view 适配为 Linnya Citation domain 的生产顺序。
 * 每次调用都从 working history 重算，child run 因而天然使用自己的 turn 和事件视图。
 */
export function decorateCitationSequenceToolContext(contextValue: unknown): void {
  if (!isToolExecutionContext(contextValue)) {
    throw new Error('Citation sequence decorator requires a ToolContext-like host object.');
  }
  const turnId = contextValue.turnId?.trim();
  if (!turnId) {
    throw new Error('Citation sequence decorator requires an admitted turnId.');
  }
  const events = readToolContextWorkingHistory(contextValue);
  attachCitationSequence(contextValue, {
    offset: computeTurnCitationOffset(events, turnId),
  });
}
