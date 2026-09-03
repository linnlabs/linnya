import { describe, expect, it } from 'vitest';
import { TodoUpdateFieldNotAllowedError, TodoUpdatePayloadInvalidError } from '../definitions/todoErrors';
import { buildTodoUpdateAssignments } from './buildTodoUpdateAssignments';

describe('buildTodoUpdateAssignments', () => {
  it('builds explicit assignments for allowed todo fields', () => {
    const result = buildTodoUpdateAssignments({
      title: 'Plan',
      description: 'Details',
      status: 'scheduled',
      priority: 'high',
      customTags: ['work', 'today'],
      dueDate: '2026-06-24',
      dueTime: '10:30',
    });

    expect(result.fields).toEqual([
      'title = ?',
      'description = ?',
      'status = ?',
      'priority = ?',
      'custom_tags_json = ?',
      'due_date = ?',
      'due_time = ?',
    ]);
    expect(result.values).toEqual([
      'Plan',
      'Details',
      'scheduled',
      'high',
      '["work","today"]',
      '2026-06-24',
      '10:30',
    ]);
  });

  it('skips undefined values, including customTags', () => {
    const result = buildTodoUpdateAssignments({
      title: undefined,
      customTags: undefined,
    });

    expect(result.fields).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it('clears customTags with an empty array', () => {
    const result = buildTodoUpdateAssignments({ customTags: [] });

    expect(result.fields).toEqual(['custom_tags_json = ?']);
    expect(result.values).toEqual([null]);
  });

  it('rejects contract-external fields before SQL construction', () => {
    expect(() => buildTodoUpdateAssignments({ projectId: 'project-2' }))
      .toThrow(TodoUpdateFieldNotAllowedError);
    expect(() => buildTodoUpdateAssignments({ deletedAt: Date.now() }))
      .toThrow(TodoUpdateFieldNotAllowedError);
  });

  it('rejects unsupported enum values', () => {
    expect(() => buildTodoUpdateAssignments({ status: 'archived' }))
      .toThrow(TodoUpdatePayloadInvalidError);
    expect(() => buildTodoUpdateAssignments({ priority: 'urgent' }))
      .toThrow(TodoUpdatePayloadInvalidError);
  });
});
