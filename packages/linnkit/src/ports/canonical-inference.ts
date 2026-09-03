import type {
  CanonicalLlmUsage,
  ProviderContinuation,
  SerializableJsonValue,
} from '../contracts';
import type { ToolParameterSchema } from './tool-schema';

export interface CanonicalInferenceTextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface CanonicalInferenceImageBlock {
  readonly type: 'image';
  readonly media_type: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly bytes: Uint8Array;
}

export type CanonicalInferenceContentBlock =
  | CanonicalInferenceTextBlock
  | CanonicalInferenceImageBlock;

export interface CanonicalCompletedToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, SerializableJsonValue>;
  readonly continuation?: readonly ProviderContinuation[];
}

export type CanonicalAssistantReplayPart =
  | {
      readonly type: 'text';
      readonly text: string;
      readonly continuation?: readonly ProviderContinuation[];
    }
  | {
      readonly type: 'reasoning';
      readonly text: string;
      readonly continuation?: readonly ProviderContinuation[];
    }
  | {
      readonly type: 'tool_call';
      readonly call: CanonicalCompletedToolCall;
    };

export type CanonicalInferenceMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: readonly CanonicalInferenceContentBlock[] }
  | {
      readonly role: 'assistant';
      readonly parts: readonly CanonicalAssistantReplayPart[];
    }
  | {
      readonly role: 'tool';
      readonly tool_call_id: string;
      readonly content: readonly CanonicalInferenceContentBlock[];
    };

export interface CanonicalInferenceTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
}

export type CanonicalToolChoice =
  | 'auto'
  | 'none'
  | { readonly type: 'tool'; readonly name: string };

export type CanonicalInferenceCacheAnchor =
  | 'end_of_system_prompt'
  | 'end_of_history_summary';

export interface CanonicalInferenceCachePolicy {
  /**
   * Linnkit 只声明稳定前缀在 canonical messages 中的结束位置。
   * Provider adapter 可以投影为原生断点；不支持显式断点时必须忽略，不能改变请求语义。
   */
  readonly breakpoints: readonly {
    readonly anchor: CanonicalInferenceCacheAnchor;
    readonly message_index: number;
  }[];
}

export interface CanonicalInferenceRequest {
  readonly model_id: string;
  readonly messages: readonly CanonicalInferenceMessage[];
  readonly tools: readonly CanonicalInferenceTool[];
  readonly tool_choice: CanonicalToolChoice;
  readonly cache_policy?: CanonicalInferenceCachePolicy;
  readonly sampling: {
    readonly temperature?: number;
    readonly top_p?: number;
    readonly max_output_tokens?: number;
    readonly reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  };
  readonly signal?: AbortSignal;
  readonly invocation: {
    readonly trace_id: string;
    readonly attempt_id: string;
  };
}

export type CanonicalInferenceFinishReason = 'stop' | 'length' | 'tool_use' | 'content_filter';

export type CanonicalInferenceFailureKind = 'aborted' | 'transport' | 'provider' | 'protocol';

export type CanonicalInferenceEvent =
  | { readonly type: 'start'; readonly model_id: string; readonly attempt_id: string }
  | { readonly type: 'answer_delta'; readonly text: string }
  | { readonly type: 'thought_delta'; readonly text: string }
  | {
      readonly type: 'tool_call_start';
      readonly index: number;
      /** 当前 Assistant 产出内跨 text/reasoning/tool 的全局 part 顺序。 */
      readonly part_index: number;
      readonly id?: string;
      readonly name?: string;
    }
  | { readonly type: 'tool_argument_delta'; readonly index: number; readonly json_delta: string }
  | {
      readonly type: 'tool_call_end';
      readonly index: number;
      readonly call: CanonicalCompletedToolCall;
    }
  | {
      readonly type: 'assistant_part_end';
      readonly index: number;
      readonly part: Exclude<CanonicalAssistantReplayPart, { readonly type: 'tool_call' }>;
    }
  | { readonly type: 'usage'; readonly usage: CanonicalLlmUsage }
  | { readonly type: 'finish'; readonly reason: CanonicalInferenceFinishReason }
  | {
      readonly type: 'failure';
      readonly kind: CanonicalInferenceFailureKind;
      readonly code: string;
      readonly retryable: boolean;
    };

export interface CanonicalInferencePort {
  stream(request: CanonicalInferenceRequest): AsyncIterable<CanonicalInferenceEvent>;
}
