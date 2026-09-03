/**
 * @file src/app-hosts/linnya/context/agent/schemas.ts
 *
 * @brief [API适配层] 定义了与Agent智能体功能相关的API请求和响应数据模型。
 *
 * @description
 * 使用 Zod 来定义所有请求和响应的结构，确保类型安全和运行时验证。
 *
 * 本文件仅负责：
 * - API层数据验证 (Zod Schema)
 * - Agent请求响应模型定义
 * - 事件类型定义
 */

import { z } from 'zod';
import {
  PromptKeys,
  UserQuoteSchema,
} from '@app/schemas';
import { generateAiMessageId } from '@linnlabs/linnkit/contracts';
import * as contextManager from '@linnlabs/linnkit/context-manager';
import type { graph } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvokeRequest } from './contracts';
import {
  AiMessage as AiMessageSchema,
  RuntimeResourceRef as RuntimeResourceRefSchema,
} from '@linnlabs/linnkit/contracts';
import type {
  AiMessage,
  AssistantMessage,
  SystemMessage,
  TokenCountConfidence,
  TokenCountSource,
  ToolMessage,
  UserMessage,
} from '@linnlabs/linnkit/contracts';

const { AGENT_CONSTANTS } = contextManager.agentConfig;
type ConversationSession = contextManager.agentContext.ConversationSession;

/**
 * ExecutorLocalState 的权威定义已下沉到 runtime-kernel/graph-engine/types.ts。
 * 这里 re-export 保持 product-extension 入口稳定。
 */
export type ExecutorLocalState = graph.ExecutorLocalState;

const ProjectMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

const DocumentMetadataSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
});

const FenceInjectionSchema = z.object({
  kind: z.string(),
  content: z.string(),
  attrs: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AgentInvokeRequestSchema = z
  .object({
    query: z.string().describe('用户查询'),
    currentUserEventId: z.string().refine(
      value => value.trim().length > 0 && value === value.trim(),
      { message: 'currentUserEventId 必须非空且不包含首尾空白' },
    ).optional().describe('当前 user_input 的不可变事件ID'),
    currentUserAttachments: z.array(RuntimeResourceRefSchema)
      .min(1)
      .optional()
      .describe('当前轮尚未进入历史时所需的 durable 资源引用'),
    promptKey: z.string().default(PromptKeys.DEFAULT).describe('任务提示键'),
    model_id: z.string().optional().describe('使用的模型ID'),
    imageGenerationModelId: z.string().optional().describe('图片生成模型ID'),
    context_before: z.string().optional().describe('光标前的内容'),
    context_after: z.string().optional().describe('光标后的内容'),
    document_fragment: z.string().optional().describe('文档片段'),
    current_paragraph: z.string().optional().describe('当前段落'),
    document_title: z.string().optional().describe('文档标题'),
    document_toc: z.string().optional().describe('文档目录'),
    document_list: z.string().optional().describe('可用文档列表'),
    knowledgeBaseId: z.string().optional().describe('知识库ID'),
    maxSteps: z.number().optional().default(AGENT_CONSTANTS.DEFAULT_MAX_STEPS).describe('最大推理步数'),
    enableTools: z.boolean().optional().default(true).describe('是否启用工具使用'),
    availableTools: z.array(z.string()).optional().describe('可用工具列表'),
    conversationHistory: z.array(AiMessageSchema).optional().describe('对话历史'),
    reasoning_effort: z
      .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
      .optional()
      .describe('思考努力程度（统一语义）'),
    fences: z.array(FenceInjectionSchema).optional().describe('结构化上下文围栏'),
    project_metadata: ProjectMetadataSchema.optional().describe('当前项目的人类可读信息'),
    document_metadata: DocumentMetadataSchema.optional().describe('当前文档的人类可读信息'),
    user_quote: UserQuoteSchema.optional().describe('用户选区引用信息'),
    injected_context: z.string().optional().describe('enricher 注入的补充上下文片段'),
  })
  .extend({
    review_run_id: z.string().optional().describe('Review运行ID（分组/幂等）'),
    agent_id: z.string().optional().describe('审阅角色ID'),
    chunk_index: z.number().int().min(0).optional().describe('当前chunk索引（从0开始）'),
    total_chunks: z.number().int().min(1).optional().describe('总chunk数（>=1）'),
    review_background: z.string().optional().describe('审阅背景'),
    review_goal: z.string().optional().describe('审阅目标'),
    agent_name: z.string().optional().describe('角色名（后端注入）'),
    agent_system_prompt: z.string().optional().describe('角色system prompt（后端注入）'),
    agent_knowledge: z.string().optional().describe('角色knowledge（后端注入）'),
  })
  .extend({
    completionLengthHint: z.string().optional().describe('补全长度提示'),
    recentRejections: z
      .array(
        z.object({
          suggestionText: z.string().describe('被拒绝的建议文本'),
          userContinuedWith: z.string().optional().describe('用户拒绝后继续输入的文本'),
        })
      )
      .optional()
      .describe('最近被拒绝的建议列表'),
  })
  .superRefine((request, ctx) => {
    if (request.currentUserAttachments !== undefined && request.currentUserEventId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentUserAttachments'],
        message: 'currentUserAttachments 必须与 currentUserEventId 同时提供',
      });
    }
  });

export const AgentInvokeResponseSchema = z.object({
  answer: z.string().describe('最终答案'),
  steps: z.array(z.unknown()).describe('执行步骤'),
  totalSteps: z.number().describe('总推理步数'),
  success: z.boolean().describe('是否成功完成'),
  error: z.string().optional().describe('错误信息'),
  model: z.string().optional().describe('使用的模型'),
  durationMs: z.number().describe('总耗时'),
});

export type { AgentInvokeRequest } from './contracts';
export type AgentInvokeResponse = z.infer<typeof AgentInvokeResponseSchema>;

export type { AiMessage } from '@linnlabs/linnkit/contracts';

export interface AgentEvent {
  type: string;
  timestamp: number;
  id?: string;
}

export interface TurnStartEvent extends AgentEvent {
  type: 'turn_start';
  step: number;
}

export interface TurnEndEvent extends AgentEvent {
  type: 'turn_end';
  step: number;
  success: boolean;
  finalAnswer?: string;
}

export interface TurnFailEvent extends AgentEvent {
  type: 'turn_fail';
  step: number;
  error: string;
  details?: string;
}

export interface RawPayloadEvent extends AgentEvent {
  type: 'raw_payload';
  payload: Array<{ role: string; content: string; [key: string]: unknown }>;
}

interface BaseToolLifecycleAgentEvent extends AgentEvent {
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_calls?: unknown[];
  tool_call_id?: string;
  phase?: 'start' | 'update' | 'complete' | 'error';
  status?: 'loading' | 'success' | 'error';
  payload?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface ToolCallDecisionEvent extends BaseToolLifecycleAgentEvent {
  type: 'tool_call_decision';
}

export interface ToolProcessEvent extends BaseToolLifecycleAgentEvent {
  type: 'tool_process';
}

export interface ObservationEvent extends AgentEvent {
  type: 'observation';
  tool_name: string;
  tool_call_id?: string;
  output: string;
  success?: boolean;
  payload?: unknown;
  duration_ms?: number;
}

export interface ThoughtEvent extends AgentEvent {
  type: 'thought';
  content: string;
  delta?: string;
  is_complete?: boolean;
  meta?: Record<string, unknown>;
  thought_message_id?: string;
}

export interface FinalAnswerEvent extends AgentEvent {
  type: 'final_answer';
  answer: string;
  answer_id?: string;
}

export interface ErrorEvent extends AgentEvent {
  type: 'error';
  error: string;
  details?: string;
}

export interface StreamChunkEvent extends AgentEvent {
  type: 'stream_chunk';
  content: string;
  answer_id: string;
  seq: number;
  is_last?: boolean;
}

export interface StreamControlEvent extends AgentEvent {
  type: 'stream_control';
  controlType: 'start' | 'end' | 'pause' | 'resume';
}

export type AnyAgentEvent =
  | TurnStartEvent
  | TurnEndEvent
  | TurnFailEvent
  | RawPayloadEvent
  | ThoughtEvent
  | ToolCallDecisionEvent
  | ToolProcessEvent
  | ObservationEvent
  | FinalAnswerEvent
  | ErrorEvent
  | StreamChunkEvent;

export type ProcessedAiMessage = AiMessage & {
  estimatedTokens?: number;
  preserveReason?: string;
};

export interface ContextBuildResult {
  messages: AiMessage[];
  truncated: boolean;
  truncatedCount: number;
  tokenUsage: {
    used: number;
    budget: number;
    remaining: number;
    source: TokenCountSource;
    confidence: TokenCountConfidence;
  };
  strategies: {
    applied: string[];
    recommendations: string[];
  };
  processingStats: {
    originalCount: number;
    keptCount: number;
    truncatedCount: number;
    buildStats?: Record<string, unknown>;
  };
}

export interface AgentMessageBuildContext {
  request: AgentInvokeRequest;
  session?: ConversationSession;
  history?: AiMessage[];
}

export function createSystemMessage(content: string, type: SystemMessage['type'] = 'system_prompt'): SystemMessage {
  return {
    id: generateAiMessageId(),
    role: 'system',
    type,
    content,
    timestamp: Date.now(),
  };
}

export function createUserMessage(content: string, type: UserMessage['type'] = 'user_input'): UserMessage {
  return {
    id: generateAiMessageId(),
    role: 'user',
    type,
    content,
    timestamp: Date.now(),
  };
}

export function createAssistantMessage(
  content: string,
  type: AssistantMessage['type'] = 'final_answer'
): AssistantMessage {
  return {
    id: generateAiMessageId(),
    role: 'assistant',
    type,
    content,
    timestamp: Date.now(),
  };
}

export function createToolMessage(content: string): ToolMessage {
  return {
    id: generateAiMessageId(),
    role: 'tool',
    type: 'tool_output',
    content,
    timestamp: Date.now(),
  };
}
