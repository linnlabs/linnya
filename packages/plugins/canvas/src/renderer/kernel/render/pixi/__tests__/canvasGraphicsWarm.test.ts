import { expect, it } from 'vitest';
import { Container, Graphics, RenderTexture, Texture, type GraphicsContext, type Renderer, type RenderOptions, type TextureSource } from 'pixi.js';
import { warmCanvasGraphicsPipeline } from '../warmCanvasGraphicsPipeline';

function capture(failure?: Error) {
  const resources: { readonly graphic: Graphics; readonly context: GraphicsContext; readonly target: RenderTexture; readonly source: TextureSource }[] = [];
  const renderer: Pick<Renderer, 'render'> = { render(input: RenderOptions | Container) {
    if (input instanceof Container || !(input.container instanceof Graphics) || !(input.target instanceof RenderTexture)) throw new Error('warm_fixture_requires_offscreen_graphics');
    expect(input.container.context.batchMode).toBe('no-batch'); expect(input.target.width).toBe(1); expect(input.target.height).toBe(1);
    resources.push({ graphic: input.container, context: input.container.context, target: input.target, source: input.target.source });
    if (failure) throw failure;
  } };
  return { resources, renderer };
}
it('冷Graphics路径使用独立非batch目标，结束释放临时资源并保留共享白纹理', () => {
  const state = capture(); warmCanvasGraphicsPipeline(state.renderer);
  expect(state.resources).toHaveLength(1);
  const [resource] = state.resources;
  expect(resource.graphic.destroyed).toBe(true); expect(resource.context.destroyed).toBe(true);
  expect(resource.target.destroyed).toBe(true); expect(resource.source.destroyed).toBe(true); expect(Texture.WHITE.destroyed).toBe(false);
});
it('真实draw失败仍释放临时资源并保留原异常，不吞错或重试', () => {
  const failure = new Error('device_pipeline_failed'), state = capture(failure);
  expect(() => warmCanvasGraphicsPipeline(state.renderer)).toThrow(failure); expect(state.resources).toHaveLength(1);
  const [resource] = state.resources;
  expect(resource.graphic.destroyed).toBe(true); expect(resource.context.destroyed).toBe(true);
  expect(resource.target.destroyed).toBe(true); expect(resource.source.destroyed).toBe(true); expect(Texture.WHITE.destroyed).toBe(false);
});
