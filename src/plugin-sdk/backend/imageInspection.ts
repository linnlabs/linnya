import {
  inspectImageBytes as inspectHostImageBytes,
} from '../../shared/media/image-inspection';
import type {
  PluginImageInspectionOptions,
  PluginImageInspectionResult,
} from '@linnya/plugin-host-contract/backend/imageInspection';

/**
 * 插件只提交内存 bytes；真实格式识别、完整像素解码和 hash 由 host 统一完成。
 * 这样插件无需各自携带原生图片库，也不会按文件后缀猜 MIME。
 */
export async function inspectImageBytes(
  bytes: Uint8Array,
  options: PluginImageInspectionOptions,
): Promise<PluginImageInspectionResult> {
  return await inspectHostImageBytes({
    bytes: Buffer.from(bytes),
    maxImagePixels: options.maxImagePixels,
  });
}

export type {
  PluginImageInspectionOptions,
  PluginImageInspectionResult,
  PluginSupportedImageMediaType,
} from '@linnya/plugin-host-contract/backend/imageInspection';
