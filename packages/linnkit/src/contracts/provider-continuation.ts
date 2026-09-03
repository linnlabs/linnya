import { z } from 'zod';

import { SerializableJsonValue } from './json';

const NonBlankIdentity = z.string().trim().min(1);

/**
 * 生成 Provider 私有 continuation 的完整调用身份。
 *
 * continuation 只能回放给完全相同的 route；当前选中模型不能证明历史数据的来源。
 */
export const ProviderContinuationProducer = z
  .object({
    model_id: NonBlankIdentity,
    endpoint_id: NonBlankIdentity,
    api_surface: NonBlankIdentity,
    capability_id: NonBlankIdentity,
    endpoint_model_id: NonBlankIdentity,
  })
  .strict();

export type ProviderContinuationProducer = z.infer<typeof ProviderContinuationProducer>;

/** Provider 返回、下一轮请求需要原样回放的最小持久化载荷。 */
export const ProviderContinuation = z
  .object({
    schema_version: z.literal(2),
    producer: ProviderContinuationProducer,
    kind: NonBlankIdentity,
    payload: SerializableJsonValue,
  })
  .strict();

export type ProviderContinuation = z.infer<typeof ProviderContinuation>;

export const ProviderContinuations = z.array(ProviderContinuation);
export type ProviderContinuations = z.infer<typeof ProviderContinuations>;

/**
 * 一次 Assistant 产出的有序 replay 结构。
 *
 * 正文、reasoning 与工具调用必须共享同一个顺序容器；否则分别持久化后无法还原
 * Provider 原始 content block 顺序。continuation 仍是 opaque 数据，只绑定到所属 part。
 */
export const AssistantReplayPart = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().min(1),
    provider_continuations: ProviderContinuations.min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
    provider_continuations: ProviderContinuations.min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal('tool_call'),
    tool_call_id: z.string().trim().min(1),
    provider_continuations: ProviderContinuations.min(1).optional(),
  }).strict(),
]);

export type AssistantReplayPart = z.infer<typeof AssistantReplayPart>;

export const AssistantReplayParts = z.array(AssistantReplayPart).min(1);
export type AssistantReplayParts = z.infer<typeof AssistantReplayParts>;
