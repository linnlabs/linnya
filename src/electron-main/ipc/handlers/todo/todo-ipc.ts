/**
 * @file todo-ipc.ts
 * @description IPC handlers for the Todo feature.
 */

import { Logger } from '../../../../shared/logger';
import { TodoService, NewTodoPayload } from '../../../../features/project-todo/infrastructure/sqlite/todo.service';
import { getBackendRendererIntegrationPort } from '../../../../app-hosts/linnya/desktop-capabilities';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';

const logger = new Logger('TodoIPC');

interface TodoHandlerServicesPort {
  getServices(): {
    readonly databaseService?: {
      getDb(): ConstructorParameters<typeof TodoService>[0];
    } | null;
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUpdateTodoArgs(value: unknown): { todoId: string; updates: Record<string, unknown> } {
  if (!isRecord(value)) {
    throw new Error('todo:update payload must be an object');
  }
  const { todoId, updates } = value;
  if (typeof todoId !== 'string' || todoId.trim().length === 0) {
    throw new Error('todo:update todoId must be a non-empty string');
  }
  if (!isRecord(updates)) {
    throw new Error('todo:update updates must be an object');
  }
  return { todoId, updates };
}

/**
 * Sends a notification to the renderer process that todos have changed for a project.
 * @param projectId The ID of the project whose todos were updated.
 */
function notifyTodosChanged(projectId: string) {
  logger.info(`🚀 Notifying renderer of todo changes for project: ${projectId}`);
  getBackendRendererIntegrationPort().publishTodosChanged(projectId);
}

export function registerTodoHandlers(
  servicesPort: TodoHandlerServicesPort,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  logger.info('🔌 [IPC-LIFECYCLE] REGISTER | Registering all Todo IPC handlers...');

  const services = servicesPort.getServices();
  const databaseService = services.databaseService;

  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | ❌ DatabaseService not available for Todos!');
    return;
  }

  // Helper to get a fresh TodoService instance with the active DB connection
  const getTodoService = () => new TodoService(databaseService.getDb());

  // Get a global overview of todos across all projects (for App Home)
  ipcMain.handle('todo:get-overview', async (_event, limit?: number) => {
    try {
      const todoService = getTodoService();
      const todos = todoService.getTodosOverview(typeof limit === 'number' ? limit : 50);
      return { success: true, data: todos };
    } catch (error: unknown) {
      logger.error('[todo:get-overview] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get all todos for a project
  ipcMain.handle('todo:get-for-project', async (event, projectId: string) => {
    try {
      if (!projectId) {
        return { success: false, error: 'projectId is required' };
      }
      const todoService = getTodoService();
      const todos = todoService.getTodosForProject(projectId);
      return { success: true, data: todos };
    } catch (error: unknown) {
      logger.error(`[todo:get-for-project] Error for projectId=${projectId}:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Add a new todo
  ipcMain.handle('todo:add', async (event, payload: NewTodoPayload) => {
    try {
      const todoService = getTodoService();
      const newTodo = todoService.addTodo(payload);
      if (newTodo) {
        notifyTodosChanged(payload.projectId); // 🔥 Notify on add
      }
      return { success: true, data: newTodo };
    } catch (error: unknown) {
      logger.error('[todo:add] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Update a todo
  ipcMain.handle('todo:update', async (_event, rawArgs: unknown) => {
    let todoId = '(invalid)';
    try {
      const args = readUpdateTodoArgs(rawArgs);
      todoId = args.todoId;
      const todoService = getTodoService();
      const updatedTodo = todoService.updateTodo(args.todoId, args.updates);
      if (!updatedTodo) {
        return { success: false, error: `Todo with id ${args.todoId} not found or failed to update.` };
      }
      notifyTodosChanged(updatedTodo.project_id); // 🔥 Notify on update
      return { success: true, data: updatedTodo };
    } catch (error: unknown) {
      logger.error(`[todo:update] Error for todoId=${todoId}:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Delete a todo
  ipcMain.handle('todo:delete', async (event, todoId: string) => {
    try {
      const todoService = getTodoService();
      // We need to know the project ID before deleting.
      const todoToDelete = todoService.getTodoById(todoId);
      const projectId = todoToDelete?.project_id;
      
      const result = todoService.deleteTodo(todoId);
      
      if (result.changes > 0 && projectId) {
        notifyTodosChanged(projectId); // 🔥 Notify on delete
      }
      
      if (result.changes === 0) {
        // This isn't a critical error, just a warning that no rows were affected.
        logger.warn(`[todo:delete] Attempted to delete todoId=${todoId}, but no rows were changed.`);
      }
      return { success: true, data: { changes: result.changes } };
    } catch (error: unknown) {
      logger.error(`[todo:delete] Error for todoId=${todoId}:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  logger.info('✅ [IPC-LIFECYCLE] REGISTER | All Todo IPC handlers registered.');
}
