import type { BackendPluginCliExecutionContext } from '@linnya/plugin-host-contract/backend/pluginCli';
export type { RunInputQuote } from '@linnya/plugin-host-contract/backend/runInputQuote';
export { RunInputQuoteError } from '../../app-hosts/linnya/application/run-input-provenance';

export async function readCurrentRunInputQuote(context: BackendPluginCliExecutionContext, quote: string) {
  const { readCurrentRunInputQuote: read } = await import('../../app-hosts/linnya/adapters/conversation-inputs/readCurrentRunInputQuote');
  return read(context, quote);
}
