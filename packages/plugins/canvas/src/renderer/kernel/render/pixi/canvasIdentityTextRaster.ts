import { CanvasTextGenerator, TextStyle } from 'pixi.js';

const style = new TextStyle({
  fill: 0xffffff,
  fontFamily: 'system-ui',
  fontSize: 15,
  wordWrap: false,
});

/**
 * 只隔离固定8.22的root公开导出。Generator虽有@internal标记，仍由Pixi Text自身使用；
 * 不复制其字形/基线/ceil规则，升级时必须重过整串中文、RTL、emoji像素对照。
 */
export function withCanvasIdentityTextRaster<T>(
  text: string,
  resolution: number,
  consume: (raster: {
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly width: number;
    readonly height: number;
  }) => T
): T {
  const generated = CanvasTextGenerator.getCanvasAndContext({ text, style, resolution });
  try {
    const canvas = generated.canvasAndContext.canvas;
    if (!(canvas instanceof HTMLCanvasElement) && !(canvas instanceof OffscreenCanvas))
      throw new Error('canvas_identity_native_source_required');
    // frame是Generator复用的临时对象；同步复制尺寸，借来的canvas绝不成为atlas的resource。
    return consume({ canvas, width: generated.frame.width, height: generated.frame.height });
  } finally {
    CanvasTextGenerator.returnCanvasAndContext(generated.canvasAndContext);
  }
}
