import type { RunInputQuote } from '@app/schemas';
import type { BackendPluginCliExecutionContext } from './pluginCli';
export type { RunInputQuote } from '@app/schemas';

export declare class RunInputQuoteError extends Error {
  readonly code: 'unavailable' | 'invalid_quote' | 'quote_mismatch';
}

/** 仅当前已授权root的原输入；不接受调用者选择历史事件或借用其他run。 */
export declare function readCurrentRunInputQuote(context: BackendPluginCliExecutionContext, quote: string): Promise<RunInputQuote>;
