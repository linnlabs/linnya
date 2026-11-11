import type { Todo } from '../definitions/todo';

export const todoSelectors = {
  todayTasks: (todos: readonly Todo[], now: Date) => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    return todos
      .filter((todo): todo is Todo & { dueDate: string } => {
        if (todo.status !== 'scheduled' || !todo.dueDate) return false;
        // By appending T00:00:00, we ensure the date is parsed in the local timezone, not UTC.
        const dueDate = new Date(`${todo.dueDate}T00:00:00`);
        return dueDate.getTime() === todayTimestamp;
      })
      .sort((a, b) => {
        if (a.dueTime && b.dueTime) {
          return a.dueTime.localeCompare(b.dueTime);
        }
        if (a.dueTime) return -1; // a has time, b doesn't, so a comes first
        if (b.dueTime) return 1; // b has time, a doesn't, so b comes first
        return 0; // Both have no time
      });
  },
  overdueTasks: (todos: readonly Todo[], now: Date) => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    return todos
      .filter((todo): todo is Todo & { dueDate: string } => {
        if (todo.status === 'completed' || !todo.dueDate) return false;
        const dueDate = new Date(`${todo.dueDate}T00:00:00`);
        return dueDate.getTime() < todayTimestamp;
      })
      .sort((a, b) => {
        const dateA = new Date(a.dueDate);
        const dateB = new Date(b.dueDate);
        return dateA.getTime() - dateB.getTime();
      });
  },
  futureTasks: (todos: readonly Todo[], now: Date) => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    return todos
      .filter((todo): todo is Todo & { dueDate: string } => {
        if (todo.status !== 'scheduled' || !todo.dueDate) return false;
        // Same timezone fix here.
        const dueDate = new Date(`${todo.dueDate}T00:00:00`);
        return dueDate.getTime() > todayTimestamp;
      })
      .sort((a, b) => {
        // Both `a` and `b` are guaranteed to have `dueDate` by the filter logic.
        const dateA = new Date(a.dueDate);
        const dateB = new Date(b.dueDate);

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
  todoTasks: (todos: readonly Todo[]) => todos.filter(todo => todo.status === 'todo'),
  completedTasks: (todos: readonly Todo[]) => todos.filter(todo => todo.status === 'completed'),
  allScheduledTasks: (todos: readonly Todo[]) => todos.filter(todo => todo.status === 'scheduled'),
};
