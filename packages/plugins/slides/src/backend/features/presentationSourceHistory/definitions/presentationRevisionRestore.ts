export interface RestorePresentationRevisionInput {
  readonly nodeId: string;
  readonly revision: number;
}

export interface PresentationRevisionSourceReader {
  getRevisionSource(nodeId: string, revision: number): Promise<string | null>;
}

export interface PresentationRevisionRestoreCompiler<TResult> {
  restoreFromSource(input: { readonly nodeId: string; readonly source: string }): Promise<TResult>;
}

export class PresentationRevisionNotFoundError extends Error {
  readonly code = 'PRESENTATION_REVISION_NOT_FOUND';

  constructor(readonly nodeId: string, readonly revision: number) {
    super(`Presentation revision not found: ${nodeId}/${revision}`);
    this.name = 'PresentationRevisionNotFoundError';
  }
}
