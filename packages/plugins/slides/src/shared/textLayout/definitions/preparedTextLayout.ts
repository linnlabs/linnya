import type { FontUnitAdvances } from '@linnya/text-measurement-core';
import type { TextRenderNode } from '../../renderModel';
import type { FontLineMetrics, TextLayoutResult } from './types';

/** 随当前 RenderModel 投影的字体事实；不含字体路径、平台对象或可写文档状态。 */
export interface PreparedTextLayout {
  readonly sourceKind: 'generated' | 'imported';
  readonly defaultFontFamily: string;
  readonly profile: 'plain-textbox' | 'shape-inner-text';
  /** autofit 之前的锚点与尺寸，防止连续编辑累积上一次扩框。 */
  readonly inputBox: TextRenderNode['box'];
  readonly fontUnits: readonly { readonly key: number; readonly value: FontUnitAdvances; readonly source: TextLayoutResult['advanceSource'] }[];
  readonly metricsInEm: readonly { readonly key: number; readonly value: FontLineMetrics | null }[];
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
