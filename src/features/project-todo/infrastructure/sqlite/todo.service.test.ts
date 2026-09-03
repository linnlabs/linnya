import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TodoUpdateFieldNotAllowedError } from '../../definitions/todoErrors';
import { TODO_SCHEMAS } from './todo.schema';
import { TodoService } from './todo.service';

interface RawTodoRow {
  readonly project_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: string | null;
  readonly custom_tags_json: string | null;
  readonly due_date: string | null;
  readonly due_time: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly deleted_at: number | null;
}

function readRawTodo(db: Database.Database, todoId: string): RawTodoRow {
  const row = db.prepare<[string], RawTodoRow>('SELECT * FROM todos WHERE id = ?').get(todoId);
  if (!row) {
    throw new Error(`Missing todo row: ${todoId}`);
  }
  return row;
}

function prepareTodoDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-1', 'Project 1');
  for (const ddl of TODO_SCHEMAS) {
    db.exec(ddl);
  }
}

describe('TodoService updateTodo', () => {
  let db: Database.Database;
  let service: TodoService;

  beforeEach(() => {
    db = new Database(':memory:');
    prepareTodoDatabase(db);
    service = new TodoService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('updates every allowed field with explicit column mappings', () => {
    const todo = service.addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
    });

    const updated = service.updateTodo(todo.id, {
      title: 'Updated',
      description: 'Notes',
      status: 'scheduled',
      priority: 'low',
      customTags: ['a', 'b'],
      dueDate: '2026-06-24',
      dueTime: '09:30',
    });

    expect(updated).toMatchObject({
      id: todo.id,
      project_id: 'project-1',
      title: 'Updated',
      description: 'Notes',
      status: 'scheduled',
      priority: 'low',
      custom_tags_json: '["a","b"]',
      due_date: '2026-06-24',
      due_time: '09:30',
      deleted_at: null,
    });
  });

  it('does not clear custom tags when customTags is undefined', () => {
    const todo = service.addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
      customTags: ['keep'],
    });

    service.updateTodo(todo.id, { customTags: undefined });

    expect(readRawTodo(db, todo.id).custom_tags_json).toBe('["keep"]');
  });

  it('throws for contract-external projectId without changing project_id', () => {
    const todo = service.addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
    });

    expect(() => service.updateTodo(todo.id, { projectId: 'project-2' }))
      .toThrow(TodoUpdateFieldNotAllowedError);

    expect(readRawTodo(db, todo.id).project_id).toBe('project-1');
  });

  it('throws for contract-external deletedAt without changing deleted_at', () => {
    const todo = service.addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
    });

    expect(() => service.updateTodo(todo.id, { deletedAt: Date.now() }))
      .toThrow(TodoUpdateFieldNotAllowedError);

    expect(readRawTodo(db, todo.id).deleted_at).toBeNull();
  });

  it('throws for unknown keys before they can become SQL identifiers', () => {
    const todo = service.addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
    });

    expect(() => service.updateTodo(todo.id, { arbitraryColumn: 'value' }))
      .toThrow(TodoUpdateFieldNotAllowedError);

    expect(readRawTodo(db, todo.id).title).toBe('Initial');
  });
});
