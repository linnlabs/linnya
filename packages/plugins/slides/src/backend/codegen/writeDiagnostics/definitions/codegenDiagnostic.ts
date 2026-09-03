import type { SlideSourceSpan } from '@plugin/slides/shared';

export interface ParseCodegenDiagnostic {
  readonly phase: 'parse';
  readonly severity: 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
  readonly path: string;
}

export type StructureCodegenDiagnosticCode =
  | 'LAYOUT_UNATTACHED_CONTENT_SUBTREE'
  | 'LAYOUT_UNATTACHED_RENDERABLE_NODE'
  | 'LAYOUT_UNATTACHED_CONFIGURED_CONTAINER';

export interface StructureCodegenDiagnostic {
  readonly phase: 'structure';
  readonly severity: 'warning';
  readonly code: StructureCodegenDiagnosticCode;
  readonly message: string;
  readonly hint: string;
  readonly slideNumber?: number;
  readonly sourceSpan: SlideSourceSpan;
}

export type CodegenDiagnostic = ParseCodegenDiagnostic | StructureCodegenDiagnostic;
