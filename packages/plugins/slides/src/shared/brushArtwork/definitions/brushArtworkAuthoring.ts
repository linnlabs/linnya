export const BRUSH_ARTWORK_QUALITIES = ['draft', 'standard', 'high'] as const;

export type BrushArtworkQuality = 'draft' | 'standard' | 'high';

export const BRUSH_ARTWORK_BRUSHES = [
  'pen',
  'rotring',
  '2B',
  'HB',
  '2H',
  'cpencil',
  'pastel',
  'crayon',
  'charcoal',
  'spray',
  'marker',
] as const;

export type BrushArtworkBrush =
  | 'pen'
  | 'rotring'
  | '2B'
  | 'HB'
  | '2H'
  | 'cpencil'
  | 'pastel'
  | 'crayon'
  | 'charcoal'
  | 'spray'
  | 'marker';

export const BRUSH_ARTWORK_FIELDS = [
  'hand',
  'curved',
  'zigzag',
  'waves',
  'seabed',
  'spiral',
  'columns',
] as const;

export type BrushArtworkField =
  | 'hand'
  | 'curved'
  | 'zigzag'
  | 'waves'
  | 'seabed'
  | 'spiral'
  | 'columns';

export const BRUSH_ARTWORK_LIMITS = {
  maxLayers: 24,
  maxMarks: 512,
  maxPoints: 4096,
} as const;

/** 元素局部坐标，x/y 均使用 0–100；第三项是可选笔压。 */
export type BrushArtworkPoint = readonly [x: number, y: number, pressure?: number];
export type BrushArtworkPosition = readonly [x: number, y: number];

export interface BrushArtworkStroke {
  readonly brush: BrushArtworkBrush;
  readonly color: string;
  /** 相对元素短边的百分比。 */
  readonly weight?: number;
}

export interface BrushArtworkWatercolorFill {
  readonly kind: 'watercolor';
  readonly color: string;
  /** p5.brush 原生 1–255 opacity。 */
  readonly opacity?: number;
  readonly bleed?: number;
  readonly bleedDirection?: 'in' | 'out';
  readonly bleedAngle?: number;
  readonly texture?: number;
  readonly border?: number;
  readonly scatter?: boolean;
}

export interface BrushArtworkWashFill {
  readonly kind: 'wash';
  readonly color: string;
  readonly opacity?: number;
}

export interface BrushArtworkMassFill {
  readonly kind: 'mass';
  readonly brush: BrushArtworkBrush;
  readonly color: string;
  readonly precision?: number;
  readonly strength?: number;
  readonly gradient?: number;
  readonly outline?: boolean;
}

export type BrushArtworkFill =
  | BrushArtworkWatercolorFill
  | BrushArtworkWashFill
  | BrushArtworkMassFill;

export interface BrushArtworkHatch {
  readonly brush: BrushArtworkBrush;
  readonly color: string;
  /** 相对元素短边的百分比。 */
  readonly weight?: number;
  /** 相对元素短边的百分比。 */
  readonly spacing?: number;
  readonly angle?: number;
  readonly randomness?: number;
  readonly continuous?: boolean;
  readonly gradient?: number;
}

export interface BrushArtworkLineMark {
  readonly type: 'line';
  readonly from: BrushArtworkPosition;
  readonly to: BrushArtworkPosition;
}

export interface BrushArtworkSplineMark {
  readonly type: 'spline';
  readonly points: readonly BrushArtworkPoint[];
  readonly curvature?: number;
}

export interface BrushArtworkArcMark {
  readonly type: 'arc';
  readonly center: BrushArtworkPosition;
  /** 相对元素短边的百分比。 */
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export interface BrushArtworkRectMark {
  readonly type: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrushArtworkEllipseMark {
  readonly type: 'ellipse';
  readonly center: BrushArtworkPosition;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly irregularity?: number;
}

export interface BrushArtworkPolygonMark {
  readonly type: 'polygon';
  readonly points: readonly BrushArtworkPoint[];
}

export interface BrushArtworkFlowLineMark {
  readonly type: 'flowLine';
  readonly from: BrushArtworkPosition;
  /** 相对元素短边的百分比。 */
  readonly length: number;
  readonly direction: number;
}

export type BrushArtworkMark =
  | BrushArtworkLineMark
  | BrushArtworkSplineMark
  | BrushArtworkArcMark
  | BrushArtworkRectMark
  | BrushArtworkEllipseMark
  | BrushArtworkPolygonMark
  | BrushArtworkFlowLineMark;

export interface BrushArtworkLayer {
  readonly stroke?: BrushArtworkStroke;
  readonly fill?: BrushArtworkFill;
  readonly hatch?: BrushArtworkHatch;
  readonly field?: BrushArtworkField;
  readonly marks: readonly BrushArtworkMark[];
}

/**
 * Agent 可持久化的作者意图。运行时、像素尺寸和图片 ownership 不进入 deck.js。
 * 普通 JavaScript 循环可以构造 marks；Worker 只消费已经求值的数据。
 */
export interface BrushArtworkIntent {
  readonly seed: number;
  /** 当前上游不保留 alpha，因此首版必须显式给出最终不透明底色。 */
  readonly backgroundColor: string;
  readonly quality?: BrushArtworkQuality;
  readonly layers: readonly BrushArtworkLayer[];
}

export interface BrushArtworkSourceRef extends BrushArtworkIntent {
  readonly kind: 'brush_artwork';
}
