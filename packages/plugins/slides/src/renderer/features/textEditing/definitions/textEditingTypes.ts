import type { SlidesAuthoringEditRef } from '@plugin/slides/shared/authoringEditing';

export interface TextEditingPoint {
  readonly x: number;
  readonly y: number;
}

export interface TextEditingPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** 原位输入只消费当前正式视觉，不从 DOM 或 Canvas 实例反推作者值。 */
export interface TextEditingTarget {
  readonly elementId: string;
  readonly targetKind: 'text' | 'shape';
  readonly authoringRef: SlidesAuthoringEditRef;
  readonly content: string;
  readonly origin: TextEditingPoint;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly padding: TextEditingPadding;
  readonly verticalOffset: number;
  readonly fontFamily: string;
  readonly fontSizePt: number;
  readonly appliedFontScale: number;
  readonly fontWeight: 'normal' | 'bold';
  readonly fontStyle: 'normal' | 'italic';
  readonly textDecoration?: string;
  readonly color: string;
  readonly textAlign: 'left' | 'center' | 'right' | 'justify';
  readonly lineHeight: number;
  readonly letterSpacingPt?: number;
  readonly opacity: number;
}
