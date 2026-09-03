import type {
  PresentationBuildFailure,
  PresentationBuildFailureCode,
  PresentationBuildFailurePhase,
  PresentationTypecheckDiagnostic,
} from '../definitions/presentationBuildFailure';

interface PresentationBuildFailurePolicy {
  readonly phase: PresentationBuildFailurePhase;
  readonly retryable: boolean;
  readonly sourceFixable: boolean;
  readonly nextAction: string;
}

const FAILURE_POLICIES: Readonly<
  Record<PresentationBuildFailureCode, PresentationBuildFailurePolicy>
> = {
  'slides.codegen.typecheck': {
    phase: 'typecheck',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Fix the reported deck.js lines, then write the source again.',
  },
  'slides.codegen.sandbox': {
    phase: 'sandbox',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Fix the reported deck.js runtime error, then write the source again.',
  },
  'slides.codegen.compose_contract': {
    phase: 'compose',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Fix the compose input described in the summary, then write the source again.',
  },
  'slides.codegen.slide_count_mismatch': {
    phase: 'source_contract',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Declare exactly one top-level createSlide() call for each composed page.',
  },
  'slides.asset.external_url_not_supported': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction:
      'Download the image to a local file with an existing network or Shell capability, then reference that local file in deck.js.',
  },
  'slides.asset.local_source_unavailable': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction:
      'Make the referenced local image readable or replace the reference with an existing local file.',
  },
  'slides.asset.invalid_media': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Replace the referenced image with a valid supported image within the size limits.',
  },
  'slides.asset.ownership_denied': {
    phase: 'asset',
    retryable: false,
    sourceFixable: false,
    nextAction: 'Restore the presentation-owned asset link before retrying the same source.',
  },
  'slides.asset.binding_conflict': {
    phase: 'asset',
    retryable: false,
    sourceFixable: false,
    nextAction: 'Repair the presentation asset binding before retrying the same source.',
  },
  'slides.asset.store_unavailable': {
    phase: 'asset',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore the managed image store, then retry the same deck.js source.',
  },
  'slides.brush.invalid_intent': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Fix the Brush layers, marks, colors, seed, quality, or image dimensions in deck.js.',
  },
  'slides.brush.render_failed': {
    phase: 'materialization',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore the Slides Brush worker, then retry the same deck.js source.',
  },
  'slides.formula.invalid_source': {
    phase: 'source_contract',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Fix the formula source fields, then write the deck.js source again.',
  },
  'slides.formula.unsupported_syntax': {
    phase: 'source_contract',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Replace the unsupported LaTeX with the documented formula subset.',
  },
  'slides.formula.resource_limit_exceeded': {
    phase: 'source_contract',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Simplify the formula so it fits the documented parser budgets.',
  },
  'slides.formula.inline_formula_too_wide': {
    phase: 'source_contract',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Widen the text box, reduce the formula size, or use a block formula.',
  },
  'slides.formula.inline_formula_line_height_insufficient': {
    phase: 'source_contract',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Increase the exact line height or reduce the inline formula size.',
  },
  'slides.formula.projection_failed': {
    phase: 'materialization',
    retryable: false,
    sourceFixable: false,
    nextAction: 'Report the Slides formula projection defect; do not rewrite the deck.js source.',
  },
  'slides.formula.pptx_patch_failed': {
    phase: 'materialization',
    retryable: false,
    sourceFixable: false,
    nextAction: 'Report the Slides formula PPTX patch defect; do not rewrite the deck.js source.',
  },
  'slides.svg.invalid_xml': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Fix the inline or local SVG XML, then write the deck.js source again.',
  },
  'slides.svg.missing_viewbox': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Add a finite positive 0 0 viewBox to the SVG, then write the source again.',
  },
  'slides.svg.unsupported_element': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Replace the unsupported SVG element with the documented canonical subset.',
  },
  'slides.svg.unsupported_attribute': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Replace the unsupported SVG attribute or value with the documented subset.',
  },
  'slides.svg.external_reference_forbidden': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Remove external SVG resources and keep references inside the same SVG document.',
  },
  'slides.svg.resource_limit_exceeded': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Simplify the SVG so it fits the documented byte and structure budgets.',
  },
  'slides.svg.source_unavailable': {
    phase: 'asset',
    retryable: false,
    sourceFixable: true,
    nextAction: 'Restore the referenced local SVG file or replace the source reference.',
  },
  'slides.svg.ownership_denied': {
    phase: 'asset',
    retryable: false,
    sourceFixable: false,
    nextAction: 'Restore the presentation-owned SVG asset link before retrying the same source.',
  },
  'slides.svg.binding_conflict': {
    phase: 'asset',
    retryable: false,
    sourceFixable: false,
    nextAction: 'Repair the presentation SVG source binding before retrying the same source.',
  },
  'slides.svg.store_unavailable': {
    phase: 'asset',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore the managed SVG asset store, then retry the same deck.js source.',
  },
  'slides.svg.render_failed': {
    phase: 'materialization',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore the Slides raster worker, then retry the same deck.js source.',
  },
  'slides.svg.pptx_embedding_failed': {
    phase: 'materialization',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore the Slides PPTX materializer, then retry the same deck.js source.',
  },
  'slides.materialization.contract_invalid': {
    phase: 'materialization',
    retryable: false,
    sourceFixable: false,
    nextAction:
      'Report the deterministic Slides materialization contract mismatch; do not retry or rewrite the deck.js source.',
  },
  'slides.materialization.pptx_failed': {
    phase: 'materialization',
    retryable: true,
    sourceFixable: false,
    nextAction:
      'Retry the same source after the Slides materialization runtime is available; do not rewrite the deck based on this error alone.',
  },
  'slides.persistence.commit_failed': {
    phase: 'persistence',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore presentation persistence, then retry the same deck.js source.',
  },
  'slides.persistence.draft_failed': {
    phase: 'persistence',
    retryable: true,
    sourceFixable: false,
    nextAction:
      'Restore presentation draft persistence, reload the current source, then apply the edit again.',
  },
  'slides.environment.sandbox_unavailable': {
    phase: 'environment',
    retryable: true,
    sourceFixable: false,
    nextAction:
      'Restore the deck.js sandbox runner, then retry the same source without rewriting it.',
  },
  'slides.environment.build_executor_busy': {
    phase: 'environment',
    retryable: true,
    sourceFixable: false,
    nextAction:
      'Retry the same source after the current Slides build work completes; do not rewrite the deck.',
  },
  'slides.environment.build_executor_unavailable': {
    phase: 'environment',
    retryable: true,
    sourceFixable: false,
    nextAction:
      'Restore the Slides build executor, then retry the same source without rewriting it.',
  },
  'slides.environment.workspace_unavailable': {
    phase: 'environment',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Restore the Workspace document runtime, then retry the same operation.',
  },
  'slides.conflict.stale_source': {
    phase: 'conflict',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Use read_file to reload the current deck.js source, then apply the edit again.',
  },
  'slides.conflict.stale_draft_base': {
    phase: 'conflict',
    retryable: true,
    sourceFixable: false,
    nextAction: 'Use read_file to reload the current deck.js source, then apply the edit again.',
  },
  'slides.codegen.unknown': {
    phase: 'environment',
    retryable: false,
    sourceFixable: false,
    nextAction:
      'Inspect the Slides runtime failure facts before changing deck.js; this error has no safe automatic source remediation.',
  },
};

export function createPresentationBuildFailure(input: {
  readonly code: PresentationBuildFailureCode;
  readonly summary: string;
  readonly referenceId?: string;
  readonly diagnostics?: readonly PresentationTypecheckDiagnostic[];
}): PresentationBuildFailure {
  const policy = FAILURE_POLICIES[input.code];
  return {
    code: input.code,
    ...policy,
    summary: input.summary,
    ...(input.referenceId ? { referenceId: input.referenceId } : {}),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}
