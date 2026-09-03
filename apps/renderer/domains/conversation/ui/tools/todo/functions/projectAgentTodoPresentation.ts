import {
  AgentTodoToolResultSchema,
  AgentTodoWriteResultSchema,
  type AgentTodoToolItem,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  AgentTodoPresentationCounts,
  AgentTodoPresentationData,
  AgentTodoPresentationOperation,
} from '../definitions/agentTodoPresentation';

export function projectAgentTodoPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<AgentTodoPresentationData> {
  const operation = readAgentTodoOperation(input.uiKey);
  if (input.status !== 'success') {
    return {
      data: { kind: 'lifecycle', operation },
      title: createConversationToolTitleDescriptor(
        operation === 'read'
          ? 'conversation.tool.todo.read'
          : 'conversation.tool.todo.update',
      ),
    };
  }

  const todo = operation === 'read'
    ? AgentTodoToolResultSchema.parse(input.result).data
    : AgentTodoWriteResultSchema.parse(input.result).data;
  const counts = countAgentTodoItems(todo.items);
  const title = operation === 'read'
    ? createConversationToolTitleDescriptor(
        counts.total === 0
          ? 'conversation.tool.todo.empty'
          : 'conversation.tool.todo.readCount',
        counts.total === 0 ? undefined : { count: counts.total },
      )
    : createConversationToolTitleDescriptor(
        counts.total === 0
          ? 'conversation.tool.todo.update'
          : 'conversation.tool.todo.updateCount',
        counts.total === 0 ? undefined : { count: counts.total },
      );

  return {
    data: {
      kind: 'snapshot',
      operation,
      todo,
      items: todo.items,
      counts,
      progressPercent: counts.total === 0
        ? 0
        : Math.round((counts.completed / counts.total) * 100),
    },
    title,
    hideContent: operation === 'read' && counts.total === 0,
  };
}

function readAgentTodoOperation(uiKey: string): AgentTodoPresentationOperation {
  if (uiKey === 'todo_read') return 'read';
  if (uiKey === 'todo_write') return 'write';
  throw new Error(`Unsupported AgentTodo presentation key: ${uiKey}`);
}

function countAgentTodoItems(items: readonly AgentTodoToolItem[]): AgentTodoPresentationCounts {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  let cancelled = 0;
  for (const item of items) {
    if (item.status === 'pending') pending += 1;
    else if (item.status === 'in_progress') inProgress += 1;
    else if (item.status === 'completed') completed += 1;
    else cancelled += 1;
  }
  return { pending, inProgress, completed, cancelled, total: items.length };
}
