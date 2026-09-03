import {
  transcodeImageToJpeg as transcodeHostImageToJpeg,
} from '../../shared/media/image-transcoding';
import type {
  PluginJpegTranscodingOptions,
} from '@linnya/plugin-host-contract/backend/imageTranscoding';

/** 插件只选择编码策略；Host 统一持有原生图片运行时和输入像素门禁。 */
export async function transcodeImageToJpeg(
  bytes: Uint8Array,
  options: PluginJpegTranscodingOptions,
): Promise<Uint8Array> {
  return await transcodeHostImageToJpeg({ bytes, options });
}

export type {
  PluginJpegChromaSubsampling,
  PluginJpegTranscodingOptions,
} from '@linnya/plugin-host-contract/backend/imageTranscoding';
