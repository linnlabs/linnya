export interface SlidesManualTranslation {
  /** 相对未应用人工位移的布局结果，单位 inches。 */
  readonly dx: number;
  readonly dy: number;
}

export interface SlidesManualVisualSize {
  /** 覆盖 Yoga 结果的最终可见宽高，单位 inches；不改变 Flex 占位。 */
  readonly width: number;
  readonly height: number;
}

export type SlidesManualTargetKind =
  | 'text'
  | 'frame'
  | 'shape'
  | 'image'
  | 'table'
  | 'chart'
  | 'svgGraphic'
  | 'formula';

export interface SlidesManualEditBase {
  readonly editKey: string;
  readonly translation?: SlidesManualTranslation;
  readonly deleted?: never;
}

export interface SlidesManualTextEdit extends SlidesManualEditBase {
  readonly kind: 'text';
  /** 当前只开放纯文本内容；rich/formula runs 保持只读。 */
  readonly content?: string;
  readonly fontSizePt?: number;
  readonly color?: string;
}

export interface SlidesManualFrameEdit extends SlidesManualEditBase {
  readonly kind: 'frame';
  readonly backgroundColor?: string;
}

export interface SlidesManualShapeEdit extends SlidesManualEditBase {
  readonly kind: 'shape';
  /** 内嵌纯文本属于形状自身，不创建虚构的子 Text 作者身份。 */
  readonly content?: string;
  readonly fillColor?: string;
  readonly visualSize?: SlidesManualVisualSize;
}

export interface SlidesManualImageEdit extends SlidesManualEditBase {
  readonly kind: 'image';
  readonly visualSize?: SlidesManualVisualSize;
}

export type SlidesManualTranslationOnlyEditKind =
  | 'table'
  | 'chart'
  | 'svgGraphic'
  | 'formula';

export interface SlidesManualTranslationOnlyEdit extends SlidesManualEditBase {
  readonly kind: SlidesManualTranslationOnlyEditKind;
  readonly translation: SlidesManualTranslation;
}

export type SlidesManualAtomicEditKind =
  | 'shape'
  | 'image'
  | SlidesManualTranslationOnlyEditKind;

export type SlidesManualAtomicEdit =
  | SlidesManualShapeEdit
  | SlidesManualImageEdit
  | SlidesManualTranslationOnlyEdit;

/** 删除值与其他人工值互斥；Frame 的删除自然覆盖完整作者子树。 */
export type SlidesManualDeletedTargetEdit = {
  readonly [Kind in SlidesManualTargetKind]: {
    readonly kind: Kind;
    readonly editKey: string;
    readonly deleted: true;
  };
}[SlidesManualTargetKind];

export type SlidesManualTargetEdit =
  | SlidesManualTextEdit
  | SlidesManualFrameEdit
  | SlidesManualAtomicEdit
  | SlidesManualDeletedTargetEdit;

export interface SlidesManualSlideEdits {
  readonly slideKey: string;
  readonly targets: readonly SlidesManualTargetEdit[];
}

/** deck.js 中唯一的人工值块；字段表示当前有效值，不是操作日志。 */
export interface SlidesManualEdits {
  readonly version: 2;
  readonly slides: readonly SlidesManualSlideEdits[];
}

/** 仅供生成的 compose 输入合同描述 v1 兼容形状；新源码必须写 v2。 */
export type SlidesManualV1TargetEdit =
  | {
      readonly kind: 'text';
      readonly editKey: string;
      readonly content?: string;
      readonly translation?: SlidesManualTranslation;
    }
  | {
      readonly kind: Exclude<SlidesManualTargetKind, 'text'>;
      readonly editKey: string;
      readonly translation: SlidesManualTranslation;
    };

/** 仅供生成的 compose 输入合同闭合 v1 依赖，不属于当前编辑输出。 */
export interface SlidesManualV1SlideEdits {
  readonly slideKey: string;
  readonly targets: readonly SlidesManualV1TargetEdit[];
}

/** 仅供 compose 输入兼容既有 v1；codec 读取后统一产出当前 v2。 */
export type SlidesManualEditsInput = SlidesManualEdits | {
  readonly version: 1;
  readonly slides: readonly SlidesManualV1SlideEdits[];
};
