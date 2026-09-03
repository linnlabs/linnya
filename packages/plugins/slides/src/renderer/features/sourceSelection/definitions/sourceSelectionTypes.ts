import type {
  RenderNodeKind,
  RenderSourceSpan,
} from '../../../types/render';

export interface SourceSelectionPoint {
  x: number;
  y: number;
}

export interface SourceSelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceSelectableElement {
  elementId: string;
  kind: RenderNodeKind;
  summary?: string;
  sourceSpan: RenderSourceSpan;
  bounds: SourceSelectionRect;
  polygon: readonly SourceSelectionPoint[];
  zPath: readonly number[];
}

export interface SourceSelectionEditSubmitPayload {
  instruction: string;
  slideNumber: number;
  targets: readonly SourceSelectableElement[];
}

export interface SourceSelectionMarquee {
  anchor: SourceSelectionPoint;
  focus: SourceSelectionPoint;
}
