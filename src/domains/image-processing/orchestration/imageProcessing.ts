import sharp from 'sharp';
import {
  GRID_MAX_EDGE,
  PROCESSING_MAX_EDGE,
  TEXTURE_MAX_EDGE,
  type EncodedImage,
  type ImageProcessingOutcome,
  type ImageQuad,
  type ImageRegion,
  type RgbColor,
  type TextureKind,
  type TrimMeasurement,
} from '../definitions/imageProcessing';
import { gridOverlaySvg, MAX_GRID_DIVISIONS } from '../functions/gridOverlay';
import { borderMedianLuma, grayToInk, LIGHT_BACKGROUND_MIN_LUMA } from '../functions/inkAlpha';
import { quadProblem, warpIntoQuad } from '../functions/perspectiveWarp';
import {
  decode,
  encode,
  failure,
  hasTransparency,
  isFailure,
  ok,
  raw,
  toPixels,
  type RgbaImage,
} from '../shared/pixelCodec';

/** 纸色默认取未漂白宣纸的暖白。 */
const PAPER_COLOR: RgbColor = [239, 231, 214];

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * 量出图片四周的纯色边（白边、扫描黑边、水印条），给出 Slides `crop` 可以直接用的比例。
 * 默认只量不另存：Slides 写 `crop` 时原图留在文稿里，导出 PPTX 后仍能在 PowerPoint 里调；
 * 只有不支持裁剪的地方（如 Markdown）才需要 `save` 另存裁好的图。
 * `tolerance` 是 sharp trim 的阈值：与左上角颜色的差在它以内都算边，JPEG 压缩噪声一般要 10 以上。
 */
export async function measureImageTrim(input: {
  readonly bytes: Uint8Array;
  readonly tolerance: number;
  readonly save: boolean;
}): Promise<ImageProcessingOutcome<TrimMeasurement>> {
  if (!(input.tolerance >= 1 && input.tolerance <= 100)) return failure('invalid_options', '容差须在 1–100 之间');
  const source = await decode(input.bytes, PROCESSING_MAX_EDGE);
  if (isFailure(source)) return source;
  // 整张同色时 sharp 原样返回，四边都是 0。
  const trimmed = await raw(source).trim({ threshold: input.tolerance }).raw().toBuffer({ resolveWithObject: true });
  // sharp 给的偏移是负数（裁掉多少就是负多少），取绝对值，免得没裁时出现 -0。
  const left = Math.abs(trimmed.info.trimOffsetLeft ?? 0);
  const top = Math.abs(trimmed.info.trimOffsetTop ?? 0);
  const crop = {
    top: round4(top / source.height),
    right: round4((source.width - left - trimmed.info.width) / source.width),
    bottom: round4((source.height - top - trimmed.info.height) / source.height),
    left: round4(left / source.width),
  };
  const measurement = { crop, width: source.width, height: source.height };
  if (!input.save) return ok(measurement);
  const image = await encode({ width: trimmed.info.width, height: trimmed.info.height, data: new Uint8Array(trimmed.data) });
  return ok({ ...measurement, image });
}

/**
 * 白纸上的墨迹（书法、拓片、白描、印章）转成单色加透明度，裁到有墨的范围。
 * 照片或深色底用它没有意义，先看边框亮度，不是浅底就拒绝，而不是交回一张半透明的灰图。
 * 已经是透明底的图（例如之前抠好的字）保留原透明度，只换成墨色：按亮度算的话浅色字会被当成纸整个抹掉。
 */
export async function convertInkToAlpha(input: {
  readonly bytes: Uint8Array;
  readonly ink: RgbColor;
}): Promise<ImageProcessingOutcome<EncodedImage>> {
  const source = await decode(input.bytes, PROCESSING_MAX_EDGE);
  if (isFailure(source)) return source;
  const { width, height } = source;
  if (hasTransparency(source.data)) {
    const recolored = new Uint8Array(source.data);
    for (let o = 0; o < recolored.length; o += 4) recolored.set(input.ink, o);
    return ok(await encode(await toPixels(raw({ width, height, data: recolored }).trim({ threshold: 8 })), true));
  }
  // 不透明的图按亮度算：纸色全透明，墨色不透明
  const gray = new Uint8Array(
    await raw(source).removeAlpha().greyscale().extractChannel(0).raw().toBuffer(),
  );
  const paper = borderMedianLuma(gray, width, height);
  if (paper < LIGHT_BACKGROUND_MIN_LUMA) {
    return failure('background_not_light', `边框亮度 ${paper}/255，不是白纸或浅底，照片和深色底不适用`);
  }
  const ink = { width, height, data: grayToInk(gray, paper, input.ink) };
  return ok(await encode(await toPixels(raw(ink).trim({ threshold: 8 })), true));
}

/** 按宽高比居中裁，与文档里 cover 铺满、不写焦点时显示的部分一致。 */
async function centerCrop(pixels: RgbaImage, aspect: number): Promise<RgbaImage> {
  const width = Math.min(pixels.width, Math.round(pixels.height * aspect));
  const height = Math.min(pixels.height, Math.round(pixels.width / aspect));
  const box = { left: (pixels.width - width) >> 1, top: (pixels.height - height) >> 1, width, height };
  return await toPixels(raw(pixels).extract(box));
}

function regionProblem(region: ImageRegion): string | null {
  const values = [region.left, region.top, region.width, region.height];
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return '区域的四个数都要在 0–1 之间';
  if (region.width <= 0 || region.height <= 0) return '区域的宽高要大于 0';
  if (region.left + region.width > 1.0001 || region.top + region.height > 1.0001) return '区域超出了图片';
  return null;
}

/**
 * 磨砂卡：把背景图上卡片所在的一块预先模糊，整张图交回。卡片的底色、描边、投影仍用原生形状叠在上面，
 * 导出后可改；这里只做原生形状做不到的“背后模糊”。`radius` 是圆角占区域短边的比例，与卡片圆角对齐，
 * 否则模糊的方角会从圆角卡片后面露出来。
 * `aspect`（宽/高）给出时先按它居中裁：照片很少正好是页面比例，铺满页面时会被裁掉一部分，
 * 先裁成页面比例，区域才能直接按“卡片位置 ÷ 页面尺寸”写。
 */
export async function frostImageRegion(input: {
  readonly bytes: Uint8Array;
  readonly region: ImageRegion;
  readonly blur: number;
  readonly radius: number;
  readonly aspect?: number;
}): Promise<ImageProcessingOutcome<EncodedImage>> {
  const problem = regionProblem(input.region);
  if (problem) return failure('invalid_options', problem);
  if (!(input.blur >= 1 && input.blur <= 100)) return failure('invalid_options', '模糊半径须在 1–100 之间');
  if (!(input.radius >= 0 && input.radius <= 0.5)) return failure('invalid_options', '圆角须在 0–0.5 之间（占区域短边的比例）');
  if (input.aspect !== undefined && !(input.aspect >= 0.1 && input.aspect <= 10)) return failure('invalid_options', '宽高比须在 1:10 到 10:1 之间');
  const decoded = await decode(input.bytes, PROCESSING_MAX_EDGE);
  if (isFailure(decoded)) return decoded;
  const source = input.aspect === undefined ? decoded : await centerCrop(decoded, input.aspect);
  const left = Math.round(input.region.left * source.width);
  const top = Math.round(input.region.top * source.height);
  const box = {
    left,
    top,
    width: Math.min(source.width - left, Math.round(input.region.width * source.width)),
    height: Math.min(source.height - top, Math.round(input.region.height * source.height)),
  };
  if (box.width < 8 || box.height < 8) return failure('invalid_options', '区域太小（不到 8 像素）');
  let card = await raw(source).extract(box).blur(input.blur).png().toBuffer();
  if (input.radius > 0) {
    const rx = Math.round(Math.min(box.width, box.height) * input.radius);
    const shape = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><rect width="100%" height="100%" rx="${rx}" fill="#fff"/></svg>`,
    );
    card = await sharp(card).composite([{ input: shape, blend: 'dest-in' }]).png().toBuffer();
  }
  return ok(await encode(await toPixels(raw(source).composite([{ input: card, left: box.left, top: box.top }]))));
}

/**
 * 把图片投影进画布上的四边形（透视展板、斜放的屏幕、封面流）。四边形外透明。
 * 画布默认与（缩到 2400 以内的）原图同尺寸，`width`/`height` 可另给。
 */
export async function warpImageToQuad(input: {
  readonly bytes: Uint8Array;
  readonly quad: ImageQuad;
  readonly width?: number;
  readonly height?: number;
}): Promise<ImageProcessingOutcome<EncodedImage>> {
  const problem = quadProblem(input.quad);
  if (problem) return failure('invalid_options', problem);
  for (const size of [input.width, input.height]) {
    if (size !== undefined && !(Number.isInteger(size) && size >= 16 && size <= PROCESSING_MAX_EDGE)) {
      return failure('invalid_options', `画布宽高须为 16–${PROCESSING_MAX_EDGE} 的整数`);
    }
  }
  const source = await decode(input.bytes, PROCESSING_MAX_EDGE);
  if (isFailure(source)) return source;
  const width = input.width ?? source.width;
  const height = input.height ?? source.height;
  return ok(await encode({ width, height, data: warpIntoQuad(source, input.quad, width, height) }, true));
}

/**
 * 叠坐标网格：能看图的模型读出主体落在哪几格，再按格子换算成 `crop` / `focus` 的比例。
 * 第 i 列覆盖横向 i/n–(i+1)/n，第 k 行（A 起）覆盖纵向 k/n–(k+1)/n。
 */
export async function overlayImageGrid(input: {
  readonly bytes: Uint8Array;
  readonly divisions: number;
}): Promise<ImageProcessingOutcome<EncodedImage>> {
  if (!(Number.isInteger(input.divisions) && input.divisions >= 2 && input.divisions <= MAX_GRID_DIVISIONS)) {
    return failure('invalid_options', `等分数须为 2–${MAX_GRID_DIVISIONS} 的整数`);
  }
  const source = await decode(input.bytes, GRID_MAX_EDGE);
  if (isFailure(source)) return source;
  const svg = Buffer.from(gridOverlaySvg(source.width, source.height, input.divisions));
  // 透明图铺白底再画线，否则网格画在透明处看不见。
  return ok(await encode(await toPixels(raw(source).flatten({ background: '#ffffff' }).composite([{ input: svg }]))));
}

/**
 * 程序生成的质感，没有许可问题：
 * - `paper`：纸纹，不透明，铺在页面底层；
 * - `grain`：颗粒，透明叠加层，放在照片或色块上面，用原生透明度调强弱。
 */
export async function createTexture(input: {
  readonly kind: TextureKind;
  readonly width: number;
  readonly height: number;
  readonly color?: RgbColor;
}): Promise<ImageProcessingOutcome<EncodedImage>> {
  const { width, height } = input;
  for (const size of [width, height]) {
    if (!(Number.isInteger(size) && size >= 16 && size <= TEXTURE_MAX_EDGE)) {
      return failure('invalid_options', `宽高须为 16–${TEXTURE_MAX_EDGE} 的整数`);
    }
  }
  if (input.kind === 'paper') {
    const [r, g, b] = input.color ?? PAPER_COLOR;
    // 低频起伏 + 横向拉长的纤维，两层都用柔光叠在纸色上
    const mottle = await sharp({ create: { width: Math.ceil(width / 4), height: Math.ceil(height / 4), channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
      .greyscale().resize(width, height, { kernel: 'cubic' }).blur(1.2).png().toBuffer();
    const fibers = await sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .greyscale().resize(width, Math.max(1, Math.round(height / 12))).resize(width, height).blur(0.6).png().toBuffer();
    const paper = sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
      .composite([{ input: mottle, blend: 'soft-light' }, { input: fibers, blend: 'soft-light' }]);
    return ok(await encode(await toPixels(paper)));
  }
  const noise = await sharp({ create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 36 } } })
    .greyscale().extractChannel(0).raw().toBuffer();
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < noise.length; i += 1) {
    // 比中灰亮的点画白、暗的点画黑，离中灰越远越不透明
    const v = noise[i];
    const o = i * 4;
    const shade = v >= 128 ? 255 : 0;
    data[o] = shade;
    data[o + 1] = shade;
    data[o + 2] = shade;
    data[o + 3] = Math.min(255, Math.abs(v - 128) * 2);
  }
  return ok(await encode({ width, height, data }, true));
}
