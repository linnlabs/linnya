import type {
  WorkspaceDocumentCitationDiagnostic,
  WorkspaceDocumentCitationSource,
} from '@app/schemas';
import {
  buildDocumentCitationAppendix,
  DEFAULT_DOCUMENT_CITATION_APPENDIX_BUDGET,
  selectDocumentCitationDiagnosticsForBodyWindow,
  selectDocumentCitationSourcesForBodyWindow,
  type DocumentCitationProjection,
} from '../../../../domains/citation';
import {
  formatDocumentCitationDiagnosticsObservation,
  projectDocumentCitationDiagnostics,
  projectDocumentCitationSources,
} from '../functions/projectDocumentCitationReadOutput';

export interface WorkspaceDocumentCitationWindowOutput {
  readonly citationSources: readonly WorkspaceDocumentCitationSource[];
  readonly citationDiagnostics: readonly WorkspaceDocumentCitationDiagnostic[];
  readonly observationSuffix: string;
}

/**
 * 把同一份 Citation admission 收窄到实际正文窗口。
 * DocumentView 与普通 VFS text 复用该编排，外层格式和正文 cursor 仍由各自 reader 拥有。
 */
export function buildDocumentCitationWindowOutput(params: {
  readonly bodyWindow: string;
  readonly projection: DocumentCitationProjection;
}): WorkspaceDocumentCitationWindowOutput {
  const windowSources = selectDocumentCitationSourcesForBodyWindow({
    bodyWindow: params.bodyWindow,
    sources: params.projection.sources,
  });
  const projectionDiagnostics = selectDocumentCitationDiagnosticsForBodyWindow({
    bodyWindow: params.bodyWindow,
    diagnostics: params.projection.diagnostics,
  });
  const appendix = buildDocumentCitationAppendix({
    sources: windowSources,
    budget: DEFAULT_DOCUMENT_CITATION_APPENDIX_BUDGET,
  });
  const citationSources = projectDocumentCitationSources(
    windowSources,
    appendix.sourceExcerpts
  );
  const citationDiagnostics = projectDocumentCitationDiagnostics([
    ...projectionDiagnostics,
    ...appendix.diagnostics,
  ]);
  const diagnosticsObservation = formatDocumentCitationDiagnosticsObservation(
    citationDiagnostics
  );

  return {
    citationSources,
    citationDiagnostics,
    observationSuffix: [appendix.text, diagnosticsObservation]
      .filter(section => section.length > 0)
      .join('\n\n'),
  };
}
