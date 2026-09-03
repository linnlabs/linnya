import type { LlmRequestMessage } from './llm-call';

export type LlmImageInputPlacement = 'user_image' | 'tool_result_image';

/**
 * 图片估算只需要 durable 元数据，不允许 Context Manager 读取文件或 host route 配置。
 */
export interface LlmImageInputDescriptor {
  readonly id: string;
  readonly resourceId: string;
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly placement: LlmImageInputPlacement;
}

export interface LlmImageInputEstimate {
  readonly estimatedTokens: number;
  readonly profileId: string;
  readonly estimatorVersion: string;
}

export interface LlmImageInputEstimatorPort {
  estimateImageInput(
    activeModelId: string,
    descriptor: LlmImageInputDescriptor,
  ): LlmImageInputEstimate;
}

export interface ImageInputAdmissionAttachmentEvidence {
  readonly messageIndex: number;
  readonly attachmentIndex: number;
  readonly id: string;
  readonly resourceId: string;
  readonly placement: LlmImageInputPlacement;
  readonly estimatedTokens: number;
}

/**
 * Context Manager 的短生命周期输出。fallback 只能据此复核预算，不能从 trace 反推输入。
 */
export interface ImageInputAdmissionEvidence {
  readonly inputBudget: number;
  readonly nonImageEstimatedTokens: number;
  readonly initialProfileId: string;
  readonly attachments: readonly ImageInputAdmissionAttachmentEvidence[];
}

export interface ResolvedLlmImageAttachment {
  readonly id: string;
  readonly resourceId: string;
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly placement: LlmImageInputPlacement;
  readonly bytes: Uint8Array;
}

type ReplaceDurableAttachments<T> = T extends { attachments?: unknown }
  ? Omit<T, 'attachments'> & { readonly attachments?: readonly ResolvedLlmImageAttachment[] }
  : T;

/**
 * Canonical inference request builder 的短生命周期输入。该类型不能进入 durable event、context state 或 audit schema。
 */
export type ResolvedLlmInputMessage = ReplaceDurableAttachments<LlmRequestMessage>;

export interface LlmInputMaterializationAttempt {
  readonly activeModelId: string;
  readonly messages: readonly LlmRequestMessage[];
  readonly admissionEvidence: ImageInputAdmissionEvidence;
}

export interface LlmInputMaterializerPort {
  materialize(attempt: LlmInputMaterializationAttempt): Promise<ResolvedLlmInputMessage[]>;
}
