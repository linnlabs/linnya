export type WorkspaceToolModelInputFailure =
  | 'conversation_context_missing'
  | 'conversation_not_found'
  | 'project_context_missing'
  | 'project_context_mismatch'
  | 'asset_uri_invalid'
  | 'artifact_claim_rejected'
  | 'asset_out_of_scope'
  | 'asset_unavailable'
  | 'asset_integrity_failed';

export class WorkspaceToolModelInputError extends Error {
  readonly name = 'WorkspaceToolModelInputError';
  readonly code = 'tool.model_input.asset_resolution_failed';

  constructor(
    readonly failure: WorkspaceToolModelInputFailure,
    readonly selectionId?: string,
    readonly requestIndex?: number,
  ) {
    super(`Workspace tool model input failed: ${failure}`);
  }
}
