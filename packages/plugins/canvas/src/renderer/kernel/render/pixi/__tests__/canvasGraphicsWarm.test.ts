// @vitest-environment jsdom
import { afterAll, expect, it, vi } from 'vitest';
import { AlphaFilter, Container, Graphics, RenderTexture, Texture, type GraphicsContext, type Renderer, type RenderOptions, type TextureSource } from 'pixi.js';
import { warmCanvasGraphicsPipeline } from '../warmCanvasGraphicsPipeline';

// 此处验证真实对象所有权；GPU编译效果由Electron像素/采样门禁验证。
vi.hoisted(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterAll(() => { vi.restoreAllMocks(); });

function capture(failure?: Error) {
  const resources: { readonly graphic: Graphics; readonly context: GraphicsContext; readonly target: RenderTexture; readonly source: TextureSource }[] = [];
  const filters = new Set<() => void>();
  const renderer: Pick<Renderer, 'render'> = { render(input: RenderOptions | Container) {
    if (input instanceof Container || !(input.container instanceof Graphics) || !(input.target instanceof RenderTexture)) throw new Error('warm_fixture_requires_offscreen_graphics');
    expect(input.container.context.batchMode).toBe('no-batch'); expect(input.target.width).toBe(1); expect(input.target.height).toBe(1);
    const filter = input.container.filters?.[0]; if (!(filter instanceof AlphaFilter)) throw new Error('warm_fixture_requires_alpha_composition');
    const destroyed = vi.spyOn(filter, 'destroy'); filters.add(() => expect(destroyed).toHaveBeenCalledExactlyOnceWith());
    resources.push({ graphic: input.container, context: input.container.context, target: input.target, source: input.target.source });
    if (failure) throw failure;
  } };
  return { resources, renderer, assertFiltersReleased() { for (const assert of filters) assert(); } };
}
it('冷Graphics路径使用独立非batch目标，结束释放临时资源并保留共享白纹理', () => {
  const state = capture(); warmCanvasGraphicsPipeline(state.renderer);
  expect(state.resources).toHaveLength(1);
  const [resource] = state.resources;
  expect(resource.graphic.destroyed).toBe(true); expect(resource.context.destroyed).toBe(true);
  expect(resource.target.destroyed).toBe(true); expect(resource.source.destroyed).toBe(true); expect(Texture.WHITE.destroyed).toBe(false);
  state.assertFiltersReleased();
});
it('真实draw失败仍释放临时资源并保留原异常，不吞错或重试', () => {
  const failure = new Error('device_pipeline_failed'), state = capture(failure);
  expect(() => warmCanvasGraphicsPipeline(state.renderer)).toThrow(failure); expect(state.resources).toHaveLength(1);
  const [resource] = state.resources;
  expect(resource.graphic.destroyed).toBe(true); expect(resource.context.destroyed).toBe(true);
  expect(resource.target.destroyed).toBe(true); expect(resource.source.destroyed).toBe(true); expect(Texture.WHITE.destroyed).toBe(false);
  state.assertFiltersReleased();
});
