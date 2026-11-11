import { z } from 'zod';
import type { BackendTodo } from '@/shared/ipc/todoGateway';
import type { Todo } from '../definitions/todo';

const customTagsSchema = z.array(z.string());

/** 数据库存储 JSON；Renderer 只投影已定义的待办字段。 */
export function projectTodoRecord(record: BackendTodo): Todo {
  return {
    id: record.id,
    title: record.title,
    description: record.description ?? undefined,
    status: record.status,
    priority: record.priority ?? undefined,
    customTags: record.custom_tags_json
      ? customTagsSchema.parse(JSON.parse(record.custom_tags_json))
      : undefined,
    dueDate: record.due_date ?? undefined,
    dueTime: record.due_time ?? undefined,
  };
}

export function resolveToggledTodoStatus(todo: Todo): Todo['status'] {
  return todo.status !== 'completed' ? 'completed' : todo.dueDate ? 'scheduled' : 'todo';
}
