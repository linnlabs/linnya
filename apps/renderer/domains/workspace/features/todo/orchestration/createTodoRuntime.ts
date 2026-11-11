import { z } from 'zod';
import { todoGateway } from '@/shared/ipc/todoGateway';
import type { NewTodoPayload } from '@/shared/ipc/todoGateway';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import type { useTodoStore } from '../store/todoStore';
import type { Todo } from '../definitions/todo';
import { projectTodoRecord, resolveToggledTodoStatus } from '../functions/projectTodoRecord';

const changeSchema = z.object({ projectId: z.string() });

export function createTodoRuntime(state: ReturnType<typeof useTodoStore>) {
  let listenerRegistered = false;
  function listenForChanges() {
    if (listenerRegistered || !window.electronAPI) return;
    window.electronAPI.on('todos-changed', payload => {
      const { projectId } = changeSchema.parse(payload);
      if (useWorkspaceProjectsStore().activeProjectId === projectId) void fetchTodos(projectId);
    });
    listenerRegistered = true;
  }
  async function fetchTodos(projectId: string) {
    state.setLoading(true);
    try {
      const result = await todoGateway['get-for-project'](projectId);
      if (result.success) {
        state.replaceTodos(result.data.map(projectTodoRecord));
      } else {
        console.error('Failed to fetch todos:', result.error);
        state.replaceTodos([]);
      }
    } catch (error) {
      console.error('Error fetching todos:', error);
      state.replaceTodos([]);
    } finally {
      state.setLoading(false);
    }
  }

  async function addTodo(projectId: string, todo: Omit<Todo, 'id'>) {
    // Vue wraps arrays in Proxies which can't cross the IPC boundary, so unwrap tags.
    const plainCustomTags = todo.customTags ? [...todo.customTags] : undefined;
    const payload: NewTodoPayload = {
      projectId,
      title: todo.title,
      description: todo.description,
      status: todo.status,
      priority: todo.priority,
      customTags: plainCustomTags,
      dueDate: todo.dueDate,
      dueTime: todo.dueTime,
    };
    const result = await todoGateway.add(payload);
    if (result.success) {
      const newTodo = projectTodoRecord(result.data);
      state.prependTodo(newTodo);
    } else {
      console.error('Failed to add todo:', result.error);
    }
  }

  async function updateTodo(todoId: string, updates: Partial<Omit<Todo, 'id'>>) {
    const sanitizedUpdates: Partial<Omit<Todo, 'id'>> = { ...updates };
    if ('customTags' in updates) {
      sanitizedUpdates.customTags = updates.customTags ? [...updates.customTags] : undefined;
    }
    const result = await todoGateway.update({ todoId, updates: sanitizedUpdates });
    if (result.success) {
      const updatedTodo = projectTodoRecord(result.data);
      state.replaceTodo(updatedTodo);
    } else {
      console.error('Failed to update todo:', result.error);
    }
  }

  async function toggleComplete(id: string) {
    const todo = state.todos.find(t => t.id === id);
    if (!todo) return;

    const isCompleting = todo.status !== 'completed';
    const newStatus = resolveToggledTodoStatus(todo);

    const result = await todoGateway.update({ todoId: id, updates: { status: newStatus } });

    if (result.success) {
      const updatedTodo = projectTodoRecord(result.data);
      state.replaceTodo(updatedTodo, isCompleting);
    } else {
      console.error('Failed to toggle todo complete status:', result.error);
    }
  }

  async function deleteTodo(id: string) {
    const result = await todoGateway.delete(id);
    if (!result.success) console.error('Failed to delete todo:', result.error);
    // 保持既有交互：后端报告已不存在或失败时，也移除本地条目。
    state.removeTodo(id);
  }
  return { listenForChanges, fetchTodos, addTodo, updateTodo, toggleComplete, deleteTodo };
}
