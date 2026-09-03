import sharp from 'sharp';
import {
  ImageTranscodingError,
  type JpegTranscodingOptions,
} from '../definitions/imageTranscoding';

export async function transcodeImageToJpeg(input: {
  readonly bytes: Uint8Array;
  readonly options: JpegTranscodingOptions;
}): Promise<Uint8Array> {
  assertOptions(input.options);

  try {
    const image = sharp(Buffer.from(input.bytes), {
      failOn: 'error',
      limitInputPixels: input.options.maxInputPixels,
    });
    await assertOpaqueImage(image);

    const { data, info } = await image
      .removeAlpha()
      .jpeg({
        quality: input.options.quality,
        chromaSubsampling: input.options.chromaSubsampling,
      })
      .toBuffer({ resolveWithObject: true });

    if (info.format !== 'jpeg' || info.width <= 0 || info.height <= 0) {
      throw new ImageTranscodingError(
        'invalid_image',
        'JPEG 编码没有返回有效的格式或尺寸',
      );
    }
    return data;
  } catch (error) {
    if (error instanceof ImageTranscodingError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ImageTranscodingError('invalid_image', `JPEG 转码失败: ${message}`);
  }
}

function assertOptions(options: JpegTranscodingOptions): void {
  if (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100) {
    throw new ImageTranscodingError('invalid_options', 'JPEG quality 必须是 1 到 100 的整数');
  }
  if (!Number.isSafeInteger(options.maxInputPixels) || options.maxInputPixels <= 0) {
    throw new ImageTranscodingError('invalid_options', 'JPEG 输入像素预算必须是正整数');
  }
  if (options.chromaSubsampling !== '4:4:4' && options.chromaSubsampling !== '4:2:0') {
    throw new ImageTranscodingError('invalid_options', 'JPEG chroma subsampling 不受支持');
  }
}

async function assertOpaqueImage(image: sharp.Sharp): Promise<void> {
  const metadata = await image.metadata();
  if (!metadata.hasAlpha) return;

  const channels = (await image.clone().stats()).channels;
  const alphaChannel = channels[channels.length - 1];
  if (alphaChannel === undefined || alphaChannel.min < 255) {
    throw new ImageTranscodingError(
      'invalid_image',
      'JPEG 转码只接受已经完成背景合成的不透明图片',
    );
  }
}
