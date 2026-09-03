/**
 * @file packages/linnkit/src/runtime-kernel/enrichment/types.ts
 * @description 请求增强器（Request Enricher）接口定义
 *
 * 核心目标：
 * - 将 host 特定的请求补全逻辑从主循环剥离
 * - 提供统一的扩展点，主循环只负责调度，不感知具体业务
 */

import type { AgentInvocationRequest } from '../../ports';
import type { RunContext } from '../run-context/types';
import type { ToolContextPatch } from '../tools/toolContextPatch';

export interface EnrichmentContext {
  /**
   * 当前会话 ID
   *
   * 中文备注：
   * - RequestEnricher 的目标是"把业务特定逻辑从主循环剥离"，但它仍然是"针对某个会话的增强"；
   * - host workflow 可能需要按会话读取或写入自己的状态，
   *   因此把 conversationId 纳入 enrichment 上下文是结构性必需条件；
   * - 该字段是运行期上下文，不属于模型输入。
   */
  conversationId: string;
  /** 原始请求；runtime 只依赖 AgentInvocationRequest 协议面。 */
  request: AgentInvocationRequest;
  /** 当前运行上下文 */
  runContext: RunContext;
}

export interface EnrichmentResult {
  /**
   * 增强后的请求对象（例如补全 host 注册字段）
   * - 如果不需要修改，可返回原对象
   */
  request: AgentInvocationRequest;

  /**
   * 需要注入到 ToolContext 的额外数据
   * - 例如 host 工具执行所需的窄元信息
   * - 这些数据仅工具可见，模型不可见
   */
  toolContextPatch?: ToolContextPatch;

  /**
   * 对 RunContext 的更新（可选）
   * - 例如：业务层解析出了更准确的 traceId 或 tags
   */
  runContextPatch?: Partial<RunContext>;
}

/**
 * Registry 输出的最终增强结果
 *
 * 说明：
 * - `RequestEnricher.enrich()` 返回 patch（增量）
 * - Registry 会把所有 patch 串行合并，并返回最终的 `runContext`
 */
export interface RegistryEnrichmentResult {
  request: AgentInvocationRequest;
  toolContextPatch?: ToolContextPatch;
  runContext: RunContext;
}

/**
 * 请求增强器接口
 *
 * 中文备注：
 * - runtime 层只依赖 AgentInvocationRequest 协议面；
   * - host enricher 可以接收结构上满足该协议的更丰富请求；
   * - 访问 host 字段前必须在适配边界完成显式校验和窄化。
 */
export interface RequestEnricher {
  /** 增强器名称（用于调试/日志） */
  name: string;

  /**
   * 判断该增强器是否适用于当前请求
   * - 通常基于 promptKey 或 mode 判断
   */
  isApplicable(request: AgentInvocationRequest): boolean;

  /**
   * 执行增强逻辑
   * - 可以包含异步操作（查库、调 RPC 等）
   */
  enrich(context: EnrichmentContext): Promise<EnrichmentResult>;
}
