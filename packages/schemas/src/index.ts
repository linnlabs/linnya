/**
 * @file package/schemas/src/index.ts
 * @description 统一导出所有schemas和工具函数
 *
 * 这是 @app/schemas 包的主入口文件，提供统一的类型定义和验证函数。
 * 前后端可以从这里导入所需的所有类型和工具函数。
 */

// ============ API DTO 相关 ============
export * from './api-dtos';
export * from './json-value';
export * from './model-inference';
export * from './document-ocr';
export * from './transcription';
export * from './provider-outbound-audit';
export * from './provider-catalog';
export * from './provider-onboarding';
export * from './provider-account';
export * from './custom-api-onboarding';
export * from './ollama-onboarding';
export * from './model-picker';
export type {
  IncrementalEvent,
  ConversationOptions,
  ConversationNextRequest,
  ConversationNextResponse,
  AgentInvokeRequest,
  ChatMessage,
  KnowledgeBaseSearchRequest,
  KnowledgeBaseSearchResponse,
  ErrorResponse,
  SuccessResponse,
  ApiResponse,
} from './api-dtos';

// ============ 便捷导出：常用的验证函数 ============
export {
  validateConversationNextRequest,
  validateAgentInvokeRequest,
  validateKnowledgeBaseSearchRequest,
} from './api-dtos';

// ============ 便捷导出：常用的创建函数 ============
export {
  createConversationNextRequest,
  createAgentInvokeRequest,
  createUserInputEvent as createIncrementalUserInputEvent,
  createToolOutputEvent as createIncrementalToolOutputEvent,
} from './api-dtos';

// ============ Agent 配置（前后端共享） ============
export * from './agent-config/index';
export {
  // 🎯 唯一真源：所有 promptKey 从这里导出
  PromptKeys,
  PROMPT_KEY_VALUES,
  // 兼容别名
  DEFAULT_PROMPT_KEY,
  WRITING_PROMPT_KEY,
  ANNOTATION_PROMPT_KEY,
  AUTOCOMPLETE_PROMPT_KEY,
  TABLE_AI_FILL_PROMPT_KEY,
  AGENT_DEFAULT_PROMPT_KEY,
  REVIEW_PROMPT_KEY,
  PROJECT_PLANNING_PROMPT_KEY,
  TRANSLATION_PROMPT_KEY,
  AUDIO_SUMMARY_PROMPT_KEY,
} from './agent-config/index';
export type { PromptKey } from './agent-config/index';

// ============ Conversation agent 选择合同 ============
export * from './conversation/selected-agent';
export * from './conversation/history';
export * from './conversation/file-link';

// ============ Storage Space HTTP 合同 ============
export * from './storage-space';

// ============ 开发态进程内存诊断合同 ============
export * from './system/process-memory';

// ============ DocumentView 协议（AI Edit 前后端共享） ============
export * from './document-view';
export * from './markdown-annotation';
export type {
  DocumentViewDocType,
  DocumentViewMeta,
  FlattenedBlock,
  TextWindowResult,
} from './document-view';
export {
  DocumentViewDocTypeSchema,
  DocumentViewMetaSchema,
  FlattenedBlockSchema,
  buildDocumentView,
  buildBodyFromBlocks,
  sliceTextWindow,
} from './document-view';

// ============ 引用（RAG Citation，支持 KB / Web 多来源） ============
export * from './citation';

// ============ 插件平台契约 ============
export * from './plugins';

// ============ Workspace / Document mutation bus ============
export * from './workspace-mutation-events';

// ============ Workspace 节点跨项目移动 ============
export * from './workspace-node-transfer';

// ============ Agent 可见文件地址空间合同 ============
export * from './file-locator';

// ============ Command runtime 跨进程合同 ============
export * from './commands';

// ============ Conversation 投影契约 ============
export * from './conversation/attachment-ref';
export * from './conversation/reference-identity';
export * from './conversation/user-quote';
export * from './conversation/subrun-trace-summary';
export * from './conversation/message-identity';
export * from './conversation/visual-turn-identity';
export * from './conversation/ui-message';
export * from './conversation/presentation';
export * from './conversation/tool-message';
export * from './conversation/summary-message';
export * from './conversation/message-metadata';

// ============ Conversation CLI / App Host 控制面合同 ============
export * from './conversation-control';

// ============ 系统 batch 工具契约 ============
export * from './tools/subrun-batch';
export * from './tools/subagent';
export * from './tools/write-to-table';
export * from './tools/ask';
export * from './tools/document-list';
export * from './tools/knowledge-base-document-read';
export * from './tools/knowledge-search';
export * from './tools/citation-snapshot';
export * from './tools/taskstate';
export * from './tools/workspace-document-read';
export * from './tools/tool-output-read';
export * from './tools/agent-todo';
export * from './tools/conversation-artifact-read';
export * from './tools/shared-memory';
export * from './tools/workspace-file';
export * from './tools/workspace-file-history';
export * from './tools/resource-read';
export * from './tools/skill';
export * from './tools/image-generation';
export * from './tools/web-common';
export * from './tools/web-search';
export * from './tools/web-read';
export * from './tools/assemble-documents';
export * from './tools/historical-assemble-evidence';
export * from './tools/evidence-resolve';
export * from './tools/research-run-writer';

// ============ 用户可见消息 / 错误边界 ============
export * from './user-facing-message';

// ============ 版本信息 ============
export const SCHEMA_VERSION = 1;
export const PACKAGE_VERSION = '1.0.0';

// ============ 类型守卫函数 ============

import type { IncrementalEvent } from './api-dtos';

function isRecord(event: unknown): event is Record<string, unknown> {
  return !!event && typeof event === 'object' && !Array.isArray(event);
}

/**
 * 检查是否为增量事件
 */
export function isIncrementalEvent(event: unknown): event is IncrementalEvent {
  if (!isRecord(event)) return false;
  return (
    (event.type === 'user_input' || event.type === 'tool_output') &&
    typeof event.timestamp === 'number'
  );
}
