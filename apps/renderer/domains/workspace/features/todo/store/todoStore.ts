import { defineStore } from 'pinia';
import type { Todo } from '../types';
import { todoGateway, BackendTodo, NewTodoPayload } from '../../../../../shared/ipc/todoGateway';
import { useWorkspaceProjectsStore } from '../../../store';

let isListenerRegistered = false;

function mapBackendToFrontend(backendTodo: BackendTodo): Todo {
  return {
    id: backendTodo.id,
    title: backendTodo.title,
    description: backendTodo.description ?? undefined,
    status: backendTodo.status,
    priority: backendTodo.priority ?? undefined,
    customTags: backendTodo.custom_tags_json ? JSON.parse(backendTodo.custom_tags_json) : undefined,
    dueDate: backendTodo.due_date ?? undefined,
    dueTime: backendTodo.due_time ?? undefined,
  };
}


export const useTodoStore = defineStore('todo', {
  state: () => ({
    todos: [] as Todo[],
    isLoading: false,
  }),
  getters: {
    todayTasks: (state) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = today.getTime();

      return state.todos.filter((todo) => {
        if (todo.status !== 'scheduled' || !todo.dueDate) return false;
        // By appending T00:00:00, we ensure the date is parsed in the local timezone, not UTC.
        const dueDate = new Date(`${todo.dueDate}T00:00:00`);
        return dueDate.getTime() === todayTimestamp;
      }).sort((a, b) => {
        if (a.dueTime && b.dueTime) {
          return a.dueTime.localeCompare(b.dueTime);
        }
        if (a.dueTime) return -1; // a has time, b doesn't, so a comes first
        if (b.dueTime) return 1;  // b has time, a doesn't, so b comes first
        return 0; // Both have no time
      });
    },
    overdueTasks: (state) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = today.getTime();

      return state.todos.filter((todo) => {
        if (todo.status === 'completed' || !todo.dueDate) return false;
        const dueDate = new Date(`${todo.dueDate}T00:00:00`);
        return dueDate.getTime() < todayTimestamp;
      }).sort((a, b) => {
        const dateA = new Date(a.dueDate!);
        const dateB = new Date(b.dueDate!);
        return dateA.getTime() - dateB.getTime();
      });
    },
    futureTasks: (state) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = today.getTime();

      return state.todos.filter((todo) => {
        if (todo.status !== 'scheduled' || !todo.dueDate) return false;
        // Same timezone fix here.
        const dueDate = new Date(`${todo.dueDate}T00:00:00`);
        return dueDate.getTime() > todayTimestamp;
      }).sort((a, b) => {
        // Both `a` and `b` are guaranteed to have `dueDate` by the filter logic.
        const dateA = new Date(a.dueDate!);
        const dateB = new Date(b.dueDate!);

        if (dateA.getTime() !== dateB.getTime()) {
          return dateA.getTime() - dateB.getTime();
        }

        // If dates are the same, sort by time.
        if (a.dueTime && b.dueTime) {
          return a.dueTime.localeCompare(b.dueTime);
        }
        if (a.dueTime) return -1;
        if (b.dueTime) return 1;
        return 0;
      });
    },
    todoTasks: state => state.todos.filter(todo => todo.status === 'todo'),
    completedTasks: state => state.todos.filter(todo => todo.status === 'completed'),
    allScheduledTasks: state => state.todos.filter(todo => todo.status === 'scheduled'),
  },
  actions: {
    // 🔥 新增：监听后端推送的待办变更事件
    listenForChanges() {
      if (isListenerRegistered || !(window as any).electronAPI) {
        return;
      }

      console.log('[TodoStore] Registering listener for "todos-changed"...');
      (window as any).electronAPI.on('todos-changed', ({ projectId }: { projectId: string }) => {
        console.log(`[TodoStore] Received "todos-changed" event for project: ${projectId}`);
        const projectsStore = useWorkspaceProjectsStore();
        if (projectsStore.activeProjectId === projectId) {
          console.log('[TodoStore] Active project matches, fetching updated todos.');
          this.fetchTodos(projectId);
        } else {
          console.log('[TodoStore] Project does not match active project, ignoring.');
        }
      });
      
      isListenerRegistered = true;
    },

    async fetchTodos(projectId: string) {
      this.isLoading = true;
      try {
        const result = await todoGateway['get-for-project'](projectId);
        if (result.success) {
          this.todos = result.data.map(mapBackendToFrontend);
        } else {
          console.error('Failed to fetch todos:', result.error);
          this.todos = [];
        }
      } catch (error) {
        console.error('Error fetching todos:', error);
        this.todos = [];
      } finally {
        this.isLoading = false;
      }
    },

    async addTodo(projectId: string, todo: Omit<Todo, 'id'>) {
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
        const newTodo = mapBackendToFrontend(result.data);
        this.todos.unshift(newTodo);
      } else {
        console.error('Failed to add todo:', result.error);
        // Optionally, show an error to the user
      }
    },

    async updateTodo(todoId: string, updates: Partial<Omit<Todo, 'id'>>) {
      const sanitizedUpdates: Partial<Omit<Todo, 'id'>> = { ...updates };
      if ('customTags' in updates) {
        sanitizedUpdates.customTags = updates.customTags
          ? [...updates.customTags]
          : undefined;
      }
      const result = await todoGateway.update({ todoId, updates: sanitizedUpdates });
      if (result.success) {
        const updatedTodo = mapBackendToFrontend(result.data);
        const index = this.todos.findIndex(t => t.id === todoId);
        if (index !== -1) {
          this.todos[index] = updatedTodo;
        }
      } else {
        console.error('Failed to update todo:', result.error);
      }
    },

    async toggleComplete(id: string) {
      const todo = this.todos.find(t => t.id === id);
      if (!todo) return;

      const isCompleting = todo.status !== 'completed';
      const newStatus = isCompleting 
        ? 'completed'
        : (todo.dueDate ? 'scheduled' : 'todo');

      const result = await todoGateway.update({ todoId: id, updates: { status: newStatus } });

      if (result.success) {
        const updatedTodo = mapBackendToFrontend(result.data);
        const index = this.todos.findIndex(t => t.id === id);
        
        if (index !== -1) {
          if (isCompleting) {
            // When completing, move to the top of the list.
            this.todos.splice(index, 1);
            this.todos.unshift(updatedTodo);
          } else {
            // When un-completing, update in place.
            this.todos[index] = updatedTodo;
          }
        }
      } else {
        console.error('Failed to toggle todo complete status:', result.error);
      }
    },

    async deleteTodo(id: string) {
      const result = await todoGateway.delete(id);
      if (result.success && result.data.changes > 0) {
        this.todos = this.todos.filter(t => t.id !== id);
      } else {
        if (!result.success) {
          console.error('Failed to delete todo:', result.error);
        }
        // If changes is 0, it was likely already deleted or didn't exist.
        // We can remove it from the local state just in case.
        this.todos = this.todos.filter(t => t.id !== id);
      }
    },
  },
});
