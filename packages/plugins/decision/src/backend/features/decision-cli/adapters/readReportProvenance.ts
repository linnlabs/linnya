import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import { readCurrentRunInputQuote } from '@plugin/backend/runInputQuote';
import type { DecisionReportProvenance } from '../../../../shared';
import { DecisionFailure } from '../../decision-record';

export async function readReportProvenance(context: BackendPluginCliExecutionContext, quote: string | undefined): Promise<DecisionReportProvenance> {
  if (!context.conversationId || !context.agentRunId) {
    throw new DecisionFailure('invalid_model', 'Reporting an action requires an active Agent run identity from the Host.');
  }
  if (quote !== undefined) return { kind: 'conversation_input_quote', input: await readCurrentRunInputQuote(context, quote) };
  return { kind: 'agent_report', conversationId: context.conversationId, agentRunId: context.agentRunId };
}
