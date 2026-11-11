// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useReviewStore } from './store/reviewStore';
import { useReviewActions } from './runtime';
import type { ReviewAgentRecord } from './services/reviewAgentsService';
const api = vi.hoisted(() => ({
  createReviewAgent: vi.fn(),
  listReviewAgents: vi.fn(),
  updateReviewAgent: vi.fn(),
}));
vi.mock('./services/reviewAgentsService', () => api);
const agent = (id: string, name = id): ReviewAgentRecord => ({
  id,
  name,
  type: 'review',
  systemPrompt: 'prompt',
  knowledge: 'notes',
  createdAt: 1,
  updatedAt: 1,
});
describe('审阅角色和运行启动', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());
  it('加载合并不重复自定义角色，新建自动选中且最多三个，修改保留对象身份', async () => {
    const state = useReviewStore(),
      actions = useReviewActions();
    api.listReviewAgents.mockResolvedValue({ success: true, data: { agents: [agent('custom')] } });
    await actions.loadCustomAgents();
    await actions.loadCustomAgents();
    expect(state.availableAgents.filter(a => a.isCustom)).toHaveLength(1);
    state.beginCreateCustomAgent();
    api.createReviewAgent.mockResolvedValue({ success: true, data: { agent: agent('new') } });
    await actions.addCustomAgent({ name: 'new' });
    expect(state.activeAgentIds).toEqual(['new']);
    expect(state.status).toBe('idle');
    state.selectAgent('logicCheck');
    state.selectAgent('structure');
    state.selectAgent('polish');
    expect(state.activeAgentIds).toHaveLength(3);
    state.beginEditCustomAgent('new');
    const previous = state.availableAgents.find(a => a.id === 'new');
    api.updateReviewAgent.mockResolvedValue({
      success: true,
      data: { agent: agent('new', 'modified') },
    });
    await actions.updateCustomAgent('new', { name: 'modified' });
    expect(state.availableAgents.find(a => a.id === 'new')).toBe(previous);
    expect(previous).toMatchObject({ name: 'modified' });
    expect(state.editingAgentId).toBeNull();
    await actions.updateCustomAgent('logicCheck', { name: 'ignored' });
    expect(api.updateReviewAgent).toHaveBeenCalledTimes(1);
  });
  it('持久化失败保留角色和编辑状态', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = useReviewStore();
    state.beginCreateCustomAgent();
    api.createReviewAgent.mockResolvedValue({ success: false, error: 'failed' });
    await useReviewActions().addCustomAgent({ name: 'failure' });
    expect(state.status).toBe('creating_agent');
    expect(state.availableAgents.some(a => a.isCustom)).toBe(false);
  });
  it('启动只派发一次同一个运行ID、已选角色和输入，无角色不派发', () => {
    const state = useReviewStore(),
      actions = useReviewActions(),
      dispatch = vi.spyOn(window, 'dispatchEvent');
    actions.startReview();
    expect(dispatch).not.toHaveBeenCalled();
    state.selectAgent('logicCheck');
    state.setReviewBackground('背景');
    state.setReviewGoal('目标');
    actions.startReview();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'review-started',
      detail: {
        reviewRunId: state.currentReviewRunId,
        agentIds: ['logicCheck'],
        background: '背景',
        goal: '目标',
      },
    });
    expect(state.currentReviewRunId).toMatch(/^review-run/);
    expect(state.status).toBe('processing');
    expect(state.progressState).toEqual({ phase: 'preparing' });
  });
});
