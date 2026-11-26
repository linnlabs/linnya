import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import type { ProjectOperationsOptions } from '../definitions/projectOperations';

/**
 * 新建项目、AI 辅助规划的提示要和实际结果一致：
 * 项目一旦建成，后续步骤失败只说明那一步没完成，不能再报“创建失败”；规划首条消息没发出去时不能提示成功。
 */
const createProject = vi.hoisted(() => vi.fn());
const refreshProjectCatalog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/shared/ipc/projectGateway', () => ({ projectGateway: { create: createProject } }));
vi.mock('../../../features/project-catalog', () => ({
  refreshProjectCatalog,
  updateProjectCatalog: vi.fn(async () => undefined),
}));
vi.mock('../../useWorkspaceLocalization', () => ({
  useWorkspaceLocalization: () => ({
    workspaceMessage: (key: string, params?: Record<string, string>) =>
      params?.projectName ? `${key}|${params.projectName}` : key,
  }),
}));

import { useProjectOperations } from './useProjectOperations';

function setup(overrides: Partial<ProjectOperationsOptions> = {}) {
  const store = useWorkspaceProjectsStore();
  store.replaceProjects([
    {
      id: 'existing',
      name: '已有项目',
      description: null,
      icon: null,
      systemRole: null,
      canDelete: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  const show = vi.fn();
  const options: ProjectOperationsOptions = {
    openProjectWorkspace: vi.fn(async () => undefined),
    startProjectPlanning: vi.fn(async () => true),
    deleteProject: vi.fn(async () => undefined),
    ...overrides,
  };
  return { store, show, options, operations: useProjectOperations(store, { show }, options) };
}

const form = { name: ' 季度复盘 ', description: '', kbIds: [] };

beforeEach(() => {
  setActivePinia(createPinia());
  createProject.mockReset();
  createProject.mockResolvedValue({ success: true, data: { projectId: 'project-new' } });
  refreshProjectCatalog.mockReset();
  refreshProjectCatalog.mockResolvedValue(undefined);
});

describe('新建项目的提示', () => {
  it('项目建成后打开失败：提示“已创建但没能打开”，不报创建失败', async () => {
    const { show, operations } = setup({
      openProjectWorkspace: vi.fn(async () => {
        throw new Error('navigation failed');
      }),
    });

    await operations.handleProjectDialogConfirm(form);

    expect(show.mock.calls).toEqual([
      ['workspace.project.operation.created|季度复盘', 'success'],
      ['workspace.project.operation.createdButOpenFailed|季度复盘', 'error'],
    ]);
  });

  it('后端拒绝创建时仍按失败提示，不进入后续步骤', async () => {
    createProject.mockResolvedValue({ success: false, error: 'rejected' });
    const { show, options, operations } = setup();

    await operations.handleProjectDialogConfirm(form);

    expect(show.mock.calls).toEqual([['workspace.project.operation.createFailed', 'error']]);
    expect(options.openProjectWorkspace).not.toHaveBeenCalled();
  });
});

describe('AI 辅助规划的提示', () => {
  it('规划首条消息没发出去：提示“已创建但规划没有开始”，不提示成功', async () => {
    const { show, operations } = setup({ startProjectPlanning: vi.fn(async () => false) });

    await operations.handleAiCreateProject(form);

    expect(show.mock.calls).toEqual([
      ['workspace.project.operation.createdButPlanningNotStarted|季度复盘', 'warning'],
    ]);
  });

  it('规划启动抛错时同样说明项目已创建，不报创建失败', async () => {
    const { show, operations } = setup({
      startProjectPlanning: vi.fn(async () => {
        throw new Error('agent choice unavailable');
      }),
    });

    await operations.handleAiCreateProject(form);

    expect(show.mock.calls).toEqual([
      ['workspace.project.operation.createdButPlanningNotStarted|季度复盘', 'warning'],
    ]);
  });

  it('规划真正开始才提示成功，并用去掉空白的项目名', async () => {
    const { show, options, operations } = setup();

    await operations.handleAiCreateProject(form);

    expect(options.startProjectPlanning).toHaveBeenCalledWith({
      id: 'project-new',
      name: '季度复盘',
      description: '',
    });
    expect(show.mock.calls).toEqual([
      ['workspace.project.operation.createdWithAiPlanning|季度复盘', 'success'],
    ]);
  });

  it('已有项目的 AI 初始化没开始时提示失败，不提示成功', async () => {
    const { store, show, operations } = setup({ startProjectPlanning: vi.fn(async () => false) });
    store.markActiveProject('existing');

    await operations.initializeExistingProjectWithAi();

    expect(show.mock.calls).toEqual([['workspace.project.operation.aiInitFailed', 'error']]);
  });
});
