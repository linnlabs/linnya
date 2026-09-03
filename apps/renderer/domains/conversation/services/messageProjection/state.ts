import type { Conversation } from '../../types';
import type { AnswerSegmentState } from '../../features/answer-segment';
import type { ConversationCitationProjectionWorkspace } from '../../features/citation-presentation';

export type ProjectedMessage = Conversation['messages'][number];

/**
 * @description
 * MessageProjection 的“投影状态”定义。
 *
 * 原则：
 * - 高内聚：只放状态结构与最核心的类型；
 * - 低耦合：不包含投影算法与副作用；
 * - 严格：用于 reducer 与 projectors 的共享契约。
 */

export interface TurnState {
  turnId: string;
  thoughtMessageId?: string;
  answerMessageId?: string;
  answerId?: string;
  lastMessageType?: 'thought' | 'final_answer' | 'tool_preamble' | 'partial_answer' | 'tool_call_decision' | 'tool_process' | 'tool_output';
}

export interface AnswerState extends AnswerSegmentState {
  turnId: string;
  messageId?: string;
}

export interface ToolState {
  toolCallId: string;
  turnId: string;
  messageId: string;
}

/** 一个 execution 独享的在途归并状态；其中所有局部 ID 都禁止跨 execution 查询。 */
export interface ExecutionProjectionState {
  readonly runId: string;
  readonly executionId: string;
  /** 轮次状态索引：Map<turn_id, TurnState> */
  readonly turnState: Map<string, TurnState>;
  /** 答案状态索引：Map<answer_id, AnswerState> */
  readonly answerState: Map<string, AnswerState>;
  /** 思考缓冲区：Map<turn_id, Map<thought_message_id, content>> */
  readonly thoughtBuffers: Map<string, Map<string, string>>;
}

/** 一个 run 可跨多个 execution；HITL resume 需要继续更新该 run 原有的工具实体。 */
export interface RunProjectionState {
  readonly runId: string;
  /** 工具状态索引：Map<tool_call_id, ToolState> */
  readonly toolState: Map<string, ToolState>;
  /** 同一 run 的各次 start/resume execution。 */
  readonly executionStates: Map<string, ExecutionProjectionState>;
}

export interface MessageProjectionState {
  /** 对话对象 */
  conversation: Conversation;
  /**
   * 消息 ID 到 messages 下标的索引。
   *
   * 历史回放会对同一批消息反复按 id patch（tool/subrun/thought/final_answer），
   * 线性 find/findIndex 在长对话里会把投影放大成明显的 O(N²) 常数。
   */
  messageIndex: Map<string, number>;
  /** Conversation 内 live 引用投影工作区；仅服务消息依赖快照生成。 */
  citationWorkspace: ConversationCitationProjectionWorkspace;
  /** 在途状态先按 run_id，再按 execution_id 分区。 */
  runStates: Map<string, RunProjectionState>;
  /** execution_id 的唯一 run 所有权索引；只用于拒绝上游身份改绑。 */
  executionRunOwners: Map<string, string>;
  /** 已处理事件集合：Set<event_id> */
  processedEvents: Set<string>;
}

export interface ProjectionResult {
  /** 处理是否成功 */
  success: boolean;
  /** 相关消息ID（如果有） */
  messageId?: string;
  /** 失败原因 */
  reason?: string;
  /** 更新后的状态 */
  newState?: MessageProjectionState;
  /** 错误信息（用于 error 事件） */
  error?: string;
  /** 错误详情（用于 error 事件；只用于调试，不直接展示） */
  errorDetails?: unknown;
}
