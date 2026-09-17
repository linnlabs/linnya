import type { FontLineMetrics, TextLayoutResult } from './types';

/** 随当前 RenderModel 投影的字体事实；不含字体路径、平台对象或可写文档状态。 */
export interface PreparedTextLayout {
  readonly sourceKind: 'generated' | 'imported';
  readonly defaultFontFamily: string;
  readonly keys: readonly string[];
  readonly widths: readonly number[];
  readonly advances: readonly {
    readonly key: number;
    readonly fontSizePt: number;
    readonly widthIndexes: readonly number[];
    readonly source: TextLayoutResult['advanceSource'];
  }[];
  readonly metrics: readonly { readonly key: number; readonly fontSizePt: number; readonly value: FontLineMetrics | null }[];
}
