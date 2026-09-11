import type { ToolContext } from '../../types';
import type { ToolOwnerResultCommit } from '../../../app-hosts/linnya/application/run-resumption';

/** 仅由确认具备同事务能力的 document provider 调用 prepare / commit。 */
export function createFileToolResultCommit<T>(
  context: ToolContext,
  toolName: string,
  serialize: (result: T) => string
): ToolOwnerResultCommit<T> | undefined {
  const receipts = context.toolResultReceipts;
  if (!receipts) return undefined;
  const callId = context.parentToolCallId;
  if (!callId) throw new Error('Durable file mutation requires its original tool call identity');
  return {
    prepare: () => receipts.prepare(callId, toolName),
    commit: result => receipts.commit(callId, toolName, serialize(result)),
  };
}
