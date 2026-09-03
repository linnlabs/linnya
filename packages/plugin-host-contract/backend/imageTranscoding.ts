export type PluginJpegChromaSubsampling = '4:4:4' | '4:2:0';

export interface PluginJpegTranscodingOptions {
  readonly quality: number;
  readonly chromaSubsampling: PluginJpegChromaSubsampling;
  readonly maxInputPixels: number;
}

/** 把插件持有的不透明内存图片转成 JPEG；路径、asset 与发布生命周期不属于该合同。 */
export declare function transcodeImageToJpeg(
  bytes: Uint8Array,
  options: PluginJpegTranscodingOptions,
): Promise<Uint8Array>;
