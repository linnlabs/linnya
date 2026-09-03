import { MATH_FORMULA_ERROR_CODES } from '@plugin/slides/shared/mathFormula';

export const PRESENTATION_BUILD_FAILURE_CODES = [
  'slides.codegen.typecheck',
  'slides.codegen.sandbox',
  'slides.codegen.compose_contract',
  'slides.codegen.slide_count_mismatch',
  'slides.asset.external_url_not_supported',
  'slides.asset.local_source_unavailable',
  'slides.asset.invalid_media',
  'slides.asset.ownership_denied',
  'slides.asset.binding_conflict',
  'slides.asset.store_unavailable',
  'slides.brush.invalid_intent',
  'slides.brush.render_failed',
  ...MATH_FORMULA_ERROR_CODES,
  'slides.svg.invalid_xml',
  'slides.svg.missing_viewbox',
  'slides.svg.unsupported_element',
  'slides.svg.unsupported_attribute',
  'slides.svg.external_reference_forbidden',
  'slides.svg.resource_limit_exceeded',
  'slides.svg.source_unavailable',
  'slides.svg.ownership_denied',
  'slides.svg.binding_conflict',
  'slides.svg.store_unavailable',
  'slides.svg.render_failed',
  'slides.svg.pptx_embedding_failed',
  'slides.materialization.contract_invalid',
  'slides.materialization.pptx_failed',
  'slides.persistence.commit_failed',
  'slides.persistence.draft_failed',
  'slides.environment.sandbox_unavailable',
  'slides.environment.build_executor_busy',
  'slides.environment.build_executor_unavailable',
  'slides.environment.workspace_unavailable',
  'slides.conflict.stale_source',
  'slides.conflict.stale_draft_base',
  'slides.codegen.unknown',
] as const;

export type PresentationBuildFailureCode = (typeof PRESENTATION_BUILD_FAILURE_CODES)[number];

export type PresentationBuildFailurePhase =
  | 'typecheck'
  | 'sandbox'
  | 'compose'
  | 'source_contract'
  | 'asset'
  | 'materialization'
  | 'persistence'
  | 'environment'
  | 'conflict';

export interface PresentationTypecheckDiagnostic {
  readonly tsCode: number;
  readonly line: number;
  readonly column: number;
  readonly snippet?: string;
}

export interface PresentationBuildFailure {
  readonly code: PresentationBuildFailureCode;
  /** 可安全暴露给工具与 Agent，用于关联宿主内部诊断日志。 */
  readonly referenceId?: string;
  readonly phase: PresentationBuildFailurePhase;
  readonly retryable: boolean;
  readonly sourceFixable: boolean;
  readonly summary: string;
  readonly nextAction: string;
  readonly diagnostics?: readonly PresentationTypecheckDiagnostic[];
}

export interface PresentationExpectedRevision {
  readonly revisionId: string;
  readonly revision: number;
}

/** 写入边界补齐的上下文事实；这些字段可以安全进入工具 observation。 */
export interface PresentationWriteFailure extends PresentationBuildFailure {
  readonly draftSaved: boolean;
  readonly presentationId: string | null;
  readonly expectedRevision: PresentationExpectedRevision | null;
}

export class PresentationBuildFailureError extends Error {
  readonly name = 'PresentationBuildFailureError';

  constructor(readonly failure: PresentationBuildFailure) {
    super(failure.summary);
  }
}
