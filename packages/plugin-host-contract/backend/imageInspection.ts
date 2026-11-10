export type PluginSupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PluginImageInspectionResult {
  readonly mediaType: PluginSupportedImageMediaType;
  readonly byteLength: number;
  /** 原始编码尺寸；受管资产身份与完整性校验使用这对值。 */
  readonly width: number;
  readonly height: number;
  /** 应用图片方向后的显示尺寸；文档等比布局使用这对值。 */
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly sha256: string;
}

export interface PluginImageInspectionOptions {
  readonly maxImagePixels: number;
}

export declare function inspectImageBytes(
  bytes: Uint8Array,
  options: PluginImageInspectionOptions,
): Promise<PluginImageInspectionResult>;
