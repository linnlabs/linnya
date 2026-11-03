import { WebGLRenderer, type Renderer } from 'pixi.js';

/** 只在适配层读取当前上下文；插件业务不接触GPU厂商或Host Electron对象。 */
export function readCanvasGpuMode(renderer: Renderer): { readonly software: boolean; readonly renderer: string } {
  if (!(renderer instanceof WebGLRenderer)) throw new Error('canvas_webgl_required');
  const gl = renderer.gl, extension = gl.getExtension('WEBGL_debug_renderer_info');
  const value: unknown = gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  const name = typeof value === 'string' ? value : 'unavailable';
  return { software: /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(name), renderer: name };
}
