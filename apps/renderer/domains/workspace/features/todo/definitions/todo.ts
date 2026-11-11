export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: 'scheduled' | 'todo' | 'completed';
  priority?: 'high' | 'medium' | 'low';
  customTags?: string[];
  dueDate?: string;
  dueTime?: string;
}

export interface TodoState {
  todos: Todo[];
  isLoading: boolean;
}
