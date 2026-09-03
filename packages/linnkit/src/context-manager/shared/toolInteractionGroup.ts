import type { AiMessage } from '../../contracts';
import type { MessageProcessingState } from './providers/base';

type IndexedEntry<T> = {
  value: T;
  originalIndex: number;
  message: AiMessage;
};

type ToolCallRecord = {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

interface ToolInteractionGroupBuildOptions {
  /**
   * 工具调用与工具结果允许相隔的最大消息数。
   *
   * 中文备注：超过窗口的 tool_output 不再配对，避免很旧的 tool_calls 被远处结果误粘连。
   */
  maxPairingDistance?: number;
}

export interface ToolInteractionGroupItem<T> {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolCall: ToolCallRecord;
  toolOutputs: T[];
  toolOutputMessages: AiMessage[];
  rawOutputs: string[];
}

export interface ToolInteractionGroup<T> {
  anchorId: string;
  /** 工具组所属的用户轮次序号：0 表示第一条 user_input 之前，之后每遇到一条 user_input 递增。 */
  runOrdinal: number;
  assistantState: T;
  assistantMessage: AiMessage;
  assistantIndex: number;
  toolOutputs: T[];
  toolOutputMessages: AiMessage[];
  toolOutputIndexes: number[];
  toolCallIds: string[];
  toolNames: string[];
  sourceMessageIds: string[];
  messageIndexes: number[];
  startIndex: number;
  endIndex: number;
  isComplete: boolean;
  isCompressed: boolean;
  items: ToolInteractionGroupItem<T>[];
  messages: T[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolCallRecord(value: unknown): value is ToolCallRecord {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === 'string' && value.id.trim().length > 0;
}

function getToolCalls(message: AiMessage): ToolCallRecord[] {
  const toolCalls = message.metadata?.tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.filter(isToolCallRecord);
}

function safeParseArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (typeof rawArgs !== 'string' || rawArgs.trim().length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getRawOutput(message: AiMessage): string {
  if (message.metadata?.data !== undefined) {
    return JSON.stringify({
      data: message.metadata.data,
      observation: message.content,
      ...(isRecord(message.metadata.presentation) && message.metadata.presentation['media'] !== undefined
        ? { media: message.metadata.presentation['media'] }
        : {}),
    });
  }
  if (typeof message.metadata?.error === 'string') {
    return JSON.stringify({ error: message.metadata.error, observation: message.content });
  }
  throw new Error(`tool_output message ${message.id} is missing canonical data or error metadata.`);
}

function buildToolInteractionGroups<T>(
  entries: IndexedEntry<T>[],
  options: ToolInteractionGroupBuildOptions = {},
): ToolInteractionGroup<T>[] {
  type MutableGroup = {
    anchorId: string;
    assistantState: T;
    assistantMessage: AiMessage;
    assistantIndex: number;
    toolOutputs: Array<{ value: T; message: AiMessage; index: number }>;
    sourceMessageIds: Set<string>;
    runOrdinal: number;
    startIndex: number;
    endIndex: number;
    isCompressed: boolean;
    items: Array<{
      toolCallId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      toolCall: ToolCallRecord;
      toolOutputs: Array<{ value: T; message: AiMessage; index: number }>;
      rawOutputs: string[];
    }>;
  };

  const groups: MutableGroup[] = [];
  const activeToolCallIdToGroupIndex = new Map<string, number>();
  let currentRunOrdinal = 0;
  for (const entry of entries) {
    const { message } = entry;
    if (message.role === 'user' && message.type === 'user_input') {
      currentRunOrdinal += 1;
    }

    if (message.role === 'assistant' && message.type === 'tool_calls') {
      const toolCalls = getToolCalls(message);
      if (toolCalls.length === 0) {
        continue;
      }
      const groupIndex = groups.length;
      const itemList = toolCalls.map((toolCall) => {
        const toolName =
          typeof toolCall.function?.name === 'string' && toolCall.function.name.trim().length > 0
            ? toolCall.function.name
            : 'unknown_tool';
        return {
          toolCallId: toolCall.id,
          toolName,
          toolArgs: safeParseArgs(toolCall.function?.arguments),
          toolCall,
          toolOutputs: [] as Array<{ value: T; message: AiMessage; index: number }>,
          rawOutputs: [] as string[],
        };
      });

      const group: MutableGroup = {
        anchorId: message.id,
        assistantState: entry.value,
        assistantMessage: message,
        assistantIndex: entry.originalIndex,
        toolOutputs: [],
        sourceMessageIds: new Set<string>(message.id ? [message.id] : []),
        runOrdinal: currentRunOrdinal,
        startIndex: entry.originalIndex,
        endIndex: entry.originalIndex,
        isCompressed: false,
        items: itemList,
      };

      groups.push(group);
      for (const item of itemList) {
        activeToolCallIdToGroupIndex.set(item.toolCallId, groupIndex);
      }
      continue;
    }

    if (message.role !== 'tool' || message.type !== 'tool_output') {
      continue;
    }

    const toolCallId = message.metadata?.tool_call_id;
    if (typeof toolCallId !== 'string' || toolCallId.trim().length === 0) {
      continue;
    }

    const groupIndex = activeToolCallIdToGroupIndex.get(toolCallId);
    if (groupIndex === undefined) {
      continue;
    }

    const group = groups[groupIndex];
    if (
      options.maxPairingDistance !== undefined &&
      entry.originalIndex - group.assistantIndex > options.maxPairingDistance
    ) {
      continue;
    }
    const item = group.items.find((candidate) => candidate.toolCallId === toolCallId);
    if (!item) {
      continue;
    }

    const outputEntry = { value: entry.value, message, index: entry.originalIndex };
    item.toolOutputs.push(outputEntry);
    item.rawOutputs.push(getRawOutput(message));
    group.toolOutputs.push(outputEntry);
    if (message.id) {
      group.sourceMessageIds.add(message.id);
    }
    group.endIndex = Math.max(group.endIndex, entry.originalIndex);
  }

  return groups.map((group) => {
    const sortedOutputs = [...group.toolOutputs].sort((left, right) => left.index - right.index);
    const sortedItems = group.items.map((item) => {
      const itemOutputs = [...item.toolOutputs].sort((left, right) => left.index - right.index);
      return {
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        toolArgs: item.toolArgs,
        toolCall: item.toolCall,
        toolOutputs: itemOutputs.map((output) => output.value),
        toolOutputMessages: itemOutputs.map((output) => output.message),
        rawOutputs: [...item.rawOutputs],
      };
    });

    return {
      anchorId: group.anchorId,
      runOrdinal: group.runOrdinal,
      assistantState: group.assistantState,
      assistantMessage: group.assistantMessage,
      assistantIndex: group.assistantIndex,
      toolOutputs: sortedOutputs.map((output) => output.value),
      toolOutputMessages: sortedOutputs.map((output) => output.message),
      toolOutputIndexes: sortedOutputs.map((output) => output.index),
      toolCallIds: sortedItems.map((item) => item.toolCallId),
      toolNames: sortedItems.map((item) => item.toolName),
      sourceMessageIds: Array.from(group.sourceMessageIds),
      messageIndexes: [group.assistantIndex, ...sortedOutputs.map((output) => output.index)],
      startIndex: group.startIndex,
      endIndex: group.endIndex,
      isComplete: sortedItems.every((item) => item.toolOutputs.length > 0),
      isCompressed: group.isCompressed,
      items: sortedItems,
      messages: [group.assistantState, ...sortedOutputs.map((output) => output.value)],
    };
  });
}

export function collectToolInteractionGroups<T extends MessageProcessingState>(
  states: T[],
): ToolInteractionGroup<T>[] {
  const entries: IndexedEntry<T>[] = states.map((value, index) => ({
    value,
    originalIndex: index,
    message: value.message,
  }));

  return buildToolInteractionGroups(entries);
}

export function buildToolInteractionGroupsFromMessages(
  messages: AiMessage[],
  options: {
    startIndex?: number;
    endIndexExclusive?: number;
  } = {},
): ToolInteractionGroup<AiMessage>[] {
  const startIndex = Math.max(0, options.startIndex ?? 0);
  const endIndexExclusive = Math.min(messages.length, options.endIndexExclusive ?? messages.length);
  const entries = messages.slice(startIndex, endIndexExclusive).map((message, orderIndex) => ({
    value: message,
    originalIndex: startIndex + orderIndex,
    message,
  }));
  return buildToolInteractionGroups(entries);
}

export function buildToolInteractionGroupsFromStates(
  states: MessageProcessingState[],
  options: ToolInteractionGroupBuildOptions = {},
): ToolInteractionGroup<MessageProcessingState>[] {
  const normalizedPositions = getNormalizedStatePositions(states);
  const entries = states.map((state, orderIndex) => ({
    value: state,
    originalIndex: normalizedPositions[orderIndex],
    message: state.message,
  }));
  return buildToolInteractionGroups(entries, options);
}

export function findCurrentRunStartIndex(messages: AiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.type === 'user_input') {
      return index;
    }
  }
  return messages.length;
}

export function findLastUserInputOriginalIndex(states: MessageProcessingState[]): number | null {
  const normalizedPositions = getNormalizedStatePositions(states);
  let result: number | null = null;
  for (let orderIndex = 0; orderIndex < states.length; orderIndex += 1) {
    const state = states[orderIndex];
    if (state.message.role !== 'user' || state.message.type !== 'user_input') {
      continue;
    }
    const currentIndex = normalizedPositions[orderIndex];
    result = result === null ? currentIndex : Math.max(result, currentIndex);
  }
  return result;
}

function getNormalizedStatePositions(states: MessageProcessingState[]): number[] {
  const positions: number[] = [];
  let lastPosition = -1;
  for (let orderIndex = 0; orderIndex < states.length; orderIndex += 1) {
    const state = states[orderIndex];
    const rawPosition = typeof state.originalIndex === 'number' ? state.originalIndex : orderIndex;
    if (rawPosition > lastPosition) {
      positions.push(rawPosition);
      lastPosition = rawPosition;
      continue;
    }
    const nextPosition = lastPosition + 1;
    positions.push(nextPosition);
    lastPosition = nextPosition;
  }
  return positions;
}
