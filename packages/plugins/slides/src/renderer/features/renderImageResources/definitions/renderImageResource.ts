import type { RenderAssetRef } from '../../../types/render';

/** Konva 主舞台与离屏栅格共同消费的已解码图片。 */
export interface LoadedRenderImage {
  image: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
}

/** 单页图片资源以渲染节点 id 索引，背景图片使用固定 key。 */
export interface SlideImageResourceTarget {
  key: string;
  source: RenderAssetRef | string;
}

export type SlideImageResourceMap = ReadonlyMap<string, LoadedRenderImage>;

export type ImageResourceFailureMode = 'omit' | 'reject';

export class RenderImageResourceError extends Error {
  public readonly targetKey: string;

  constructor(targetKey: string) {
    super(`Image resource could not be loaded: ${targetKey}`);
    this.name = 'RenderImageResourceError';
    this.targetKey = targetKey;
  }
}
