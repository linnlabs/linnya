/**
 * @file src/app-hosts/linnya/adapters/flow/flow.schemas.ts
 * @description 对话流程编排相关的类型定义
 *
 * 功能 (What):
 * 定义所有与对话流程执行相关的数据结构，包括：
 * - ConversationNextRequest 的类型定义（从 @app/schemas 导入）
 * - 流程编排的内部类型
 * - SSE 事件相关类型
 *
 * 设计原则:
 * - 使用 TypeScript 类型系统确保类型安全
 * - 尽可能复用 @app/schemas 中已定义的类型
 * - 保持类型定义的简洁性和可读性
 */

import type {
  ConversationOptions,
  ConversationNextRequest,
  ConversationUserInputCommittedEvent,
  IncrementalEvent
} from '@app/schemas';
import type { ExecutionId, RunId, RuntimeEvent, SSEEvent } from '@linnlabs/linnkit/contracts';

/**
 * 导出核心类型（从 @app/schemas 重导出）
 *
 * 功能 (What): 提供统一的类型导入接口，避免直接依赖 @app/schemas
 */
export type {
  ConversationOptions,
  ConversationNextRequest,
  IncrementalEvent,
  ConversationUserInputCommittedEvent,
  RuntimeEvent,
  SSEEvent,
};

/**
 * 流程执行结果
 *
 * 功能 (What): 定义流程编排器执行后的返回结果
 *
 * @property conversation_id - 会话的唯一标识符
 * @property events - 本次执行产生的运行时事件列表
 * @property stepCount - 执行步数（可选）
 */
export interface FlowExecutionResult {
  conversation_id: string;
  events: RuntimeEvent[];
  stepCount?: number;
  /**
   * 本轮结束原因。
   *
   * 说明：
   * - `interrupted` 用于用户主动终止；
   * - 上层用它决定 `transport_end.reason`，避免把用户 stop 误标成 error。
   */
  terminationReason?: 'complete' | 'error' | 'interrupted' | 'timeout';
  /**
   * ✅ 执行结束时的 checkpoint 节点 ID（用于上层编排判断“是否暂停等待用户”）
   *
   * 中文备注：
   * - GraphExecutor.runUntilYield 会返回 checkpoint.nodeId；
   * - 某些上层编排需要知道“本轮是否暂停在 wait_user”，否则可能在同一个请求内继续推进，造成“未提交问卷就推进”的问题。
   */
  checkpointNodeId?: string;
}

/**
 * Host 已持久化本次输入并取得 run execution ownership 后产生的内部回执。
 * transport adapter 只能投影它，不能在收到请求时提前伪造 accepted。
 */
export interface FlowRunAcceptance {
  readonly conversationId: string;
  readonly incomingEventIds: readonly string[];
  readonly turnId: string;
  readonly runId: RunId;
  readonly executionId: ExecutionId;
  readonly agentId: string;
  readonly acceptedAt: number;
}

/**
 * SSE 数据发送函数类型
 *
 * 功能 (What): 定义流式发送 SSE 事件的函数签名
 * 
 * @param event - 要发送的 SSE 事件
 * @returns void - realtime sink 只负责传输 DTO，不得回传或生成 RuntimeEvent 事实
 */
export type ConversationRealtimeEvent = SSEEvent | ConversationUserInputCommittedEvent;
export type SSESink = (event: ConversationRealtimeEvent) => void;
