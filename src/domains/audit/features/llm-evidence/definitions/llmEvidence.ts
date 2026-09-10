import type { SerializableJsonRecord } from '@linnlabs/linnkit/contracts';

export interface LlmAuditContext {
  conversationId: string;
  runId: string;
  traceId?: string;
  subrunId?: string;
  parentToolCallId?: string;
  source?: string;
}

export interface RunTranscriptAuditToolset {
  readonly availableTools?: string[];
}

export interface LlmInputMaterializationAuditInput {
  readonly activeModelId: string;
  readonly profileId: string;
  readonly estimatorVersion: string;
  readonly apiSurface: string;
  readonly inputBudget: number;
  readonly nonImageEstimatedTokens: number;
  readonly attachmentEvidence: readonly {
    readonly messageIndex: number;
    readonly attachmentIndex: number;
    readonly id: string;
    readonly resourceId: string;
    readonly placement: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
  }[];
}

/**
 * 上游 Provider attempt 的安全终态摘要。
 *
 * 这里只允许路由身份、结束分类和 token 聚合；正文、raw usage、请求参数、header 与错误
 * message 不属于这个合同。
 */
export interface LlmResponseAuditSummaryInput {
  readonly attemptId: string;
  readonly traceId: string;
  readonly modelId: string;
  readonly endpointId: string;
  readonly endpointModelId: string;
  readonly capabilityId: string;
  readonly apiSurface: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly finishReason?: string;
  readonly failure?: {
    readonly kind: string;
    readonly code: string;
    readonly retryable: boolean;
  };
  readonly usage: {
    readonly provenance: 'provider_reported' | 'not_reported';
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly reasoningTokens?: number;
    readonly totalTokens?: number;
  };
}

/** Provider canonical stream 中允许进入最高审计等级的有界事件形状。 */
export type LlmStreamAuditEvent =
  | { readonly type: 'start'; readonly modelId: string; readonly attemptId: string }
  | { readonly type: 'answer_delta'; readonly text: string }
  | { readonly type: 'thought_delta'; readonly text: string }
  | {
      readonly type: 'tool_call_start';
      readonly index: number;
      readonly partIndex: number;
      readonly id?: string;
      readonly name?: string;
    }
  | { readonly type: 'tool_argument_delta'; readonly index: number; readonly jsonDelta: string }
  | {
      readonly type: 'tool_call_end';
      readonly index: number;
      readonly call: {
        readonly id: string;
        readonly name: string;
        readonly arguments: SerializableJsonRecord;
      };
    }
  | {
      readonly type: 'assistant_part_end';
      readonly index: number;
      readonly part: {
        readonly type: 'text' | 'reasoning';
        readonly text: string;
      };
    }
  | {
      readonly type: 'usage';
      readonly usage: {
        readonly inputTokens?: number;
        readonly outputTokens?: number;
        readonly reasoningTokens?: number;
        readonly totalTokens?: number;
        readonly source: string;
        readonly confidence: string;
      };
    }
  | { readonly type: 'finish'; readonly reason: string }
  | {
      readonly type: 'failure';
      readonly kind: string;
      readonly code: string;
      readonly retryable: boolean;
    };

export interface LlmStreamAuditEventInput {
  readonly attemptId: string;
  readonly traceId: string;
  readonly modelId: string;
  readonly event: LlmStreamAuditEvent;
}
