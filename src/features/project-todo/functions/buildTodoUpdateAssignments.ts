import { TodoUpdateFieldNotAllowedError, TodoUpdatePayloadInvalidError } from '../definitions/todoErrors';

export type TodoUpdateAssignmentValue = string | null;

export interface TodoUpdateAssignments {
  readonly fields: readonly string[];
  readonly values: readonly TodoUpdateAssignmentValue[];
}

function readString(field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new TodoUpdatePayloadInvalidError(`Todo update field ${field} must be a string`);
  }
  return value;
}

function readStringArray(field: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TodoUpdatePayloadInvalidError(`Todo update field ${field} must be a string array`);
  }
  return value;
}

function readStatus(value: unknown): string {
  const status = readString('status', value);
  if (status !== 'scheduled' && status !== 'todo' && status !== 'completed') {
    throw new TodoUpdatePayloadInvalidError(`Todo update field status has unsupported value: ${status}`);
  }
  return status;
}

function readPriority(value: unknown): string {
  const priority = readString('priority', value);
  if (priority !== 'high' && priority !== 'medium' && priority !== 'low') {
    throw new TodoUpdatePayloadInvalidError(`Todo update field priority has unsupported value: ${priority}`);
  }
  return priority;
}

function toJsonOrNull(value: readonly string[]): string | null {
  return value.length > 0 ? JSON.stringify(value) : null;
}

export function buildTodoUpdateAssignments(updates: Record<string, unknown>): TodoUpdateAssignments {
  const fields: string[] = [];
  const values: TodoUpdateAssignmentValue[] = [];

  for (const [field, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }

    switch (field) {
      case 'title':
        fields.push('title = ?');
        values.push(readString(field, value));
        break;
      case 'description':
        fields.push('description = ?');
        values.push(readString(field, value));
        break;
      case 'status':
        fields.push('status = ?');
        values.push(readStatus(value));
        break;
      case 'priority':
        fields.push('priority = ?');
        values.push(readPriority(value));
        break;
      case 'customTags':
        fields.push('custom_tags_json = ?');
        values.push(toJsonOrNull(readStringArray(field, value)));
        break;
      case 'dueDate':
        fields.push('due_date = ?');
        values.push(readString(field, value));
        break;
      case 'dueTime':
        fields.push('due_time = ?');
        values.push(readString(field, value));
        break;
      default:
        throw new TodoUpdateFieldNotAllowedError(field);
    }
  }

  return { fields, values };
}
