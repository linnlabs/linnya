import {
  ColorPaletteCheckInputSchema,
  ColorPaletteSuggestOptionsSchema,
  type ColorPaletteCheckInput,
  type ColorPaletteCheckOutcome,
  type ColorPaletteErrorCode,
  type ColorPaletteFailure,
  type ColorPaletteSuggestOptions,
  type ColorPaletteSuggestOutcome,
} from '@app/schemas/color-palette';
import {
  checkPalette,
  decodeRngId,
  MAX_PALETTE_IMAGES,
  suggestPalettes,
  type PaletteImagePixels,
} from '@linnya/color-core/palette';
import type { ZodError } from 'zod';
import {
  decodeImageThumbnailPixels,
  ImagePixelsDecodeError,
} from 'src/shared/media/image-pixels';
import { projectCheckResult, projectSuggestion } from '../functions/projectColorPalette';

const THUMBNAIL_MAX_EDGE = 128;
const MAX_INPUT_PIXELS = 100_000_000;

export interface SuggestColorPalettesInput extends ColorPaletteSuggestOptions {
  /** 编码后的 JPEG、PNG 或 WebP；第一张是主图。解不开的图片跳过并报告下标。 */
  readonly images?: readonly Uint8Array[];
  readonly signal?: AbortSignal;
}

function failure(code: ColorPaletteErrorCode, message: string): ColorPaletteFailure {
  return { status: 'failed', code, message };
}

function invalidOptions(error: ZodError): ColorPaletteFailure {
  const issue = error.issues[0];
  return failure('invalid_options', issue ? `${issue.path.join('.')}: ${issue.message}` : '参数无效');
}

async function decodeImages(
  images: readonly Uint8Array[],
  signal: AbortSignal | undefined,
): Promise<{ readonly pixels: PaletteImagePixels[]; readonly skipped: number[] }> {
  const pixels: PaletteImagePixels[] = [];
  const skipped: number[] = [];
  for (const [index, bytes] of images.entries()) {
    signal?.throwIfAborted();
    try {
      pixels.push(await decodeImageThumbnailPixels({ bytes, maxEdge: THUMBNAIL_MAX_EDGE, maxInputPixels: MAX_INPUT_PIXELS }));
    } catch (error) {
      if (!(error instanceof ImagePixelsDecodeError)) throw error;
      skipped.push(index);
    }
  }
  return { pixels, skipped };
}

export async function suggestColorPalettes(input: SuggestColorPalettesInput): Promise<ColorPaletteSuggestOutcome> {
  const { images = [], signal, ...rawOptions } = input;
  const parsed = ColorPaletteSuggestOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) return invalidOptions(parsed.error);
  const options = parsed.data;
  if (images.length > MAX_PALETTE_IMAGES) {
    return failure('too_many_images', `最多 ${MAX_PALETTE_IMAGES} 张图片，只传主要的`);
  }
  if (options.rng !== undefined && decodeRngId(options.rng) === null) {
    return failure('invalid_rng', '编号不是配色建议输出的编号；去掉它，或使用建议结果里的编号');
  }

  const { pixels, skipped } = await decodeImages(images, signal);
  signal?.throwIfAborted();
  if (images.length > 0 && pixels.length === 0 && !options.seedColors?.length && !options.pinnedColors?.length) {
    return failure('image_unreadable', '图片都读不出来；检查路径和格式（支持 JPEG、PNG、WebP）');
  }

  const result = suggestPalettes({ ...options, images: pixels });
  switch (result.kind) {
    case 'palettes':
      return { status: 'ok', suggestion: projectSuggestion(result), skippedImages: skipped };
    case 'no_subject_color':
      return failure('no_subject_color', '图片里取不出彩色（彩度过低）；改用种子色，或退回原有配色方式');
    case 'pinned_color_neutral':
      return failure('pinned_color_neutral', `指定色 ${result.hex} 是黑白灰，没有色相；只指定有彩色并定底色明暗，或自己写一套再检查`);
    case 'pinned_color_conflict':
      return failure('pinned_color_conflict', '指定色在要求的底色上达不到对比度；去掉底色要求，或自己写一套再检查');
  }
}

export function checkColorPalette(input: ColorPaletteCheckInput): ColorPaletteCheckOutcome {
  const parsed = ColorPaletteCheckInputSchema.safeParse(input);
  if (!parsed.success) return invalidOptions(parsed.error);
  return { status: 'ok', check: projectCheckResult(checkPalette(parsed.data)) };
}
