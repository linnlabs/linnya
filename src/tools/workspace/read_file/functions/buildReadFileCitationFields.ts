import type {
  WorkspaceDocumentCitationDiagnostic,
  WorkspaceDocumentCitationSource,
  WorkspaceReadFileCitationMetadata,
} from '@app/schemas';

export interface ReadFileCitationFields {
  readonly citations: WorkspaceReadFileCitationMetadata;
  readonly citation_diagnostics: WorkspaceDocumentCitationDiagnostic[];
}

/** 全局 index 只在 Agent tool facade 按 Host admitted offset 生成，不进入 Workspace provider。 */
export function buildReadFileCitationFields(params: {
  readonly sources: readonly WorkspaceDocumentCitationSource[];
  readonly diagnostics: readonly WorkspaceDocumentCitationDiagnostic[];
  readonly citationOffset: number;
}): ReadFileCitationFields {
  if (!Number.isInteger(params.citationOffset) || params.citationOffset < 0) {
    throw new Error('read_file citation offset must be a non-negative integer.');
  }
  return {
    citations: {
      citations: params.sources.map((source, index) => ({
        ...source,
        index: params.citationOffset + index + 1,
      })),
    },
    citation_diagnostics: [...params.diagnostics],
  };
}
