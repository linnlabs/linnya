import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateSharedPptCoordinatorRuntime,
  deactivateSharedPptCoordinatorRuntime,
  getSharedPptCoordinator,
} from './sharedPptCoordinator';

const coordinatorFactoryMock = vi.hoisted(() => ({
  createPptCoordinator: vi.fn(),
}));

const buildExecutionMock = vi.hoisted(() => ({
  executor: { typecheckCodegenSource: vi.fn() },
  activate: vi.fn(),
  deactivate: vi.fn(async () => {}),
}));

vi.mock('./createPptCoordinator', () => ({
  createPptCoordinator: coordinatorFactoryMock.createPptCoordinator,
}));

vi.mock('../features/presentationBuildExecution', () => ({
  activateSharedPresentationBuildExecution: buildExecutionMock.activate,
  deactivateSharedPresentationBuildExecution: buildExecutionMock.deactivate,
  getSharedPresentationBuildExecution: () => buildExecutionMock.executor,
}));

describe('getSharedPptCoordinator', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await deactivateSharedPptCoordinatorRuntime();
  });

  it('同一个 Database 对象只创建一个 Slides coordinator', () => {
    const db = { prepare: vi.fn() };
    const coordinator = { getCodegenPresentationService: vi.fn() };
    coordinatorFactoryMock.createPptCoordinator.mockReturnValue(coordinator);
    activateSharedPptCoordinatorRuntime();

    expect(getSharedPptCoordinator(db)).toBe(coordinator);
    expect(getSharedPptCoordinator(db)).toBe(coordinator);
    expect(coordinatorFactoryMock.createPptCoordinator).toHaveBeenCalledTimes(1);
    expect(coordinatorFactoryMock.createPptCoordinator).toHaveBeenCalledWith(db, {
      buildExecution: buildExecutionMock.executor,
    });
  });

  it('coordinator 已被其他入口创建后仍可绑定 conversation resolver', () => {
    const db = { prepare: vi.fn() };
    const coordinator = { bindConversationFilePathResolver: vi.fn() };
    const resolver = { resolveRelativePath: vi.fn() };
    coordinatorFactoryMock.createPptCoordinator.mockReturnValue(coordinator);
    activateSharedPptCoordinatorRuntime();

    expect(getSharedPptCoordinator(db)).toBe(coordinator);
    expect(getSharedPptCoordinator(db, { conversationFilePathResolver: resolver })).toBe(coordinator);
    expect(coordinator.bindConversationFilePathResolver).toHaveBeenCalledWith(resolver);
    expect(coordinatorFactoryMock.createPptCoordinator).toHaveBeenCalledTimes(1);
  });

  it('不同 Database 对象不会共享 coordinator 状态', () => {
    const firstDb = { prepare: vi.fn() };
    const secondDb = { prepare: vi.fn() };
    const firstCoordinator = { id: 'first' };
    const secondCoordinator = { id: 'second' };
    coordinatorFactoryMock.createPptCoordinator
      .mockReturnValueOnce(firstCoordinator)
      .mockReturnValueOnce(secondCoordinator);
    activateSharedPptCoordinatorRuntime();

    expect(getSharedPptCoordinator(firstDb)).toBe(firstCoordinator);
    expect(getSharedPptCoordinator(secondDb)).toBe(secondCoordinator);
    expect(coordinatorFactoryMock.createPptCoordinator).toHaveBeenCalledTimes(2);
  });

  it('runtime 未启用时拒绝创建共享 coordinator', () => {
    const db = { prepare: vi.fn() };

    expect(() => getSharedPptCoordinator(db)).toThrow('Slides coordinator runtime is not active.');
    expect(coordinatorFactoryMock.createPptCoordinator).not.toHaveBeenCalled();
  });

  it('runtime 停用时卸载已缓存的 coordinator', async () => {
    const db = { prepare: vi.fn() };
    const firstCoordinator = { id: 'first' };
    const secondCoordinator = { id: 'second' };
    coordinatorFactoryMock.createPptCoordinator
      .mockReturnValueOnce(firstCoordinator)
      .mockReturnValueOnce(secondCoordinator);

    activateSharedPptCoordinatorRuntime();
    expect(getSharedPptCoordinator(db)).toBe(firstCoordinator);

    await deactivateSharedPptCoordinatorRuntime();
    activateSharedPptCoordinatorRuntime();
    expect(getSharedPptCoordinator(db)).toBe(secondCoordinator);
    expect(coordinatorFactoryMock.createPptCoordinator).toHaveBeenCalledTimes(2);
  });
});
