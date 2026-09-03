import { describe, expect, it, vi } from 'vitest';
import { registerSlidesIpcHandlers } from './registerSlidesIpcHandlers';

const coordinatorFactoryMock = vi.hoisted(() => ({
  getSharedPptCoordinator: vi.fn(),
}));

vi.mock('@plugin/slides/backend-coordinator', () => ({
  getSharedPptCoordinator: coordinatorFactoryMock.getSharedPptCoordinator,
}));

const packageHandlerMock = vi.hoisted(() => ({
  registerSlidesIpcHandlersForCoordinatorProvider: vi.fn(),
}));

vi.mock('./slidesIpcHandlers', async (importOriginal) => ({
  ...await importOriginal<typeof import('./slidesIpcHandlers')>(),
  registerSlidesIpcHandlersForCoordinatorProvider:
    packageHandlerMock.registerSlidesIpcHandlersForCoordinatorProvider,
}));

describe('registerSlidesIpcHandlers', () => {
  it('从 host 服务容器取 db，注册延迟读取 coordinator 的 handlers', () => {
    const db = { prepare: vi.fn() };
    const coordinator = { generate: vi.fn() };
    const tsServiceManager = {
      getServices: vi.fn(() => ({
        databaseService: { getDb: () => db },
      })),
    };
    const registerBackendPluginIpcHandler = vi.fn();

    coordinatorFactoryMock.getSharedPptCoordinator.mockReturnValue(coordinator);

    registerSlidesIpcHandlers(tsServiceManager, registerBackendPluginIpcHandler);

    expect(coordinatorFactoryMock.getSharedPptCoordinator).not.toHaveBeenCalled();
    expect(packageHandlerMock.registerSlidesIpcHandlersForCoordinatorProvider)
      .toHaveBeenCalledWith(expect.any(Function), registerBackendPluginIpcHandler);

    const readCoordinator = packageHandlerMock.registerSlidesIpcHandlersForCoordinatorProvider.mock.calls[0]?.[0];
    expect(readCoordinator()).toBe(coordinator);
    expect(coordinatorFactoryMock.getSharedPptCoordinator).toHaveBeenCalledWith(db);
  });

  it('databaseService 缺失时抛错', () => {
    const tsServiceManager = {
      getServices: vi.fn(() => ({ databaseService: null })),
    };
    expect(() => registerSlidesIpcHandlers(tsServiceManager, vi.fn())).toThrow(
      'DatabaseService not available',
    );
  });

  it('非 TSServiceManager 形状的宿主对象抛错', () => {
    expect(() => registerSlidesIpcHandlers({}, vi.fn())).toThrow(
      'Slides IPC registrar requires TSServiceManager-like host object.',
    );
  });
});
