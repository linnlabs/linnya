/**
 * @file src/agent/context-manager/profiles/agent/tasks/BaseAgentTask.ts
 * @description Agent任务的抽象基类 - 处理Agent通用逻辑
 *
 * 专注于核心消息构建，将复杂的上下文管理交给 AgentContextManager
 */

import type { AgentProfileRequest } from '../contracts';
import { IAgentTask } from './base';
import {
  generateAiMessageId,
  type AiMessage,
  type PersistentMetadata,
} from '../../../../contracts';
import type {
  FenceDescriptor,
  FenceInjection,
  FencePlacement,
  FenceRegistry,
} from '../../../shared/fences';
import { CONTEXT_CHECKPOINT_ROOT_SYSTEM_GUARD } from '../../../features/context-compaction';

export interface BaseAgentTaskOptions {
  fenceRegistry?: FenceRegistry;
}

/**
 * Agent任务的抽象基类
 *
 * @abstract
 * @description
 * 现在只负责构建 Agent 任务的核心消息骨架：
 * - system prompt
 * - host-provided context injection messages
 * - 当前 user query
 * - 按时序附加 history
 */
export abstract class BaseAgentTask implements IAgentTask {
  abstract readonly name: string;

  private readonly fenceRegistry?: FenceRegistry;

  constructor(options: BaseAgentTaskOptions = {}) {
    this.fenceRegistry = options.fenceRegistry;
  }

  protected abstract getSystemPrompt(request: AgentProfileRequest): string;

  public getSystemPromptForRequest(request: AgentProfileRequest): string {
    return this.getSystemPrompt(request);
  }

  buildMessages(request: AgentProfileRequest, history: AiMessage[]): AiMessage[] {
    const messages: AiMessage[] = [];
    const fenceMessages = this.createFenceMessages(request.fences ?? []);

    const systemPrompt = this.getSystemPrompt(request);
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({
        id: generateAiMessageId(),
        role: 'system',
        type: 'system_prompt',
        content: `${systemPrompt}\n\n${CONTEXT_CHECKPOINT_ROOT_SYSTEM_GUARD}`,
        timestamp: Date.now(),
      });
    }

    messages.push(...fenceMessages['after-system']);

    const currentUserIndex = findCurrentUserInputIndex(history, request.currentUserEventId);
    const historyBeforeCurrentUser = currentUserIndex === -1 ? history : history.slice(0, currentUserIndex);
    const currentUserMessage = currentUserIndex === -1
      ? this.createCurrentUserMessage(request)
      : history[currentUserIndex];
    const historyAfterCurrentUser = currentUserIndex === -1 ? [] : history.slice(currentUserIndex + 1);

    messages.push(...historyBeforeCurrentUser);
    messages.push(...fenceMessages['before-current-user']);

    if (currentUserMessage) {
      messages.push(currentUserMessage);
    }

    messages.push(...fenceMessages['after-current-user']);
    messages.push(...historyAfterCurrentUser);
    this.insertAfterLastToolResult(messages, fenceMessages['after-last-tool-result']);

    return messages;
  }

  private createCurrentUserMessage(request: AgentProfileRequest): AiMessage | null {
    if (request.currentUserAttachments?.length && request.currentUserEventId === undefined) {
      throw new Error('Current user attachments require currentUserEventId.');
    }

    const content = request.query.trim();
    if (request.currentUserEventId === undefined && !content) {
      return null;
    }

    return {
      id: request.currentUserEventId ?? generateAiMessageId(),
      role: 'user',
      type: 'user_input',
      content,
      timestamp: Date.now(),
      ...(request.currentUserAttachments?.length
        ? { attachments: request.currentUserAttachments }
        : {}),
    };
  }

  private createFenceMessages(fences: FenceInjection[]): Record<FencePlacement, AiMessage[]> {
    const grouped: Record<FencePlacement, AiMessage[]> = {
      'after-system': [],
      'before-current-user': [],
      'after-current-user': [],
      'after-last-tool-result': [],
    };

    if (fences.length === 0) {
      return grouped;
    }

    if (!this.fenceRegistry) {
      throw new Error('Fence injections require a FenceRegistry.');
    }

    for (const fence of fences) {
      const descriptor = this.fenceRegistry.get(fence.kind);
      if (!descriptor) {
        throw new Error(`Fence kind "${fence.kind}" is not registered.`);
      }
      grouped[descriptor.placement].push(this.createFenceMessage(fence, descriptor));
    }

    return grouped;
  }

  private createFenceMessage(fence: FenceInjection, descriptor: FenceDescriptor): AiMessage {
    const metadata: PersistentMetadata = {
      ...fence.metadata,
      fenceKind: fence.kind,
      fenceAttrs: fence.attrs ?? {},
      fencePlacement: descriptor.placement,
    };

    return {
      id: generateAiMessageId(),
      role: descriptor.llmRole,
      type: 'context_injection',
      content: fence.content,
      timestamp: Date.now(),
      metadata,
    };
  }

  private insertAfterLastToolResult(messages: AiMessage[], fenceMessages: AiMessage[]): void {
    if (fenceMessages.length === 0) {
      return;
    }
    const lastToolIndex = findLastIndex(messages, message => message.role === 'tool' && message.type === 'tool_output');
    if (lastToolIndex === -1) {
      messages.push(...fenceMessages);
      return;
    }
    messages.splice(lastToolIndex + 1, 0, ...fenceMessages);
  }

  processResponse(rawResponse: string): string {
    return rawResponse;
  }

  processStreamChunk(chunk: string): string {
    return chunk;
  }
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

function findCurrentUserInputIndex(history: AiMessage[], currentUserEventId: string | undefined): number {
  if (currentUserEventId === undefined) {
    return -1;
  }

  if (!currentUserEventId || currentUserEventId.trim() !== currentUserEventId) {
    throw new Error('currentUserEventId must be non-blank and trimmed.');
  }

  const index = history.findIndex(message => message.id === currentUserEventId);
  if (index === -1) return -1;

  const message = history[index];
  if (message.role !== 'user' || message.type !== 'user_input') {
    throw new Error(`Message "${currentUserEventId}" is not a user_input event.`);
  }
  return index;
}
