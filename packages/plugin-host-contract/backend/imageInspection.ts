export type PluginSupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PluginImageInspectionResult {
  readonly mediaType: PluginSupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface PluginImageInspectionOptions {
  readonly maxImagePixels: number;
}

export declare function inspectImageBytes(
  bytes: Uint8Array,
  options: PluginImageInspectionOptions,
): Promise<PluginImageInspectionResult>;
