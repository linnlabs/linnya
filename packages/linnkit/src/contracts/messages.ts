import { z } from 'zod';
import { RuntimeResourceRefs, type RuntimeResourceRef } from './resource-ref';
import {
  AiMessageIdSchema,
  HistoryMessageReferenceIdSchema,
  ToolCallIdSchema,
  generateAiMessageId,
} from './identity';
import { FinalAnswerCompletionReason } from './final-answer';
import { SerializableJsonValue } from './json';
import { AssistantReplayParts, ProviderContinuations } from './provider-continuation';

export const ToolCallWire = z
  .object({
    id: ToolCallIdSchema,
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })
  .strict();

export type ToolCallWire = z.infer<typeof ToolCallWire>;

export const HistorySummaryMeta = z.object({
  messageType: z.literal('summary'),
  originalMessageCount: z.number().int().positive(),
  compressionRatio: z.number().min(0).max(1).optional(),
  includedOldSummary: z.boolean(),
  replacedMessageIds: z.array(HistoryMessageReferenceIdSchema),
  summarySeq: z.number().int().nonnegative(),
});

export type HistorySummaryMeta = z.infer<typeof HistorySummaryMeta>;

export const ToolCallsMeta = z.object({
  tool_calls: z.array(ToolCallWire),
  provider_continuations: ProviderContinuations.optional(),
  assistant_replay_parts: AssistantReplayParts.optional(),
  completion_reason: FinalAnswerCompletionReason.optional(),
});

export type ToolCallsMeta = z.infer<typeof ToolCallsMeta>;

export const ToolOutputMeta = z.object({
  tool_name: z.string(),
  args: z.record(z.unknown()).optional(),
  tool_call_id: ToolCallIdSchema,
});

export type ToolOutputMeta = z.infer<typeof ToolOutputMeta>;

export const ObservationTruncationMeta = z.object({
  /** Host 物化完整 observation 后返回的稳定引用；历史事件可能没有，live 截断必须提供。 */
  blobId: z.string().trim().min(1).optional(),
  originalChars: z.number().int().nonnegative(),
  previewChars: z.number().int().nonnegative(),
  originalLines: z.number().int().nonnegative().optional(),
  previewLines: z.number().int().nonnegative().optional(),
});

export type ObservationTruncationMeta = z.infer<typeof ObservationTruncationMeta>;

export const TaskTrackingMeta = z.object({
  taskType: z.string().optional(),
  taskId: z.string().optional(),
  taskStatus: z.enum(['requested', 'in_progress', 'completed', 'failed']).optional(),
  taskTrackingInfo: z
    .object({
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      duration: z.number().optional(),
      retryCount: z.number().int().nonnegative().optional(),
      lastError: z.string().optional(),
    })
    .optional(),
});

export type TaskTrackingMeta = z.infer<typeof TaskTrackingMeta>;

export const PersistentMetadata = z
  .object({
    messageType: z.literal('summary').optional(),
    originalMessageCount: z.number().int().positive().optional(),
    compressionRatio: z.number().min(0).max(1).optional(),
    includedOldSummary: z.boolean().optional(),
    replacedMessageIds: z.array(HistoryMessageReferenceIdSchema).optional(),
    summarySeq: z.number().int().nonnegative().optional(),
    tool_calls: z.array(ToolCallWire).optional(),
    provider_continuations: ProviderContinuations.optional(),
    assistant_replay_parts: AssistantReplayParts.optional(),
    tool_name: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    tool_call_id: ToolCallIdSchema.optional(),
    observationTruncation: ObservationTruncationMeta.optional(),
    data: SerializableJsonValue.optional(),
    error: z.string().optional(),
    presentation: SerializableJsonValue.optional(),
    taskType: z.string().optional(),
    taskId: z.string().optional(),
    taskStatus: z.enum(['requested', 'in_progress', 'completed', 'failed']).optional(),
    taskTrackingInfo: z
      .object({
        startTime: z.number().optional(),
        endTime: z.number().optional(),
        duration: z.number().optional(),
        retryCount: z.number().int().nonnegative().optional(),
        lastError: z.string().optional(),
      })
      .optional(),
    fenceKind: z.string().optional(),
    fenceAttrs: z.record(z.unknown()).optional(),
    fencePlacement: z.string().optional(),
  })
  .passthrough();

export type PersistentMetadata = z.infer<typeof PersistentMetadata>;

const BaseMessage = z.object({
  id: AiMessageIdSchema,
  content: z.string(),
  timestamp: z.number().int().nonnegative(),
  metadata: PersistentMetadata.optional(),
});

export const SystemMessage = BaseMessage.extend({
  role: z.literal('system'),
  type: z.enum(['system_prompt', 'history_summary', 'context_injection']),
});

export type SystemMessage = z.infer<typeof SystemMessage>;

const UserInputMessage = BaseMessage.extend({
  role: z.literal('user'),
  type: z.literal('user_input'),
  attachments: RuntimeResourceRefs.optional(),
});

const UserContextMessage = BaseMessage.extend({
  role: z.literal('user'),
  type: z.enum([
    'context_injection',
    'context_before',
    'context_after',
    'document_fragment',
    'task_request',
  ]),
});

export const UserMessage = z.union([UserInputMessage, UserContextMessage]);

export type UserMessage = z.infer<typeof UserMessage>;

export const AssistantMessage = BaseMessage.extend({
  role: z.literal('assistant'),
  type: z.enum(['thought', 'final_answer', 'tool_code', 'tool_calls', 'task_completion']),
});

export type AssistantMessage = z.infer<typeof AssistantMessage>;

export const ToolMessage = BaseMessage.extend({
  role: z.literal('tool'),
  type: z.literal('tool_output'),
  attachments: RuntimeResourceRefs.optional(),
});

export type ToolMessage = z.infer<typeof ToolMessage>;

const AiMessageShape = z.union([SystemMessage, UserMessage, AssistantMessage, ToolMessage]);

function hasOwnAttachments(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'attachments')
  );
}

export const AiMessage = z
  .unknown()
  .superRefine((value, ctx) => {
    if (hasOwnAttachments(value)) {
      const validPlacement =
        (value['role'] === 'user' && value['type'] === 'user_input') ||
        (value['role'] === 'tool' && value['type'] === 'tool_output');
      if (!validPlacement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attachments'],
          message: 'attachments are only allowed on user_input and tool_output messages',
        });
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const metadata = Reflect.get(value, 'metadata');
      if (
        metadata
        && typeof metadata === 'object'
        && !Array.isArray(metadata)
        && Object.prototype.hasOwnProperty.call(metadata, 'reasoning_details')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadata', 'reasoning_details'],
          message: 'reasoning_details is retired; use provider_continuations with producer identity',
        });
      }
    }
  })
  .pipe(AiMessageShape)
  .superRefine((message, ctx) => {
    if (
      message.role === 'assistant'
      && message.metadata?.provider_continuations?.length
      && !message.metadata.assistant_replay_parts?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', 'assistant_replay_parts'],
        message: 'provider_continuations require ordered assistant_replay_parts',
      });
    }
  });

export type AiMessage = z.infer<typeof AiMessage>;

export function createSystemMessage(
  type: SystemMessage['type'],
  content: string,
  metadata?: PersistentMetadata
): SystemMessage {
  return {
    id: generateAiMessageId(),
    role: 'system',
    type,
    content,
    timestamp: Date.now(),
    metadata,
  };
}

type UserContextMessageType = Exclude<UserMessage['type'], 'user_input'>;
type UserInputMessage = Extract<UserMessage, { type: 'user_input' }>;
type UserContextMessage = Exclude<UserMessage, UserInputMessage>;

export function createUserMessage(
  type: 'user_input',
  content: string,
  metadata?: PersistentMetadata,
  attachments?: readonly RuntimeResourceRef[]
): UserInputMessage;
export function createUserMessage(
  type: UserContextMessageType,
  content: string,
  metadata?: PersistentMetadata
): UserContextMessage;
export function createUserMessage(
  type: UserMessage['type'],
  content: string,
  metadata?: PersistentMetadata,
  attachments?: readonly RuntimeResourceRef[]
): UserMessage {
  if (type === 'user_input') {
    return {
      id: generateAiMessageId(),
      role: 'user',
      type,
      content,
      timestamp: Date.now(),
      metadata,
      ...(attachments?.length ? { attachments: [...attachments] } : {}),
    };
  }
  return {
    id: generateAiMessageId(),
    role: 'user',
    type,
    content,
    timestamp: Date.now(),
    metadata,
  };
}

export function createAssistantMessage(
  type: AssistantMessage['type'],
  content: string,
  metadata?: PersistentMetadata
): AssistantMessage {
  return {
    id: generateAiMessageId(),
    role: 'assistant',
    type,
    content,
    timestamp: Date.now(),
    metadata,
  };
}

export function createToolMessage(
  content: string,
  toolCallId: z.infer<typeof ToolCallIdSchema>,
  toolName: string,
  metadata?: PersistentMetadata
): ToolMessage {
  return {
    id: generateAiMessageId(),
    role: 'tool',
    type: 'tool_output',
    content,
    timestamp: Date.now(),
    metadata: {
      ...metadata,
      tool_call_id: toolCallId,
      tool_name: toolName,
    },
  };
}

export function createHistorySummaryMessage(
  content: string,
  summaryMeta: HistorySummaryMeta
): SystemMessage {
  return {
    id: generateAiMessageId(),
    role: 'system',
    type: 'history_summary',
    content,
    timestamp: Date.now(),
    metadata: summaryMeta,
  };
}

export function validateAiMessage(data: unknown): z.SafeParseReturnType<unknown, AiMessage> {
  return AiMessage.safeParse(data);
}

export function validateHistorySummaryMeta(
  data: unknown
): z.SafeParseReturnType<unknown, HistorySummaryMeta> {
  return HistorySummaryMeta.safeParse(data);
}

export function isSystemMessage(message: AiMessage): message is SystemMessage {
  return message.role === 'system';
}

export function isUserMessage(message: AiMessage): message is UserMessage {
  return message.role === 'user';
}

export function isAssistantMessage(message: AiMessage): message is AssistantMessage {
  return message.role === 'assistant';
}

export function isToolMessage(message: AiMessage): message is ToolMessage {
  return message.role === 'tool';
}

export function isHistorySummaryMessage(message: AiMessage): message is SystemMessage {
  return (
    message.role === 'system' &&
    message.type === 'history_summary' &&
    message.metadata?.messageType === 'summary'
  );
}

export function hasToolCalls(message: AiMessage): boolean {
  return (
    message.role === 'assistant' &&
    Array.isArray(message.metadata?.tool_calls) &&
    message.metadata.tool_calls.length > 0
  );
}
