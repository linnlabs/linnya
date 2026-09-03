/**
 * @file packages/linnkit/src/ports/llm-call.ts
 * @description
 * Linnkit LLM 调用合同的 owner。
 *
 * `LlmRequestMessage` 是 Context Manager 交给 `LlmCaller` 的 durable 输入；
 * `LlmCallOptions` 与 `LlmRetryConfig` 只表达 Linnkit 已经决定的调用策略。
 * Provider 请求与结构化 stream 的正式 Host 合同由 `CanonicalInferencePort` 拥有。
 *
 * continuation 约束：
 * - `ProviderContinuation` 的事实 owner 是 contracts：它出现在 provider port 响应中，
 *   并绑定到 `AiMessage.metadata.assistant_replay_parts` 的所属 part 回放；
 * - 每项都必须携带 producer route identity，禁止 durable 层保存匿名 sidecar。
 *
 * 约定：
 * - 本文件**只放类型定义**，不包含业务逻辑；
 * - 供 ports / runtime-kernel / testkit / 外部 host 共享引用。
 */

import type {
  AiMessage,
  AssistantReplayPart,
  ProviderContinuation,
  RuntimeResourceRef,
} from '../contracts';
import type {
  CanonicalInferenceCachePolicy,
  CanonicalInferenceTool,
  CanonicalToolChoice,
} from './canonical-inference';

export type { ProviderContinuation } from '../contracts';

/** Runtime 内部持久化和工具执行使用的工具调用结果。 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type LlmRequestMessage =
  | AiMessage
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: RuntimeResourceRef[] }
  | { role: 'assistant'; content: string; assistant_replay_parts?: AssistantReplayPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: unknown[];
      provider_continuations?: ProviderContinuation[];
      assistant_replay_parts?: AssistantReplayPart[];
    }
  | { role: 'tool'; tool_call_id: string; content: string; attachments?: RuntimeResourceRef[] };

export interface LlmCallOptions {
  tools?: CanonicalInferenceTool[];
  /** Provider 无关的稳定前缀断点；不支持显式缓存的 adapter 可以忽略。 */
  cache_policy?: CanonicalInferenceCachePolicy;
  /**
   * 工具选择策略（Linnkit canonical inference 语义）
   *
   * 说明：
   * - 'auto' / 'none'：常见 provider 统一语义；
 * - {type:'tool', name}：强制调用指定工具（用于步数收尾策略 force_tools 等）。
   * Provider 的私有字段由 Host adapter 映射，不能进入内核。
   */
  tool_choice?: CanonicalToolChoice;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  /**
   * 重试策略（仅影响客户端侧 `LlmCaller.callWithRetries`）。
   *
   * 背景（中文说明）：
   * - BYOK（本地直连）模式下，客户端重试是合理的：成本由用户自带 key 承担；
   * - Cloud（积分计费）模式下，客户端重试会导致"一次点击一个 request_id"的账单语义被破坏，
   *   因为同一次点击可能触发多次上游调用，造成对账困难或平台资损。
   *
   * 约定：
   * - `client`：允许客户端按本地 retryConfig 重试（默认）；
   * - `none`：强制不重试（只执行一次，失败直接返回错误）。Cloud 模式推荐使用该值或在模型配置中关闭客户端重试。
   */
  retry_policy?: 'client' | 'none';

  /**
   * 是否允许 LLM 层在一次调用失败后自动切换到其它模型。
   *
   * 中文说明：
   * - `false` 用于固定模型语义：模型不可用时应直接暴露失败，不能被 policy switch
   *   或 cloud quota fallback 掩盖。
   * - 未设置时保持历史行为，由 retry/fallback 层按策略决定是否切模型。
   */
  allow_model_fallback?: boolean;

  /**
   * 云端模型限额降级目标（同一个 run 内续跑专用）
   *
   * 中文说明：
   * - 仅当"同一个 run 内已经不是第一次 LLM 调用"时由上层传入；
   * - 如果本次 LLM 调用因为云端 quota/限额被拒，LlmCaller 会静默切到该模型继续，
   *   不向前端发 error 事件（前端无感知）；
   * - 若为 undefined 或空字符串，则 quota 错误仍按"不可重试"处理（即新请求直接报错）。
   */
  cloud_quota_fallback_model_id?: string;
  /**
   * 思考努力程度（统一语义，prepareCallStage 已降级后的最终档位）。
   * adapter 负责翻译为 provider 原生字段，不得原样进入请求体。
   */
  reasoning_effort?: import('../contracts').ReasoningEffort;
}

export interface LlmRetryConfig {
  maxRetries: number;
  /**
   * 单次 LLM 编排允许触发的真实上游调用总数。
   *
   * 中文备注：
   * - `maxRetries` 只表达“同一模型失败后的客户端重试次数”；
   * - `maxTotalAttempts` 额外覆盖 policy switch / cloud quota fallback 造成的切模型调用，
   *   避免多级 fallback 绕开 retry 配额。
   */
  maxTotalAttempts?: number;
  enableEmptyResponseRetry: boolean;
  retryDelayMs: number;
}
