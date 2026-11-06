// Pixi 的静态 uniform polyfill 支持严格 CSP；不放开 script-src unsafe-eval。
import 'pixi.js/unsafe-eval';
import { Application } from 'pixi.js';
import type { CanvasKernel } from '../../definitions/canvasKernel';
import type { CanvasKernelOptions } from '../../definitions/canvasKernelOptions';
import { warmCanvasGraphicsPipeline } from './warmCanvasGraphicsPipeline';
import { PixiCanvasKernel } from './PixiCanvasKernel';

/** Pixi 应用的初始化入口；外部只看到 CanvasKernel 与业务快照。 */
export async function createPixiCanvasKernel(options: CanvasKernelOptions): Promise<CanvasKernel> {
  const app = new Application();
  const canvas = document.createElement('canvas');
  const width = options.width ?? options.host.clientWidth;
  const height = options.height ?? options.host.clientHeight;
  await app.init({
    canvas,
    width: Math.max(1, width),
    height: Math.max(1, height),
    resolution: options.resolution ?? devicePixelRatio,
    autoDensity: true,
    autoStart: false,
    preference: 'webgl',
    antialias: true,
    backgroundAlpha: 0,
  });
  try {
    warmCanvasGraphicsPipeline(app.renderer);
  } catch (error) {
    app.destroy(true, { children: true, texture: true, textureSource: true });
    throw error;
  }
  return new PixiCanvasKernel(app, options, width, height);
}
