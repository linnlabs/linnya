export type { AgentContextInjection, AgentInvocationRequest } from './agent-invocation';
export type {
  CanonicalCompletedToolCall,
  CanonicalAssistantReplayPart,
  CanonicalInferenceCacheAnchor,
  CanonicalInferenceCachePolicy,
  CanonicalInferenceContentBlock,
  CanonicalInferenceEvent,
  CanonicalInferenceFailureKind,
  CanonicalInferenceFinishReason,
  CanonicalInferenceImageBlock,
  CanonicalInferenceMessage,
  CanonicalInferencePort,
  CanonicalInferenceRequest,
  CanonicalInferenceTextBlock,
  CanonicalInferenceTool,
  CanonicalToolChoice,
} from './canonical-inference';
export type {
  ProviderContinuation,
  ProviderContinuationProducer,
} from '../contracts';
export type { AuditPort } from './audit';
export type { TokenCounterPort, TokenCountResult } from './token-counter';
export type { TokenizerPort } from './tokenizer';
export type { UsageNormalizer } from './usage-normalizer';
export type {
  JsonSchemaValue,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolParameterType,
} from './tool-schema';
export type {
  ImageInputAdmissionAttachmentEvidence,
  ImageInputAdmissionEvidence,
  LlmImageInputDescriptor,
  LlmImageInputEstimate,
  LlmImageInputEstimatorPort,
  LlmImageInputPlacement,
  LlmInputMaterializationAttempt,
  LlmInputMaterializerPort,
  ResolvedLlmImageAttachment,
  ResolvedLlmInputMessage,
} from './llm-input-materialization';

/**
 * Linnkit LLM 调用参数合同。
 *
 * 归位说明（2026-04-23）：这 5 个 type 的 definitive source 原本在
 * `runtime-kernel/llm/caller.types.ts`，归位到 ports 后解决了 ports ⇄ runtime-kernel
 * 反向循环依赖。`runtime-kernel/llm/index.ts` 继续 re-export 这些 type，保证
 * `import { llm } from 'linnkit/runtime-kernel'` 后 `llm.LlmCallOptions` 的
 * namespace 访问语法不变。
 */
export type {
  LlmCallOptions,
  LlmRequestMessage,
  LlmRetryConfig,
  ToolCall,
} from './llm-call';
