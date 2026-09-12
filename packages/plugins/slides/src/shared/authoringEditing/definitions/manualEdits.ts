export interface SlidesManualTranslation {
  /** 相对未应用人工位移的布局结果，单位 inches。 */
  readonly dx: number;
  readonly dy: number;
}

export interface SlidesManualEditBase {
  readonly editKey: string;
  readonly translation?: SlidesManualTranslation;
}

export interface SlidesManualTextEdit extends SlidesManualEditBase {
  readonly kind: 'text';
  /** 当前首期只开放纯文本内容；rich/formula runs 保持只读。 */
  readonly content?: string;
}

export interface SlidesManualFrameEdit extends SlidesManualEditBase {
  readonly kind: 'frame';
  readonly translation: SlidesManualTranslation;
}

export type SlidesManualAtomicEditKind =
  | 'shape'
  | 'image'
  | 'table'
  | 'chart'
  | 'svgGraphic'
  | 'formula';

export interface SlidesManualAtomicEdit extends SlidesManualEditBase {
  readonly kind: SlidesManualAtomicEditKind;
  readonly translation: SlidesManualTranslation;
}

export type SlidesManualTargetEdit =
  | SlidesManualTextEdit
  | SlidesManualFrameEdit
  | SlidesManualAtomicEdit;

export interface SlidesManualSlideEdits {
  readonly slideKey: string;
  readonly targets: readonly SlidesManualTargetEdit[];
}

/** deck.js 中唯一的人工值块；字段表示当前有效值，不是操作日志。 */
export interface SlidesManualEdits {
  readonly version: 1;
  readonly slides: readonly SlidesManualSlideEdits[];
}

export type SlidesManualTargetKind = SlidesManualTargetEdit['kind'];
