import sharp from 'sharp';
import type { ForegroundMaskPort } from '../definitions/foregroundMask';
import {
  PROCESSING_MAX_EDGE,
  type CutoutEngine,
  type CutoutMethod,
  type EncodedImage,
  type ForegroundCutout,
  type ImageProcessingFailure,
  type ImageProcessingOutcome,
} from '../definitions/imageProcessing';
import { EDGE_TOLERANCE, edgeBackgroundMask } from '../functions/edgeMatte';
import { foregroundCoverage } from '../functions/foregroundCoverage';
import { opaqueBounds } from '../functions/opaqueBounds';
import { decode, encode, failure, isFailure, ok, raw, toPixels, type RgbaImage } from '../shared/pixelCodec';

/** 交给 Vision 的图：JPEG 写临时文件快，颜色最后仍取自原图，有损只影响遮罩，看不出差别。 */
const VISION_JPEG_QUALITY = 92;
/** 边缘抠图在缩小的图上判背景，再把遮罩放大回去：判背景不需要细节，600px 已够，速度快一个量级。 */
const EDGE_MAX_EDGE = 600;
/** 裁到主体时忽略低于它的透明度，遮罩在背景上的零星噪点不会把范围撑到整张图。 */
const TRIM_MIN_ALPHA = 8;
/** 检查图每一栏的最大边长，两栏并排约 1600px，看图模型一眼看完。 */
const CHECK_PANEL = 780;
const CHECK_GAP = 20;

/** Vision 的遮罩：给回同尺寸的透明度；没找到前景时为 null。 */
async function visionAlpha(
  source: RgbaImage, port: ForegroundMaskPort, signal: AbortSignal,
): Promise<Uint8Array | null | ImageProcessingFailure> {
  const jpeg = await raw(source).flatten({ background: '#ffffff' }).jpeg({ quality: VISION_JPEG_QUALITY }).toBuffer();
  const result = await port.mask({ jpeg: new Uint8Array(jpeg), signal });
  if (result.status === 'no_foreground') return null;
  if (result.status === 'failed') return failure('vision_failed', result.message);
  const { data, info } = await sharp(Buffer.from(result.png)).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  // 系统接口的输出尺寸由它自己决定；对不上时说明合同变了，直接报错，不缩放凑合
  if (info.width !== source.width || info.height !== source.height) {
    return failure('vision_failed', `前景遮罩尺寸 ${info.width}×${info.height} 与输入 ${source.width}×${source.height} 不一致`);
  }
  return new Uint8Array(data);
}

/** 边缘抠图：缩小后判背景，中值去掉孤立的点，放大回原尺寸并轻微模糊成柔边。 */
async function edgeAlpha(source: RgbaImage): Promise<Uint8Array> {
  const small = await raw(source).flatten({ background: '#ffffff' })
    .resize(EDGE_MAX_EDGE, EDGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .blur(0.8).raw().toBuffer({ resolveWithObject: true });
  const background = edgeBackgroundMask(new Uint8Array(small.data), small.info.width, small.info.height, EDGE_TOLERANCE);
  const mask = Buffer.alloc(background.length);
  for (let i = 0; i < background.length; i += 1) mask[i] = background[i] ? 0 : 255;
  const alpha = await sharp(mask, { raw: { width: small.info.width, height: small.info.height, channels: 1 } })
    .median(3)
    .resize(source.width, source.height, { fit: 'fill', kernel: 'cubic' })
    .blur(1.2)
    .extractChannel(0).raw().toBuffer();
  return new Uint8Array(alpha);
}

/** 左边原图，右边去背结果叠在品红底上：残留的背景、被误抠的主体都显眼。 */
async function checkImage(source: RgbaImage, cutout: EncodedImage): Promise<EncodedImage> {
  const original = await raw(source).flatten({ background: '#ffffff' })
    .resize(CHECK_PANEL, CHECK_PANEL, { fit: 'inside', withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  const result = await sharp(Buffer.from(cutout.bytes))
    .resize(CHECK_PANEL, CHECK_PANEL, { fit: 'inside', withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  const magenta = await sharp({ create: { width: result.info.width, height: result.info.height, channels: 3, background: '#ff00ff' } })
    .composite([{ input: result.data }]).png().toBuffer();
  const width = original.info.width + CHECK_GAP + result.info.width;
  const height = Math.max(original.info.height, result.info.height);
  return await encode(await toPixels(sharp({ create: { width, height, channels: 3, background: '#808080' } }).composite([
    { input: original.data, left: 0, top: 0 },
    { input: magenta, left: original.info.width + CHECK_GAP, top: 0 },
  ])));
}

/**
 * 去掉照片背景，裁到主体，另出检查图。
 * - `auto`：本机有系统前景遮罩就用；它没找到前景时改用边缘抠图，并在结果里注明。
 * - `vision`：只用系统前景遮罩，不可用或没找到前景都报错。
 * - `edge`：只按边缘颜色抠，适合无缝背景纸、纯色台面上的器物和产品。
 * 原图本来带透明的部分保持透明（取两者较小的透明度）。
 */
export async function cutoutForeground(input: {
  readonly bytes: Uint8Array;
  readonly method: CutoutMethod;
  readonly foregroundMask: ForegroundMaskPort;
  readonly signal: AbortSignal;
}): Promise<ImageProcessingOutcome<ForegroundCutout>> {
  if (input.method === 'vision' && !input.foregroundMask.available) {
    return failure('vision_unavailable', 'Vision 前景遮罩只在 macOS 14 及以上可用；改用 --method edge');
  }
  const source = await decode(input.bytes, PROCESSING_MAX_EDGE);
  if (isFailure(source)) return source;

  let engine: CutoutEngine = input.method === 'edge' || !input.foregroundMask.available ? 'edge' : 'vision';
  let visionFoundNothing = false;
  let alpha: Uint8Array | null = null;
  if (engine === 'vision') {
    const vision = await visionAlpha(source, input.foregroundMask, input.signal);
    if (vision instanceof Uint8Array) {
      alpha = vision;
    } else if (vision !== null) {
      return vision;
    } else if (input.method === 'vision') {
      return failure('no_foreground', 'Vision 没在图上找到前景；主体与背景分得开时改用 --method edge，否则换一张主体清楚的图');
    } else {
      engine = 'edge';
      visionFoundNothing = true;
    }
  }
  const mask = alpha ?? await edgeAlpha(source);

  const { width, height } = source;
  const rgba = new Uint8Array(width * height * 4);
  const combined = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const a = Math.min(mask[i], source.data[i * 4 + 3]);
    combined[i] = a;
    if (a === 0) continue;
    rgba.set(source.data.subarray(i * 4, i * 4 + 3), i * 4);
    rgba[i * 4 + 3] = a;
  }
  const coverage = foregroundCoverage(combined, width, height);
  const bounds = opaqueBounds(rgba, width, { left: 0, top: 0, width, height }, TRIM_MIN_ALPHA);
  if (bounds === null || coverage.foregroundRatio === 0) {
    return failure('no_foreground', '去背后没有剩下前景：背景和主体颜色太接近，或整张都是背景');
  }
  const image = await encode(await toPixels(raw({ width, height, data: rgba }).extract(bounds)), true);
  return ok({
    engine, visionFoundNothing, ...coverage,
    image, check: await checkImage(source, image),
  });
}
