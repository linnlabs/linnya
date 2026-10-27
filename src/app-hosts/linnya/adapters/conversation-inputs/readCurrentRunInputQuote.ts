import type { BackendPluginCliExecutionContext } from '@linnya/plugin-host-contract/backend/pluginCli';
import type { ToolContext } from 'src/tools/types';
import { SQLiteEventStore } from '../persistence/event-store';
import { SqliteRunDescriptorStore } from '../persistence/run-descriptors';
import { readCurrentRunInputQuoteUseCase, RunInputQuoteError } from '../../application/run-input-provenance';

function hasDatabase(value: unknown): value is Pick<ToolContext, 'databaseService'> {
  return typeof value === 'object' && value !== null && 'databaseService' in value
    && typeof value.databaseService === 'object' && value.databaseService !== null
    && 'getDb' in value.databaseService && typeof value.databaseService.getDb === 'function';
}

export async function readCurrentRunInputQuote(context: BackendPluginCliExecutionContext, quote: string) {
  const { conversationId, agentRunId, projectId } = context;
  if (!hasDatabase(context.hostContext) || !context.hostContext.databaseService || !conversationId || !agentRunId || !projectId) {
    throw new RunInputQuoteError('unavailable', 'Input quoting requires an admitted internal-data context and a project root run.');
  }
  const db = context.hostContext.databaseService.getDb();
  const metadata = await new SQLiteEventStore(db).getConversationMetadata(conversationId);
  if (metadata?.project_id !== projectId) throw new RunInputQuoteError('unavailable', 'Input quote project scope does not match the conversation.');
  return readCurrentRunInputQuoteUseCase({
    conversationId, agentRunId, quote, signal: context.signal,
    store: new SqliteRunDescriptorStore(db),
  });
}
