// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPixiCanvasKernel } from '../createPixiCanvasKernel';
import { warmCanvasGraphicsPipeline } from '../warmCanvasGraphicsPipeline';

// 此处只验证初始化失败时 Pixi app（持有 WebGL 上下文）的所有权；真实像素由 Electron 门禁覆盖。
const state = vi.hoisted(() => ({
  destroy: vi.fn(),
  constructFailure: null as Error | null,
  instances: [] as unknown[],
}));
vi.mock('pixi.js/unsafe-eval', () => ({}));
vi.mock('pixi.js', () => ({
  Application: class {
    readonly renderer = {};
    constructor() {
      state.instances.push(this);
    }
    init = async () => undefined;
    destroy = state.destroy;
  },
}));
vi.mock('../warmCanvasGraphicsPipeline', () => ({ warmCanvasGraphicsPipeline: vi.fn() }));
vi.mock('../PixiCanvasKernel', () => ({
  PixiCanvasKernel: class {
    constructor() {
      if (state.constructFailure) throw state.constructFailure;
    }
  },
}));

afterEach(() => {
  state.constructFailure = null;
  state.instances.length = 0;
  vi.clearAllMocks();
});

const options = () => ({ host: document.createElement('div'), width: 10, height: 10 });

it('kernel 构造抛错时销毁已初始化的 Pixi app 并保留原异常', async () => {
  const failure = new Error('canvas_2d_unavailable');
  state.constructFailure = failure;
  await expect(createPixiCanvasKernel(options())).rejects.toBe(failure);
  expect(state.instances).toHaveLength(1);
  expect(state.destroy).toHaveBeenCalledOnce();
});

it('预热抛错时同样销毁 Pixi app', async () => {
  const failure = new Error('device_pipeline_failed');
  vi.mocked(warmCanvasGraphicsPipeline).mockImplementationOnce(() => {
    throw failure;
  });
  await expect(createPixiCanvasKernel(options())).rejects.toBe(failure);
  expect(state.destroy).toHaveBeenCalledOnce();
});

it('初始化成功后 app 的所有权交给 kernel，不被提前销毁', async () => {
  await createPixiCanvasKernel(options());
  expect(state.destroy).not.toHaveBeenCalled();
});
