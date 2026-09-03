import type {
  CanonicalInferencePort,
  ResolvedLlmInputMessage,
} from '../../ports';
import type {
  CanonicalLlmUsage,
  AssistantReplayPart,
  ProviderContinuation,
} from '../../contracts';
import type { LlmCallOptions, ToolCall } from './caller.types';
import { callLlmStream } from './streaming-adapter';

/**
 * Linnkit 的统一调用结果只保留 canonical 字段。
 * Provider 原始 usage 只允许作为 canonicalUsage.rawUsage 的审计证据存在。
 */
export interface LlmCallResult {
  readonly content: string;
  readonly tool_calls?: ToolCall[];
  readonly provider_continuations?: ProviderContinuation[];
  readonly assistant_replay_parts?: AssistantReplayPart[];
  readonly canonicalUsage?: CanonicalLlmUsage;
}

export async function callPlainCompletion(
  inferencePort: CanonicalInferencePort,
  modelId: string,
  messages: ResolvedLlmInputMessage[],
  options: LlmCallOptions = {},
  signal?: AbortSignal,
  traceId?: string
): Promise<LlmCallResult> {
  return callLlmStream({
    inferencePort,
    modelId,
    messages,
    options,
    signal,
    traceId,
  });
}

export function getLlmResultContent(result: LlmCallResult): string {
  return result.content;
}

export function getLlmResultToolCalls(result: LlmCallResult): ToolCall[] | undefined {
  return result.tool_calls;
}
