import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TODO_SCHEMAS } from '../../../../features/project-todo/infrastructure/sqlite/todo.schema';

type IpcHandler = (event: undefined, ...args: readonly unknown[]) => unknown | Promise<unknown>;

const registeredHandlers = new Map<string, IpcHandler>();
const webContentsSend = vi.fn();

async function invokeTodoUpdate(payload: unknown): Promise<unknown> {
  const handler = registeredHandlers.get('todo:update');
  if (!handler) {
    throw new Error('todo:update handler was not registered');
  }
  return handler(undefined, payload);
}

interface TodoUpdateFailure {
  readonly success: false;
  readonly error: string;
}

interface TodoUpdateSuccess {
  readonly success: true;
  readonly data: {
    readonly id: string;
    readonly project_id: string;
    readonly title: string;
    readonly status: string;
  };
}

function isFailure(value: unknown): value is TodoUpdateFailure {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && value.success === false
    && 'error' in value
    && typeof value.error === 'string'
  );
}

function isSuccess(value: unknown): value is TodoUpdateSuccess {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && value.success === true
    && 'data' in value
    && typeof value.data === 'object'
    && value.data !== null
  );
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

describe('todo IPC handlers', () => {
  let db: Database.Database;

  beforeEach(async () => {
    registeredHandlers.clear();
    webContentsSend.mockClear();
    db = new Database(':memory:');
    prepareTodoDatabase(db);
    const rendererIntegration = await import('../../../../app-hosts/linnya/desktop-capabilities');
    rendererIntegration.clearBackendRendererIntegrationPortForTesting();
    rendererIntegration.installBackendRendererIntegrationPort({
      connectModelCatalogUpdates: async () => () => undefined,
      publishIngestionStatus: vi.fn(),
      queueJobPresentationPublisher: {
        publishProgress: vi.fn(),
        publishCompletion: vi.fn(),
        publishFailure: vi.fn(),
      },
      publishKnowledgeGraphProgress: vi.fn(),
      publishTranscriptionProgress: vi.fn(),
      publishWorkspaceMutation: vi.fn(),
      publishPluginRendererPush: vi.fn(),
      publishTodosChanged: projectId => webContentsSend('todos-changed', { projectId }),
      publishModelsChanged: vi.fn(),
      publishPluginsChanged: vi.fn(),
    });
    const { registerTodoHandlers } = await import('./todo-ipc');
    registerTodoHandlers({
      getServices: () => ({
        databaseService: {
          getDb: () => db,
        },
      }),
    }, {
      handle: (channel, handler) => {
        registeredHandlers.set(channel, handler);
      },
    });
  });

  afterEach(async () => {
    db.close();
    const rendererIntegration = await import('../../../../app-hosts/linnya/desktop-capabilities');
    rendererIntegration.clearBackendRendererIntegrationPortForTesting();
  });

  it('rejects contract-external update keys without notifying renderer', async () => {
    const { TodoService } = await import('../../../../features/project-todo/infrastructure/sqlite/todo.service');
    const todo = new TodoService(db).addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
    });

    const result = await invokeTodoUpdate({
      todoId: todo.id,
      updates: { projectId: 'project-2' },
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toContain('Todo update field is not allowed: projectId');
    }
    expect(webContentsSend).not.toHaveBeenCalled();
  });

  it('rejects malformed update payloads before reaching service', async () => {
    const result = await invokeTodoUpdate({
      todoId: 'todo-1',
      updates: null,
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toBe('todo:update updates must be an object');
    }
    expect(webContentsSend).not.toHaveBeenCalled();
  });

  it('updates legal payloads and emits todos-changed', async () => {
    const { TodoService } = await import('../../../../features/project-todo/infrastructure/sqlite/todo.service');
    const todo = new TodoService(db).addTodo({
      projectId: 'project-1',
      title: 'Initial',
      status: 'todo',
    });

    const result = await invokeTodoUpdate({
      todoId: todo.id,
      updates: { status: 'completed' },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toMatchObject({
        id: todo.id,
        project_id: 'project-1',
        status: 'completed',
      });
    }
    expect(webContentsSend).toHaveBeenCalledWith('todos-changed', { projectId: 'project-1' });
  });
});
