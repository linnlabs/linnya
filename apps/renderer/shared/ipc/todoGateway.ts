/**
 * @file apps/renderer/shared/ipc/todoGateway.ts
 * @description Todo feature IPC Gateway (Renderer side).
 *
 * This module is the sole entry point for the renderer process to communicate
 * with the main process regarding the Todo feature. It provides a type-safe
 * interface over the `window.electronAPI` for all 'todo:*' channels.
 */

import type { OperationResult } from './workspaceGateway';
import type { Todo as FrontendTodo } from '../../domains/workspace/features/todo/types';

// The full Todo type as defined on the backend.
// Duplicating this here avoids complex module resolution between frontend/backend.
export interface BackendTodo {
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

// Backend todo with project information, for overview usage on App Home.
export interface BackendTodoWithProject extends BackendTodo {
  project_name: string | null;
}

// Payload for creating a new todo. Matches backend `NewTodoPayload`.
export type NewTodoPayload = {
  projectId: string;
} & Omit<FrontendTodo, 'id'>;

// Payload for updating a todo. Matches backend `UpdateTodoPayload`.
export type UpdateTodoPayload = Partial<Omit<FrontendTodo, 'id'>>;

/**
 * The Todo IPC gateway interface.
 * Method names correspond to the handlers registered in `todo-ipc.ts`.
 */
export interface ITodoGateway {
  'get-for-project'(projectId: string): Promise<OperationResult<BackendTodo[]>>;
  'get-overview'(limit?: number): Promise<OperationResult<BackendTodoWithProject[]>>;
  'add'(payload: NewTodoPayload): Promise<OperationResult<BackendTodo>>;
  'update'(args: { todoId: string; updates: UpdateTodoPayload }): Promise<OperationResult<BackendTodo>>;
  'delete'(todoId: string): Promise<OperationResult<{ changes: number }>>;
}

class TodoGatewayImpl implements ITodoGateway {
  private electronAPI: any;

  constructor() {
    if (!(window as any).electronAPI) {
      throw new Error('[TodoGateway] window.electronAPI is not available.');
    }
    this.electronAPI = (window as any).electronAPI;
  }

  private async invoke<T>(channel: string, ...args: any[]): Promise<OperationResult<T>> {
    const ipcChannel = `todo:${channel}`;
    try {
      if (typeof this.electronAPI[ipcChannel] !== 'function') {
        throw new Error(`IPC channel "${ipcChannel}" is not defined on window.electronAPI.`);
      }
      // The backend handlers already wrap responses in { success, data/error }.
      const result = await this.electronAPI[ipcChannel](...args);
      return result as OperationResult<T>;
    } catch (error) {
      console.error(`[TodoGateway] IPC call to "${ipcChannel}" failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `Unknown IPC error on channel ${ipcChannel}`,
      };
    }
  }

  'get-for-project'(projectId: string): Promise<OperationResult<BackendTodo[]>> {
    return this.invoke('get-for-project', projectId);
  }

  'get-overview'(limit: number = 50): Promise<OperationResult<BackendTodoWithProject[]>> {
    return this.invoke('get-overview', limit);
  }

  'add'(payload: NewTodoPayload): Promise<OperationResult<BackendTodo>> {
    return this.invoke('add', payload);
  }

  'update'({ todoId, updates }: { todoId: string; updates: UpdateTodoPayload }): Promise<OperationResult<BackendTodo>> {
    return this.invoke('update', { todoId, updates });
  }

  'delete'(todoId: string): Promise<OperationResult<{ changes: number }>> {
    return this.invoke('delete', todoId);
  }
}

/**
 * Singleton instance of the Todo gateway.
 */
export const todoGateway: ITodoGateway = new TodoGatewayImpl();
