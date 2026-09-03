import type JSZip from 'jszip';
import type { FindElementSelector, ModificationCallback } from 'pptx-automizer/dist/types/types';
import type {
  Box,
  ChartSeries as DomainChartSeries,
  PatchOperation,
  PatchTarget,
  ShapeStyle,
  StructuredSlideSpec,
  TableCell as DomainTableCell,
} from '@plugin/slides/shared';

type ModifyTextOp = Extract<PatchOperation, { op: 'modify_text' }> & {
  readonly text: string;
};

export type ElementLevelOp = ModifyTextOp | Extract<
  PatchOperation,
  { op: 'replace_image' | 'update_chart' | 'update_table' }
>;

export type DirectXmlElementOp = Extract<
  PatchOperation,
  { op: 'modify_style' | 'modify_geometry' | 'reorder_layer' }
>;

export type ApplyMasterOp = Extract<PatchOperation, { op: 'apply_master' }>;

export interface ResolvedApplyMaster {
  targetLayout: string | number;
}

export interface InsertionEntry {
  spec: StructuredSlideSpec;
  sourceLabel: string;
}

export interface PatchPlan {
  deletedSlides: Set<number>;
  insertions: Map<number, InsertionEntry[]>;
  elementOps: Map<number, ElementLevelOp[]>;
  applyMasterOps: Map<number, ApplyMasterOp>;
  resolvedApplyMasters: Map<number, ResolvedApplyMaster>;
  reorderOp: Extract<PatchOperation, { op: 'reorder_slides' }> | null;
}

export interface AutomizerSlidePort {
  modifyElement(selector: FindElementSelector, callback: ModificationCallback): void;
  useSlideLayout(layout: string | number): void;
}

export interface AutomizerPort {
  loadRoot(buffer: Buffer): AutomizerPort;
  load(buffer: Buffer, name: string): AutomizerPort;
  addSlide(sourceLabel: string, slideNumber: number, callback?: (slide: AutomizerSlidePort) => void): void;
  addMaster(sourceLabel: string, masterIndex: number): void;
  getJSZip(): Promise<JSZip>;
}

export interface ChartDataInput {
  categories: string[];
  series: DomainChartSeries[];
}

export interface TableDataInput {
  rows: DomainTableCell[][];
}

export interface GeometryPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type { Box, PatchTarget, ShapeStyle };
