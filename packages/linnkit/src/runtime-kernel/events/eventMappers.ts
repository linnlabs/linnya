/**
 * @file src/agent/runtime-kernel/events/eventMappers.ts
 * @brief 统一事件映射器兼容出口
 *
 * @description
 * 具体职责已拆分：
 * - agent-to-runtime.ts：AnyAgentEvent → RuntimeEvent
 * - runtime-to-ai-message.ts：RuntimeEvent → ConversationMemoryPort
 * - provider-sidecar.ts：sidecar/tool_call 相关共享工具与类型
 */

import type { RuntimeEvent } from '../../contracts';
import { agentEventToRuntime } from './agent-to-runtime';
import {
  type ConversationMemoryPort,
  type EventMappingContext,
  type RuntimeMappingOptions,
} from './provider-sidecar';
import { applyRuntimeEventToMemory } from './runtime-to-ai-message';

export { agentEventToRuntime } from './agent-to-runtime';
export {
  type ConversationMemoryPort,
  type EventMappingContext,
  type RuntimeMappingOptions,
} from './provider-sidecar';
export { applyRuntimeEventToMemory } from './runtime-to-ai-message';

/**
 * 统一的事件映射器。
 *
 * 中文备注：
 * - 保留仍在使用的 AgentEvent → RuntimeEvent 旧桥；
 * - SSE wire 投影统一走 contracts/runtimeEventToSSEEvent，禁止再从 AgentEvent 直接投 SSE；
 * - 新逻辑不要继续写回本文件，按职责放到拆分后的模块。
 */
export const eventMapper = {
  /**
   * 将 AgentEvent 转换为 RuntimeEvent。
   */
  agentToRuntime: agentEventToRuntime,

  /**
   * 将 RuntimeEvent 应用到 ConversationMemoryPort。
   */
  applyToMemory: applyRuntimeEventToMemory,

  /**
   * 批量重建内存。
   */
  rebuildMemory: (events: RuntimeEvent[], memory: ConversationMemoryPort) => {
    for (const event of events) {
      applyRuntimeEventToMemory(event, memory);
    }
  },
};
