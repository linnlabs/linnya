import { defineStore } from 'pinia';
import type { Todo, TodoState } from '../definitions/todo';
import { todoSelectors } from '../functions/projectTodoState';

/** Pinia 仅持有待办状态，IPC 和事件订阅归 feature 的 runtime。 */
export const useTodoStore = defineStore('todo', {
  state: (): TodoState => ({ todos: [], isLoading: false }),
  getters: {
    todayTasks: state => todoSelectors.todayTasks(state.todos, new Date()),
    overdueTasks: state => todoSelectors.overdueTasks(state.todos, new Date()),
    futureTasks: state => todoSelectors.futureTasks(state.todos, new Date()),
    todoTasks: state => todoSelectors.todoTasks(state.todos),
    completedTasks: state => todoSelectors.completedTasks(state.todos),
    allScheduledTasks: state => todoSelectors.allScheduledTasks(state.todos),
  },
  actions: {
    setLoading(value: boolean) {
      this.isLoading = value;
    },
    replaceTodos(todos: Todo[]) {
      this.todos = todos;
    },
    prependTodo(todo: Todo) {
      this.todos.unshift(todo);
    },
    replaceTodo(todo: Todo, moveToFront = false) {
      const index = this.todos.findIndex(item => item.id === todo.id);
      if (index === -1) return;
      if (moveToFront) {
        this.todos.splice(index, 1);
        this.todos.unshift(todo);
      } else this.todos[index] = todo;
    },
    removeTodo(id: string) {
      this.todos = this.todos.filter(todo => todo.id !== id);
    },
  },
});
