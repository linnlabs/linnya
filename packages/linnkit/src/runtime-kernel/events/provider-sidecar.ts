import type {
  AiMessage,
  RuntimeResourceRef,
  SerializableJsonRecord,
  ToolCallWire,
} from '../../contracts';

export interface EventMappingContext {
  conversationId: string;
  turnId: string;
  /**
   * 事件级扩展元数据（透传到 SSE/RuntimeEvent.metadata）。
   *
   * 中文备注：这里只放跨事件归类信息，不放 ui.hidden 这类单事件展示语义。
   */
  metadata?: SerializableJsonRecord;
}

export interface RuntimeMappingOptions {
  collectRuntime?: boolean;
  skipIncomplete?: boolean;
}

/**
 * RuntimeEvent 回放所需的最小会话内存端口。
 *
 * 中文备注：
 * - core 只依赖“写入消息”的最小能力；
 * - 具体产品实现只要结构兼容即可接入。
 */
export interface ConversationMemoryPort {
  addUserMessage(content: string, id?: string, attachments?: RuntimeResourceRef[]): void;
  addAssistantMessage(
    content: string | null,
    type: AiMessage['type'] & ('thought' | 'final_answer' | 'tool_calls'),
    metadata?: AiMessage['metadata'],
    id?: string
  ): void;
  addToolResponse(
    toolCallId: string,
    content: string,
    toolName: string,
    id?: string,
    attachments?: RuntimeResourceRef[],
    metadata?: AiMessage['metadata'],
  ): void;
  appendMessage(message: AiMessage): void;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const isToolCallWire = (value: unknown): value is ToolCallWire => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (value.type !== 'function') return false;
  const fn = value.function;
  return isRecord(fn) && typeof fn.name === 'string' && typeof fn.arguments === 'string';
};

export function readAnswerIdFromEvent(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  const value = event['answerId'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function readMetaFromEvent(event: unknown): Record<string, unknown> | undefined {
  if (!isRecord(event)) return undefined;
  const value = event['meta'];
  return isRecord(value) ? value : undefined;
}
