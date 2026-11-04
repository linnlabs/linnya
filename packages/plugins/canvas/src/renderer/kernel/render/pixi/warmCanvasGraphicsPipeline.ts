import { Graphics, RenderTexture, type Renderer } from 'pixi.js';

/** prepare.upload只上传几何/纹理；真实no-batch draw才会首次绑定Graphics GL程序。 */
export function warmCanvasGraphicsPipeline(renderer: Pick<Renderer, 'render'>): void {
  const graphics = new Graphics(), target = RenderTexture.create({ width: 1, height: 1, resolution: 1, antialias: false });
  graphics.context.batchMode = 'no-batch';
  try {
    graphics.rect(0, 0, 1, 1).fill(0xffffff);
    // 独立目标不挂主scene，不改变主画布像素，也不产生正文/可见draw回执。
    renderer.render({ container: graphics, target, clear: true });
  } finally {
    // 无参数destroy只释放owned context，不能把共享Texture.WHITE一起毁掉。
    graphics.destroy(); target.destroy(true);
  }
}
