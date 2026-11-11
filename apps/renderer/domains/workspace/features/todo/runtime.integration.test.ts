// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import type { BackendTodo } from '@/shared/ipc/todoGateway';
import { useWorkspaceProjectsStore } from '../../store/WorkspaceProjectsStore';
import { useTodoStore } from './store/todoStore';
import { useTodoActions } from './runtime';

const gateway = vi.hoisted(() => ({
  'get-for-project': vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/shared/ipc/todoGateway', () => ({ todoGateway: gateway }));
function record(id: string, fields: Partial<BackendTodo> = {}): BackendTodo {
  return {
    id,
    project_id: 'p',
    title: id,
    description: null,
    status: 'todo',
    priority: null,
    custom_tags_json: null,
    due_date: null,
    due_time: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    ...fields,
  };
}

describe('项目待办状态与 IPC 流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('按本地日期分组和时间排序，保留完成与未安排状态', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 12));
    gateway['get-for-project'].mockResolvedValue({
      success: true,
      data: [
        record('no-time', { status: 'scheduled', due_date: '2026-11-11' }),
        record('late', { status: 'scheduled', due_date: '2026-11-11', due_time: '18:00' }),
        record('early', { status: 'scheduled', due_date: '2026-11-11', due_time: '08:00' }),
        record('old', { status: 'scheduled', due_date: '2026-11-10' }),
        record('future', { status: 'scheduled', due_date: '2026-11-12' }),
        record('done', { status: 'completed', due_date: '2026-11-10' }),
        record('plain'),
      ],
    });
    const state = useTodoStore();
    await useTodoActions().fetchTodos('p');
    expect(state.todayTasks.map(t => t.id)).toEqual(['early', 'late', 'no-time']);
    expect(state.overdueTasks.map(t => t.id)).toEqual(['old']);
    expect(state.futureTasks.map(t => t.id)).toEqual(['future']);
    expect(state.completedTasks.map(t => t.id)).toEqual(['done']);
    expect(state.todoTasks.map(t => t.id)).toEqual(['plain']);
    expect(state.isLoading).toBe(false);
  });

  it('新增、完成前移、撤销完成、修改标签和删除保持既有数据流', async () => {
    const state = useTodoStore();
    const actions = useTodoActions();
    state.replaceTodos(
      [record('other')].map(r => ({ id: r.id, title: r.title, status: r.status }))
    );
    gateway.add.mockResolvedValue({
      success: true,
      data: record('new', {
        status: 'scheduled',
        due_date: '2026-11-12',
        custom_tags_json: '["标签"]',
      }),
    });
    await actions.addTodo(
      'p',
      reactive({ title: 'new', status: 'scheduled', dueDate: '2026-11-12', customTags: ['标签'] })
    );
    expect(gateway.add.mock.calls[0][0].customTags).toEqual(['标签']);
    expect(state.todos.map(t => t.id)).toEqual(['new', 'other']);
    gateway.update.mockResolvedValueOnce({
      success: true,
      data: record('other', { status: 'completed' }),
    });
    await actions.toggleComplete('other');
    expect(state.todos.map(t => t.id)).toEqual(['other', 'new']);
    gateway.update.mockResolvedValueOnce({
      success: true,
      data: record('new', { status: 'completed', due_date: '2026-11-12' }),
    });
    await actions.toggleComplete('new');
    gateway.update.mockResolvedValueOnce({
      success: true,
      data: record('new', { status: 'scheduled', due_date: '2026-11-12' }),
    });
    await actions.toggleComplete('new');
    expect(gateway.update).toHaveBeenLastCalledWith({
      todoId: 'new',
      updates: { status: 'scheduled' },
    });
    expect(state.todos.map(t => t.id)).toEqual(['new', 'other']);
    gateway.update.mockResolvedValueOnce({
      success: true,
      data: record('new', { custom_tags_json: '["新标签"]' }),
    });
    await actions.updateTodo('new', reactive({ customTags: ['新标签'] }));
    expect(state.todos[0].customTags).toEqual(['新标签']);
    gateway.delete.mockResolvedValue({ success: true, data: { changes: 0 } });
    await actions.deleteTodo('new');
    expect(state.todos.map(t => t.id)).toEqual(['other']);
  });

  it('组件重复使用只订阅一次，其他项目通知不触发刷新', async () => {
    let callback: ((payload: unknown) => void) | undefined;
    const on = vi.fn((_event: string, listener: (payload: unknown) => void) => {
      callback = listener;
    });
    vi.stubGlobal('electronAPI', { on });
    useWorkspaceProjectsStore().markActiveProject('p');
    const actions = useTodoActions();
    actions.listenForChanges();
    useTodoActions().listenForChanges();
    expect(on).toHaveBeenCalledTimes(1);
    gateway['get-for-project'].mockResolvedValue({ success: true, data: [] });
    callback?.({ projectId: 'other' });
    expect(gateway['get-for-project']).not.toHaveBeenCalled();
    callback?.({ projectId: 'p' });
    await vi.waitFor(() => expect(gateway['get-for-project']).toHaveBeenCalledWith('p'));
    setActivePinia(createPinia());
    expect(useTodoActions()).not.toBe(actions);
  });

  it('加载失败清空旧列表并结束加载状态', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = useTodoStore();
    state.replaceTodos([{ id: 'old', title: 'old', status: 'todo' }]);
    gateway['get-for-project'].mockRejectedValue(new Error('IPC failure'));
    await useTodoActions().fetchTodos('p');
    expect(state.todos).toEqual([]);
    expect(state.isLoading).toBe(false);
  });
});
