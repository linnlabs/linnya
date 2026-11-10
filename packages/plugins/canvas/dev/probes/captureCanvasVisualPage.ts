import type { Rectangle } from 'electron';

interface VisualViewport {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly width: number;
  readonly height: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly dpr: number;
}
interface VisualPixels { readonly width: number; readonly height: number; readonly pixels: Buffer }
interface VisualCapturePort {
  readViewport(): Promise<VisualViewport>;
  scrollTo(x: number, y: number): Promise<VisualViewport>;
  capture(): Promise<VisualPixels>;
}
interface VisualCaptureInput {
  readonly rectangles: readonly [Rectangle, Rectangle, Rectangle];
  readonly dpr: number;
}

/** client area是未受网页zoom取整的DIP；不能用DOM整数innerWidth代表完整PNG大小。 */
export function withNativeVisualViewport(viewport: Omit<VisualViewport, 'windowWidth' | 'windowHeight'>, native: {
  readonly contentBounds: Rectangle;
  readonly zoomFactor: number;
}): VisualViewport {
  return { ...viewport, windowWidth: native.contentBounds.width / native.zoomFactor,
    windowHeight: native.contentBounds.height / native.zoomFactor };
}

function copyTile(input: { readonly image: VisualPixels; readonly viewport: VisualViewport; readonly target: Rectangle; readonly output: VisualPixels; readonly dpr: number }) {
  const { image, viewport, target, output, dpr } = input;
  const destination = { x: Math.round(target.x * dpr), y: Math.round(target.y * dpr),
    width: Math.round((target.x + target.width) * dpr) - Math.round(target.x * dpr),
    height: Math.round((target.y + target.height) * dpr) - Math.round(target.y * dpr) };
  // 两端先映射到同一物理像素格，再相减；分数DPR下逐段round距离会产生一列重复或空洞。
  const source = { x: destination.x - Math.round(viewport.scrollX * dpr), y: destination.y - Math.round(viewport.scrollY * dpr),
    width: destination.width, height: destination.height };
  if (image.width !== Math.round(viewport.windowWidth * dpr) || image.height !== Math.round(viewport.windowHeight * dpr)
    || image.pixels.length !== image.width * image.height * 4 || source.x < 0 || source.y < 0
    || source.x + source.width > Math.round(viewport.width * dpr) || source.y + source.height > Math.round(viewport.height * dpr))
    throw new Error(`visual_capture_tile_mismatch:${JSON.stringify({ viewport, source, destination, capture: { width: image.width, height: image.height, bytes: image.pixels.length } })}`);
  for (let row = 0; row < source.height; row++) {
    const start = ((source.y + row) * image.width + source.x) * 4;
    image.pixels.copy(output.pixels, ((destination.y + row) * output.width + destination.x) * 4, start, start + source.width * 4);
  }
  return { viewport, source, destination, capturedSize: { width: image.width, height: image.height } };
}

/** 只滚动静态布局并复制真实可见像素；不resize/emulate，避免截屏动作本身丢失Canvas图层。 */
export async function captureCanvasVisualPage(port: VisualCapturePort, input: VisualCaptureInput) {
  const region = { x: 0, y: 0, width: Math.ceil(Math.max(...input.rectangles.map(rect => rect.x + rect.width))),
    height: Math.ceil(Math.max(...input.rectangles.map(rect => rect.y + rect.height))) };
  const initial = await port.readViewport();
  if (initial.width <= 0 || initial.height <= 0 || initial.dpr !== input.dpr) throw new Error('visual_capture_viewport_unavailable');
  const width = Math.round(region.width * input.dpr), height = Math.round(region.height * input.dpr);
  const output = { width, height, pixels: Buffer.alloc(width * height * 4) }, tiles = [];
  let copiedPixels = 0;
  try {
    for (let y = 0; y < region.height; y += initial.height) for (let x = 0; x < region.width; x += initial.width) {
      const viewport = await port.scrollTo(x, y);
      if (viewport.width !== initial.width || viewport.height !== initial.height || viewport.dpr !== input.dpr
        || viewport.windowWidth !== initial.windowWidth || viewport.windowHeight !== initial.windowHeight)
        throw new Error('visual_capture_environment_changed');
      const tile = copyTile({ image: await port.capture(), viewport, output, dpr: input.dpr,
        target: { x, y, width: Math.min(initial.width, region.width - x), height: Math.min(initial.height, region.height - y) } });
      tiles.push(tile); copiedPixels += tile.destination.width * tile.destination.height;
    }
    if (copiedPixels !== width * height) throw new Error('visual_capture_pixels_incomplete');
    return { ...output, region, tiles, expectedSize: { width, height } };
  } finally { await port.scrollTo(initial.scrollX, initial.scrollY); }
}
