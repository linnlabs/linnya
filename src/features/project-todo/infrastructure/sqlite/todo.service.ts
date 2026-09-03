/**
 * @file todo.service.ts
 * @description TodoService - Manages Todo items within a project.
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { buildTodoUpdateAssignments, type TodoUpdateAssignmentValue } from '../../functions/buildTodoUpdateAssignments';

// Backend representation of a Todo item, including database-specific fields.
export interface Todo {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'scheduled' | 'todo' | 'completed';
  priority: 'high' | 'medium' | 'low' | null;
  custom_tags_json: string | null; // Stored as a JSON string
  due_date: string | null;
  due_time: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

// Type for creating a new Todo, based on frontend structure.
export type NewTodoPayload = {
  projectId: string;
  title: string;
  description?: string;
  status: 'scheduled' | 'todo' | 'completed';
  priority?: 'high' | 'medium' | 'low';
  customTags?: string[];
  dueDate?: string;
  dueTime?: string;
};

// Type for updating an existing Todo. All fields are optional.
export type UpdateTodoPayload = Partial<Omit<NewTodoPayload, 'projectId'>>;

interface TodoRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'scheduled' | 'todo' | 'completed';
  priority: 'high' | 'medium' | 'low' | null;
  custom_tags_json: string | null;
  due_date: string | null;
  due_time: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface TodoOverviewRow extends TodoRow {
  project_name: string | null;
}

function mapRowToTodo(row: TodoRow): Todo {
  return {
    ...row,
    description: row.description ?? null,
    priority: row.priority ?? null,
    custom_tags_json: row.custom_tags_json ?? null,
    due_date: row.due_date ?? null,
    due_time: row.due_time ?? null,
    deleted_at: row.deleted_at ?? null,
  };
}


export class TodoService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }
  
  private getTodo(id: string): Todo | null {
    const stmt = this.db.prepare<[string], TodoRow>('SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL');
    const row = stmt.get(id);
    return row ? mapRowToTodo(row) : null;
  }

  /**
   * Retrieves a single todo by its ID.
   */
  getTodoById(id: string): Todo | null {
    return this.getTodo(id);
  }

  /**
   * Retrieves all non-deleted todos for a specific project.
   */
  getTodosForProject(projectId: string): Todo[] {
    const stmt = this.db.prepare<[string], TodoRow>(`
      SELECT * FROM todos
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(projectId);
    return rows.map(mapRowToTodo);
  }

  /**
   * Retrieves a global overview of todos across all projects, joined with project names.
   * Intended for the App Home view.
   */
  getTodosOverview(limit: number = 50): (Todo & { project_name: string | null })[] {
    const stmt = this.db.prepare<[number], TodoOverviewRow>(`
      SELECT t.*, p.name AS project_name
      FROM todos t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.deleted_at IS NULL
      ORDER BY t.created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit);
    // Ensure nullable fields are normalized in the same way as other getters
    return rows.map((row) => {
      const todo = mapRowToTodo(row);
      return {
        ...todo,
        project_name: row.project_name ?? null,
      };
    });
  }

  /**
   * Adds a new todo to a project.
   */
  addTodo(payload: NewTodoPayload): Todo {
    const now = Date.now();
    const id = uuidv4();
    
    const custom_tags_json = payload.customTags && payload.customTags.length > 0
      ? JSON.stringify(payload.customTags) 
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO todos (
        id, project_id, title, description, status, priority, 
        custom_tags_json, due_date, due_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      payload.projectId,
      payload.title,
      payload.description || null,
      payload.status,
      payload.priority || null,
      custom_tags_json,
      payload.dueDate || null,
      payload.dueTime || null,
      now,
      now
    );

    const createdTodo = this.getTodo(id);
    if (!createdTodo) {
      throw new Error(`[TodoService] addTodo: Todo with id ${id} was inserted but could not be read back.`);
    }
    return createdTodo;
  }

  /**
   * Updates an existing todo item.
   */
  updateTodo(todoId: string, updates: Record<string, unknown>): Todo | null {
    const existingTodo = this.getTodo(todoId);
    if (!existingTodo) {
      console.warn(`[TodoService] updateTodo: Todo with id ${todoId} not found.`);
      return null;
    }

    const assignments = buildTodoUpdateAssignments(updates);
    const fields = [...assignments.fields];
    const values: Array<TodoUpdateAssignmentValue | number> = [...assignments.values];
    
    if (fields.length === 0) {
      return existingTodo; // No fields to update
    }

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(todoId);

    const stmt = this.db.prepare(`
      UPDATE todos
      SET ${fields.join(', ')}
      WHERE id = ? AND deleted_at IS NULL
    `);

    const result = stmt.run(...values);

    if (result.changes === 0) {
      // This might happen in a race condition, but it's unlikely.
      console.warn(`[TodoService] updateTodo: Failed to update todo with id ${todoId}.`);
      return null;
    }
    
    return this.getTodo(todoId);
  }

  /**
   * Soft-deletes a todo item.
   */
  deleteTodo(todoId: string): { changes: number } {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE todos
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `);
    
    const result = stmt.run(now, now, todoId);
    
    if (result.changes === 0) {
      console.warn(`[TodoService] deleteTodo: Todo with id ${todoId} not found or already deleted.`);
    }
    return { changes: result.changes };
  }
}
