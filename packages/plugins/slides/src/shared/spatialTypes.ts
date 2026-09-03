import type { PresentationSourceKind } from './documentSource';

export type SpatialNodeKind = 'text' | 'shape' | 'image' | 'chart' | 'table' | 'group' | 'slide' | 'other';

export interface SpatialBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpatialNode {
  nodeId: string;
  slideNumber: number;
  kind: SpatialNodeKind;
  box: SpatialBox;
  localBox?: SpatialBox;
  parentNodeId?: string;
  zIndex: number;
  opacity?: number;
  sourceKind: PresentationSourceKind;
  childNodeIds: string[];
  text?: string;
  semanticNodeId?: string;
  semanticRole?: string;
}

export type OverlapClassification =
  | 'background'
  | 'container'
  | 'decorative'
  | 'overlay'
  | 'forbidden'
  | 'none';

export interface RelationEdge {
  type:
    | 'align_left'
    | 'align_center_x'
    | 'same_row'
    | 'same_column'
    | 'distribute_h'
    | 'distribute_v'
    | 'contain'
    | 'overlap'
    | 'z_before';
  slideNumber: number;
  nodeIds: string[];
  description: string;
  confidence: number;
  gap?: number;
  overlapType?: OverlapClassification;
}

export interface SpatialSectionSummary {
  id: string;
  slideNumber: number;
  kind: 'header' | 'cluster' | 'content' | 'footer' | 'whitespace';
  label: string;
  bounds: SpatialBox;
  nodeIds: string[];
  confidence: number;
}

export interface SpatialAnalysisSummary {
  slideNumber: number;
  sourceKind: PresentationSourceKind;
  /** 当前页没有任何可渲染节点；仅用于 inspect 非阻塞提示。 */
  isEmptySlide: boolean;
  confidence: number;
  summaryLines: string[];
  sections: SpatialSectionSummary[];
  relations: RelationEdge[];
  debugLogs: string[];
}
